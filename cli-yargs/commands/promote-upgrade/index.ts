import type { Argv, CommandModule } from "yargs";
import { serialize, parse } from "@blaze-cardano/data";
import {
  Address,
  AssetId,
  AssetName,
  Credential,
  CredentialType,
  PaymentAddress,
  PolicyId,
  Script,
  toHex,
  TransactionOutput,
} from "@blaze-cardano/core";
import { resolve } from "path";
import type { GlobalOptions } from "../../lib/global-options";
import { getNetworkId } from "../../lib/types";
import { getDeployerAddress } from "../../lib/config";
import { createBlaze } from "../../lib/provider";
import {
  getContractInstances,
  getContractAddress,
  getTwoStageContracts,
} from "../../lib/contracts";
import { extractSignersFromCbor, parsePrivateKeys } from "../../lib/signers";
import {
  getContractUtxos,
  getTwoStageUtxos,
  ensureRewardAccountsRegistered,
  isRewardAccountRegistered,
} from "../../lib/governance-provider";
import {
  createNativeMultisigScript,
  createRewardAccount,
  signTransaction,
  attachWitnesses,
  findUtxoByTxRef,
  parseInlineDatum,
} from "../../lib/transaction";
import { writeTransactionFile, printSuccess } from "../../lib/output";
import { completeTx } from "../../lib/complete-tx";
import { createTxMetadata } from "../../lib/metadata";
import { promoteValidator } from "../../lib/versions";
import * as Contracts from "../../../contract_blueprint";

const VALIDATOR_LOGIC_V2_NAMES: Record<string, string> = {
  "tech-auth": "tech_auth_logic_v2",
  council: "council_logic_v2",
  reserve: "reserve_logic_v2",
  ics: "ics_logic_v2",
  "federated-ops": "federated_ops_logic_v2",
  "terms-and-conditions": "terms_and_conditions_logic_v2",
};

interface PromoteUpgradeOptions extends GlobalOptions {
  validator: string;
  "tx-hash": string;
  "tx-index": number;
  sign: boolean;
  "output-file": string;
}

export const command = "promote-upgrade";
export const describe =
  "Promote staged logic to main for a two-stage upgrade validator";

export function builder(yargs: Argv<GlobalOptions>) {
  return yargs
    .option("validator", {
      alias: "v",
      type: "string",
      demandOption: true,
      description:
        "Validator to promote (tech-auth, council, reserve, ics, federated-ops, terms-and-conditions)",
    })
    .option("tx-hash", {
      type: "string",
      demandOption: true,
      description: "Transaction hash for the fee-paying UTxO",
    })
    .option("tx-index", {
      type: "number",
      demandOption: true,
      description: "Transaction index for the fee-paying UTxO",
    })
    .option("sign", {
      type: "boolean",
      default: true,
      description:
        "Sign the transaction (requires TECH_AUTH_PRIVATE_KEYS and COUNCIL_PRIVATE_KEYS)",
    })
    .option("output-file", {
      type: "string",
      default: "promote-upgrade-tx.json",
      description: "Output file name for the transaction",
    });
}

