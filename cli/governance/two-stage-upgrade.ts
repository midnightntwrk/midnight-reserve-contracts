/**
 * stage-upgrade / promote-upgrade: move one field of a two-stage validator's
 * UpgradeState (logic, auth, mitigation logic, mitigation auth) into staging,
 * then promote it to main. A transaction is one or more target steps (spend
 * one two-stage UTxO, reference its twin, write the next state) plus one
 * governance authority (gov-auth withdrawal, threshold reference, both
 * authority witnesses). The build*Tx functions compose one step with the
 * authority. The programs resolve everything through
 * Provider/Blueprint/Settings and keep the deployed-scripts snapshot
 * (versions.json, merged plutus.json) in step with the chain.
 */
import { serialize } from "@blaze-cardano/data";
import {
  type Address,
  addressFromValidator,
  AssetId,
  type NetworkId,
  PaymentAddress,
  type Script,
  toHex,
  type TransactionInput,
  TransactionOutput,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import type {
  Blaze,
  Provider as BlazeProvider,
  Wallet,
} from "@blaze-cardano/sdk";
import type { TxBuilder } from "@blaze-cardano/tx";
import type { FileSystem } from "@effect/platform";
import { Effect, Either, Option } from "effect";
import type { Signers } from "../datum/signers";
import {
  type Environment,
  environmentOf,
  type Profile,
} from "../config/network-mapping";
import {
  Blueprint,
  hasDeployedScripts,
  type UpgradableValidator,
} from "../contracts/contracts";
import {
  contractUtxos,
  ensureRegistered,
  MAIN_TOKEN_HEX,
  rawUpgradeStateAt,
  rewardAccountRegistered,
  STAGING_TOKEN_HEX,
  twoStageUtxos,
  deployerUtxo,
  signersAt,
  thresholdAt,
  upgradeStateAt,
  type ContractUtxos,
} from "../chain/governance-provider";
import {
  createRewardAccount,
  registerScriptStake,
  createTxMetadata,
  mintWitnesses,
  signAndWrite,
  signerFor,
  witnessCount,
} from "../chain/transaction";
import { Output } from "../output";
import { buildTx } from "../chain/complete-tx";
import { buildOutput, PROJECT_ROOT } from "../contracts/paths";
import {
  buildValidatorNameByHash,
  type DeployedScripts,
  prepareValidatorMerge,
  promoteValidatorVersion,
  readVersions,
  stageValidator,
  validatorNameByHash,
  writeValidatorMerge,
} from "../contracts/versions";
import {
  type FeeInput,
  type ScriptHash,
  type TxFileInput,
  txFilePath,
} from "../input";
import { type WitnessRequirements, witnessRequirements } from "./threshold";
import { Provider } from "../chain/provider";
import {
  type BlueprintError,
  type DatumParseError,
  PreconditionFailed,
} from "../errors";
import * as Contracts from "../../contract_blueprint";

/** The two-stage validators with a v2 staging track, as mint-staging-state takes them. */
export const V2_TRACK_VALIDATORS = [
  "tech-auth",
  "council",
  "reserve",
  "ics",
  "federated-ops",
  "terms-and-conditions",
] as const;

/** One of V2_TRACK_VALIDATORS. */
export type V2TrackValidator = (typeof V2_TRACK_VALIDATORS)[number];

const TECH_WITNESS_ASSET = toHex(new TextEncoder().encode("tech-auth-witness"));
const COUNCIL_WITNESS_ASSET = toHex(
  new TextEncoder().encode("council-auth-witness"),
);

/** The UpgradeState field a transaction moves. */
export type UpgradeField =
  "Logic" | "Auth" | "MitigationLogic" | "MitigationAuth";

/** One two-stage validator with its main and staging UTxOs. */
export interface TwoStageTarget {
  readonly twoStage: Script;
  readonly mainUtxo: TransactionUnspentOutput;
  readonly stagingUtxo: TransactionUnspentOutput;
  /** A reference-script UTxO carrying `twoStage`; None provides the script inline. */
  readonly scriptRef: Option.Option<TransactionUnspentOutput>;
}

/** The gov-auth script that runs, its threshold, and both authorities' forever states. */
export interface GovernanceAuthority {
  readonly govAuth: Script;
  readonly thresholdUtxo: TransactionUnspentOutput;
  readonly techAuthForeverUtxo: TransactionUnspentOutput;
  readonly councilForeverUtxo: TransactionUnspentOutput;
  readonly techAuthSigners: Signers;
  readonly councilSigners: Signers;
  /** What the threshold demands of both signer sets above. */
  readonly requirements: WitnessRequirements;
  /** The council main UTxO the staging authority reads; None when the target's own main already is it. */
  readonly councilMainUtxo: Option.Option<TransactionUnspentOutput>;
}

export interface UpgradeInputs {
  readonly target: TwoStageTarget;
  readonly authority: GovernanceAuthority;
  readonly userUtxo: TransactionUnspentOutput;
}

export interface StageUpgradeParams {
  readonly field: UpgradeField;
  readonly newHash: string;
  readonly networkId: NetworkId;
  readonly changeAddress: Address;
  readonly feePadding: bigint;
}

export interface PromoteUpgradeParams {
  readonly field: UpgradeField;
  readonly networkId: NetworkId;
  readonly changeAddress: Address;
  readonly feePadding: bigint;
  /** The promoted logic script to register as a stake credential in the same transaction. */
  readonly registerLogic: Option.Option<Script>;
}

/** UpgradeState is [logic, mitigation_logic, auth, mitigation_auth, round, logic_round]. */
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

const outputRef = (input: TransactionInput) => ({
  transaction_id: input.transactionId(),
  output_index: BigInt(input.index()),
});

const twoStageOutput = (
  target: TwoStageTarget,
  spent: TransactionUnspentOutput,
  tokenHex: string,
  state: Contracts.UpgradeState,
  networkId: NetworkId,
) =>
  TransactionOutput.fromCore({
    address: PaymentAddress(
      addressFromValidator(networkId, target.twoStage).toBech32(),
    ),
    value: {
      coins: spent.output().amount().coin(),
      assets: new Map([[AssetId(target.twoStage.hash() + tokenHex), 1n]]),
    },
    datum: serialize(Contracts.UpgradeState, state).toCore(),
  });

const withTwoStageScript = (txBuilder: TxBuilder, target: TwoStageTarget) =>
  Option.match(target.scriptRef, {
    onNone: () => txBuilder.provideScript(target.twoStage),
    onSome: (ref) => txBuilder.addReferenceInput(ref),
  });

/** Spend the target's staging UTxO into its next state, referencing main. */
export const stageUpgradeStep = (
  txBuilder: TxBuilder,
  target: TwoStageTarget,
  field: UpgradeField,
  newHash: string,
  networkId: NetworkId,
): Either.Either<TxBuilder, DatumParseError> =>
  Either.map(rawUpgradeStateAt(target.stagingUtxo), (current) => {
    const redeemer = serialize(Contracts.TwoStageRedeemer, [
      field,
      { Staging: [outputRef(target.mainUtxo.input()), newHash] },
    ]);
    return withTwoStageScript(
      txBuilder
        .addInput(target.stagingUtxo, redeemer)
        .addReferenceInput(target.mainUtxo)
        .addOutput(
          twoStageOutput(
            target,
            target.stagingUtxo,
            STAGING_TOKEN_HEX,
            nextStagingState(field, current, newHash),
            networkId,
          ),
        ),
      target,
    );
  });

/** Spend the target's main UTxO into the promoted state, referencing staging. */
const promoteUpgradeStep = (
  txBuilder: TxBuilder,
  target: TwoStageTarget,
  field: UpgradeField,
  networkId: NetworkId,
): Either.Either<TxBuilder, DatumParseError> =>
  Either.map(
    Either.all([
      rawUpgradeStateAt(target.mainUtxo),
      rawUpgradeStateAt(target.stagingUtxo),
    ]),
    ([main, staging]) => {
      const redeemer = serialize(Contracts.TwoStageRedeemer, [
        field,
        { Main: [outputRef(target.stagingUtxo.input())] },
      ]);
      return withTwoStageScript(
        txBuilder
          .addInput(target.mainUtxo, redeemer)
          .addReferenceInput(target.stagingUtxo)
          .addOutput(
            twoStageOutput(
              target,
              target.mainUtxo,
              MAIN_TOKEN_HEX,
              promotedMainState(field, main, staging),
              networkId,
            ),
          ),
        target,
      );
    },
  );

/** Run the authority: reference the threshold and both forevers, mint both witness tokens, withdraw through gov-auth with the first tech-auth signer as redeemer. */
export const withGovernanceAuthority = (
  txBuilder: TxBuilder,
  authority: GovernanceAuthority,
  networkId: NetworkId,
): TxBuilder => {
  const { techAuth, council } = authority.requirements;
  const [firstSigner] = authority.techAuthSigners;
  const govAuthRedeemer = serialize(Contracts.PermissionedRedeemer, {
    [firstSigner.paymentHash]: firstSigner.sr25519Key,
  });
  const authorized = mintWitnesses(
    txBuilder
      .addReferenceInput(authority.thresholdUtxo)
      .addReferenceInput(authority.techAuthForeverUtxo)
      .addReferenceInput(authority.councilForeverUtxo)
      .provideScript(authority.govAuth),
    [
      {
        ...techAuth,
        signers: authority.techAuthSigners,
        assetName: TECH_WITNESS_ASSET,
      },
      {
        ...council,
        signers: authority.councilSigners,
        assetName: COUNCIL_WITNESS_ASSET,
      },
    ],
    networkId,
  ).addWithdrawal(
    createRewardAccount(authority.govAuth.hash(), networkId),
    0n,
    govAuthRedeemer,
  );
  return Option.match(authority.councilMainUtxo, {
    onNone: () => authorized,
    onSome: (councilMain) => authorized.addReferenceInput(councilMain),
  });
};

/** The stage transaction: one target step, the fee UTxO, the authority. */
export const buildStageUpgradeTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: UpgradeInputs,
  params: StageUpgradeParams,
): Either.Either<TxBuilder, DatumParseError> =>
  Either.gen(function* () {
    const stepped = yield* stageUpgradeStep(
      blaze.newTransaction(),
      inputs.target,
      params.field,
      params.newHash,
      params.networkId,
    );
    const authorized = withGovernanceAuthority(
      stepped.addInput(inputs.userUtxo),
      inputs.authority,
      params.networkId,
    );
    return authorized
      .setChangeAddress(params.changeAddress)
      .setMetadata(createTxMetadata("stage-upgrade"))
      .setFeePadding(params.feePadding);
  });

