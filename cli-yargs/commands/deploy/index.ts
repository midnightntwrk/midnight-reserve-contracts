import type { Argv, CommandModule } from "yargs";
import {
  addressFromValidator,
  AssetId,
  AssetName,
  Credential,
  CredentialType,
  PaymentAddress,
  PlutusData,
  PolicyId,
  Script,
  toHex,
  TransactionId,
  TransactionInput,
  TransactionOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { calculateRequiredCollateral } from "@blaze-cardano/tx";
import { resolve } from "path";
import { readFileSync, existsSync } from "fs";
import type { TransactionUnspentOutput } from "@blaze-cardano/core";

import type { GlobalOptions } from "../../lib/global-options";
import type { ProviderType, TransactionOutput as TxOutput } from "../../lib/types";
import { getNetworkId } from "../../lib/types";
import {
  loadAikenConfig,
  getDeployerAddress,
  getDeployUtxoAmount,
  getTechAuthThreshold,
  getCouncilThreshold,
  getCouncilStagingThreshold,
  getTechAuthStagingThreshold,
  getTermsAndConditionsInitialHash,
  getTermsAndConditionsInitialLink,
  type Threshold,
} from "../../lib/config";
import { createBlaze } from "../../lib/provider";
import { getProtocolParameters, calculateMinUtxo } from "../../lib/protocol";
import { getContractInstances } from "../../lib/contracts";
import {
  saveVersionSnapshot,
  setCurrentVersion,
  type ChangeRecord,
} from "../../lib/versions";
import {
  parseSignersWithCount,
  createMultisigStateFromMap,
} from "../../lib/signers";
import { createFederatedOpsDatum } from "../../lib/candidates";
import {
  writeJsonFile,
  createDeploymentOutput,
  printSuccess,
  printError,
  printInfo,
  printTransactionSummary,
  ensureDirectory,
  TX_TYPE_CONWAY,
} from "../../lib/output";
import { createOneShotUtxo, createUpgradeState } from "../../lib/transaction";
import * as Contracts from "../../../contract_blueprint";

interface MultisigDeployParams {
  name: string;
  oneShotHash: string;
  oneShotIndex: number;
  twoStageContract: { Script: Script };
  foreverContract: { Script: Script };
  logicContract: { Script: Script };
  totalSigners: bigint;
  signers: Record<string, string>;
}

interface SimpleDeployParams {
  name: string;
  oneShotHash: string;
  oneShotIndex: number;
  twoStageContract: { Script: Script };
  foreverContract: { Script: Script };
  logicContract: { Script: Script };
}

interface ThresholdDeployParams {
  name: string;
  oneShotHash: string;
  oneShotIndex: number;
  thresholdContract: { Script: Script };
  thresholdDatum: Contracts.MultisigThreshold;
}

interface FederatedOpsDeployParams {
  name: string;
  oneShotHash: string;
  oneShotIndex: number;
  twoStageContract: { Script: Script };
  foreverContract: { Script: Script };
  logicContract: { Script: Script };
  federatedOpsDatum: Contracts.FederatedOps;
}

interface ScriptOutputInfo {
  address: string;
  policyId?: string;
  assetName?: string;
}

interface DeployOptions extends GlobalOptions {
  "utxo-amount"?: string;
  "tech-auth-threshold"?: string;
  "council-threshold"?: string;
  "council-staging-threshold"?: string;
  "tech-auth-staging-threshold"?: string;
  components?: string;
  name?: string;
  "use-build": boolean;
}

export const command = "deploy";
export const describe = "Generate deployment transactions";

export function builder(yargs: Argv<GlobalOptions>) {
  return yargs
    .option("utxo-amount", {
      type: "string",
      description: "Lovelace amount per UTxO (default: from DEPLOY_UTXO_AMOUNT env or 20000000)",
    })
    .option("tech-auth-threshold", {
      type: "string",
      description: "Tech auth threshold as numerator/denominator (e.g., 2/3)",
    })
    .option("council-threshold", {
      type: "string",
      description: "Council threshold as numerator/denominator (e.g., 2/3)",
    })
    .option("council-staging-threshold", {
      type: "string",
      description: "Council staging threshold as numerator/denominator",
    })
    .option("tech-auth-staging-threshold", {
      type: "string",
      description: "Tech auth staging threshold as numerator/denominator",
    })
    .option("components", {
      type: "string",
      description: "Comma-separated list of components to deploy (or 'all')",
    })
    .option("name", {
      type: "string",
      description: "Deploy a single named transaction",
    })
    .option("use-build", {
      type: "boolean",
      default: false,
      description: "Use freshly built blueprint instead of deployed scripts",
    });
}

function parseThreshold(value: string): Threshold {
  const parts = value.split("/");
  if (parts.length !== 2) {
    throw new Error(
      `Invalid threshold format '${value}'. Expected 'numerator/denominator' (e.g., '2/3')`,
    );
  }
  return { numerator: BigInt(parts[0]), denominator: BigInt(parts[1]) };
}

export async function handler(argv: DeployOptions) {
  const { network, output } = argv;
  const useBuild = argv["use-build"];
  const txName = argv.name;

  const utxoAmount = argv["utxo-amount"]
    ? BigInt(argv["utxo-amount"])
    : getDeployUtxoAmount();
  const techAuthThreshold = argv["tech-auth-threshold"]
    ? parseThreshold(argv["tech-auth-threshold"])
    : getTechAuthThreshold();
  const councilThreshold = argv["council-threshold"]
    ? parseThreshold(argv["council-threshold"])
    : getCouncilThreshold();
  const councilStagingThreshold = argv["council-staging-threshold"]
    ? parseThreshold(argv["council-staging-threshold"])
    : getCouncilStagingThreshold();
  const techAuthStagingThreshold = argv["tech-auth-staging-threshold"]
    ? parseThreshold(argv["tech-auth-staging-threshold"])
    : getTechAuthStagingThreshold();
  const components = argv.components
    ? argv.components.split(",")
    : [];

  console.log(`===========================================`);
  console.log(`Generating deployment transactions for ${network}`);
  console.log(`===========================================`);
  console.log(`UTxO Amount: ${utxoAmount} lovelace`);
  console.log(`Min UTxO: calculated dynamically from protocol parameters`);

  const config = loadAikenConfig(network);
  const contracts = getContractInstances(network, useBuild);
  const networkId = getNetworkId(network);
  const deployerAddr = getDeployerAddress();

  const { totalSigners: techAuthTotalSigners, signers: techAuthSigners } =
    parseSignersWithCount("TECH_AUTH_SIGNERS");
  const { totalSigners: councilTotalSigners, signers: councilSigners } =
    parseSignersWithCount("COUNCIL_SIGNERS");

  console.log(`\nTotal tech auth signers: ${techAuthTotalSigners}`);
  console.log(
    `Number of tech auth signer pairs: ${Object.keys(techAuthSigners).length}`,
  );
  console.log(`Total council signers: ${councilTotalSigners}`);
  console.log(
    `Number of council signer pairs: ${Object.keys(councilSigners).length}`,
  );

  const { blaze } = await createBlaze(network, argv.provider as ProviderType | undefined);

  const protocolParams = await getProtocolParameters(blaze.provider);

  let collateralUtxo: TransactionUnspentOutput | undefined;
  if (config.collateral_utxo_hash) {
    const collateralInput = TransactionInput.fromCore({
      txId: TransactionId(config.collateral_utxo_hash),
      index: config.collateral_utxo_index,
    });
    const resolved = await blaze.provider.resolveUnspentOutputs([
      collateralInput,
    ]);
    if (resolved.length > 0) {
      collateralUtxo = resolved[0];
      console.log(
        `\nUsing collateral UTxO: ${config.collateral_utxo_hash}#${config.collateral_utxo_index} with ${collateralUtxo.output().amount().coin()} lovelace`,
      );

      const estimatedMaxFee = 5_000_000n;
      const requiredCollateral = calculateRequiredCollateral(
        estimatedMaxFee,
        protocolParams.collateralPercentage,
      );
      const availableCollateral = collateralUtxo.output().amount().coin();

      if (availableCollateral < requiredCollateral) {
        throw new Error(
          `Collateral UTxO has ${availableCollateral} lovelace but requires at least ${requiredCollateral} lovelace (collateralPercentage: ${protocolParams.collateralPercentage}%, estimated max fee: ${estimatedMaxFee} lovelace)`,
        );
      }
      console.log(
        `Collateral validation passed: ${availableCollateral} lovelace >= ${requiredCollateral} lovelace required`,
      );
    } else {
      throw new Error(
        `Collateral UTxO not found: ${config.collateral_utxo_hash}#${config.collateral_utxo_index}. Ensure the UTxO exists and has not been spent.`,
      );
    }
  }

  async function generateMultisigDeployment(params: MultisigDeployParams) {
    const oneShotUtxo = createOneShotUtxo(
      params.oneShotHash,
      params.oneShotIndex,
      deployerAddr,
      utxoAmount,
    );

    const twoStageAddress = addressFromValidator(
      networkId,
      params.twoStageContract.Script,
    );
    const foreverAddress = addressFromValidator(
      networkId,
      params.foreverContract.Script,
    );

    const mainUpgradeState = createUpgradeState(
      params.logicContract.Script.hash(),
      contracts.govAuth.Script.hash(),
    );
    const stagingUpgradeState = createUpgradeState(
      params.logicContract.Script.hash(),
      contracts.stagingGovAuth.Script.hash(),
    );

    const foreverState = createMultisigStateFromMap(
      params.totalSigners,
      params.signers,
    );

    let txBuilder = blaze.newTransaction().addInput(oneShotUtxo);

    const twoStageMainOutput = TransactionOutput.fromCore({
      address: PaymentAddress(twoStageAddress.toBech32()),
      value: {
        coins: 0n,
        assets: new Map([
          [
            AssetId(
              params.twoStageContract.Script.hash() +
                toHex(new TextEncoder().encode("main")),
            ),
            1n,
          ],
        ]),
      },
      datum: serialize(Contracts.UpgradeState, mainUpgradeState).toCore(),
    });
    twoStageMainOutput
      .amount()
      .setCoin(calculateMinUtxo(protocolParams, twoStageMainOutput));

    const twoStageStagingOutput = TransactionOutput.fromCore({
      address: PaymentAddress(twoStageAddress.toBech32()),
      value: {
        coins: 0n,
        assets: new Map([
          [
            AssetId(
              params.twoStageContract.Script.hash() +
                toHex(new TextEncoder().encode("staging")),
            ),
            1n,
          ],
        ]),
      },
      datum: serialize(Contracts.UpgradeState, stagingUpgradeState).toCore(),
    });
    twoStageStagingOutput
      .amount()
      .setCoin(calculateMinUtxo(protocolParams, twoStageStagingOutput));

    const foreverOutput = TransactionOutput.fromCore({
      address: PaymentAddress(foreverAddress.toBech32()),
      value: {
        coins: 0n,
        assets: new Map([[AssetId(params.foreverContract.Script.hash()), 1n]]),
      },
      datum: serialize(Contracts.VersionedMultisig, foreverState).toCore(),
    });
    foreverOutput
      .amount()
      .setCoin(calculateMinUtxo(protocolParams, foreverOutput));

    txBuilder = txBuilder
      .addMint(
        PolicyId(params.foreverContract.Script.hash()),
        new Map([[AssetName(""), 1n]]),
        serialize(Contracts.PermissionedRedeemer, params.signers),
      )
      .addMint(
        PolicyId(params.twoStageContract.Script.hash()),
        new Map([
          [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
          [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
        ]),
        PlutusData.newInteger(0n),
      )
      .provideScript(params.twoStageContract.Script)
      .provideScript(params.foreverContract.Script)
      .addOutput(twoStageMainOutput)
      .addOutput(twoStageStagingOutput)
      .addOutput(foreverOutput)
      .addRegisterStake(
        Credential.fromCore({
          hash: params.logicContract.Script.hash(),
          type: CredentialType.ScriptHash,
        }),
      );

    if (collateralUtxo) {
      txBuilder = txBuilder.provideCollateral([collateralUtxo]);
    }

    return await txBuilder.complete();
  }

  async function generateSimpleDeployment(params: SimpleDeployParams) {
    const oneShotUtxo = createOneShotUtxo(
      params.oneShotHash,
      params.oneShotIndex,
      deployerAddr,
      utxoAmount,
    );

    const foreverAddress = addressFromValidator(
      networkId,
      params.foreverContract.Script,
    );
    const twoStageAddress = addressFromValidator(
      networkId,
      params.twoStageContract.Script,
    );

    const mainUpgradeState = createUpgradeState(
      params.logicContract.Script.hash(),
      contracts.govAuth.Script.hash(),
    );
    const stagingUpgradeState = createUpgradeState(
      params.logicContract.Script.hash(),
      contracts.stagingGovAuth.Script.hash(),
    );

    const twoStageMainOutput = TransactionOutput.fromCore({
      address: PaymentAddress(twoStageAddress.toBech32()),
      value: {
        coins: 0n,
        assets: new Map([
          [
            AssetId(
              params.twoStageContract.Script.hash() +
                toHex(new TextEncoder().encode("main")),
            ),
            1n,
          ],
        ]),
      },
      datum: serialize(Contracts.UpgradeState, mainUpgradeState).toCore(),
    });
    twoStageMainOutput
      .amount()
      .setCoin(calculateMinUtxo(protocolParams, twoStageMainOutput));

    const twoStageStagingOutput = TransactionOutput.fromCore({
      address: PaymentAddress(twoStageAddress.toBech32()),
      value: {
        coins: 0n,
        assets: new Map([
          [
            AssetId(
              params.twoStageContract.Script.hash() +
                toHex(new TextEncoder().encode("staging")),
            ),
            1n,
          ],
        ]),
      },
      datum: serialize(Contracts.UpgradeState, stagingUpgradeState).toCore(),
    });
    twoStageStagingOutput
      .amount()
      .setCoin(calculateMinUtxo(protocolParams, twoStageStagingOutput));

    const foreverOutput = TransactionOutput.fromCore({
      address: PaymentAddress(foreverAddress.toBech32()),
      value: {
        coins: 0n,
        assets: new Map([[AssetId(params.foreverContract.Script.hash()), 1n]]),
      },
      datum: PlutusData.fromCore({
        constructor: 0n,
        fields: {
          items: [
            PlutusData.newInteger(0n).toCore(),
            PlutusData.newInteger(0n).toCore(),
          ],
        },
      }).toCore(),
    });
    foreverOutput
      .amount()
      .setCoin(calculateMinUtxo(protocolParams, foreverOutput));

    let txBuilder = blaze
      .newTransaction()
      .addInput(oneShotUtxo)
      .addMint(
        PolicyId(params.foreverContract.Script.hash()),
        new Map([[AssetName(""), 1n]]),
        PlutusData.newInteger(0n),
      )
      .addMint(
        PolicyId(params.twoStageContract.Script.hash()),
        new Map([
          [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
          [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
        ]),
        PlutusData.newInteger(0n),
      )
      .provideScript(params.foreverContract.Script)
      .provideScript(params.twoStageContract.Script)
      .addOutput(twoStageMainOutput)
      .addOutput(twoStageStagingOutput)
      .addOutput(foreverOutput);

    if (collateralUtxo) {
      txBuilder = txBuilder.provideCollateral([collateralUtxo]);
    }

    return await txBuilder.complete();
  }

  async function generateThresholdDeployment(params: ThresholdDeployParams) {
    const oneShotUtxo = createOneShotUtxo(
      params.oneShotHash,
      params.oneShotIndex,
      deployerAddr,
      utxoAmount,
    );

    const thresholdAddress = addressFromValidator(
      networkId,
      params.thresholdContract.Script,
    );

    const thresholdOutput = TransactionOutput.fromCore({
      address: PaymentAddress(thresholdAddress.toBech32()),
      value: {
        coins: 0n,
        assets: new Map([
          [AssetId(params.thresholdContract.Script.hash()), 1n],
        ]),
      },
      datum: serialize(
        Contracts.MultisigThreshold,
        params.thresholdDatum,
      ).toCore(),
    });
    thresholdOutput
      .amount()
      .setCoin(calculateMinUtxo(protocolParams, thresholdOutput));

    let txBuilder = blaze
      .newTransaction()
      .addInput(oneShotUtxo)
      .addMint(
        PolicyId(params.thresholdContract.Script.hash()),
        new Map([[AssetName(""), 1n]]),
        PlutusData.newInteger(0n),
      )
      .provideScript(params.thresholdContract.Script)
      .addOutput(thresholdOutput);

    if (collateralUtxo) {
      txBuilder = txBuilder.provideCollateral([collateralUtxo]);
    }

    return await txBuilder.complete();
  }

  async function generateFederatedOpsDeployment(
    params: FederatedOpsDeployParams,
  ) {
    const oneShotUtxo = createOneShotUtxo(
      params.oneShotHash,
      params.oneShotIndex,
      deployerAddr,
      utxoAmount,
    );

    const twoStageAddress = addressFromValidator(
      networkId,
      params.twoStageContract.Script,
    );
    const foreverAddress = addressFromValidator(
      networkId,
      params.foreverContract.Script,
    );

    const mainUpgradeState = createUpgradeState(
      params.logicContract.Script.hash(),
      contracts.govAuth.Script.hash(),
    );
    const stagingUpgradeState = createUpgradeState(
      params.logicContract.Script.hash(),
      contracts.stagingGovAuth.Script.hash(),
    );

    const twoStageMainOutput = TransactionOutput.fromCore({
      address: PaymentAddress(twoStageAddress.toBech32()),
      value: {
        coins: 0n,
        assets: new Map([
          [
            AssetId(
              params.twoStageContract.Script.hash() +
                toHex(new TextEncoder().encode("main")),
            ),
            1n,
          ],
        ]),
      },
      datum: serialize(Contracts.UpgradeState, mainUpgradeState).toCore(),
    });
    twoStageMainOutput
      .amount()
      .setCoin(calculateMinUtxo(protocolParams, twoStageMainOutput));

    const twoStageStagingOutput = TransactionOutput.fromCore({
      address: PaymentAddress(twoStageAddress.toBech32()),
      value: {
        coins: 0n,
        assets: new Map([
          [
            AssetId(
              params.twoStageContract.Script.hash() +
                toHex(new TextEncoder().encode("staging")),
            ),
            1n,
          ],
        ]),
      },
      datum: serialize(Contracts.UpgradeState, stagingUpgradeState).toCore(),
    });
    twoStageStagingOutput
      .amount()
      .setCoin(calculateMinUtxo(protocolParams, twoStageStagingOutput));

    const foreverOutput = TransactionOutput.fromCore({
      address: PaymentAddress(foreverAddress.toBech32()),
      value: {
        coins: 0n,
        assets: new Map([[AssetId(params.foreverContract.Script.hash()), 1n]]),
      },
      datum: serialize(
        Contracts.FederatedOps,
        params.federatedOpsDatum,
      ).toCore(),
    });
    foreverOutput
      .amount()
      .setCoin(calculateMinUtxo(protocolParams, foreverOutput));

    let txBuilder = blaze
      .newTransaction()
      .addInput(oneShotUtxo)
      .addMint(
        PolicyId(params.foreverContract.Script.hash()),
        new Map([[AssetName(""), 1n]]),
        PlutusData.newInteger(0n),
      )
      .addMint(
        PolicyId(params.twoStageContract.Script.hash()),
        new Map([
          [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
          [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
        ]),
        PlutusData.newInteger(0n),
      )
      .provideScript(params.twoStageContract.Script)
      .provideScript(params.foreverContract.Script)
      .addOutput(twoStageMainOutput)
      .addOutput(twoStageStagingOutput)
      .addOutput(foreverOutput)
      .addRegisterStake(
        Credential.fromCore({
          hash: params.logicContract.Script.hash(),
          type: CredentialType.ScriptHash,
        }),
      );

    if (collateralUtxo) {
      txBuilder = txBuilder.provideCollateral([collateralUtxo]);
    }

    return await txBuilder.complete();
  }

  const allTransactionDefs = [
    {
      name: "technical-authority-deployment",
      component: "tech-auth",
      generator: () =>
        generateMultisigDeployment({
          name: "Technical Authority",
          oneShotHash: config.technical_authority_one_shot_hash,
          oneShotIndex: config.technical_authority_one_shot_index,
          twoStageContract: contracts.techAuthTwoStage,
          foreverContract: contracts.techAuthForever,
          logicContract: contracts.techAuthLogic,
          totalSigners: techAuthTotalSigners,
          signers: techAuthSigners,
        }),
    },
    {
      name: "tech-auth-update-threshold-deployment",
      component: "tech-auth-threshold",
      generator: () =>
        generateThresholdDeployment({
          name: "Tech Auth Update Threshold",
          oneShotHash: config.main_tech_auth_update_one_shot_hash,
          oneShotIndex: config.main_tech_auth_update_one_shot_index,
          thresholdContract: contracts.mainTechAuthUpdateThreshold,
          thresholdDatum: [
            techAuthThreshold.numerator,
            techAuthThreshold.denominator,
            councilThreshold.numerator,
            councilThreshold.denominator,
          ],
        }),
    },
    {
      name: "council-deployment",
      component: "council",
      generator: () =>
        generateMultisigDeployment({
          name: "Council",
          oneShotHash: config.council_one_shot_hash,
          oneShotIndex: config.council_one_shot_index,
          twoStageContract: contracts.councilTwoStage,
          foreverContract: contracts.councilForever,
          logicContract: contracts.councilLogic,
          totalSigners: councilTotalSigners,
          signers: councilSigners,
        }),
    },
    {
      name: "council-update-threshold-deployment",
      component: "council-threshold",
      generator: () =>
        generateThresholdDeployment({
          name: "Council Update Threshold",
          oneShotHash: config.main_council_update_one_shot_hash,
          oneShotIndex: config.main_council_update_one_shot_index,
          thresholdContract: contracts.mainCouncilUpdateThreshold,
          thresholdDatum: [
            techAuthThreshold.numerator,
            techAuthThreshold.denominator,
            councilThreshold.numerator,
            councilThreshold.denominator,
          ],
        }),
    },
    {
      name: "reserve-deployment",
      component: "reserve",
      generator: () =>
        generateSimpleDeployment({
          name: "Reserve",
          oneShotHash: config.reserve_one_shot_hash,
          oneShotIndex: config.reserve_one_shot_index,
          twoStageContract: contracts.reserveTwoStage,
          foreverContract: contracts.reserveForever,
          logicContract: contracts.reserveLogic,
        }),
    },
    {
      name: "ics-deployment",
      component: "ics",
      generator: () =>
        generateSimpleDeployment({
          name: "ICS",
          oneShotHash: config.ics_one_shot_hash,
          oneShotIndex: config.ics_one_shot_index,
          twoStageContract: contracts.icsTwoStage,
          foreverContract: contracts.icsForever,
          logicContract: contracts.icsLogic,
        }),
    },
    {
      name: "main-gov-threshold-deployment",
      component: "main-gov",
      generator: () =>
        generateThresholdDeployment({
          name: "Main Government Threshold",
          oneShotHash: config.main_gov_one_shot_hash,
          oneShotIndex: config.main_gov_one_shot_index,
          thresholdContract: contracts.mainGovThreshold,
          thresholdDatum: [
            techAuthThreshold.numerator,
            techAuthThreshold.denominator,
            councilThreshold.numerator,
            councilThreshold.denominator,
          ],
        }),
    },
    {
      name: "staging-gov-threshold-deployment",
      component: "staging-gov",
      generator: () =>
        generateThresholdDeployment({
          name: "Staging Government Threshold",
          oneShotHash: config.staging_gov_one_shot_hash,
          oneShotIndex: config.staging_gov_one_shot_index,
          thresholdContract: contracts.stagingGovThreshold,
          thresholdDatum: [
            techAuthStagingThreshold.numerator,
            techAuthStagingThreshold.denominator,
            councilStagingThreshold.numerator,
            councilStagingThreshold.denominator,
          ],
        }),
    },
    {
      name: "federated-ops-deployment",
      component: "federated-ops",
      generator: () =>
        generateFederatedOpsDeployment({
          name: "Federated Operators",
          oneShotHash: config.federated_operators_one_shot_hash,
          oneShotIndex: config.federated_operators_one_shot_index,
          twoStageContract: contracts.federatedOpsTwoStage,
          foreverContract: contracts.federatedOpsForever,
          logicContract: contracts.federatedOpsLogic,
          federatedOpsDatum: createFederatedOpsDatum(
            "PERMISSIONED_CANDIDATES",
            1n,
          ),
        }),
    },
    {
      name: "federated-ops-update-threshold-deployment",
      component: "federated-ops-threshold",
      generator: () =>
        generateThresholdDeployment({
          name: "Federated Ops Update Threshold",
          oneShotHash: config.main_federated_ops_update_one_shot_hash,
          oneShotIndex: config.main_federated_ops_update_one_shot_index,
          thresholdContract: contracts.mainFederatedOpsUpdateThreshold,
          thresholdDatum: [
            techAuthThreshold.numerator,
            techAuthThreshold.denominator,
            councilThreshold.numerator,
            councilThreshold.denominator,
          ],
        }),
    },
    {
      name: "terms-and-conditions-deployment",
      component: "terms-and-conditions",
      generator: async () => {
        const oneShotUtxo = createOneShotUtxo(
          config.terms_and_conditions_one_shot_hash,
          config.terms_and_conditions_one_shot_index,
          deployerAddr,
          utxoAmount,
        );

        const foreverAddress = addressFromValidator(
          networkId,
          contracts.termsAndConditionsForever.Script,
        );
        const twoStageAddress = addressFromValidator(
          networkId,
          contracts.termsAndConditionsTwoStage.Script,
        );

        const mainUpgradeState = createUpgradeState(
          contracts.termsAndConditionsLogic.Script.hash(),
          contracts.govAuth.Script.hash(),
        );
        const stagingUpgradeState = createUpgradeState(
          contracts.termsAndConditionsLogic.Script.hash(),
          contracts.stagingGovAuth.Script.hash(),
        );

        const initialTermsAndConditions: Contracts.VersionedTermsAndConditions =
          [
            [
              getTermsAndConditionsInitialHash(),
              getTermsAndConditionsInitialLink(),
            ],
            0n,
          ];

        const twoStageMainOutput = TransactionOutput.fromCore({
          address: PaymentAddress(twoStageAddress.toBech32()),
          value: {
            coins: 0n,
            assets: new Map([
              [
                AssetId(
                  contracts.termsAndConditionsTwoStage.Script.hash() +
                    toHex(new TextEncoder().encode("main")),
                ),
                1n,
              ],
            ]),
          },
          datum: serialize(Contracts.UpgradeState, mainUpgradeState).toCore(),
        });
        twoStageMainOutput
          .amount()
          .setCoin(calculateMinUtxo(protocolParams, twoStageMainOutput));

        const twoStageStagingOutput = TransactionOutput.fromCore({
          address: PaymentAddress(twoStageAddress.toBech32()),
          value: {
            coins: 0n,
            assets: new Map([
              [
                AssetId(
                  contracts.termsAndConditionsTwoStage.Script.hash() +
                    toHex(new TextEncoder().encode("staging")),
                ),
                1n,
              ],
            ]),
          },
          datum: serialize(
            Contracts.UpgradeState,
            stagingUpgradeState,
          ).toCore(),
        });
        twoStageStagingOutput
          .amount()
          .setCoin(calculateMinUtxo(protocolParams, twoStageStagingOutput));

        const foreverOutput = TransactionOutput.fromCore({
          address: PaymentAddress(foreverAddress.toBech32()),
          value: {
            coins: 0n,
            assets: new Map([
              [AssetId(contracts.termsAndConditionsForever.Script.hash()), 1n],
            ]),
          },
          datum: serialize(
            Contracts.VersionedTermsAndConditions,
            initialTermsAndConditions,
          ).toCore(),
        });
        foreverOutput
          .amount()
          .setCoin(calculateMinUtxo(protocolParams, foreverOutput));

        let txBuilder = blaze
          .newTransaction()
          .addInput(oneShotUtxo)
          .addMint(
            PolicyId(contracts.termsAndConditionsForever.Script.hash()),
            new Map([[AssetName(""), 1n]]),
            PlutusData.newInteger(0n),
          )
          .addMint(
            PolicyId(contracts.termsAndConditionsTwoStage.Script.hash()),
            new Map([
              [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
              [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
            ]),
            PlutusData.newInteger(0n),
          )
          .provideScript(contracts.termsAndConditionsForever.Script)
          .provideScript(contracts.termsAndConditionsTwoStage.Script)
          .addOutput(twoStageMainOutput)
          .addOutput(twoStageStagingOutput)
          .addOutput(foreverOutput)
          .addRegisterStake(
            Credential.fromCore({
              hash: contracts.termsAndConditionsLogic.Script.hash(),
              type: CredentialType.ScriptHash,
            }),
          );

        if (collateralUtxo) {
          txBuilder = txBuilder.provideCollateral([collateralUtxo]);
        }

        return await txBuilder.complete();
      },
    },
    {
      name: "terms-and-conditions-threshold-deployment",
      component: "terms-and-conditions-threshold",
      generator: () =>
        generateThresholdDeployment({
          name: "Terms and Conditions Threshold",
          oneShotHash: config.terms_and_conditions_threshold_one_shot_hash,
          oneShotIndex: config.terms_and_conditions_threshold_one_shot_index,
          thresholdContract: contracts.termsAndConditionsThreshold,
          thresholdDatum: [
            techAuthThreshold.numerator,
            techAuthThreshold.denominator,
            councilThreshold.numerator,
            councilThreshold.denominator,
          ],
        }),
    },
  ];

  // Filter transactions based on --name or --components options
  let transactions = allTransactionDefs;

  if (txName) {
    if (components.length > 0 && !components.includes("all")) {
      printInfo(`Warning: --name overrides --components. Using --name=${txName}`);
    }
    const matched = allTransactionDefs.find((t) => t.name === txName);
    if (!matched) {
      throw new Error(
        `Transaction '${txName}' not found in deployment definitions`,
      );
    }
    transactions = [matched];
    printInfo(`Targeting single transaction: ${txName}`);
  } else if (components.length > 0 && !components.includes("all")) {
    transactions = allTransactionDefs.filter((t) =>
      components.includes(t.component),
    );
  }

  const allTransactions: TxOutput[] = [];
  const allScriptOutputs: Map<string, ScriptOutputInfo[]> = new Map();

  for (const { name, generator } of transactions) {
    try {
      const tx = await generator();
      allTransactions.push({
        type: TX_TYPE_CONWAY,
        description: name,
        cborHex: tx.toCbor(),
        txHash: tx.getId(),
        signed: false,
      });

      const scriptOutputs: ScriptOutputInfo[] = [];
      const txBody = tx.body();
      const outputs = txBody.outputs();

      for (let i = 0; i < outputs.length; i++) {
        const txOutput = outputs[i];
        const address = txOutput.address();
        const addressBech32 = address.toBech32();

        const isScriptAddress =
          addressBech32.includes("addr_test1w") ||
          addressBech32.includes("addr1w") ||
          addressBech32.startsWith("addr_test1z") ||
          addressBech32.startsWith("addr1z");

        if (isScriptAddress || txOutput.amount().multiasset()) {
          const outputInfo: ScriptOutputInfo = {
            address: addressBech32,
          };

          const multiasset = txOutput.amount().multiasset();
          if (multiasset) {
            for (const [assetId] of multiasset) {
              const policyId = assetId.slice(0, 56);
              const assetNameHex = assetId.slice(56);
              outputInfo.policyId = policyId;
              if (assetNameHex) {
                try {
                  const bytes = new Uint8Array(
                    assetNameHex
                      .match(/.{1,2}/g)!
                      .map((byte: string) => parseInt(byte, 16)),
                  );
                  const decoded = new TextDecoder().decode(bytes);
                  if (/^[\x20-\x7E]*$/.test(decoded)) {
                    outputInfo.assetName = decoded || "(empty)";
                  } else {
                    outputInfo.assetName = assetNameHex;
                  }
                } catch {
                  outputInfo.assetName = assetNameHex || "(empty)";
                }
              } else {
                outputInfo.assetName = "(empty)";
              }
              break;
            }
          }

          scriptOutputs.push(outputInfo);
        }
      }

      if (scriptOutputs.length > 0) {
        allScriptOutputs.set(name, scriptOutputs);
      }
    } catch (error) {
      printError(`Error generating ${name}: ${error}`);
      throw error;
    }
  }

  const deploymentDir = resolve(output, network);
  ensureDirectory(deploymentDir);

  const outputFile = resolve(deploymentDir, "deployment-transactions.json");

  // If --name is provided and file exists, merge with existing transactions
  let finalTransactions = allTransactions;
  if (txName && existsSync(outputFile)) {
    try {
      const existingData = JSON.parse(readFileSync(outputFile, "utf-8")) as {
        transactions?: TxOutput[];
      };
      if (
        existingData.transactions &&
        Array.isArray(existingData.transactions)
      ) {
        const existingIdx = existingData.transactions.findIndex(
          (t) => t.description === txName,
        );
        if (existingIdx >= 0) {
          existingData.transactions[existingIdx] = allTransactions[0];
          finalTransactions = existingData.transactions;
          printInfo(
            `Replaced transaction ${txName} in existing deployment file (${existingData.transactions.length} total)`,
          );
        } else {
          finalTransactions = [
            ...existingData.transactions,
            ...allTransactions,
          ];
          printInfo(
            `Appended transaction ${txName} to existing deployment file (${existingData.transactions.length + 1} total)`,
          );
        }
      }
    } catch (err) {
      printInfo(
        `Could not parse existing deployment file: ${err instanceof Error ? err.message : err}. Creating new one.`,
      );
    }
  }

  const deploymentOutput = createDeploymentOutput(
    network,
    { utxoAmount },
    finalTransactions,
  );

  writeJsonFile(outputFile, deploymentOutput);

  // Auto-save deployment scripts for full deployments
  if (!txName) {
    try {
      const projectRoot = resolve(import.meta.dir, "../../..");
      const plutusJsonPath = resolve(projectRoot, `plutus-${network}.json`);
      const blueprintPath = resolve(
        projectRoot,
        `contract_blueprint_${network}.ts`,
      );

      if (existsSync(plutusJsonPath) && existsSync(blueprintPath)) {
        const versionInfo = {
          round: 0n,
          logicRound: 0n,
          timestamp: new Date().toISOString(),
          gitCommit: "",
        };

        const changes: ChangeRecord[] = [
          {
            type: "initial",
            validator: "all",
            description: "Initial deployment",
          },
        ];

        const versionName = saveVersionSnapshot(
          network,
          versionInfo,
          changes,
          plutusJsonPath,
          blueprintPath,
        );
        setCurrentVersion(network, versionName);

        printSuccess(
          `Deployment scripts saved to deployed-scripts/${network}/versions/${versionName}/`,
        );
      }
    } catch (error) {
      printInfo(
        `Note: Could not save deployment scripts: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  console.log(`===========================================`);
  printSuccess(`Generated ${transactions.length} deployment transactions`);
  console.log(`Output file: ${outputFile}`);
  console.log(`===========================================`);

  printTransactionSummary(allTransactions);

  console.log(`\nScript Outputs:`);
  console.log(`===========================================`);
  for (const [outputTxName, outputs] of allScriptOutputs) {
    console.log(`\n${outputTxName}:`);
    for (const scriptOutput of outputs) {
      console.log(`  Address: ${scriptOutput.address}`);
      if (scriptOutput.policyId) {
        console.log(`  Policy ID: ${scriptOutput.policyId}`);
        if (scriptOutput.assetName) {
          console.log(`  Asset Name: ${scriptOutput.assetName}`);
        }
      }
      console.log(``);
    }
  }
}

const commandModule: CommandModule<GlobalOptions, DeployOptions> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;