export async function handler(argv: PromoteUpgradeOptions) {
  const {
    network,
    output,
    validator,
    sign,
    "tx-hash": txHash,
    "tx-index": txIndex,
    "output-file": outputFile,
  } = argv;

  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, outputFile);

  console.log(
    `\nPromoting staged upgrade to main for ${validator} on ${network} network`,
  );
  console.log(`Using UTxO: ${txHash}#${txIndex}`);

  // Validate signing env vars early to avoid wasting a Blockfrost round-trip
  if (sign) {
    if (!process.env.TECH_AUTH_PRIVATE_KEYS) {
      throw new Error(
        "TECH_AUTH_PRIVATE_KEYS environment variable is required when --sign is enabled",
      );
    }
    if (!process.env.COUNCIL_PRIVATE_KEYS) {
      throw new Error(
        "COUNCIL_PRIVATE_KEYS environment variable is required when --sign is enabled",
      );
    }
  }

  const networkId = getNetworkId(network);
  const deployerAddress = getDeployerAddress();
  // Always use deployed contracts for on-chain infrastructure
  const contracts = getContractInstances(network, false);
  const targetContracts = getTwoStageContracts(validator, network, false);

  const twoStageAddress = getContractAddress(
    network,
    targetContracts.twoStage.Script,
  );

  console.log("\nTwo Stage Address:", twoStageAddress.toBech32());

  const providerType = argv.provider;
  const { blaze, provider } = await createBlaze(network, providerType);

  // Query all contract UTxOs in parallel
  const [{ main: mainUtxo, staging: stagingUtxo }, allUtxos] =
    await Promise.all([
      getTwoStageUtxos(provider, targetContracts.twoStage.Script, networkId),
      getContractUtxos(
        provider,
        {
          techAuthForever: contracts.techAuthForever.Script,
          councilForever: contracts.councilForever.Script,
          mainGovThreshold: contracts.mainGovThreshold.Script,
        },
        networkId,
      ),
    ]);

  console.log("\nFound contract UTxOs:");
  console.log("  Two stage: main and staging found");
  console.log("  Tech auth forever:", allUtxos.techAuthForever.length);
  console.log("  Council forever:", allUtxos.councilForever.length);
  console.log("  Main gov threshold:", allUtxos.mainGovThreshold.length);

  if (
    !allUtxos.techAuthForever.length ||
    !allUtxos.councilForever.length ||
    !allUtxos.mainGovThreshold.length
  ) {
    throw new Error("Missing required contract UTxOs");
  }

  const techAuthForeverUtxo = allUtxos.techAuthForever[0];
  const councilForeverUtxo = allUtxos.councilForever[0];
  const mainGovThresholdUtxo = allUtxos.mainGovThreshold[0];

  console.log("\nReading current tech auth state...");
  const techAuthDatum = techAuthForeverUtxo.output().datum()?.asInlineData();
  if (!techAuthDatum) {
    throw new Error("Tech auth forever UTxO missing inline datum");
  }
  const techAuthSigners = extractSignersFromCbor(techAuthDatum);

  console.log("Reading current council state...");
  const councilDatum = councilForeverUtxo.output().datum()?.asInlineData();
  if (!councilDatum) {
    throw new Error("Council forever UTxO missing inline datum");
  }
  const councilSigners = extractSignersFromCbor(councilDatum);

  console.log("Reading main gov threshold...");
  const thresholdState = parseInlineDatum(
    mainGovThresholdUtxo,
    Contracts.MultisigThreshold,
    parse,
  );

  // Parse staging state to get the staged logic hash
  console.log("Reading staging state...");
  const stagingState = parseInlineDatum(
    stagingUtxo,
    Contracts.UpgradeState,
    parse,
  );
  const stagedLogicHash = stagingState[0];

  console.log(`\nStaged logic hash to promote: ${stagedLogicHash}`);

  // Calculate required signers based on threshold
  const [techAuthNum, techAuthDenom, councilNum, councilDenom] = thresholdState;
  const techAuthRequiredSigners = Number(
    (BigInt(techAuthSigners.length) * techAuthNum + (techAuthDenom - 1n)) /
      techAuthDenom,
  );
  const councilRequiredSigners = Number(
    (BigInt(councilSigners.length) * councilNum + (councilDenom - 1n)) /
      councilDenom,
  );

  console.log(
    `\nRequired tech auth signers: ${techAuthRequiredSigners}/${techAuthSigners.length}`,
  );
  console.log(
    `Required council signers: ${councilRequiredSigners}/${councilSigners.length}`,
  );

  const techAuthNativeScript = createNativeMultisigScript(
    techAuthRequiredSigners,
    techAuthSigners,
    networkId,
  );
  const councilNativeScript = createNativeMultisigScript(
    councilRequiredSigners,
    councilSigners,
    networkId,
  );

  const techAuthWitnessPolicy = PolicyId(techAuthNativeScript.hash());
  const councilWitnessPolicy = PolicyId(councilNativeScript.hash());

  // Create gov auth reward account — main govAuth for promote operations
  const govAuthRewardAccount = createRewardAccount(
    contracts.govAuth.Script.hash(),
    networkId,
  );

  // Pre-flight: check that the main gov auth reward account is registered
  await ensureRewardAccountsRegistered(
    [
      {
        label: "Main Gov Auth",
        rewardAccount: govAuthRewardAccount,
        scriptHash: contracts.govAuth.Script.hash(),
      },
    ],
    network,
  );

  // Check if the promoted logic hash needs stake credential registration.
  // After promote, governance commands use the new logic hash as a withdrawal
  // (reward account). If it's a v2 logic script not yet registered, we must
  // include addRegisterStake in this transaction so subsequent governance
  // commands can use it immediately.
  const promotedLogicRewardAccount = createRewardAccount(
    stagedLogicHash,
    networkId,
  );
  const promotedLogicAlreadyRegistered = await isRewardAccountRegistered(
    promotedLogicRewardAccount,
    network,
  );
  if (!promotedLogicAlreadyRegistered) {
    console.log(
      `\n  Promoted logic hash not yet registered as stake credential.`,
    );
    console.log(`  Will register ${stagedLogicHash} in this transaction.`);
  }

  // Get staging UTxO reference for redeemer
  const stagingInput = stagingUtxo.input();

  // Build redeemer - Main variant references the staging UTxO
  const redeemer = serialize(Contracts.TwoStageRedeemer, [
    "Logic",
    {
      Main: [
        {
          transaction_id: stagingInput.transactionId(),
          output_index: BigInt(stagingInput.index()),
        },
      ],
    },
  ]);

  // Parse current main datum to get round
  const currentMainState = parseInlineDatum(
    mainUtxo,
    Contracts.UpgradeState,
    parse,
  );

  const newMainState: Contracts.UpgradeState = [
    stagedLogicHash,
    currentMainState[1], // keep mitigation_logic
    currentMainState[2], // keep gov_auth
    currentMainState[3], // keep mitigation_auth
    currentMainState[4], // keep round
    stagingState[5], // logic_round from staging (set during stage-upgrade)
  ];

  // Build gov auth redeemer (using first tech auth signer)
  const govAuthRedeemerData = serialize(Contracts.PermissionedRedeemer, {
    [techAuthSigners[0].paymentHash]: techAuthSigners[0].sr25519Key,
  });

  const changeAddress = Address.fromBech32(deployerAddress);
  const deployerUtxos = await provider.getUnspentOutputs(changeAddress);
  const userUtxo = findUtxoByTxRef(deployerUtxos, txHash, txIndex);

  if (!userUtxo) {
    throw new Error(`User UTXO not found: ${txHash}#${txIndex}`);
  }

  const MAIN_TOKEN_HEX = toHex(new TextEncoder().encode("main"));
  const TECH_WITNESS_ASSET = toHex(
    new TextEncoder().encode("tech-auth-witness"),
  );
  const COUNCIL_WITNESS_ASSET = toHex(
    new TextEncoder().encode("council-auth-witness"),
  );

  const txBuilder = blaze
    .newTransaction()
    .addInput(mainUtxo, redeemer)
    .addInput(userUtxo)
    .addReferenceInput(stagingUtxo)
    .addReferenceInput(mainGovThresholdUtxo)
    .addReferenceInput(techAuthForeverUtxo)
    .addReferenceInput(councilForeverUtxo)
    .provideScript(targetContracts.twoStage.Script)
    .provideScript(contracts.govAuth.Script)
    .addMint(
      techAuthWitnessPolicy,
      new Map([[AssetName(TECH_WITNESS_ASSET), 1n]]),
    )
    .provideScript(Script.newNativeScript(techAuthNativeScript))
    .addMint(
      councilWitnessPolicy,
      new Map([[AssetName(COUNCIL_WITNESS_ASSET), 1n]]),
    )
    .provideScript(Script.newNativeScript(councilNativeScript))
    .addWithdrawal(govAuthRewardAccount, 0n, govAuthRedeemerData)
    .addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(twoStageAddress.toBech32()),
        value: {
          coins: mainUtxo.output().amount().coin(),
          assets: new Map([
            [
              AssetId(targetContracts.twoStage.Script.hash() + MAIN_TOKEN_HEX),
              1n,
            ],
          ]),
        },
        datum: serialize(Contracts.UpgradeState, newMainState).toCore(),
      }),
    )
    .setChangeAddress(changeAddress)
    .setMetadata(createTxMetadata("promote-upgrade"))
    .setFeePadding(50000n);

  // Register the promoted logic hash as a stake credential so subsequent
  // governance commands can use it as a withdrawal (reward account).
  if (!promotedLogicAlreadyRegistered) {
    txBuilder.addRegisterStake(
      Credential.fromCore({
        hash: stagedLogicHash,
        type: CredentialType.ScriptHash,
      }),
    );
  }

  const { tx } = await completeTx(txBuilder, {
    commandName: "promote-upgrade",
    provider,
    networkId,
    environment: network,
    knownUtxos: [
      mainUtxo,
      stagingUtxo,
      mainGovThresholdUtxo,
      techAuthForeverUtxo,
      councilForeverUtxo,
      userUtxo,
    ],
  });

  if (sign) {
    const signerKeyGroups = [
      {
        label: "tech auth",
        keys: parsePrivateKeys("TECH_AUTH_PRIVATE_KEYS"),
      },
      { label: "council", keys: parsePrivateKeys("COUNCIL_PRIVATE_KEYS") },
    ];

    const allSignatures: ReturnType<typeof signTransaction> = [];

    for (const { label, keys } of signerKeyGroups) {
      console.log(`\nSigning with ${keys.length} ${label} private keys...`);
      const signatures = signTransaction(tx.getId(), keys);
      allSignatures.push(...signatures);
      console.log(`  Created ${signatures.length} signatures`);
    }

    const signedTx = attachWitnesses(tx.toCbor(), allSignatures);
    writeTransactionFile(
      outputPath,
      signedTx.toCbor(),
      tx.getId(),
      true,
      "Promote Upgrade Transaction",
    );
    printSuccess(`Signed transaction written to ${outputPath}`);
  } else {
    writeTransactionFile(
      outputPath,
      tx.toCbor(),
      tx.getId(),
      false,
      "Promote Upgrade Transaction",
    );
    printSuccess(`Unsigned transaction written to ${outputPath}`);
  }

  console.log("\nTransaction ID:", tx.getId());

  // Track promoted validator in versions.json
  const logicV2Name = VALIDATOR_LOGIC_V2_NAMES[validator];
  if (logicV2Name) {
    if (promoteValidator(network, logicV2Name)) {
      printSuccess(`Tracked ${logicV2Name} as promoted in versions.json`);
    } else {
      console.warn(
        `Warning: Could not track ${logicV2Name} as promoted — versions.json not found`,
      );
    }
  }
}

const commandModule: CommandModule<GlobalOptions, PromoteUpgradeOptions> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;
