/**
 * Two-stage contracts: the main and staging NFTs, the UpgradeState in a
 * two-stage UTxO's inline datum, which validator names are a track's
 * logic, and the logic scripts a main state names. twoStageLogic serves
 * change-council, change-tech-auth, change-terms and change-federated-ops.
 * register-gov-auth registers the stake credentials of the main and
 * staging gov auth, which every upgrade runs through. stage-upgrade and
 * promote-upgrade move a logic hash into a validator's staging state and
 * from there into main, and keep the deployed-scripts record in step.
 */
import {
  addressFromValidator,
  AssetId,
  type NetworkId,
  PaymentAddress,
  type PlutusData,
  type Script,
  toHex,
  TransactionOutput,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { parse, serialize } from "@blaze-cardano/data";
import { Effect, Option } from "effect";
import * as Contracts from "../../contract_blueprint";
import {
  deployerUtxo,
  firstUtxoAt,
  planningContext,
  Provider,
  refuseRegistered,
  scriptUtxos,
} from "../chain";
import { DeployerAddress, type Environment, environmentOf } from "../config";
import {
  type Blueprint,
  type ContractInstances,
  ContractResolver,
  type UpgradableValidator,
} from "../contracts/resolver";
import {
  applyRecordUpdate,
  prepareValidatorMerge,
  type RecordUpdate,
} from "../contracts/snapshot-write";
import { decodeInlineDatum } from "../datum";
import {
  type BlueprintError,
  type DatumParseError,
  PreconditionFailed,
  UtxoNotFound,
} from "../errors";
import {
  type ScriptHash,
  type TxHash,
  type TxIndex,
  txFilePath,
} from "../input";
import { Output } from "../output";
import {
  compileReported,
  signAndWrite,
  signerFor,
  UNSIGNED,
  witnessCount,
} from "../signing";
import { createRewardAccount, type PlanningContext, type TxPlan } from "../tx";
import {
  type GovernanceAuthority,
  governanceAuthorityPlan,
  resolveAuthority,
} from "./multisig";

/** Hex of the "main" NFT name every two-stage contract mints. */
export const MAIN_TOKEN_HEX = toHex(new TextEncoder().encode("main"));
/** Hex of the "staging" NFT name every two-stage contract mints. */
export const STAGING_TOKEN_HEX = toHex(new TextEncoder().encode("staging"));

/** The UTxO holding the "main" NFT of this two-stage policy. */
export const findMainUtxo = (
  utxos: readonly TransactionUnspentOutput[],
  policyId: string,
): TransactionUnspentOutput | undefined =>
  utxos.find(
    (utxo) =>
      utxo
        .output()
        .amount()
        .multiasset()
        ?.get(AssetId(policyId + MAIN_TOKEN_HEX)) === 1n,
  );

/** The UTxO among `utxos` holding the "main" NFT of the two-stage script, or UtxoNotFound at its address. */
export const mainUtxoAt = (
  utxos: readonly TransactionUnspentOutput[],
  twoStage: Script,
  networkId: NetworkId,
): Effect.Effect<TransactionUnspentOutput, UtxoNotFound> => {
  const utxo = findMainUtxo(utxos, twoStage.hash());
  return utxo === undefined
    ? Effect.fail(
        UtxoNotFound.holding(
          addressFromValidator(networkId, twoStage).toBech32(),
          `${twoStage.hash()}.main`,
        ),
      )
    : Effect.succeed(utxo);
};

/** The UpgradeState fields the CLI reads. */
export interface UpgradeState {
  readonly logicHash: string;
  readonly mitigationLogicHash: string;
  readonly authHash: string;
  readonly logicRound: number;
}

/** The blueprint UpgradeState tuple in a two-stage UTxO's inline datum. */
export const rawUpgradeStateAt = (
  utxo: TransactionUnspentOutput,
): Effect.Effect<Contracts.UpgradeState, DatumParseError> =>
  decodeInlineDatum(utxo, "UpgradeState", (data) =>
    parse(Contracts.UpgradeState, data),
  );

/** The UpgradeState in a two-stage UTxO's inline datum. */
export const upgradeStateAt = (
  utxo: TransactionUnspentOutput,
): Effect.Effect<UpgradeState, DatumParseError> =>
  Effect.map(
    rawUpgradeStateAt(utxo),
    ([logicHash, mitigationLogicHash, authHash, , , logicRound]) => ({
      logicHash,
      mitigationLogicHash,
      authHash,
      logicRound: Number(logicRound),
    }),
  );

/** Whether `name` is a logic of `track`: `<track>_logic`, or `<track>_logic_v<N>` for any N from 2 up. */
export const isTrackLogic = (track: string, name: string): boolean =>
  name === `${track}_logic` ||
  new RegExp(`^${track}_logic_v([2-9]|[1-9][0-9]+)$`).test(name);

/** The logic and mitigation logic scripts an UpgradeState names, from the blueprint; `expected` describes the logic the unknown-logic error asks for. */
export const upgradeScripts = (
  blueprint: Blueprint,
  state: Pick<UpgradeState, "logicHash" | "mitigationLogicHash">,
  expected: string,
): Effect.Effect<
  {
    readonly logic: Script;
    readonly mitigationLogic: Option.Option<Script>;
  },
  BlueprintError
> =>
  Effect.all({
    logic: blueprint.scriptByHash(
      state.logicHash,
      `Unknown logic script hash in UpgradeState: ${state.logicHash}. Expected: ${expected}`,
    ),
    mitigationLogic: state.mitigationLogicHash
      ? Effect.map(
          blueprint.scriptByHash(
            state.mitigationLogicHash,
            `Unknown mitigation logic script hash in UpgradeState: ${state.mitigationLogicHash}`,
          ),
          Option.some,
        )
      : Effect.succeed(Option.none<Script>()),
  });

/** The logic scripts a two-stage main state names, logged with the reward accounts the transaction withdraws from; `label` names the contract in the log. */
export const twoStageLogic = (
  blueprint: Blueprint,
  label: string,
  twoStageMain: TransactionUnspentOutput,
  expectedLogic: string,
  networkId: NetworkId,
) =>
  Effect.gen(function* () {
    const output = yield* Output;
    yield* output.log(`\nReading ${label} two-stage upgrade state...`);
    const state = yield* upgradeStateAt(twoStageMain);
    yield* output.log(`  Logic hash: ${state.logicHash}`);
    yield* output.log(
      `  Mitigation logic hash: ${state.mitigationLogicHash || "(empty)"}`,
    );
    yield* output.log(`  Logic round: ${state.logicRound}`);
    const { logic, mitigationLogic } = yield* upgradeScripts(
      blueprint,
      state,
      expectedLogic,
    );
    yield* output.log(
      `\nLogic reward account: ${createRewardAccount(state.logicHash, networkId)}`,
    );
    if (Option.isSome(mitigationLogic)) {
      yield* output.log(
        `Mitigation logic reward account: ${createRewardAccount(state.mitigationLogicHash, networkId)}`,
      );
      yield* output.log("  Adding mitigation logic withdrawal...");
    }
    return {
      logicRound: state.logicRound,
      logicScript: logic,
      mitigationLogicScript: mitigationLogic,
    };
  });

// register-gov-auth

/** The gov-auth scripts every two-stage contract's upgrades run through. */
export interface GovAuthScripts {
  readonly govAuth: Script;
  readonly stagingGovAuth: Script;
}

/** Register the main and staging gov-auth scripts as stake credentials in one transaction; the wallet pays. */
export const planRegisterGovAuth = (
  ctx: PlanningContext<GovAuthScripts>,
): TxPlan => ({
  spends: [],
  references: [],
  scripts: [],
  mints: [],
  outputs: [],
  withdrawals: [],
  registrations: [ctx.resolved.govAuth, ctx.resolved.stagingGovAuth],
  collateral: [],
  metadata: Option.none(),
  feePadding: 0n,
  expectedWitnesses: witnessCount(UNSIGNED, 0),
});

/** Register the main and staging gov-auth stake credentials, refused when the chain already has either; the deployer wallet pays and takes the change; built (never submitted), unsigned, and written to a file. */
export const registerGovAuthProgram = (input: {
  readonly network: Environment;
  readonly outputDir: string;
  readonly outputFile: string;
}) =>
  Effect.gen(function* () {
    const { network } = input;
    const output = yield* Output;
    yield* output.log(`\nRegistering Gov Auth scripts on ${network} network`);

    const blueprint = (yield* ContractResolver).contracts("actsOn");
    const instances = yield* blueprint.instances;
    const govAuth = instances.govAuth.Script;
    const stagingGovAuth = instances.stagingGovAuth.Script;
    yield* output.log(`\nMain Gov Auth script hash: ${govAuth.hash()}`);
    yield* output.log(`Staging Gov Auth script hash: ${stagingGovAuth.hash()}`);
    yield* refuseRegistered("register-gov-auth", network, [
      { label: "Main Gov Auth", scriptHash: govAuth.hash() },
      { label: "Staging Gov Auth", scriptHash: stagingGovAuth.hash() },
    ]);

    const ctx = yield* planningContext({
      command: "register-gov-auth",
      environment: network,
      wallet: yield* (yield* DeployerAddress).address,
      contracts: yield* blueprint.contracts,
      resolved: { govAuth, stagingGovAuth },
    });
    const tx = yield* compileReported(planRegisterGovAuth(ctx), ctx);
    yield* signAndWrite(
      tx,
      txFilePath(input),
      UNSIGNED,
      "Register Government Authority Transaction",
    );
    return tx;
  });

// stage-upgrade and promote-upgrade

/** The UpgradeState field a transaction moves. */
export type UpgradeField =
  | "Logic"
  | "Auth"
  | "MitigationLogic"
  | "MitigationAuth";

/** The staging state after staging `newHash` in `field`: Logic raises logic_round, every other field round. UpgradeState is [logic, mitigation_logic, auth, mitigation_auth, round, logic_round]. */
export const nextStagingState = (
  field: UpgradeField,
  current: Contracts.UpgradeState,
  newHash: string,
): Contracts.UpgradeState => {
  const [logic, mitigationLogic, auth, mitigationAuth, round, logicRound] =
    current;
  switch (field) {
    case "Logic":
      return [
        newHash,
        mitigationLogic,
        auth,
        mitigationAuth,
        round,
        logicRound + 1n,
      ];
    case "Auth":
      return [
        logic,
        mitigationLogic,
        newHash,
        mitigationAuth,
        round + 1n,
        logicRound,
      ];
    case "MitigationLogic":
      return [logic, newHash, auth, mitigationAuth, round + 1n, logicRound];
    case "MitigationAuth":
      return [logic, mitigationLogic, auth, newHash, round + 1n, logicRound];
  }
};

/** The main state after promotion: the staged field and its round are copied over. */
export const promotedMainState = (
  field: UpgradeField,
  main: Contracts.UpgradeState,
  staging: Contracts.UpgradeState,
): Contracts.UpgradeState => {
  const [logic, mitigationLogic, auth, mitigationAuth, round, logicRound] =
    main;
  switch (field) {
    case "Logic":
      return [
        staging[0],
        mitigationLogic,
        auth,
        mitigationAuth,
        round,
        staging[5],
      ];
    case "Auth":
      return [
        logic,
        mitigationLogic,
        staging[2],
        mitigationAuth,
        staging[4],
        logicRound,
      ];
    case "MitigationLogic":
      return [logic, staging[1], auth, mitigationAuth, staging[4], logicRound];
    case "MitigationAuth":
      return [logic, mitigationLogic, auth, staging[3], staging[4], logicRound];
  }
};

/** A two-stage validator with its main and staging UTxOs and their UpgradeStates. */
export interface TwoStageTarget {
  readonly twoStage: Script;
  readonly mainUtxo: TransactionUnspentOutput;
  readonly stagingUtxo: TransactionUnspentOutput;
  readonly mainState: Contracts.UpgradeState;
  readonly stagingState: Contracts.UpgradeState;
}

/** The main and staging UTxOs of a two-stage validator, with their states; a missing one is UtxoNotFound naming its token. */
export const twoStageTarget = (twoStage: Script, networkId: NetworkId) =>
  Effect.gen(function* () {
    const utxosAt = yield* scriptUtxos({ twoStage }, networkId);
    const policyId = twoStage.hash();
    const holding = (tokenHex: string) =>
      utxosAt("twoStage").find(
        (utxo) =>
          utxo
            .output()
            .amount()
            .multiasset()
            ?.get(AssetId(policyId + tokenHex)) === 1n,
      );
    const mainUtxo = holding(MAIN_TOKEN_HEX);
    const stagingUtxo = holding(STAGING_TOKEN_HEX);
    if (mainUtxo === undefined || stagingUtxo === undefined) {
      return yield* UtxoNotFound.holding(
        addressFromValidator(networkId, twoStage).toBech32(),
        [
          ...(mainUtxo ? [] : [`${policyId}.main`]),
          ...(stagingUtxo ? [] : [`${policyId}.staging`]),
        ].join(" and "),
      );
    }
    const target: TwoStageTarget = {
      twoStage,
      mainUtxo,
      stagingUtxo,
      mainState: yield* rawUpgradeStateAt(mainUtxo),
      stagingState: yield* rawUpgradeStateAt(stagingUtxo),
    };
    return target;
  });

const outputRef = (utxo: TransactionUnspentOutput) => ({
  transaction_id: utxo.input().transactionId(),
  output_index: BigInt(utxo.input().index()),
});

/** What a stage or a promote is built from. */
export interface Upgrade {
  readonly target: TwoStageTarget;
  readonly authority: GovernanceAuthority;
  readonly feeUtxo: TransactionUnspentOutput;
  readonly field: UpgradeField;
  readonly feePadding: bigint;
  readonly expectedWitnesses: number;
}

/** Spend the target's `spent` UTxO with `redeemer` into `state` under `tokenHex`, referencing `referenced`, with the fee UTxO and the governance authority. */
const upgradePlan = (
  ctx: PlanningContext<Upgrade>,
  spent: TransactionUnspentOutput,
  redeemer: PlutusData,
  referenced: TransactionUnspentOutput,
  tokenHex: string,
  state: Contracts.UpgradeState,
): TxPlan => {
  const { target, authority, feeUtxo } = ctx.resolved;
  const governance = governanceAuthorityPlan(authority, ctx.networkId);
  return {
    spends: [
      { utxo: spent, redeemer: Option.some(redeemer) },
      { utxo: feeUtxo, redeemer: Option.none() },
    ],
    references: [referenced, ...governance.references],
    scripts: [target.twoStage],
    mints: governance.mints,
    outputs: [
      TransactionOutput.fromCore({
        address: PaymentAddress(
          addressFromValidator(ctx.networkId, target.twoStage).toBech32(),
        ),
        value: {
          coins: spent.output().amount().coin(),
          assets: new Map([[AssetId(target.twoStage.hash() + tokenHex), 1n]]),
        },
        datum: serialize(Contracts.UpgradeState, state).toCore(),
      }),
    ],
    withdrawals: governance.withdrawals,
    registrations: [],
    collateral: [],
    metadata: Option.some(ctx.command),
    feePadding: ctx.resolved.feePadding,
    expectedWitnesses: ctx.resolved.expectedWitnesses,
  };
};

/** Stage `newHash` in the field: spend the staging UTxO into its next state, referencing main. */
export const planStage = (
  ctx: PlanningContext<Upgrade & { readonly newHash: string }>,
): TxPlan => {
  const { target, field, newHash } = ctx.resolved;
  return upgradePlan(
    ctx,
    target.stagingUtxo,
    serialize(Contracts.TwoStageRedeemer, [
      field,
      { Staging: [outputRef(target.mainUtxo), newHash] },
    ]),
    target.mainUtxo,
    STAGING_TOKEN_HEX,
    nextStagingState(field, target.stagingState, newHash),
  );
};

/** Promote the staged field: spend the main UTxO into the promoted state, referencing staging; register the promoted logic's stake credential when the chain lacks it. */
export const planPromote = (
  ctx: PlanningContext<
    Upgrade & { readonly registerLogic: Option.Option<Script> }
  >,
): TxPlan => {
  const { target, field, registerLogic } = ctx.resolved;
  return {
    ...upgradePlan(
      ctx,
      target.mainUtxo,
      serialize(Contracts.TwoStageRedeemer, [
        field,
        { Main: [outputRef(target.stagingUtxo)] },
      ]),
      target.stagingUtxo,
      MAIN_TOKEN_HEX,
      promotedMainState(field, target.mainState, target.stagingState),
    ),
    registrations: Option.toArray(registerLogic),
  };
};

/** The flags of a stage or a promote. */
interface UpgradeInput {
  readonly network: Environment;
  readonly outputDir: string;
  readonly outputFile: string;
  readonly validator: UpgradableValidator;
  readonly txHash: TxHash;
  readonly txIndex: TxIndex;
  readonly feePadding: bigint;
  readonly sign: boolean;
}

/** The authority's forevers and threshold, and the council two-stage main when `councilTwoStage` is given (only the staging authority reads it), read from the chain with their counts logged; the target's main and staging are "found" already. */
const authorityUtxos = (
  instances: ContractInstances,
  threshold: { readonly label: string; readonly script: Script },
  councilTwoStage: Option.Option<Script>,
  networkId: NetworkId,
) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const scripts = {
      techAuthForever: instances.techAuthForever.Script,
      councilForever: instances.councilForever.Script,
      threshold: threshold.script,
    };
    const [utxosAt, councilUtxos] = yield* Effect.all(
      [
        scriptUtxos(scripts, networkId),
        Effect.transposeOption(
          Option.map(councilTwoStage, (script) =>
            Effect.map(
              scriptUtxos({ councilTwoStage: script }, networkId),
              (at) => ({ script, utxos: at("councilTwoStage") }),
            ),
          ),
        ),
      ],
      { concurrency: "unbounded" },
    );
    yield* output.log("\nFound contract UTxOs:");
    yield* output.log("  Two stage: main and staging found");
    yield* output.log(
      `  Tech auth forever: ${utxosAt("techAuthForever").length}`,
    );
    yield* output.log(`  Council forever: ${utxosAt("councilForever").length}`);
    yield* output.log(`  ${threshold.label}: ${utxosAt("threshold").length}`);
    if (Option.isSome(councilUtxos)) {
      yield* output.log(
        `  Council two stage: ${councilUtxos.value.utxos.length}`,
      );
    }
    const first = (name: keyof typeof scripts) =>
      firstUtxoAt(utxosAt(name), scripts[name], networkId);
    return {
      techAuthForeverUtxo: yield* first("techAuthForever"),
      councilForeverUtxo: yield* first("councilForever"),
      thresholdUtxo: yield* first("threshold"),
      councilMainUtxo: yield* Effect.transposeOption(
        Option.map(councilUtxos, ({ script, utxos }) =>
          mainUtxoAt(utxos, script, networkId),
        ),
      ),
    };
  });