/** The promote transaction: one target step, the fee UTxO, the authority, optionally the logic registration. */
export const buildPromoteUpgradeTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: UpgradeInputs,
  params: PromoteUpgradeParams,
): Either.Either<TxBuilder, DatumParseError> =>
  Either.gen(function* () {
    const stepped = yield* promoteUpgradeStep(
      blaze.newTransaction(),
      inputs.target,
      params.field,
      params.networkId,
    );
    const authorized = withGovernanceAuthority(
      stepped.addInput(inputs.userUtxo),
      inputs.authority,
      params.networkId,
    );
    const txBuilder = authorized
      .setChangeAddress(params.changeAddress)
      .setMetadata(createTxMetadata("promote-upgrade"))
      .setFeePadding(params.feePadding);
    return Option.match(params.registerLogic, {
      onNone: () => txBuilder,
      onSome: (logic) => registerScriptStake(txBuilder, logic),
    });
  });

/** A promotion: the validator, its fee UTxO, whether to sign, and where the file goes. */
export interface PromoteUpgradeInput extends TxFileInput, FeeInput {
  readonly validator: UpgradableValidator;
  readonly sign: boolean;
}

/** A stage: the validator and the logic hash to stage, its fee UTxO, whether to sign, where the file goes. */
export interface StageUpgradeInput extends TxFileInput, FeeInput {
  readonly validator: UpgradableValidator;
  readonly newLogicHash: ScriptHash;
  readonly sign: boolean;
}

