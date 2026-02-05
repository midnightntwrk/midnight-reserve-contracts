import {
  Address,
  AssetId,
  AssetName,
  PaymentAddress,
  PlutusData,
  PlutusList,
  PolicyId,
  Script,
  toHex,
  TransactionOutput,
} from "@blaze-cardano/core";
import { serialize, parse } from "@blaze-cardano/data";
import { resolve } from "path";
import { existsSync } from "fs";

import type { StageUpgradeOptions } from "../lib/types";
import { getNetworkId, getConfigSection } from "../lib/types";
import { loadAikenConfig, getDeployerAddress } from "../lib/config";
import { createBlaze } from "../lib/provider";
import { getProtocolParameters, calculateMinUtxo } from "../lib/protocol";
import {
  type ContractInstances,
  getContractInstances,
  getCredentialAddress,
  getTwoStageContracts,
  loadContractModule,
} from "../lib/contracts";
import { extractSignersFromMultisigState } from "../lib/signers";
import {
  printSuccess,
  printError,
  writeTransactionFile,
  getContractUtxos,
  getTwoStageUtxos,
  parseInlineDatum,
} from "../utils";
import {
  createNativeMultisigScript,
  createRewardAccount,
  signTransaction,
  attachWitnesses,
  findUtxoWithMainAsset,
  findUtxoByTxRef,
} from "../utils/transaction";
import { createTxMetadata } from "../utils/metadata";
import {
  saveVersionSnapshot,
  type VersionInfo,
  type ChangeRecord,
} from "../lib/versions";
import { diffBlueprints } from "../lib/blueprint-diff";
import * as Contracts from "../../contract_blueprint";

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