/** Write the record updates and print what they did. */
const applyRecord = (network: string, updates: readonly RecordUpdate[]) =>
  Effect.gen(function* () {
    const output = yield* Output;
    for (const outcome of yield* applyRecordUpdate(network, updates)) {
      if (outcome._tag === "Merged") {
        yield* output.success(
          `Added ${outcome.name} to deployed-scripts/${network}/plutus.json`,
        );
      } else if (outcome._tag === "Tracked") {
        yield* output.success(
          `Tracked ${outcome.name} as ${outcome.as} in versions.json`,
        );
      } else if (outcome._tag === "VersionsMissing") {
        yield* output.stderr(
          `Warning: Could not track ${outcome.as} validator — versions.json not found for ${network}`,
        );
      }
    }
  });

const sameUtxo = (a: TransactionUnspentOutput, b: TransactionUnspentOutput) =>
  a.input().transactionId() === b.input().transactionId() &&
  a.input().index() === b.input().index();

/**
 * Stage a new logic hash for a two-stage validator under the staging
 * authority; built (never submitted), signed with both authorities' keys
 * unless --no-sign, and written to a file. The validator's contracts, the
 * forevers, the staging threshold and gov auth come from the record (the
 * build on local and the emulator). The logic is looked up in the record,
 * else in the build; where the environment keeps a record, a logic only
 * the build has is copied into it, and the validator is tracked as staged
 * unless it re-stages a promoted one.
 */