/** The build output a stage copies a new logic from. */
export interface LogicBuild {
  readonly profile: Profile;
  readonly plutusPath: string;
}

/** The logic to stage by name: from the record, or from the build (Some path: copy it into the record, which overwrites an unpromoted entry of that name); a hash in neither, or a build logic whose name is promoted, is refused. */
export const logicToStage = (
  environment: string,
  hash: ScriptHash,
  build: LogicBuild,
): Effect.Effect<
  { readonly name: string; readonly copyFrom: Option.Option<string> },
  BlueprintError | PreconditionFailed,
  FileSystem.FileSystem | DeployedScripts
> =>
  Effect.gen(function* () {
    const recorded = yield* validatorNameByHash(environment, hash);
    if (Option.isSome(recorded))
      return { name: recorded.value, copyFrom: Option.none() };
    const built = yield* buildValidatorNameByHash(
      environment,
      hash,
      build.plutusPath,
    );
    if (Option.isNone(built))
      return yield* new PreconditionFailed({
        command: "stage-upgrade",
        refusal: {
          _tag: "LogicNotFound",
          logicHash: hash,
          environment,
          profile: build.profile,
          buildPath: build.plutusPath,
        },
      });
    if (
      Option.exists(yield* readVersions(environment), ({ promoted }) =>
        promoted.includes(built.value),
      )
    )
      return yield* new PreconditionFailed({
        command: "stage-upgrade",
        refusal: {
          _tag: "PromotedLogicMoved",
          name: built.value,
          logicHash: hash,
          environment,
          profile: build.profile,
        },
      });
    return { name: built.value, copyFrom: Option.some(build.plutusPath) };
  });

