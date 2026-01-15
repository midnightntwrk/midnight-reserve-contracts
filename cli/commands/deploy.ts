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
  TransactionOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { resolve } from "path";

import type {
  DeployOptions,
  TransactionOutput as TxOutput,
} from "../lib/types";
import { getNetworkId } from "../lib/types";
import {
  loadAikenConfig,
  getDeployerAddress,
  getTermsAndConditionsInitialHash,
  getTermsAndConditionsInitialLink,
} from "../lib/config";
import { createBlaze } from "../lib/provider";
import { getContractInstances } from "../lib/contracts";
import {
  parseSignersWithCount,
  createMultisigStateFromMap,
} from "../lib/signers";
import { createFederatedOpsDatum } from "../lib/candidates";
import {
  writeJsonFile,
  createDeploymentOutput,
  printSuccess,
  printError,
  printProgress,
  printInfo,
  printTransactionSummary,
  ensureDirectory,
} from "../utils/output";
import { readFileSync, existsSync } from "fs";
import { createOneShotUtxo, createUpgradeState } from "../utils/transaction";
import * as Contracts from "../../contract_blueprint";
import type { TransactionUnspentOutput } from "@blaze-cardano/core";

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

export async function deploy(options: DeployOptions): Promise<void> {
  const {
    network,
    output,
    utxoAmount,
    outputAmount,
    thresholdOutputAmount,
    techAuthThreshold,
    councilThreshold,
    councilStagingThreshold,
    techAuthStagingThreshold,
    components,
    name,
  } = options;

  console.log(`===========================================`);
  console.log(`Generating deployment transactions for ${network}`);
  console.log(`===========================================`);
  console.log(`UTxO Amount: ${utxoAmount} lovelace`);
  console.log(`Output Amount: ${outputAmount} lovelace`);
  console.log(`Threshold Output Amount: ${thresholdOutputAmount} lovelace`);

  const config = loadAikenConfig(network);
  const contracts = getContractInstances();
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

  const { blaze } = await createBlaze(network, options.provider);

  // Create collateral UTxO - this UTxO is NOT spent by any deployment transaction,
  // so it can be safely reused as collateral across all transactions
  let collateralUtxo: TransactionUnspentOutput | undefined;
  if (config.collateral_utxo_hash) {
    collateralUtxo = createOneShotUtxo(
      config.collateral_utxo_hash,
      config.collateral_utxo_index,
      deployerAddr,
      utxoAmount,
    );
    console.log(
      `\nUsing collateral UTxO: ${config.collateral_utxo_hash}#${config.collateral_utxo_index}`,
    );
  }

  async function generateMultisigDeployment(params: MultisigDeployParams) {
    printProgress(`Generating ${params.name} deployment transaction...`);

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

    // Main uses govAuth, staging uses stagingGovAuth
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
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(twoStageAddress.toBech32()),
          value: {
            coins: outputAmount,
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
        }),
      )
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(twoStageAddress.toBech32()),
          value: {
            coins: outputAmount,
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
          datum: serialize(
            Contracts.UpgradeState,
            stagingUpgradeState,
          ).toCore(),
        }),
      )
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(foreverAddress.toBech32()),
          value: {
            coins: outputAmount,
            assets: new Map([
              [AssetId(params.foreverContract.Script.hash()), 1n],
            ]),
          },
          datum: serialize(Contracts.VersionedMultisig, foreverState).toCore(),
        }),
      )
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
    printProgress(`Generating ${params.name} deployment transaction...`);

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

    // Main uses govAuth, staging uses stagingGovAuth
    const mainUpgradeState = createUpgradeState(
      params.logicContract.Script.hash(),
      contracts.govAuth.Script.hash(),
    );
    const stagingUpgradeState = createUpgradeState(
      params.logicContract.Script.hash(),
      contracts.stagingGovAuth.Script.hash(),
    );

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
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(twoStageAddress.toBech32()),
          value: {
            coins: outputAmount,
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
        }),
      )
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(twoStageAddress.toBech32()),
          value: {
            coins: outputAmount,
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
          datum: serialize(
            Contracts.UpgradeState,
            stagingUpgradeState,
          ).toCore(),
        }),
      )
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(foreverAddress.toBech32()),
          value: {
            coins: outputAmount,
            assets: new Map([
              [AssetId(params.foreverContract.Script.hash()), 1n],
            ]),
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
        }),
      );

    if (collateralUtxo) {
      txBuilder = txBuilder.provideCollateral([collateralUtxo]);
    }

    return await txBuilder.complete();
  }

  async function generateThresholdDeployment(params: ThresholdDeployParams) {
    printProgress(`Generating ${params.name} deployment transaction...`);

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

    let txBuilder = blaze
      .newTransaction()
      .addInput(oneShotUtxo)
      .addMint(
        PolicyId(params.thresholdContract.Script.hash()),
        new Map([[AssetName(""), 1n]]),
        PlutusData.newInteger(0n),
      )
      .provideScript(params.thresholdContract.Script)
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(thresholdAddress.toBech32()),
          value: {
            coins: thresholdOutputAmount,
            assets: new Map([
              [AssetId(params.thresholdContract.Script.hash()), 1n],
            ]),
          },
          datum: serialize(
            Contracts.MultisigThreshold,
            params.thresholdDatum,
          ).toCore(),
        }),
      );

    if (collateralUtxo) {
      txBuilder = txBuilder.provideCollateral([collateralUtxo]);
    }

    return await txBuilder.complete();
  }

  async function generateFederatedOpsDeployment(
    params: FederatedOpsDeployParams,
  ) {
    printProgress(`Generating ${params.name} deployment transaction...`);

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

    // Main uses govAuth, staging uses stagingGovAuth
    const mainUpgradeState = createUpgradeState(
      params.logicContract.Script.hash(),
      contracts.govAuth.Script.hash(),
    );
    const stagingUpgradeState = createUpgradeState(
      params.logicContract.Script.hash(),
      contracts.stagingGovAuth.Script.hash(),
    );

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
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(twoStageAddress.toBech32()),
          value: {
            coins: outputAmount,
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
        }),
      )
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(twoStageAddress.toBech32()),
          value: {
            coins: outputAmount,
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
          datum: serialize(
            Contracts.UpgradeState,
            stagingUpgradeState,
          ).toCore(),
        }),
      )
      .addOutput(
        TransactionOutput.fromCore({
          address: PaymentAddress(foreverAddress.toBech32()),
          value: {
            coins: outputAmount,
            assets: new Map([
              [AssetId(params.foreverContract.Script.hash()), 1n],
            ]),
          },
          datum: serialize(
            Contracts.FederatedOps,
            params.federatedOpsDatum,
          ).toCore(),
        }),
      )
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
            0n,
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
        printProgress(
          "Generating Terms and Conditions deployment transaction...",
        );

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

        // Main uses govAuth, staging uses stagingGovAuth
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
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(twoStageAddress.toBech32()),
              value: {
                coins: outputAmount,
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
              datum: serialize(
                Contracts.UpgradeState,
                mainUpgradeState,
              ).toCore(),
            }),
          )
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(twoStageAddress.toBech32()),
              value: {
                coins: outputAmount,
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
            }),
          )
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(foreverAddress.toBech32()),
              value: {
                coins: outputAmount,
                assets: new Map([
                  [
                    AssetId(contracts.termsAndConditionsForever.Script.hash()),
                    1n,
                  ],
                ]),
              },
              datum: serialize(
                Contracts.VersionedTermsAndConditions,
                initialTermsAndConditions,
              ).toCore(),
            }),
          )
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

  if (name) {
    // Warn if both --name and --components are provided
    if (components.length > 0 && !components.includes("all")) {
      printInfo(`Warning: --name overrides --components. Using --name=${name}`);
    }
    // Filter by specific transaction name
    const matched = allTransactionDefs.find((t) => t.name === name);
    if (!matched) {
      throw new Error(`Transaction '${name}' not found in deployment definitions`);
    }
    transactions = [matched];
    printInfo(`Targeting single transaction: ${name}`);
  } else if (components.length > 0 && !components.includes("all")) {
    // Filter by component(s)
    transactions = allTransactionDefs.filter((t) => components.includes(t.component));
  }

  const allTransactions: TxOutput[] = [];
  const allScriptOutputs: Map<string, ScriptOutputInfo[]> = new Map();

  for (const { name, generator } of transactions) {
    try {
      const tx = await generator();
      allTransactions.push({
        name,
        cbor: tx.toCbor(),
        hash: tx.getId(),
      });

      const scriptOutputs: ScriptOutputInfo[] = [];
      const txBody = tx.body();
      const outputs = txBody.outputs();

      for (let i = 0; i < outputs.length; i++) {
        const output = outputs[i];
        const address = output.address();
        const addressBech32 = address.toBech32();

        // Check if this is a script address (starts with addr_test1w or addr1w for scripts)
        const isScriptAddress = addressBech32.includes("addr_test1w") ||
                                addressBech32.includes("addr1w") ||
                                addressBech32.startsWith("addr_test1z") ||
                                addressBech32.startsWith("addr1z");

        if (isScriptAddress || output.amount().multiasset()) {
          const outputInfo: ScriptOutputInfo = {
            address: addressBech32,
          };

          // Extract policy ID and asset name from multiasset if present
          const multiasset = output.amount().multiasset();
          if (multiasset) {
            for (const [assetId] of multiasset) {
              // AssetId is policyId + assetName (28 bytes policy + rest is asset name)
              const policyId = assetId.slice(0, 56);
              const assetNameHex = assetId.slice(56);
              outputInfo.policyId = policyId;
              if (assetNameHex) {
                try {
                  // Try to decode as UTF-8
                  const bytes = new Uint8Array(assetNameHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
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
              break; // Just take the first asset for display
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
  if (name && existsSync(outputFile)) {
    try {
      const existingData = JSON.parse(readFileSync(outputFile, "utf-8")) as {
        transactions?: TxOutput[];
      };
      if (existingData.transactions && Array.isArray(existingData.transactions)) {
        // Preserve ordering: replace in-place if exists, otherwise append
        const existingIdx = existingData.transactions.findIndex((t) => t.name === name);
        if (existingIdx >= 0) {
          existingData.transactions[existingIdx] = allTransactions[0];
          finalTransactions = existingData.transactions;
          printInfo(`Replaced transaction ${name} in existing deployment file (${existingData.transactions.length} total)`);
        } else {
          finalTransactions = [...existingData.transactions, ...allTransactions];
          printInfo(`Appended transaction ${name} to existing deployment file (${existingData.transactions.length + 1} total)`);
        }
      }
    } catch (err) {
      // If we can't parse existing file, just use new transactions
      printInfo(`Could not parse existing deployment file: ${err instanceof Error ? err.message : err}. Creating new one.`);
    }
  }

  const deploymentOutput = createDeploymentOutput(
    network,
    { utxoAmount, outputAmount, thresholdOutputAmount },
    finalTransactions,
  );

  writeJsonFile(outputFile, deploymentOutput);

  console.log(`===========================================`);
  printSuccess(`Generated ${transactions.length} deployment transactions`);
  console.log(`Output file: ${outputFile}`);
  console.log(`===========================================`);

  printTransactionSummary(allTransactions);

  console.log(`\nScript Outputs:`);
  console.log(`===========================================`);
  for (const [txName, outputs] of allScriptOutputs) {
    console.log(`\n${txName}:`);
    for (const output of outputs) {
      console.log(`  Address: ${output.address}`);
      if (output.policyId) {
        console.log(`  Policy ID: ${output.policyId}`);
        if (output.assetName) {
          console.log(`  Asset Name: ${output.assetName}`);
        }
      }
      console.log(``);
    }
  }
}