export const stageUpgradeProgram = (
  input: UpgradeInput & { readonly newLogicHash: ScriptHash },
) =>
  Effect.gen(function* () {
    const command = "stage-upgrade";
    const signer = yield* signerFor(input.sign, "both");
    const { network, validator, newLogicHash, txHash, txIndex } = input;
    const output = yield* Output;
    const resolver = yield* ContractResolver;
    const blueprint = resolver.contracts("actsOn");
    const { profile, plutusPath } = resolver.build;

    yield* output.log(
      `\nStaging upgrade for ${validator} on ${network} network`,
    );
    yield* output.log(`New logic hash: ${newLogicHash}`);
    const recorded = yield* resolver.recordedNameOf(newLogicHash);
    let name: string;
    let copy: Option.Option<RecordUpdate> = Option.none();
    if (Option.isSome(recorded)) {
      name = recorded.value;
    } else {
      const built = yield* resolver.builtNameOf(newLogicHash);
      if (Option.isNone(built)) {
        return yield* new PreconditionFailed({
          command,
          refusal: {
            _tag: "LogicNotFound",
            logicHash: newLogicHash,
            environment: network,
            profile,
            buildPath: plutusPath,
          },
        });
      }
      name = built.value;
      if (yield* resolver.isPromoted(name)) {
        return yield* new PreconditionFailed({
          command,
          refusal: {
            _tag: "PromotedLogicMoved",
            name,
            logicHash: newLogicHash,
            environment: network,
            profile,
          },
        });
      }
      if (resolver.hasRecord) {
        copy = Option.some(
          yield* prepareValidatorMerge(network, name, newLogicHash, plutusPath),
        );
        yield* output.log(
          `  Not in deployed-scripts/${network}; found in the ${profile} build as ${name}`,
        );
      }
    }
    yield* output.log(`Using UTxO: ${txHash}#${txIndex}`);
    const restage = yield* resolver.isPromoted(name);
    if (restage) {
      yield* output.log(
        `\n  Re-staging promoted validator: ${name} (${newLogicHash})`,
      );
    }
    const record: RecordUpdate[] = resolver.hasRecord
      ? [
          ...Option.toArray(copy),
          ...(restage ? [] : [{ _tag: "Track", as: "staged", name } as const]),
        ]
      : [];

    const { networkId } = environmentOf(network);
    const instances = yield* blueprint.instances;
    const twoStage = (yield* blueprint.twoStage(validator)).twoStage.Script;
    yield* output.log(
      `\nTwo Stage Address: ${addressFromValidator(networkId, twoStage).toBech32()}`,
    );
    const target = yield* twoStageTarget(twoStage, networkId);
    const found = yield* authorityUtxos(
      instances,
      {
        label: "Staging gov threshold",
        script: instances.stagingGovThreshold.Script,
      },
      Option.some(instances.councilTwoStage.Script),
      networkId,
    );
    const authority = yield* resolveAuthority(
      found,
      "Staging",
      instances.stagingGovAuth.Script,
      // The staging authority reads the council main; when the target is the council, its own main already is it.
      Option.filter(
        found.councilMainUtxo,
        (councilMain) => !sameUtxo(councilMain, target.mainUtxo),
      ),
      network,
    );
    const { address: deployer, utxo: feeUtxo } = yield* deployerUtxo(
      txHash,
      txIndex,
    );
    const { techAuth, council } = authority.requirements;
    const ctx = yield* planningContext({
      command,
      environment: network,
      wallet: deployer,
      contracts: yield* blueprint.contracts,
      resolved: {
        target,
        authority,
        feeUtxo,
        field: "Logic" as const,
        newHash: newLogicHash,
        feePadding: input.feePadding,
        expectedWitnesses: witnessCount(
          signer,
          techAuth.required + council.required,
        ),
      },
    });
    const tx = yield* compileReported(planStage(ctx), ctx);
    yield* signAndWrite(
      tx,
      txFilePath(input),
      signer,
      "Stage Upgrade Transaction",
    );
    yield* applyRecord(network, record);
    return tx;
  });

