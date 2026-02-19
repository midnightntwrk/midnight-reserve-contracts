import type { Argv, CommandModule } from "yargs";
import { serialize, parse } from "@blaze-cardano/data";
import {
  Address,
  AssetId,
  AssetName,
  PaymentAddress,
  PolicyId,
  Script,
  toHex,
  TransactionOutput,
} from "@blaze-cardano/core";
import { resolve } from "path";
import type { GlobalOptions } from "../../lib/global-options";
import type { NetworkConfig } from "../../lib/types";
import { getNetworkId, getConfigSection } from "../../lib/types";
import { loadAikenConfig, getDeployerAddress } from "../../lib/config";
import { createBlaze } from "../../lib/provider";
import {
  type ContractInstances,
  getContractInstances,
  getContractAddress,
  getTwoStageContracts,
  loadContractModule,
} from "../../lib/contracts";
import { extractSignersFromCbor } from "../../lib/signers";
import {
  validateScriptHash,
  validateTxHash,
  validateTxIndex,
} from "../../lib/validation";
import {
  getContractUtxos,
  getTwoStageUtxos,
  ensureRewardAccountsRegistered,
} from "../../lib/governance-provider";
import { parsePrivateKeys } from "../../lib/signers";
import {
  createNativeMultisigScript,
  createRewardAccount,
  signTransaction,
  attachWitnesses,
  findUtxoWithMainAsset,
  findUtxoByTxRef,
  parseInlineDatum,
} from "../../lib/transaction";
import { writeTransactionFile, printSuccess } from "../../lib/output";
import { completeTx } from "../../lib/complete-tx";
import { createTxMetadata } from "../../lib/metadata";
import {
  mergeValidatorToDeployedScripts,
  readVersionsJson,
  addStagedValidator,
  resolveValidatorNameByHash,
} from "../../lib/versions";
import { diffBlueprints } from "../../lib/blueprint-diff";
import * as Contracts from "../../../contract_blueprint";

function getStagingForeverHash(
  validatorName: string,
  contracts: ContractInstances,
): string {
  let contract: { Script: Script } | undefined;
  switch (validatorName) {
    case "tech-auth":
      contract = contracts.techAuthStagingForever;
      break;
    case "council":
      contract = contracts.councilStagingForever;
      break;
    case "reserve":
      contract = contracts.reserveStagingForever;
      break;
    case "ics":
      contract = contracts.icsStagingForever;
      break;
    case "federated-ops":
      contract = contracts.federatedOpsStagingForever;
      break;
    case "terms-and-conditions":
      contract = contracts.termsAndConditionsStagingForever;
      break;
    default:
      throw new Error(`Unknown validator: ${validatorName}`);
  }
  if (!contract) {
    throw new Error(
      `Staging forever contract not found for ${validatorName}. Ensure the blueprint includes staging forever validators.`,
    );
  }
  return contract.Script.hash();
}

function getLogicOneShotRef(
  validatorName: string,
  config: NetworkConfig,
): { hash: string; index: number } {
  switch (validatorName) {
    case "tech-auth":
      return {
        hash: config.technical_authority_logic_v2_one_shot_hash,
        index: config.technical_authority_logic_v2_one_shot_index,
      };
    case "council":
      return {
        hash: config.council_logic_v2_one_shot_hash,
        index: config.council_logic_v2_one_shot_index,
      };
    case "reserve":
      return {
        hash: config.reserve_logic_v2_one_shot_hash,
        index: config.reserve_logic_v2_one_shot_index,
      };
    case "ics":
      return {
        hash: config.ics_logic_v2_one_shot_hash,
        index: config.ics_logic_v2_one_shot_index,
      };
    case "federated-ops":
      return {
        hash: config.federated_operators_logic_v2_one_shot_hash,
        index: config.federated_operators_logic_v2_one_shot_index,
      };
    case "terms-and-conditions":
      return {
        hash: config.terms_and_conditions_logic_v2_one_shot_hash,
        index: config.terms_and_conditions_logic_v2_one_shot_index,
      };
    default:
      throw new Error(`Unknown validator: ${validatorName}`);
  }
}