/** The multisig signatures an unsigned transaction of this authority needs: tech auth's and council's. */
const requiredSignatures = ({ requirements }: GovernanceAuthority) =>
  requirements.techAuth.required + requirements.council.required;

const sameUtxo = (a: TransactionUnspentOutput, b: TransactionUnspentOutput) =>
  a.input().transactionId() === b.input().transactionId() &&
  a.input().index() === b.input().index();

/** The authority from its queried UTxOs: both signer sets and the threshold read, the witness requirements logged, its gov-auth reward account checked. */
const resolveAuthority = (
  found: ContractUtxos<"techAuthForever" | "councilForever" | "threshold">,
  scope: "Staging" | "Main",
  govAuth: Script,
  councilMainUtxo: Option.Option<TransactionUnspentOutput>,
  networkId: NetworkId,
  environment: Environment,
) =>
  Effect.gen(function* () {
    const out = yield* Output;
    const techAuthForeverUtxo = yield* found.first("techAuthForever");
    const councilForeverUtxo = yield* found.first("councilForever");
    const thresholdUtxo = yield* found.first("threshold");
    yield* out.log("\nReading current tech auth state...");
    const techAuthSigners = yield* signersAt(techAuthForeverUtxo);
    yield* out.log("Reading current council state...");
    const councilSigners = yield* signersAt(councilForeverUtxo);
    yield* out.log(`Reading ${scope.toLowerCase()} gov threshold...`);
    const threshold = yield* thresholdAt(thresholdUtxo);
    const requirements = witnessRequirements(threshold, {
      techAuthSigners,
      councilSigners,
    });

    const authority: GovernanceAuthority = {
      govAuth,
      thresholdUtxo,
      techAuthForeverUtxo,
      councilForeverUtxo,
      techAuthSigners,
      councilSigners,
      requirements,
      councilMainUtxo,
    };
    const { techAuth, council } = requirements;
    yield* out.log(
      `\nRequired tech auth signers: ${techAuth.required}/${techAuth.total}`,
    );
    yield* out.log(
      `Required council signers: ${council.required}/${council.total}`,
    );
    yield* ensureRegistered(
      [
        {
          label: `${scope} Gov Auth`,
          rewardAccount: createRewardAccount(govAuth.hash(), networkId),
          scriptHash: govAuth.hash(),
        },
      ],
      environment,
    );
    return authority;
  });