/**
 * Promote the staged logic of a two-stage validator to main under the main
 * authority, registering its stake credential in the same transaction when
 * the chain lacks it; built (never submitted), signed with both
 * authorities' keys unless --no-sign, and written to a file. The contracts
 * come from the record (the build on local and the emulator); --use-build
 * looks the staged logic up in the build instead. Where the environment
 * keeps a record, the validator is tracked as promoted.
 */
export const promoteUpgradeProgram = (
  input: UpgradeInput & { readonly useBuild: boolean },
) =>
  Effect.gen(function* () {
    const command = "promote-upgrade";
    const signer = yield* signerFor(input.sign, "both");
    const { network, validator, txHash, txIndex } = input;
    const output = yield* Output;
    const resolver = yield* ContractResolver;
    const blueprint = resolver.contracts("actsOn");
    const lookup = resolver.contracts(input.useBuild ? "creates" : "actsOn");

    yield* output.log(
      `\nPromoting staged upgrade to main for ${validator} on ${network} network`,
    );
    yield* output.log(`Using UTxO: ${txHash}#${txIndex}`);

    const { networkId } = environmentOf(network);
    const instances = yield* blueprint.instances;
    const twoStage = (yield* blueprint.twoStage(validator)).twoStage.Script;
    yield* output.log(
      `\nTwo Stage Address: ${addressFromValidator(networkId, twoStage).toBech32()}`,
    );
    const target = yield* twoStageTarget(twoStage, networkId);
    const found = yield* authorityUtxos(
      instances,
      {
        label: "Main gov threshold",
        script: instances.mainGovThreshold.Script,
      },
      Option.none(),
      networkId,
    );
    const authority = yield* resolveAuthority(
      found,
      "Main",
      instances.govAuth.Script,
      Option.none(),
      network,
    );
    yield* output.log("Reading staging state...");
    const stagedLogicHash = target.stagingState[0];
    yield* output.log(`\nStaged logic hash to promote: ${stagedLogicHash}`);
    const record: RecordUpdate[] = resolver.hasRecord
      ? [
          {
            _tag: "Track",
            as: "promoted",
            name: Option.getOrElse(
              yield* resolver.recordedNameOf(stagedLogicHash),
              () => stagedLogicHash,
            ),
          },
        ]
      : [];

    // Governance withdraws through the promoted logic next; register it here when the chain lacks it.
    const registered = Option.getOrElse(
      yield* (yield* Provider).rewardAccountRegistered(
        createRewardAccount(stagedLogicHash, networkId),
      ),
      () => true,
    );
    const registerLogic = registered
      ? Option.none<Script>()
      : Option.some(
          yield* lookup.scriptByHash(
            stagedLogicHash,
            `Staged logic script ${stagedLogicHash} not found in the ${lookup.source} blueprint` +
              (lookup.source === "build"
                ? ""
                : `; stage it again with stage-upgrade, which copies it from the build into deployed-scripts/${network}`),
          ),
        );
    if (Option.isSome(registerLogic)) {
      yield* output.log(
        "\n  Promoted logic hash not yet registered as stake credential.",
      );
      yield* output.log(
        `  Will register ${stagedLogicHash} in this transaction.`,
      );
    }
    const { address: deployer, utxo: feeUtxo } = yield* deployerUtxo(
      txHash,
      txIndex,
    );
    const { techAuth, council } = authority.requirements;
    const ctx = yield* planningContext({
      command,
      environment: network,
      wallet: deployer,
      contracts: yield* blueprint.contracts,
      resolved: {
        target,
        authority,
        feeUtxo,
        field: "Logic" as const,
        registerLogic,
        feePadding: input.feePadding,
        expectedWitnesses: witnessCount(
          signer,
          techAuth.required + council.required,
        ),
      },
    });
    const tx = yield* compileReported(planPromote(ctx), ctx);
    yield* signAndWrite(
      tx,
      txFilePath(input),
      signer,
      "Promote Upgrade Transaction",
    );
    yield* applyRecord(network, record);
    return tx;
  });