export async function stageUpgrade(
  options: StageUpgradeOptions,
): Promise<void> {
  const {
    network,
    output,
    validator,
    newLogicHash,
    txHash,
    txIndex,
    sign,
    outputFile,
  } = options;
  const deploymentDir = resolve(output, network);
  const outputPath = resolve(deploymentDir, outputFile);

  console.log(`\nStaging upgrade for ${validator} on ${network} network`);
  console.log(`New logic hash: ${newLogicHash}`);
  console.log(`Using UTxO: ${txHash}#${txIndex}`);

  const networkId = getNetworkId(network);
  const deployerAddress = getDeployerAddress();
  // Always use deployed contracts for on-chain infrastructure (two-stage, forever, gov auth, thresholds)
  const contracts = getContractInstances(network, false);
  const targetContracts = getTwoStageContracts(validator, network, false);
  // Load build contracts separately for new contract detection when --use-build is specified
  const buildContracts = options.useBuild
    ? getContractInstances(network, true)
    : undefined;

  const twoStageAddress = getCredentialAddress(
    network,
    targetContracts.twoStage.Script.hash(),
  );

  console.log("\nTwo Stage Address:", twoStageAddress.toBech32());

  const { blaze, provider } = await createBlaze(network, options.provider);

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
  const techAuthState = parseInlineDatum(
    techAuthForeverUtxo,
    Contracts.VersionedMultisig,
    parse,
  );
  const techAuthSigners = extractSignersFromMultisigState(techAuthState);

  console.log("Reading current council state...");
  const councilState = parseInlineDatum(
    councilForeverUtxo,
    Contracts.VersionedMultisig,
    parse,
  );
  const councilSigners = extractSignersFromMultisigState(councilState);

  console.log("Reading staging gov threshold...");
  const thresholdState = parseInlineDatum(
    stagingGovThresholdUtxo,
    Contracts.MultisigThreshold,
    parse,
  );

  // Calculate required signers based on threshold
  // MultisigThreshold is now a tuple: [tech_auth_num, tech_auth_denom, council_num, council_denom]
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

  // Create gov auth reward account
  // Use stagingGovAuth for staging operations - the datum stores stagingGovAuth as auth
  const govAuthRewardAccount = createRewardAccount(
    contracts.stagingGovAuth.Script.hash(),
    networkId,
  );

  // Get main UTxO reference for redeemer
  const mainInput = mainUtxo.input();

  // Build redeemer
  // TwoStageRedeemer is now a tuple: [UpdateField, WhichStage]
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
  const configSection = getConfigSection(network);
  const deployedModule = loadContractModule(configSection, true);
  const buildModule = loadContractModule(configSection, false);
  const diff = diffBlueprints(deployedModule, buildModule);
  const newLogicContract =
    diff.added.find((c) => c.hash === newLogicHash) ?? null;
  const isNewContract = newLogicContract !== null;

  try {
    let txBuilder = blaze
      .newTransaction()
      .addInput(stagingUtxo, redeemer)
      .addInput(userUtxo)
      .addReferenceInput(mainUtxo)
      .addReferenceInput(stagingGovThresholdUtxo)
      .addReferenceInput(techAuthForeverUtxo)
      .addReferenceInput(councilForeverUtxo)
      .addReferenceInput(councilTwoStageMainUtxo) // For staging_gov_auth's logic_is_on_main check
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

    // Auto-mint StagingState NFT for new logic contracts (not in deployed blueprint)
    if (isNewContract && newLogicContract) {
      const aikenConfig = loadAikenConfig(network);
      const stagingForeverHash = getStagingForeverHash(
        validator,
        buildContracts ?? contracts,
      );
      const cnightTestPolicy = aikenConfig.cnight_policy;

      // StagingState has @list annotation: [cnight_test_policy, forever_script_hash]
      const stagingStateList = new PlutusList();
      stagingStateList.add(
        PlutusData.newBytes(Buffer.from(cnightTestPolicy, "hex")),
      );
      stagingStateList.add(
        PlutusData.newBytes(Buffer.from(stagingForeverHash, "hex")),
      );
      const stagingStateDatum = PlutusData.newList(stagingStateList);

      const newLogicPolicyId = PolicyId(newLogicContract.hash);
      const newLogicScriptAddress = getCredentialAddress(
        network,
        newLogicContract.hash,
      );

      const protocolParams = await getProtocolParameters(provider);

      const stagingStateOutput = TransactionOutput.fromCore({
        address: PaymentAddress(newLogicScriptAddress.toBech32()),
        value: {
          coins: 0n,
          assets: new Map([[AssetId(newLogicPolicyId + AssetName("")), 1n]]),
        },
        datum: stagingStateDatum.toCore(),
      });
      stagingStateOutput
        .amount()
        .setCoin(calculateMinUtxo(protocolParams, stagingStateOutput));

      txBuilder = txBuilder
        .addMint(
          newLogicPolicyId,
          new Map([[AssetName(""), 1n]]),
          PlutusData.newInteger(0n),
        )
        .provideScript(newLogicContract.script)
        .addOutput(stagingStateOutput);

      console.log(
        `  Auto-minting StagingState NFT for new logic ${newLogicHash}`,
      );
      console.log(`  Staging forever hash: ${stagingForeverHash}`);
      console.log(`  CNIGHT test policy: ${cnightTestPolicy}`);
    }

    const tx = await txBuilder.complete();

    printSuccess(`Transaction built: ${tx.getId()}`);

    // Save version snapshot when using build contracts (v2+ upgrade)
    if (options.useBuild) {
      const projectRoot = resolve(import.meta.dir, "../..");
      const plutusJsonPath = resolve(projectRoot, `plutus-${network}.json`);
      const blueprintPath = resolve(
        projectRoot,
        `contract_blueprint_${network}.ts`,
      );

      if (existsSync(plutusJsonPath) && existsSync(blueprintPath)) {
        const versionInfo: VersionInfo = {
          round: newStagingState[4],
          logicRound: newStagingState[5],
          timestamp: new Date().toISOString(),
          gitCommit: "",
        };

        const changes: ChangeRecord[] = [
          {
            type: "stage",
            validator,
            oldHash: currentStagingState[0],
            newHash: newLogicHash,
            description: `Staged ${validator} logic upgrade`,
          },
        ];

        const versionName = saveVersionSnapshot(
          network,
          versionInfo,
          changes,
          plutusJsonPath,
          blueprintPath,
        );
        printSuccess(
          `Saved version snapshot to deployed-scripts/${network}/versions/${versionName}/`,
        );
      } else {
        console.warn(
          `\nWarning: Skipping version snapshot — build artifacts not found:` +
            `\n  plutus: ${plutusJsonPath} (${existsSync(plutusJsonPath) ? "exists" : "MISSING"})` +
            `\n  blueprint: ${blueprintPath} (${existsSync(blueprintPath) ? "exists" : "MISSING"})` +
            `\n  Run 'just build' first to generate these files.`,
        );
      }
    } else {
      console.warn(
        `\nWarning: No version snapshot saved — pass --use-build to save a version snapshot to deployed-scripts.`,
      );
    }

    if (sign) {
      // Sign with tech auth keys only (staging doesn't require council signatures)
      const { parsePrivateKeys } = await import("../lib/signers");
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
  } catch (error) {
    printError("Transaction build failed");
    console.error(error);
    throw error;
  }
}
