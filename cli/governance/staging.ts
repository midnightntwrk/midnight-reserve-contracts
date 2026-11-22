/**
 * The v2 logic track: mint-staging-state mints the StagingState NFT of a
 * v2 logic by spending its one-shot, with the profile's collateral (the v2
 * logic and the staging forever come from the build: they are not
 * deployed until they are promoted; the datum is the StagingState list
 * [cnight_test_policy, forever_script_hash]); once the v2 federated-ops
 * logic is promoted, migrate-federated-ops rewrites the federated-ops
 * datum from v1 to v2 through its Migrate branch, without the authorities.
 */
import {
  addressFromValidator,
  AssetId,
  AssetName,
  fromHex,
  PaymentAddress,
  PlutusData,
  type Script,
  TransactionOutput,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { parse, serialize } from "@blaze-cardano/data";
import { Effect, Option } from "effect";
import * as Contracts from "../../contract_blueprint";
import {
  deployerUtxo,
  deployerUtxoAt,
  ensureRegistered,
  firstUtxoAt,
  planningContext,
  Provider,
  profileCollateral,
  scriptUtxos,
} from "../chain";
import {
  DeployerAddress,
  type Environment,
  environmentOf,
  type NetworkConfig,
  Profile,
} from "../config";
import {
  type ContractClass,
  type ContractInstances,
  ContractResolver,
} from "../contracts/resolver";
import { decodeDatum, inlineDatum } from "../datum";
import { BlueprintError, PreconditionFailed } from "../errors";
import { type TxHash, type TxIndex, txFilePath } from "../input";
import { Output } from "../output";
import {
  compileReported,
  signAndWrite,
  signerFor,
  UNSIGNED,
  witnessCount,
} from "../signing";
import {
  createRewardAccount,
  minAda,
  type PlanningContext,
  type TxPlan,
  withdrawThroughLogic,
} from "../tx";
import { mainUtxoAt, upgradeScripts, upgradeStateAt } from "./two-stage";

/** The validators with a v2 logic track. reserve_logic_v2 mints no StagingState: its staging track reads reserve_staging_params (user decision, 11-14). */
export const V2_TRACK_VALIDATORS = [
  "tech-auth",
  "council",
  "ics",
  "federated-ops",
  "terms-and-conditions",
] as const;

export type V2TrackValidator = (typeof V2_TRACK_VALIDATORS)[number];

/** Where a validator's v2 track lives: its one-shot, its staging forever, and the class names its v2 logic may have. */
const V2_TRACKS: Record<
  V2TrackValidator,
  {
    readonly oneShot: (config: NetworkConfig) => readonly [TxHash, TxIndex];
    readonly stagingForever: (
      instances: ContractInstances,
    ) => ContractClass | undefined;
    readonly v2LogicClasses: readonly string[];
  }
> = {
  "tech-auth": {
    oneShot: (c) => [
      c.technical_authority_logic_v2_one_shot_hash,
      c.technical_authority_logic_v2_one_shot_index,
    ],
    stagingForever: (i) => i.techAuthStagingForever,
    v2LogicClasses: [
      "PermissionedV2TechAuthLogicV2Else",
      "PermissionedTechAuthLogicV2Else",
    ],
  },
  council: {
    oneShot: (c) => [
      c.council_logic_v2_one_shot_hash,
      c.council_logic_v2_one_shot_index,
    ],
    stagingForever: (i) => i.councilStagingForever,
    v2LogicClasses: [
      "PermissionedV2CouncilLogicV2Else",
      "PermissionedCouncilLogicV2Else",
    ],
  },
  ics: {
    oneShot: (c) => [
      c.ics_logic_v2_one_shot_hash,
      c.ics_logic_v2_one_shot_index,
    ],
    stagingForever: (i) => i.icsStagingForever,
    v2LogicClasses: [
      "IlliquidCirculationSupplyV2IcsLogicV2Else",
      "IlliquidCirculationSupplyIcsLogicV2Else",
    ],
  },
  "federated-ops": {
    oneShot: (c) => [
      c.federated_operators_logic_v2_one_shot_hash,
      c.federated_operators_logic_v2_one_shot_index,
    ],
    stagingForever: (i) => i.federatedOpsStagingForever,
    v2LogicClasses: [
      "PermissionedV2FederatedOpsLogicV2Else",
      "PermissionedFederatedOpsLogicV2Else",
    ],
  },
  "terms-and-conditions": {
    oneShot: (c) => [
      c.terms_and_conditions_logic_v2_one_shot_hash,
      c.terms_and_conditions_logic_v2_one_shot_index,
    ],
    stagingForever: (i) => i.termsAndConditionsStagingForever,
    v2LogicClasses: [
      "TermsAndConditionsV2TermsAndConditionsLogicV2Else",
      "TermsAndConditionsTermsAndConditionsLogicV2Else",
    ],
  },
};

/** What the StagingState mint is built from. */
export interface StagingStateMint {
  readonly oneShotUtxo: TransactionUnspentOutput;
  /** The v2 logic: the NFT's minting policy and the output's address. */
  readonly v2LogicScript: Script;
  readonly stagingForeverHash: string;
  readonly cnightPolicy: string;
  readonly collateralUtxo: TransactionUnspentOutput;
  readonly feePadding: bigint;
  readonly expectedWitnesses: number;
}

/** The NFT output at the v2 logic address with the StagingState datum and its min ADA. */
const stagingStateOutput = (
  ctx: PlanningContext<StagingStateMint>,
): TransactionOutput => {
  const mint = ctx.resolved;
  const output = TransactionOutput.fromCore({
    address: PaymentAddress(
      addressFromValidator(ctx.networkId, mint.v2LogicScript).toBech32(),
    ),
    value: {
      coins: 0n,
      assets: new Map([[AssetId(mint.v2LogicScript.hash()), 1n]]),
    },
    datum: PlutusData.fromCore({
      items: [
        PlutusData.newBytes(fromHex(mint.cnightPolicy)).toCore(),
        PlutusData.newBytes(fromHex(mint.stagingForeverHash)).toCore(),
      ],
    }).toCore(),
  });
  output.amount().setCoin(minAda(output, ctx.parameters.coinsPerUtxoByte));
  return output;
};

/** Spend the one-shot, mint the empty-name NFT under the v2 logic policy, and lock it at the v2 logic with the StagingState datum. */
export const planMintStagingState = (
  ctx: PlanningContext<StagingStateMint>,
): TxPlan => ({
  spends: [{ utxo: ctx.resolved.oneShotUtxo, redeemer: Option.none() }],
  references: [],
  scripts: [],
  mints: [
    {
      policy: ctx.resolved.v2LogicScript,
      assets: new Map([[AssetName(""), 1n]]),
      redeemer: Option.some(PlutusData.newInteger(0n)),
    },
  ],
  outputs: [stagingStateOutput(ctx)],
  withdrawals: [],
  registrations: [],
  collateral: [ctx.resolved.collateralUtxo],
  metadata: Option.some(ctx.command),
  feePadding: ctx.resolved.feePadding,
  expectedWitnesses: ctx.resolved.expectedWitnesses,
});

/** Mint the StagingState NFT of a validator's v2 logic from its one-shot, with the profile's collateral; built (never submitted), signed with the tech authority's keys unless --no-sign, and written to a file. */
export const mintStagingStateProgram = (input: {
  readonly network: Environment;
  readonly outputDir: string;
  readonly outputFile: string;
  readonly validator: V2TrackValidator;
  readonly feePadding: bigint;
  readonly sign: boolean;
}) =>
  Effect.gen(function* () {
    const command = "mint-staging-state";
    const { network, validator } = input;
    const track = V2_TRACKS[validator];
    const signer = yield* signerFor(input.sign, "tech-auth");
    const output = yield* Output;
    const blueprint = (yield* ContractResolver).contracts("creates");

    yield* output.log(
      `\nMinting StagingState NFT for ${validator} on ${network}`,
    );
    const config = yield* (yield* Profile).config;
    const deployer = yield* (yield* DeployerAddress).address;
    const instances = yield* blueprint.instances;
    const v2LogicScript = (yield* blueprint.classOf(track.v2LogicClasses))
      .Script;
    yield* output.log(
      `V2 logic script hash (policy ID): ${v2LogicScript.hash()}`,
    );
    const [oneShotHash, oneShotIndex] = track.oneShot(config);
    yield* output.log(`One-shot UTxO: ${oneShotHash}#${oneShotIndex}`);

    const stagingForever = track.stagingForever(instances);
    if (stagingForever === undefined) {
      return yield* new BlueprintError({
        environment: network,
        source: "build",
        reason: `Staging forever contract not found for ${validator}. Ensure the blueprint includes staging forever validators.`,
      });
    }
    const stagingForeverHash = stagingForever.Script.hash();
    yield* output.log(`Staging forever hash: ${stagingForeverHash}`);
    yield* output.log(`CNIGHT test policy: ${config.cnight_policy}`);

    const { collateralPercentage } = yield* (yield* Provider).parameters;
    const oneShotUtxo = yield* deployerUtxoAt(oneShotHash, oneShotIndex);
    yield* output.log(
      `One-shot UTxO resolved: ${oneShotUtxo.output().amount().coin()} lovelace`,
    );
    const collateral = yield* profileCollateral(
      command,
      config,
      collateralPercentage,
    );
    yield* output.log(
      `\nUsing collateral UTxO: ${config.collateral_utxo_hash}#${config.collateral_utxo_index} with ${collateral.lovelace} lovelace`,
    );
    yield* output.log(
      `Collateral validation passed: ${collateral.lovelace} lovelace >= ${collateral.required} lovelace required`,
    );

    const ctx = yield* planningContext({
      command,
      environment: network,
      wallet: deployer,
      contracts: yield* blueprint.contracts,
      resolved: {
        oneShotUtxo,
        v2LogicScript,
        stagingForeverHash,
        cnightPolicy: config.cnight_policy,
        collateralUtxo: collateral.collateral,
        feePadding: input.feePadding,
        expectedWitnesses: witnessCount(signer, 0),
      },
    });
    yield* output.log(
      `Min UTxO for output: ${stagingStateOutput(ctx).amount().coin()} lovelace`,
    );
    const tx = yield* compileReported(planMintStagingState(ctx), ctx);
    yield* signAndWrite(
      tx,
      txFilePath(input),
      signer,
      "Mint StagingState NFT Transaction",
    );
    yield* output.log("\nStagingState NFT details:");
    yield* output.log(`  Policy ID: ${v2LogicScript.hash()}`);
    yield* output.log(`  Asset Name: (empty)`);
    yield* output.log(
      `  Output Address: ${addressFromValidator(ctx.networkId, v2LogicScript).toBech32()}`,
    );
    yield* output.log(`  Datum: StagingState`);
    yield* output.log(`    cnight_test_policy: ${config.cnight_policy}`);
    yield* output.log(`    forever_script_hash: ${stagingForeverHash}`);
    return tx;
  });

// migrate-federated-ops

/** What a federated ops migration is built from: the forever and two-stage main UTxOs, the v1 datum and the logic the main state names. */
export interface FederatedOpsMigration {
  readonly forever: Script;
  readonly foreverUtxo: TransactionUnspentOutput;
  readonly twoStageUtxo: TransactionUnspentOutput;
  readonly feeUtxo: TransactionUnspentOutput;
  /** The v1 forever datum the migration rewrites. */
  readonly current: Contracts.FederatedOps;
  /** The logic the two-stage main state names; it must carry a Migrate branch (v2+). */
  readonly logicScript: Script;
  readonly mitigationLogicScript: Option.Option<Script>;
  readonly feePadding: bigint;
}

/** LogicRedeemer::Migrate: constructor 1, no fields. */
const MIGRATE_REDEEMER = PlutusData.fromCore({
  constructor: 1n,
  fields: { items: [] },
});

/** Spend the forever into itself with the v1 datum rewritten as FederatedOpsV2 (empty message, logic_round 2), withdrawing through the logic (and mitigation logic) with Migrate, the two-stage main referenced. No authority witnesses: the Migrate branch checks only the rewrite. */
export const planFederatedOpsMigration = (
  ctx: PlanningContext<FederatedOpsMigration>,
): TxPlan => {
  const migration = ctx.resolved;
  const [data, appendix] = migration.current;
  return {
    spends: [
      { utxo: migration.feeUtxo, redeemer: Option.none() },
      {
        utxo: migration.foreverUtxo,
        redeemer: Option.some(PlutusData.newInteger(0n)),
      },
    ],
    references: [migration.twoStageUtxo],
    scripts: [migration.forever],
    mints: [],
    outputs: [
      TransactionOutput.fromCore({
        address: PaymentAddress(
          addressFromValidator(ctx.networkId, migration.forever).toBech32(),
        ),
        value: {
          coins: migration.foreverUtxo.output().amount().coin(),
          assets: new Map([[AssetId(migration.forever.hash()), 1n]]),
        },
        datum: serialize(Contracts.FederatedOpsV2, [
          data,
          "",
          appendix,
          2n,
        ]).toCore(),
      }),
    ],
    withdrawals: withdrawThroughLogic(
      migration.logicScript,
      migration.mitigationLogicScript,
      MIGRATE_REDEEMER,
      ctx.networkId,
    ),
    registrations: [],
    collateral: [],
    metadata: Option.some(ctx.command),
    feePadding: migration.feePadding,
    expectedWitnesses: witnessCount(UNSIGNED, 0),
  };
};

/** Rewrite the federated-ops forever datum from v1 to FederatedOpsV2 through the promoted v2 logic's Migrate branch; built (never submitted), unsigned, and written to a file. */
export const migrateFederatedOpsProgram = (input: {
  readonly network: Environment;
  readonly outputDir: string;
  readonly outputFile: string;
  readonly txHash: TxHash;
  readonly txIndex: TxIndex;
  readonly feePadding: bigint;
}) =>
  Effect.gen(function* () {
    const command = "migrate-federated-ops";
    const { network, txHash, txIndex } = input;
    const output = yield* Output;
    const blueprint = (yield* ContractResolver).contracts("actsOn");

    yield* output.log(
      `\nMigrating Federated Ops datum from v1 to v2 on ${network} network`,
    );
    yield* output.log(`Using UTxO: ${txHash}#${txIndex}`);

    const { networkId } = environmentOf(network);
    const instances = yield* blueprint.instances;
    const forever = instances.federatedOpsForever.Script;
    const twoStage = instances.federatedOpsTwoStage.Script;
    yield* output.log(
      `\nFederated Ops Forever Address: ${addressFromValidator(networkId, forever).toBech32()}`,
    );
    const utxosAt = yield* scriptUtxos({ forever, twoStage }, networkId);
    yield* output.log("\nFound contract UTxOs:");
    yield* output.log(`  Federated ops forever: ${utxosAt("forever").length}`);
    yield* output.log(
      `  Federated ops two stage: ${utxosAt("twoStage").length}`,
    );
    const foreverUtxo = yield* firstUtxoAt(
      utxosAt("forever"),
      forever,
      networkId,
    );
    const twoStageUtxo = yield* mainUtxoAt(
      utxosAt("twoStage"),
      twoStage,
      networkId,
    );

    yield* output.log("\nReading federated ops two-stage upgrade state...");
    const { logicHash, mitigationLogicHash } =
      yield* upgradeStateAt(twoStageUtxo);
    yield* output.log(`  Logic hash: ${logicHash}`);
    yield* output.log(
      `  Mitigation logic hash: ${mitigationLogicHash || "(empty)"}`,
    );
    // The v1 logic has no Migrate branch.
    if (logicHash === instances.federatedOpsLogic.Script.hash()) {
      return yield* new PreconditionFailed({
        command,
        refusal: { _tag: "LogicNotV2", logicHash },
      });
    }
    const { logic: logicScript, mitigationLogic: mitigationLogicScript } =
      yield* upgradeScripts(
        blueprint,
        { logicHash, mitigationLogicHash },
        "a federated ops logic with a Migrate branch (v2+) in the blueprint",
      );

    yield* output.log("\nCurrent federated ops forever datum:");
    const datum = yield* inlineDatum(foreverUtxo, "FederatedOps");
    if ((datum.asList()?.getLength() ?? 0) >= 4) {
      return yield* new PreconditionFailed({
        command,
        refusal: { _tag: "DatumAlreadyMigrated" },
      });
    }
    const current = yield* decodeDatum(datum, "FederatedOps", (d) =>
      parse(Contracts.FederatedOps, d),
    );
    yield* output.log(`  Current logic round: ${current[2]}`);
    yield* output.log(`  Appendix entries: ${current[1].length}`);
    yield* output.log("\nNew FederatedOpsV2 datum created:");
    yield* output.log("  message: (empty)");
    yield* output.log("  logic_round: 2");

    yield* output.log(
      `\nLogic reward account: ${createRewardAccount(logicHash, networkId)}`,
    );
    if (Option.isSome(mitigationLogicScript)) {
      yield* output.log(
        `Mitigation logic reward account: ${createRewardAccount(mitigationLogicHash, networkId)}`,
      );
    }
    yield* ensureRegistered(network, [
      { label: "Logic (v2)", scriptHash: logicHash },
      ...(Option.isSome(mitigationLogicScript)
        ? [{ label: "Mitigation Logic", scriptHash: mitigationLogicHash }]
        : []),
    ]);

    const { address: deployer, utxo: feeUtxo } = yield* deployerUtxo(
      txHash,
      txIndex,
    );
    if (Option.isSome(mitigationLogicScript)) {
      yield* output.log("  Adding mitigation logic withdrawal...");
    }
    const ctx = yield* planningContext({
      command,
      environment: network,
      wallet: deployer,
      contracts: yield* blueprint.contracts,
      resolved: {
        forever,
        foreverUtxo,
        twoStageUtxo,
        feeUtxo,
        current,
        logicScript,
        mitigationLogicScript,
        feePadding: input.feePadding,
      },
    });
    const tx = yield* compileReported(planFederatedOpsMigration(ctx), ctx);
    yield* signAndWrite(
      tx,
      txFilePath(input),
      UNSIGNED,
      "Migrate Federated Ops Transaction",
    );
    yield* output.log(
      "\nNote: Migrate redeemer bypasses multisig validation - no signing required.",
    );
    return tx;
  });