/** Resolve the inputs, build, complete and write the stage transaction; then, where the environment keeps a record, copy a logic that only the build has into it and track it as staged. */
export const stageUpgradeProgram = (input: StageUpgradeInput) =>
  Effect.gen(function* () {
    const { network, validator, sign, newLogicHash } = input;
    const { txHash, txIndex } = input;
    const signer = yield* signerFor(sign, "both");
    const out = yield* Output;
    const blueprint = yield* Blueprint;
    const provider = yield* Provider;
    const outputPath = txFilePath(input);
    const profile = environmentOf(network).aikenConfigSection;

    yield* out.log(`\nStaging upgrade for ${validator} on ${network} network`);
    yield* out.log(`New logic hash: ${newLogicHash}`);
    const logic = yield* logicToStage(network, newLogicHash, {
      profile,
      plutusPath: buildOutput(PROJECT_ROOT, profile).plutusPath,
    });
    const copy = yield* Effect.transposeOption(
      Option.map(
        Option.filter(logic.copyFrom, () => hasDeployedScripts(network)),
        (plutusPath) =>
          prepareValidatorMerge(network, newLogicHash, plutusPath),
      ),
    );
    if (Option.isSome(copy)) {
      yield* out.log(
        `  Not in deployed-scripts/${network}; found in the ${profile} build as ${logic.name}`,
      );
    }
    yield* out.log(`Using UTxO: ${txHash}#${txIndex}`);

    const restage = Option.exists(
      yield* readVersions(network),
      ({ promoted }) => promoted.includes(logic.name),
    );
    if (restage) {
      yield* out.log(
        `\n  Re-staging promoted validator: ${logic.name} (${newLogicHash})`,
      );
    }

    const { networkId } = environmentOf(network);
    const contracts = yield* blueprint.instances;
    const target = yield* blueprint.twoStage(validator);
    const twoStage = target.twoStage.Script;
    yield* out.log(
      `\nTwo Stage Address: ${addressFromValidator(networkId, twoStage).toBech32()}`,
    );

    const blaze = yield* provider.blaze;
    const scripts = {
      techAuthForever: contracts.techAuthForever.Script,
      councilForever: contracts.councilForever.Script,
      threshold: contracts.stagingGovThreshold.Script,
      councilTwoStage: contracts.councilTwoStage.Script,
    };
    const [{ main: targetMain, staging: stagingUtxo }, found] =
      yield* Effect.all(
        [twoStageUtxos(twoStage, networkId), contractUtxos(scripts, networkId)],
        { concurrency: "unbounded" },
      );
    yield* out.log("\nFound contract UTxOs:");
    yield* out.log("  Two stage: main and staging found");
    yield* out.log(
      `  Tech auth forever: ${found.at("techAuthForever").length}`,
    );
    yield* out.log(`  Council forever: ${found.at("councilForever").length}`);
    yield* out.log(`  Staging gov threshold: ${found.at("threshold").length}`);
    yield* out.log(
      `  Council two stage: ${found.at("councilTwoStage").length}`,
    );

    const councilMainUtxo = yield* found.main("councilTwoStage");
    const authority = yield* resolveAuthority(
      found,
      "Staging",
      contracts.stagingGovAuth.Script,
      sameUtxo(councilMainUtxo, targetMain)
        ? Option.none()
        : Option.some(councilMainUtxo),
      networkId,
      network,
    );

    const { address: changeAddress, utxo: userUtxo } = yield* deployerUtxo(
      txHash,
      txIndex,
    );

    const txBuilder = yield* buildStageUpgradeTx(
      blaze,
      {
        target: {
          twoStage,
          mainUtxo: targetMain,
          stagingUtxo,
          scriptRef: Option.none(),
        },
        authority,
        userUtxo,
      },
      {
        field: "Logic",
        newHash: newLogicHash,
        networkId,
        changeAddress,
        feePadding: input.feePadding,
      },
    );
    const required = requiredSignatures(authority);
    const tx = yield* buildTx(txBuilder, {
      commandName: "stage-upgrade",
      environment: network,
      witnesses: witnessCount(signer, required),
      knownUtxos: [
        stagingUtxo,
        targetMain,
        authority.thresholdUtxo,
        authority.techAuthForeverUtxo,
        authority.councilForeverUtxo,
        ...Option.toArray(authority.councilMainUtxo),
        userUtxo,
      ],
    });

    yield* signAndWrite(tx, outputPath, signer, "Stage Upgrade Transaction");

    if (Option.isSome(copy)) {
      yield* writeValidatorMerge(network, copy.value);
      yield* out.success(
        `Added ${logic.name} to deployed-scripts/${network}/plutus.json`,
      );
    }
    if (!restage) {
      if (yield* stageValidator(network, logic.name)) {
        yield* out.success(`Tracked ${logic.name} as staged in versions.json`);
      } else {
        yield* out.stderr(
          `Warning: Could not track staged validator — versions.json not found for ${network}`,
        );
      }
    }
    return tx;
  });