interface StageUpgradeOptions extends GlobalOptions {
  validator: string;
  "new-logic-hash": string;
  "tx-hash": string;
  "tx-index": number;
  sign: boolean;
  "output-file": string;
  "use-build": boolean;
}

export const command = "stage-upgrade";
export const describe =
  "Stage a new logic hash for a two-stage upgrade validator";

export function builder(yargs: Argv<GlobalOptions>) {
  return yargs
    .option("validator", {
      alias: "v",
      type: "string",
      demandOption: true,
      choices: [
        "tech-auth",
        "council",
        "reserve",
        "ics",
        "federated-ops",
        "terms-and-conditions",
      ] as const,
      description: "Validator to upgrade",
    })
    .option("new-logic-hash", {
      type: "string",
      demandOption: true,
      description: "New logic script hash to stage (56 hex chars, 28 bytes)",
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
      description: "Sign the transaction (requires TECH_AUTH_PRIVATE_KEYS)",
    })
    .option("output-file", {
      type: "string",
      default: "stage-upgrade-tx.json",
      description: "Output file name for the transaction",
    })
    .option("use-build", {
      type: "boolean",
      default: false,
      description: "Use build output instead of deployed blueprint",
    });
}

export async function handler(argv: StageUpgradeOptions) {
  const {
    network,
    output,
    validator,
    sign,
    "new-logic-hash": newLogicHash,
    "tx-hash": txHash,
    "tx-index": txIndex,
    "output-file": outputFile,
    "use-build": useBuild,
  } = argv;

  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, outputFile);

  // Validate inputs before any processing
  validateScriptHash(newLogicHash);
  validateTxHash(txHash);
  validateTxIndex(txIndex);

  console.log(`\nStaging upgrade for ${validator} on ${network} network`);
  console.log(`New logic hash: ${newLogicHash}`);
  console.log(`Using UTxO: ${txHash}#${txIndex}`);

  // Validate signing env vars early to avoid wasting a Blockfrost round-trip
  if (sign) {
    if (!process.env.TECH_AUTH_PRIVATE_KEYS) {
      throw new Error(
        "TECH_AUTH_PRIVATE_KEYS environment variable is required when --sign is enabled",
      );
    }
  }

  // Pre-flight: check if the hash being staged is already a promoted validator.
  // This is version-agnostic — looks up the hash, not a hardcoded v2 name.
  const resolvedName = resolveValidatorNameByHash(network, newLogicHash);
  const versionsData = readVersionsJson(network);
  const isRestage =
    (resolvedName !== null &&
      (versionsData?.promoted.includes(resolvedName) ?? false)) ||
    (versionsData?.promoted.includes(newLogicHash) ?? false);
  if (isRestage) {
    console.log(
      `\n  Re-staging promoted validator: ${resolvedName} (${newLogicHash})`,
    );
  }

  const networkId = getNetworkId(network);
  const deployerAddress = getDeployerAddress();
  // Always use deployed contracts for on-chain infrastructure
  const contracts = getContractInstances(network, false);
  const targetContracts = getTwoStageContracts(validator, network, false);
  // Load build contracts separately for new contract detection when --use-build
  const buildContracts = useBuild
    ? getContractInstances(network, true)
    : undefined;

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
          stagingGovThreshold: contracts.stagingGovThreshold.Script,
          councilTwoStage: contracts.councilTwoStage.Script,
        },
        networkId,
      ),
    ]);

  console.log("\nFound contract UTxOs:");
  console.log("  Two stage: main and staging found");
  console.log("  Tech auth forever:", allUtxos.techAuthForever.length);
  console.log("  Council forever:", allUtxos.councilForever.length);
  console.log("  Staging gov threshold:", allUtxos.stagingGovThreshold.length);
  console.log("  Council two stage:", allUtxos.councilTwoStage.length);

  if (
    !allUtxos.techAuthForever.length ||
    !allUtxos.councilForever.length ||
    !allUtxos.stagingGovThreshold.length ||
    !allUtxos.councilTwoStage.length
  ) {
    throw new Error("Missing required contract UTxOs");
  }

  const techAuthForeverUtxo = allUtxos.techAuthForever[0];
  const councilForeverUtxo = allUtxos.councilForever[0];
  const stagingGovThresholdUtxo = allUtxos.stagingGovThreshold[0];
  const councilTwoStageMainUtxo = findUtxoWithMainAsset(
    allUtxos.councilTwoStage,
  );

  if (!councilTwoStageMainUtxo) {
    throw new Error('Could not find council two-stage UTxO with "main" asset');
  }

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

  console.log("Reading staging gov threshold...");
  const thresholdState = parseInlineDatum(
    stagingGovThresholdUtxo,
    Contracts.MultisigThreshold,
    parse,
  );

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

  // Create gov auth reward account — use stagingGovAuth for staging operations
  const govAuthRewardAccount = createRewardAccount(
    contracts.stagingGovAuth.Script.hash(),
    networkId,
  );

  // Pre-flight: check that the staging gov auth reward account is registered
  await ensureRewardAccountsRegistered(
    [
      {
        label: "Staging Gov Auth",
        rewardAccount: govAuthRewardAccount,
        scriptHash: contracts.stagingGovAuth.Script.hash(),
      },
    ],
    network,
  );

  // Get main UTxO reference for redeemer
  const mainInput = mainUtxo.input();

  // Build redeemer: TwoStageRedeemer [UpdateField, WhichStage]
  const redeemer = serialize(Contracts.TwoStageRedeemer, [
    "Logic",
    {
      Staging: [
        {
          transaction_id: mainInput.transactionId(),
          output_index: BigInt(mainInput.index()),
        },
        newLogicHash,
      ],
    },
  ]);

  // Parse current staging datum to get round
  const currentStagingState = parseInlineDatum(
    stagingUtxo,
    Contracts.UpgradeState,
    parse,
  );

  const newStagingState: Contracts.UpgradeState = [
    newLogicHash,
    currentStagingState[1], // keep mitigation_logic
    currentStagingState[2], // keep gov_auth
    currentStagingState[3], // keep mitigation_auth
    currentStagingState[4], // keep round
    currentStagingState[5] + 1n, // increment logic round
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

  const STAGING_TOKEN_HEX = toHex(new TextEncoder().encode("staging"));
  const TECH_WITNESS_ASSET = toHex(
    new TextEncoder().encode("tech-auth-witness"),
  );
  const COUNCIL_WITNESS_ASSET = toHex(
    new TextEncoder().encode("council-auth-witness"),
  );

  // Detect if newLogicHash is a new contract (in build but not deployed) via blueprint diff
  let newLogicContract: { hash: string } | null = null;
  if (useBuild) {
    const configSection = getConfigSection(network);
    const deployedModule = loadContractModule(configSection, false);
    const buildModule = loadContractModule(configSection, true);
    const diff = diffBlueprints(deployedModule, buildModule);
    newLogicContract = diff.added.find((c) => c.hash === newLogicHash) ?? null;
  }
  const isNewContract = newLogicContract !== null;

  // councilTwoStageMainUtxo is the same on-chain UTxO as mainUtxo when
  // validator === "council", so skip it to avoid a duplicate reference input.
  const councilTwoStageIsSeparate =
    councilTwoStageMainUtxo.input().transactionId() !==
      mainUtxo.input().transactionId() ||
    councilTwoStageMainUtxo.input().index() !== mainUtxo.input().index();

  const txBuilder = blaze
    .newTransaction()
    .addInput(stagingUtxo, redeemer)
    .addInput(userUtxo)
    .addReferenceInput(mainUtxo)
    .addReferenceInput(stagingGovThresholdUtxo)
    .addReferenceInput(techAuthForeverUtxo)
    .addReferenceInput(councilForeverUtxo)
    .provideScript(targetContracts.twoStage.Script)
    .provideScript(contracts.stagingGovAuth.Script)
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
          coins: stagingUtxo.output().amount().coin(),
          assets: new Map([
            [
              AssetId(
                targetContracts.twoStage.Script.hash() + STAGING_TOKEN_HEX,
              ),
              1n,
            ],
          ]),
        },
        datum: serialize(Contracts.UpgradeState, newStagingState).toCore(),
      }),
    )
    .setChangeAddress(changeAddress)
    .setMetadata(createTxMetadata("stage-upgrade"))
    .setFeePadding(50000n);

  if (councilTwoStageIsSeparate) {
    txBuilder.addReferenceInput(councilTwoStageMainUtxo);
  }

  // Log if new contract detected — StagingState NFT must be minted separately
  if (isNewContract && newLogicContract) {
    const aikenConfig = loadAikenConfig(network);
    const stagingForeverHash = getStagingForeverHash(
      validator,
      buildContracts ?? contracts,
    );
    const oneShotRef = getLogicOneShotRef(validator, aikenConfig);

    console.log(`\n  New logic contract detected: ${newLogicHash}`);
    console.log(`  StagingState NFT must be minted in a separate transaction.`);
    console.log(`  One-shot UTxO: ${oneShotRef.hash}#${oneShotRef.index}`);
    console.log(`  Staging forever hash: ${stagingForeverHash}`);
    console.log(`  CNIGHT test policy: ${aikenConfig.cnight_policy}`);
  }

  const { tx } = await completeTx(txBuilder, {
    commandName: "stage-upgrade",
    provider,
    networkId,
    environment: network,
    knownUtxos: [
      stagingUtxo,
      mainUtxo,
      stagingGovThresholdUtxo,
      techAuthForeverUtxo,
      councilForeverUtxo,
      ...(councilTwoStageIsSeparate ? [councilTwoStageMainUtxo] : []),
      userUtxo,
    ],
  });

  // Merge staged validator into deployed-scripts when using build contracts
  if (useBuild) {
    const projectRoot = resolve(import.meta.dir, "../../..");
    const plutusJsonPath = resolve(projectRoot, `plutus-${network}.json`);
    mergeValidatorToDeployedScripts(network, newLogicHash, plutusJsonPath);
    printSuccess(
      `Merged ${validator} validator into deployed-scripts/${network}/plutus.json`,
    );
  }

  if (sign) {
    const techAuthKeys = parsePrivateKeys("TECH_AUTH_PRIVATE_KEYS");

    console.log(
      `\nSigning with ${techAuthKeys.length} tech auth private keys...`,
    );
    const signatures = signTransaction(tx.getId(), techAuthKeys);
    console.log(`  Created ${signatures.length} signatures`);

    const signedTx = attachWitnesses(tx.toCbor(), signatures);
    writeTransactionFile(
      outputPath,
      signedTx.toCbor(),
      tx.getId(),
      true,
      "Stage Upgrade Transaction",
    );
    printSuccess(`Signed transaction written to ${outputPath}`);
  } else {
    writeTransactionFile(
      outputPath,
      tx.toCbor(),
      tx.getId(),
      false,
      "Stage Upgrade Transaction",
    );
    printSuccess(`Unsigned transaction written to ${outputPath}`);
  }

  console.log("\nTransaction ID:", tx.getId());

  // Track staged validator in versions.json (skip for re-staged promoted validators)
  if (!isRestage) {
    const stagedName =
      resolveValidatorNameByHash(network, newLogicHash) ?? newLogicHash;
    if (addStagedValidator(network, stagedName)) {
      printSuccess(`Tracked ${stagedName} as staged in versions.json`);
    } else {
      console.warn(
        `Warning: Could not track staged validator — versions.json not found for ${network}`,
      );
    }
  }
}

const commandModule: CommandModule<GlobalOptions, StageUpgradeOptions> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;
