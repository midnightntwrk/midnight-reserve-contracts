/**
 * The multisig authorities: the threshold rule of validators/thresholds.ak
 * and what a threshold demands of the council and tech-auth signers, the
 * signer and threshold datums of their UTxOs, the native-script witnesses
 * a governance transaction mints, the governance authority an upgrade runs
 * through, and change-council and change-tech-auth, which replace an
 * authority's signers in its forever datum.
 */
import {
  addressFromCredential,
  addressFromValidator,
  AssetId,
  AssetName,
  Credential,
  CredentialType,
  Hash28ByteBase16,
  NativeScripts,
  type NetworkId,
  PaymentAddress,
  PlutusData,
  Script,
  toHex,
  TransactionOutput,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { parse, serialize } from "@blaze-cardano/data";
import { Effect, Option, Result } from "effect";
import * as Contracts from "../../contract_blueprint";
import {
  deployerUtxo,
  ensureRegistered,
  firstUtxoAt,
  planningContext,
  scriptUtxos,
} from "../chain";
import { type Environment, environmentOf, newSigners } from "../config";
import {
  type ContractInstances,
  ContractResolver,
} from "../contracts/resolver";
import {
  datumRoundOf,
  decodeInlineDatum,
  decodeSigners,
  encodeMultisigState,
  encodeRedeemerMap,
  inlineDatum,
} from "../datum";
import { DatumParseError, type InputParseError } from "../errors";
import { type Signers, type TxHash, type TxIndex, txFilePath } from "../input";
import { Output } from "../output";
import {
  compileReported,
  signAndWrite,
  signerFor,
  witnessCount,
} from "../signing";
import {
  createRewardAccount,
  logicRedeemer,
  type PlanningContext,
  type TxPlan,
  withdrawThroughLogic,
} from "../tx";
import { mainUtxoAt, twoStageLogic } from "./two-stage";

// thresholds

/** A threshold fraction as the threshold validator accepts it: 0 <= numerator < denominator. */
export interface Threshold {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/** The tech-auth and council fractions of a threshold datum, each checked by the on-chain rule. */
export interface AuthorityThreshold {
  readonly techAuth: Threshold;
  readonly council: Threshold;
}

/** A fraction by the rule 0 <= numerator < denominator; the failure is the reason. */
const checkedThreshold = (
  numerator: bigint,
  denominator: bigint,
): Result.Result<Threshold, string> =>
  denominator <= 0n
    ? Result.fail("denominator must be greater than zero")
    : numerator < 0n
      ? Result.fail("numerator must be non-negative")
      : numerator >= denominator
        ? Result.fail("numerator must be less than denominator")
        : Result.succeed({ numerator, denominator });

/** The fractions of a [tech_num, tech_denom, council_num, council_denom] datum; the failure is the reason. */
export const authorityThreshold = ([
  techAuthNum,
  techAuthDenom,
  councilNum,
  councilDenom,
]: Contracts.MultisigThreshold): Result.Result<AuthorityThreshold, string> => {
  const checked = (numerator: bigint, denominator: bigint) =>
    Result.mapError(
      checkedThreshold(numerator, denominator),
      (reason) => `invalid threshold ${numerator}/${denominator}: ${reason}`,
    );
  return Result.all({
    techAuth: checked(techAuthNum, techAuthDenom),
    council: checked(councilNum, councilDenom),
  });
};

/** The signer count a fraction requires of `total`: ceil(total * numerator / denominator), as the on-chain native script computes it. */
export const requiredSigners = (
  total: number,
  { numerator, denominator }: Threshold,
): number =>
  Number((BigInt(total) * numerator + (denominator - 1n)) / denominator);

/** How many of a group's signers a threshold demands. */
export interface WitnessRequirement {
  readonly required: number;
  readonly total: number;
}

/** What a threshold demands of each authority. */
export interface WitnessRequirements {
  readonly techAuth: WitnessRequirement;
  readonly council: WitnessRequirement;
}

/** What the threshold demands of the tech-auth and council signers. */
export const witnessRequirements = (
  { techAuth, council }: AuthorityThreshold,
  signers: {
    readonly techAuthSigners: Signers;
    readonly councilSigners: Signers;
  },
): WitnessRequirements => ({
  techAuth: {
    required: requiredSigners(signers.techAuthSigners.length, techAuth),
    total: signers.techAuthSigners.length,
  },
  council: {
    required: requiredSigners(signers.councilSigners.length, council),
    total: signers.councilSigners.length,
  },
});

// datums

/** The current signers in a multisig authority's forever UTxO. */
export const signersAt = (utxo: TransactionUnspentOutput) =>
  Effect.flatMap(inlineDatum(utxo, "VersionedMultisig"), decodeSigners);

/** The fractions of a threshold UTxO's MultisigThreshold datum, each checked. */
export const thresholdAt = (utxo: TransactionUnspentOutput) =>
  Effect.flatMap(
    decodeInlineDatum(utxo, "MultisigThreshold", (data) =>
      parse(Contracts.MultisigThreshold, data),
    ),
    (datum) =>
      Effect.mapError(
        Effect.fromResult(authorityThreshold(datum)),
        (reason) =>
          new DatumParseError({
            what: "MultisigThreshold",
            cbor: utxo.output().datum()?.asInlineData()?.toCbor() ?? "",
            reason,
          }),
      ),
  );

// witnesses

/** At least `required` of the signers' payment keys. */
const nativeMultisig = (
  required: number,
  signers: Signers,
  networkId: NetworkId,
) =>
  Script.newNativeScript(
    NativeScripts.atLeastNOfK(
      required,
      ...signers.map((s) =>
        NativeScripts.justAddress(
          addressFromCredential(
            networkId,
            Credential.fromCore({
              type: CredentialType.KeyHash,
              hash: Hash28ByteBase16(s.paymentHash),
            }),
          ).toBech32(),
          networkId,
        ),
      ),
    ),
  );

/** One token named `assetName` under each group's native multisig, which `required` of its signers must sign. */
export const mintWitnesses = (
  witnesses: readonly {
    readonly required: number;
    readonly signers: Signers;
    readonly assetName: string;
  }[],
  networkId: NetworkId,
): TxPlan["mints"] =>
  witnesses.map(({ required, signers, assetName }) => ({
    policy: nativeMultisig(required, signers, networkId),
    assets: new Map([[AssetName(assetName), 1n]]),
    redeemer: Option.none(),
  }));

// the governance authority of an upgrade

const TECH_WITNESS_ASSET = toHex(new TextEncoder().encode("tech-auth-witness"));
const COUNCIL_WITNESS_ASSET = toHex(
  new TextEncoder().encode("council-auth-witness"),
);

/** The gov-auth script an upgrade runs through, its threshold, and both authorities' forever states. */
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

/** The authority as plan parts: reference the threshold and both forevers (and the council main when the staging authority reads it), mint both witness tokens, withdraw through gov auth with the first tech-auth signer as redeemer. */
export const governanceAuthorityPlan = (
  authority: GovernanceAuthority,
  networkId: NetworkId,
): Pick<TxPlan, "references" | "mints" | "withdrawals"> => {
  const { techAuth, council } = authority.requirements;
  const [firstSigner] = authority.techAuthSigners;
  return {
    references: [
      authority.thresholdUtxo,
      authority.techAuthForeverUtxo,
      authority.councilForeverUtxo,
      ...Option.toArray(authority.councilMainUtxo),
    ],
    mints: mintWitnesses(
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
    ),
    withdrawals: [
      {
        rewardAccount: createRewardAccount(authority.govAuth.hash(), networkId),
        script: authority.govAuth,
        redeemer: serialize(Contracts.PermissionedRedeemer, {
          [firstSigner.paymentHash]: firstSigner.sr25519Key,
        }),
      },
    ],
  };
};

/** The authority from its UTxOs: both signer sets and the threshold read, the witness requirements logged, its gov-auth reward account checked. */
export const resolveAuthority = (
  utxos: {
    readonly techAuthForeverUtxo: TransactionUnspentOutput;
    readonly councilForeverUtxo: TransactionUnspentOutput;
    readonly thresholdUtxo: TransactionUnspentOutput;
  },
  scope: "Staging" | "Main",
  govAuth: Script,
  councilMainUtxo: Option.Option<TransactionUnspentOutput>,
  environment: Environment,
) =>
  Effect.gen(function* () {
    const output = yield* Output;
    yield* output.log("\nReading current tech auth state...");
    const techAuthSigners = yield* signersAt(utxos.techAuthForeverUtxo);
    yield* output.log("Reading current council state...");
    const councilSigners = yield* signersAt(utxos.councilForeverUtxo);
    yield* output.log(`Reading ${scope.toLowerCase()} gov threshold...`);
    const requirements = witnessRequirements(
      yield* thresholdAt(utxos.thresholdUtxo),
      { techAuthSigners, councilSigners },
    );
    const { techAuth, council } = requirements;
    yield* output.log(
      `\nRequired tech auth signers: ${techAuth.required}/${techAuth.total}`,
    );
    yield* output.log(
      `Required council signers: ${council.required}/${council.total}`,
    );
    yield* ensureRegistered(environment, [
      { label: `${scope} Gov Auth`, scriptHash: govAuth.hash() },
    ]);
    const authority: GovernanceAuthority = {
      ...utxos,
      govAuth,
      techAuthSigners,
      councilSigners,
      requirements,
      councilMainUtxo,
    };
    return authority;
  });

// change-council and change-tech-auth

/** The authority a multisig change replaces the signers of; the other one witnesses it. */
export type MultisigFamily = "council" | "tech-auth";

/** A requirement with the authority's label. */
interface SignerRequirement extends WitnessRequirement {
  readonly label: string;
}

/** What a threshold demands of the primary and the secondary signers. */
export interface MultisigRequirements {
  readonly primary: SignerRequirement;
  readonly secondary: SignerRequirement;
}

/** The threshold's council and tech-auth requirements as primary and secondary; the family decides which is which. */
export const signerRequirements = (
  threshold: AuthorityThreshold,
  primarySigners: Signers,
  secondarySigners: Signers,
  family: MultisigFamily,
): MultisigRequirements => {
  const councilPrimary = family === "council";
  const requirements = witnessRequirements(threshold, {
    councilSigners: councilPrimary ? primarySigners : secondarySigners,
    techAuthSigners: councilPrimary ? secondarySigners : primarySigners,
  });
  const council = { label: "council", ...requirements.council };
  const techAuth = { label: "tech auth", ...requirements.techAuth };
  return councilPrimary
    ? { primary: council, secondary: techAuth }
    : { primary: techAuth, secondary: council };
};

/** What a multisig change is built from, read from the chain and the blueprint, and the signers it installs. */
export interface MultisigChange {
  readonly primaryForever: Script;
  readonly primaryForeverUtxo: TransactionUnspentOutput;
  readonly primaryThresholdUtxo: TransactionUnspentOutput;
  readonly secondaryForeverUtxo: TransactionUnspentOutput;
  readonly primaryTwoStageUtxo: TransactionUnspentOutput;
  readonly feeUtxo: TransactionUnspentOutput;
  readonly logicScript: Script;
  readonly mitigationLogicScript: Option.Option<Script>;
  /** logic_round of the two-stage UpgradeState: the datum round and the redeemer shape. */
  readonly logicRound: number;
  readonly currentPrimarySigners: Signers;
  readonly secondarySigners: Signers;
  readonly requirements: MultisigRequirements;
  readonly newSigners: Signers;
  readonly feePadding: bigint;
  readonly expectedWitnesses: number;
}

/** Spend the primary forever into itself with the new signers, mint both authorities' witnesses, and withdraw through the logic (and mitigation logic) with the new signers as the member redeemer. */
export const planMultisigChange = (
  ctx: PlanningContext<MultisigChange>,
): Result.Result<TxPlan, InputParseError> =>
  Result.gen(function* () {
    const change = ctx.resolved;
    const state = yield* encodeMultisigState(
      change.newSigners,
      BigInt(datumRoundOf(change.logicRound)),
    );
    const members = yield* encodeRedeemerMap(change.newSigners);
    const { primary, secondary } = change.requirements;
    return {
      spends: [
        { utxo: change.feeUtxo, redeemer: Option.none() },
        {
          utxo: change.primaryForeverUtxo,
          redeemer: Option.some(PlutusData.newInteger(0n)),
        },
      ],
      references: [
        change.primaryThresholdUtxo,
        change.secondaryForeverUtxo,
        change.primaryTwoStageUtxo,
      ],
      scripts: [change.primaryForever],
      mints: mintWitnesses(
        [
          { ...primary, signers: change.currentPrimarySigners, assetName: "" },
          { ...secondary, signers: change.secondarySigners, assetName: "" },
        ],
        ctx.networkId,
      ),
      outputs: [
        TransactionOutput.fromCore({
          address: PaymentAddress(
            addressFromValidator(
              ctx.networkId,
              change.primaryForever,
            ).toBech32(),
          ),
          value: {
            coins: change.primaryForeverUtxo.output().amount().coin(),
            assets: new Map([[AssetId(change.primaryForever.hash()), 1n]]),
          },
          datum: state.toCore(),
        }),
      ],
      withdrawals: withdrawThroughLogic(
        change.logicScript,
        change.mitigationLogicScript,
        logicRedeemer(members, change.logicRound),
        ctx.networkId,
      ),
      registrations: [],
      collateral: [],
      metadata: Option.some(ctx.command),
      feePadding: change.feePadding,
      expectedWitnesses: change.expectedWitnesses,
    };
  });

/** What tells change-council and change-tech-auth apart. */
const FAMILIES = {
  council: {
    command: "change-council",
    label: "Council",
    description: "Change Council Transaction",
    signersVariable: "COUNCIL_SIGNERS",
    contracts: (instances: ContractInstances) => ({
      primaryForever: instances.councilForever,
      primaryTwoStage: instances.councilTwoStage,
      primaryThreshold: instances.mainCouncilUpdateThreshold,
      primaryLogic: instances.councilLogic,
      secondaryForever: instances.techAuthForever,
    }),
  },
  "tech-auth": {
    command: "change-tech-auth",
    label: "Tech Auth",
    description: "Change Technical Authority Transaction",
    signersVariable: "TECH_AUTH_SIGNERS",
    contracts: (instances: ContractInstances) => ({
      primaryForever: instances.techAuthForever,
      primaryTwoStage: instances.techAuthTwoStage,
      primaryThreshold: instances.mainTechAuthUpdateThreshold,
      primaryLogic: instances.techAuthLogic,
      secondaryForever: instances.councilForever,
    }),
  },
} as const;

/** Replace the council's or the tech authority's signers with COUNCIL_SIGNERS or TECH_AUTH_SIGNERS, witnessed by both authorities; built (never submitted), signed with both authorities' keys unless --no-sign, and written to a file. */
export const multisigChangeProgram = (
  family: MultisigFamily,
  input: {
    readonly network: Environment;
    readonly outputDir: string;
    readonly outputFile: string;
    readonly txHash: TxHash;
    readonly txIndex: TxIndex;
    readonly feePadding: bigint;
    readonly sign: boolean;
  },
) =>
  Effect.gen(function* () {
    const config = FAMILIES[family];
    const signer = yield* signerFor(input.sign, "both");
    const { network, txHash, txIndex } = input;
    const output = yield* Output;
    const blueprint = (yield* ContractResolver).contracts("actsOn");
    const lower = config.label.toLowerCase();

    yield* output.log(
      `\nChanging ${config.label} members on ${network} network`,
    );
    yield* output.log(`Using UTxO: ${txHash}#${txIndex}`);

    const { networkId } = environmentOf(network);
    const selected = config.contracts(yield* blueprint.instances);
    const scripts = {
      primaryForever: selected.primaryForever.Script,
      primaryThreshold: selected.primaryThreshold.Script,
      secondaryForever: selected.secondaryForever.Script,
      primaryTwoStage: selected.primaryTwoStage.Script,
    };
    yield* output.log(
      `\n${config.label} Forever Address: ${addressFromValidator(networkId, scripts.primaryForever).toBech32()}`,
    );

    const utxosAt = yield* scriptUtxos(scripts, networkId);
    yield* output.log("\nFound contract UTxOs:");
    yield* output.log(`  primaryForever: ${utxosAt("primaryForever").length}`);
    yield* output.log(
      `  primaryThreshold: ${utxosAt("primaryThreshold").length}`,
    );
    yield* output.log(
      `  secondaryForever: ${utxosAt("secondaryForever").length}`,
    );
    yield* output.log(
      `  primaryTwoStage: ${utxosAt("primaryTwoStage").length}`,
    );

    const primaryForeverUtxo = yield* firstUtxoAt(
      utxosAt("primaryForever"),
      scripts.primaryForever,
      networkId,
    );
    const primaryThresholdUtxo = yield* firstUtxoAt(
      utxosAt("primaryThreshold"),
      scripts.primaryThreshold,
      networkId,
    );
    const secondaryForeverUtxo = yield* firstUtxoAt(
      utxosAt("secondaryForever"),
      scripts.secondaryForever,
      networkId,
    );
    const primaryTwoStageUtxo = yield* mainUtxoAt(
      utxosAt("primaryTwoStage"),
      scripts.primaryTwoStage,
      networkId,
    );

    const { logicRound, logicScript, mitigationLogicScript } =
      yield* twoStageLogic(
        blueprint,
        lower,
        primaryTwoStageUtxo,
        selected.primaryLogic.Script.hash(),
        networkId,
      );

    yield* output.log(`\nDecoding ${lower} forever datum (version-aware)...`);
    const currentPrimarySigners = yield* signersAt(primaryForeverUtxo);

    yield* output.log(
      "\nReading current secondary state for ML-3 validation...",
    );
    const secondarySigners = yield* signersAt(secondaryForeverUtxo);

    const signers = yield* newSigners(config.signersVariable);
    yield* output.log(`New ${lower} signers count: ${signers.length}`);
    yield* output.log(
      `  Unique payment hashes: ${new Set(signers.map((s) => s.paymentHash)).size}`,
    );

    yield* output.log(`\nReading ${lower} update threshold...`);
    const threshold = yield* thresholdAt(primaryThresholdUtxo);
    const requirements = signerRequirements(
      threshold,
      currentPrimarySigners,
      secondarySigners,
      family,
    );
    const { primary, secondary } = requirements;
    yield* output.log(
      `\nRequired ${primary.label} signers: ${primary.required}/${primary.total}`,
    );
    yield* output.log(
      `Required ${secondary.label} signers: ${secondary.required}/${secondary.total}`,
    );

    const { address: deployer, utxo: feeUtxo } = yield* deployerUtxo(
      txHash,
      txIndex,
    );
    const ctx = yield* planningContext({
      command: config.command,
      environment: network,
      wallet: deployer,
      contracts: yield* blueprint.contracts,
      resolved: {
        primaryForever: scripts.primaryForever,
        primaryForeverUtxo,
        primaryThresholdUtxo,
        secondaryForeverUtxo,
        primaryTwoStageUtxo,
        feeUtxo,
        logicScript,
        mitigationLogicScript,
        logicRound,
        currentPrimarySigners,
        secondarySigners,
        requirements,
        newSigners: signers,
        feePadding: input.feePadding,
        expectedWitnesses: witnessCount(
          signer,
          primary.required + secondary.required,
        ),
      },
    });
    const tx = yield* compileReported(
      yield* Effect.fromResult(planMultisigChange(ctx)),
      ctx,
    );
    yield* signAndWrite(tx, txFilePath(input), signer, config.description);
    return tx;
  });