/** Resolve the inputs, build, complete and write the promote transaction; then track the promoted validator. */
export const promoteUpgradeProgram = (input: PromoteUpgradeInput) =>
  Effect.gen(function* () {
    const { network, validator, sign, txHash, txIndex } = input;
    const signer = yield* signerFor(sign, "both");
    const out = yield* Output;
    const blueprint = yield* Blueprint;
    const provider = yield* Provider;
    const outputPath = txFilePath(input);

    yield* out.log(
      `\nPromoting staged upgrade to main for ${validator} on ${network} network`,
    );
    yield* out.log(`Using UTxO: ${txHash}#${txIndex}`);

    const { networkId } = environmentOf(network);
    const contracts = yield* blueprint.instances;
    const target = yield* blueprint.twoStage(validator);
    const twoStage = target.twoStage.Script;
    yield* out.log(
      `\nTwo Stage Address: ${addressFromValidator(networkId, twoStage).toBech32()}`,
    );

    const blaze = yield* provider.blaze;
    const scripts = {
      techAuthForever: contracts.techAuthForever.Script,
      councilForever: contracts.councilForever.Script,
      threshold: contracts.mainGovThreshold.Script,
    };
    const [{ main: targetMain, staging: stagingUtxo }, found] =
      yield* Effect.all(
        [twoStageUtxos(twoStage, networkId), contractUtxos(scripts, networkId)],
        { concurrency: "unbounded" },
      );
    yield* out.log("\nFound contract UTxOs:");
    yield* out.log("  Two stage: main and staging found");
    yield* out.log(
      `  Tech auth forever: ${found.at("techAuthForever").length}`,
    );
    yield* out.log(`  Council forever: ${found.at("councilForever").length}`);
    yield* out.log(`  Main gov threshold: ${found.at("threshold").length}`);

    const authority = yield* resolveAuthority(
      found,
      "Main",
      contracts.govAuth.Script,
      Option.none(),
      networkId,
      network,
    );
    yield* out.log("Reading staging state...");
    const stagedLogicHash = (yield* upgradeStateAt(stagingUtxo)).logicHash;
    yield* out.log(`\nStaged logic hash to promote: ${stagedLogicHash}`);

    // Governance withdraws through the promoted logic next; register it here when the chain lacks it.
    const registered = yield* rewardAccountRegistered(
      createRewardAccount(stagedLogicHash, networkId),
      network,
    );
    const registerLogic = registered
      ? Option.none<Script>()
      : Option.some(
          yield* blueprint.scriptByHash(
            stagedLogicHash,
            `Staged logic script ${stagedLogicHash} not found in the ${blueprint.source} blueprint` +
              (blueprint.source === "build"
                ? ""
                : `; stage it again with stage-upgrade, which copies it from the build into deployed-scripts/${network}`),
          ),
        );
    if (Option.isSome(registerLogic)) {
      yield* out.log(
        "\n  Promoted logic hash not yet registered as stake credential.",
      );
      yield* out.log(`  Will register ${stagedLogicHash} in this transaction.`);
    }

    const { address: changeAddress, utxo: userUtxo } = yield* deployerUtxo(
      txHash,
      txIndex,
    );
    const txBuilder = yield* buildPromoteUpgradeTx(
      blaze,
      {
        target: {
          twoStage,
          mainUtxo: targetMain,
          stagingUtxo,
          scriptRef: Option.none(),
        },
        authority,
        userUtxo,
      },
      {
        field: "Logic",
        networkId,
        changeAddress,
        feePadding: input.feePadding,
        registerLogic,
      },
    );
    const required = requiredSignatures(authority);
    const tx = yield* buildTx(txBuilder, {
      commandName: "promote-upgrade",
      environment: network,
      witnesses: witnessCount(signer, required),
      knownUtxos: [
        targetMain,
        stagingUtxo,
        authority.thresholdUtxo,
        authority.techAuthForeverUtxo,
        authority.councilForeverUtxo,
        userUtxo,
      ],
    });

    yield* signAndWrite(tx, outputPath, signer, "Promote Upgrade Transaction");

    const promotedName = Option.getOrElse(
      yield* validatorNameByHash(network, stagedLogicHash),
      () => stagedLogicHash,
    );
    if (yield* promoteValidatorVersion(network, promotedName)) {
      yield* out.success(
        `Tracked ${promotedName} as promoted in versions.json`,
      );
    } else {
      yield* out.stderr(
        `Warning: Could not track promoted validator — versions.json not found for ${network}`,
      );
    }
    return tx;
  });
