/**
 * Governed forever updates: spend a forever UTxO into the same script with
 * a new datum, mint the council and tech-auth witnesses its threshold asks
 * for, and withdraw through the two-stage logic (and mitigation logic),
 * referencing the threshold, both authorities' forever UTxOs and the
 * two-stage main UTxO. change-terms and change-federated-ops are this
 * transaction with their own datum.
 */
import {
  addressFromValidator,
  AssetId,
  fromHex,
  type NetworkId,
  PaymentAddress,
  PlutusData,
  type Script,
  toHex,
  TransactionOutput,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { Effect, Option, Result } from "effect";
import {
  deployerUtxo,
  firstUtxoAt,
  planningContext,
  scriptUtxos,
} from "../chain";
import {
  type Environment,
  environmentOf,
  permissionedCandidates,
} from "../config";
import { type Blueprint, ContractResolver } from "../contracts/resolver";
import {
  datumLogicRound,
  datumRoundOf,
  decodeFederatedOps,
  decodeTerms,
  encodeFederatedOps,
  encodeTerms,
  type FederatedOpsData,
  inlineDatum,
  type TermsData,
} from "../datum";
import { PreconditionFailed } from "../errors";
import {
  type Hash32,
  type PermissionedCandidate,
  type Signers,
  type TxHash,
  type TxIndex,
  txFilePath,
} from "../input";
import { Output } from "../output";
import {
  compileReported,
  type Signer,
  signAndWrite,
  signerFor,
  witnessCount,
} from "../signing";
import {
  logicRedeemer,
  type PlanningContext,
  type TxPlan,
  withdrawThroughLogic,
} from "../tx";
import {
  mintWitnesses,
  signersAt,
  thresholdAt,
  type WitnessRequirements,
  witnessRequirements,
} from "./multisig";
import { mainUtxoAt, twoStageLogic } from "./two-stage";

/** What a governed forever update spends and references, read from the chain and the blueprint. */
export interface GovernedForever {
  readonly forever: Script;
  readonly foreverUtxo: TransactionUnspentOutput;
  readonly thresholdUtxo: TransactionUnspentOutput;
  readonly councilForeverUtxo: TransactionUnspentOutput;
  readonly techAuthForeverUtxo: TransactionUnspentOutput;
  readonly twoStageUtxo: TransactionUnspentOutput;
  readonly feeUtxo: TransactionUnspentOutput;
  readonly logicScript: Script;
  readonly mitigationLogicScript: Option.Option<Script>;
  /** logic_round of the two-stage UpgradeState (selects the redeemer shape). */
  readonly logicRound: number;
  readonly councilSigners: Signers;
  readonly techAuthSigners: Signers;
  /** What the threshold demands of both authorities, from the signers above. */
  readonly requirements: WitnessRequirements;
  readonly feePadding: bigint;
  readonly expectedWitnesses: number;
}

/** The update with `newState` as the forever's datum: the fee and forever UTxOs spent, the council and tech-auth witnesses minted, the logic (and mitigation logic) withdrawn through. */
const planGovernedForeverUpdate = (
  ctx: PlanningContext<GovernedForever>,
  newState: PlutusData,
): TxPlan => {
  const update = ctx.resolved;
  const { techAuth, council } = update.requirements;
  return {
    spends: [
      { utxo: update.feeUtxo, redeemer: Option.none() },
      {
        utxo: update.foreverUtxo,
        redeemer: Option.some(PlutusData.newInteger(0n)),
      },
    ],
    references: [
      update.thresholdUtxo,
      update.councilForeverUtxo,
      update.techAuthForeverUtxo,
      update.twoStageUtxo,
    ],
    scripts: [update.forever],
    mints: mintWitnesses(
      [
        { ...council, signers: update.councilSigners, assetName: "" },
        { ...techAuth, signers: update.techAuthSigners, assetName: "" },
      ],
      ctx.networkId,
    ),
    outputs: [
      TransactionOutput.fromCore({
        address: PaymentAddress(
          addressFromValidator(ctx.networkId, update.forever).toBech32(),
        ),
        value: {
          coins: update.foreverUtxo.output().amount().coin(),
          assets: new Map([[AssetId(update.forever.hash()), 1n]]),
        },
        datum: newState.toCore(),
      }),
    ],
    withdrawals: withdrawThroughLogic(
      update.logicScript,
      update.mitigationLogicScript,
      logicRedeemer(PlutusData.newInteger(0n), update.logicRound),
      ctx.networkId,
    ),
    registrations: [],
    collateral: [],
    metadata: Option.some(ctx.command),
    feePadding: update.feePadding,
    expectedWitnesses: update.expectedWitnesses,
  };
};

/** A terms change: the governed update and the new terms. */
export interface TermsChange extends GovernedForever {
  readonly terms: TermsData;
}

/** The governed update with the new terms at the two-stage logic_round (capped at the latest datum format). */
export const planTermsChange = (ctx: PlanningContext<TermsChange>): TxPlan =>
  planGovernedForeverUpdate(
    ctx,
    encodeTerms(ctx.resolved.terms, datumRoundOf(ctx.resolved.logicRound)),
  );

/** A federated ops change: the governed update, the current datum and the new candidates. */
export interface FederatedOpsChange extends GovernedForever {
  readonly currentData: FederatedOpsData;
  readonly newCandidates: readonly PermissionedCandidate[];
}

/** The governed update with the new candidates in the current datum's shape (v1 or v2). */
export const planFederatedOpsChange = (
  ctx: PlanningContext<FederatedOpsChange>,
): TxPlan =>
  planGovernedForeverUpdate(
    ctx,
    encodeFederatedOps({
      ...ctx.resolved.currentData,
      candidates: ctx.resolved.newCandidates,
    }),
  );

/** A datum older than the active v2 logic (round 2 or above) must be migrated first. */
export const requireMigratedDatum = (
  datumRound: number,
  logicRound: number,
): Result.Result<void, PreconditionFailed> =>
  logicRound >= 2 && datumRound < logicRound
    ? Result.fail(
        new PreconditionFailed({
          command: "change-federated-ops",
          refusal: { _tag: "DatumNotMigrated", datumRound, logicRound },
        }),
      )
    : Result.void;

/** The flags of a governed forever update. */
interface GovernedInput {
  readonly network: Environment;
  readonly outputDir: string;
  readonly outputFile: string;
  readonly txHash: TxHash;
  readonly txIndex: TxIndex;
  readonly feePadding: bigint;
  readonly sign: boolean;
}

/** The forever, threshold, authority and two-stage UTxOs of a governed contract, their counts logged under `labels`, and the logic its main state names. */
const governedUtxos = (
  blueprint: Blueprint,
  label: string,
  scripts: {
    readonly forever: Script;
    readonly threshold: Script;
    readonly councilForever: Script;
    readonly techAuthForever: Script;
    readonly twoStage: Script;
    readonly logic: Script;
  },
  labels: {
    readonly forever: string;
    readonly threshold: string;
    readonly twoStage: string;
  },
  networkId: NetworkId,
) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const utxosAt = yield* scriptUtxos(
      {
        forever: scripts.forever,
        threshold: scripts.threshold,
        councilForever: scripts.councilForever,
        techAuthForever: scripts.techAuthForever,
        twoStage: scripts.twoStage,
      },
      networkId,
    );
    yield* output.log("\nFound contract UTxOs:");
    yield* output.log(`  ${labels.forever}: ${utxosAt("forever").length}`);
    yield* output.log(`  ${labels.threshold}: ${utxosAt("threshold").length}`);
    yield* output.log(`  Council forever: ${utxosAt("councilForever").length}`);
    yield* output.log(
      `  Tech auth forever: ${utxosAt("techAuthForever").length}`,
    );
    yield* output.log(`  ${labels.twoStage}: ${utxosAt("twoStage").length}`);

    const foreverUtxo = yield* firstUtxoAt(
      utxosAt("forever"),
      scripts.forever,
      networkId,
    );
    const thresholdUtxo = yield* firstUtxoAt(
      utxosAt("threshold"),
      scripts.threshold,
      networkId,
    );
    const councilForeverUtxo = yield* firstUtxoAt(
      utxosAt("councilForever"),
      scripts.councilForever,
      networkId,
    );
    const techAuthForeverUtxo = yield* firstUtxoAt(
      utxosAt("techAuthForever"),
      scripts.techAuthForever,
      networkId,
    );
    const twoStageUtxo = yield* mainUtxoAt(
      utxosAt("twoStage"),
      scripts.twoStage,
      networkId,
    );
    const logic = yield* twoStageLogic(
      blueprint,
      label,
      twoStageUtxo,
      scripts.logic.hash(),
      networkId,
    );
    return {
      foreverUtxo,
      thresholdUtxo,
      councilForeverUtxo,
      techAuthForeverUtxo,
      twoStageUtxo,
      ...logic,
    };
  });

/** Both authorities' current signers, as the ML-3 check reads them. */
const authoritySigners = (
  councilForeverUtxo: TransactionUnspentOutput,
  techAuthForeverUtxo: TransactionUnspentOutput,
) =>
  Effect.gen(function* () {
    const output = yield* Output;
    yield* output.log("\nReading current council state for ML-3 validation...");
    const councilSigners = yield* signersAt(councilForeverUtxo);
    yield* output.log(
      "\nReading current tech auth state for ML-3 validation...",
    );
    const techAuthSigners = yield* signersAt(techAuthForeverUtxo);
    return { councilSigners, techAuthSigners };
  });

/** What the threshold demands of both authorities, the fee UTxO, and the expected witnesses; the requirements are logged after the fee UTxO is found. */
const requirementsAndFee = (
  thresholdUtxo: TransactionUnspentOutput,
  signers: {
    readonly councilSigners: Signers;
    readonly techAuthSigners: Signers;
  },
  signer: Signer,
  input: GovernedInput,
) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const requirements = witnessRequirements(
      yield* thresholdAt(thresholdUtxo),
      signers,
    );
    const { address: deployer, utxo: feeUtxo } = yield* deployerUtxo(
      input.txHash,
      input.txIndex,
    );
    const { techAuth, council } = requirements;
    yield* output.log(
      `\nRequired tech auth signers: ${techAuth.required}/${techAuth.total}`,
    );
    yield* output.log(
      `Required council signers: ${council.required}/${council.total}`,
    );
    return {
      deployer,
      feeUtxo,
      requirements,
      feePadding: input.feePadding,
      expectedWitnesses: witnessCount(
        signer,
        techAuth.required + council.required,
      ),
    };
  });

// change-terms

/** Replace the hash and link in the terms-and-conditions forever datum, witnessed by both authorities; built (never submitted), signed with both authorities' keys unless --no-sign, and written to a file. */
export const termsChangeProgram = (
  input: GovernedInput & { readonly hash: Hash32; readonly url: string },
) =>
  Effect.gen(function* () {
    const signer = yield* signerFor(input.sign, "both");
    const { network, txHash, txIndex, hash, url } = input;
    const urlHex = toHex(new TextEncoder().encode(url));
    const output = yield* Output;
    const blueprint = (yield* ContractResolver).contracts("actsOn");

    yield* output.log(`\nChanging Terms and Conditions on ${network} network`);
    yield* output.log(`Using UTxO: ${txHash}#${txIndex}`);
    yield* output.log(`New hash: ${hash}`);
    yield* output.log(`New URL: ${url}`);
    yield* output.log(`  (hex: ${urlHex})`);

    const { networkId } = environmentOf(network);
    const instances = yield* blueprint.instances;
    const forever = instances.termsAndConditionsForever.Script;
    yield* output.log(
      `\nTerms and Conditions Forever Address: ${addressFromValidator(networkId, forever).toBech32()}`,
    );
    const found = yield* governedUtxos(
      blueprint,
      "terms and conditions",
      {
        forever,
        threshold: instances.termsAndConditionsThreshold.Script,
        councilForever: instances.councilForever.Script,
        techAuthForever: instances.techAuthForever.Script,
        twoStage: instances.termsAndConditionsTwoStage.Script,
        logic: instances.termsAndConditionsLogic.Script,
      },
      {
        forever: "Terms and conditions forever",
        threshold: "Terms and conditions threshold",
        twoStage: "Terms and conditions two stage",
      },
      networkId,
    );

    yield* output.log(
      "\nDecoding terms and conditions forever datum (version-aware)...",
    );
    const current = yield* decodeTerms(
      yield* inlineDatum(found.foreverUtxo, "VersionedTermsAndConditions"),
    );
    yield* output.log(`  Current hash: ${current.hash}`);
    yield* output.log(
      `  Current URL: ${new TextDecoder().decode(fromHex(current.link))}`,
    );
    yield* output.log(`    (hex: ${current.link})`);
    yield* output.log("\nNew terms and conditions:");
    yield* output.log(`  Hash: ${hash}`);
    yield* output.log(`  URL: ${url}`);
    yield* output.log(`    (hex: ${urlHex})`);

    const signers = yield* authoritySigners(
      found.councilForeverUtxo,
      found.techAuthForeverUtxo,
    );
    yield* output.log("\nReading terms and conditions threshold...");
    const { deployer, ...fee } = yield* requirementsAndFee(
      found.thresholdUtxo,
      signers,
      signer,
      input,
    );
    const ctx = yield* planningContext({
      command: "change-terms",
      environment: network,
      wallet: deployer,
      contracts: yield* blueprint.contracts,
      resolved: {
        forever,
        ...found,
        ...signers,
        ...fee,
        terms: { hash, link: urlHex },
      },
    });
    const tx = yield* compileReported(planTermsChange(ctx), ctx);
    yield* signAndWrite(
      tx,
      txFilePath(input),
      signer,
      "Change Terms and Conditions Transaction",
    );
    return tx;
  });

// change-federated-ops

/** Replace the permissioned candidates in the federated-ops forever datum with PERMISSIONED_CANDIDATES, keeping its shape (v1 or v2), witnessed by both authorities; built (never submitted), signed with both authorities' keys unless --no-sign, and written to a file. */
export const federatedOpsChangeProgram = (input: GovernedInput) =>
  Effect.gen(function* () {
    const signer = yield* signerFor(input.sign, "both");
    const { network, txHash, txIndex } = input;
    const output = yield* Output;
    const blueprint = (yield* ContractResolver).contracts("actsOn");

    yield* output.log(`\nChanging Federated Ops members on ${network} network`);
    yield* output.log(`Using UTxO: ${txHash}#${txIndex}`);

    const { networkId } = environmentOf(network);
    const instances = yield* blueprint.instances;
    const forever = instances.federatedOpsForever.Script;
    yield* output.log(
      `\nFederated Ops Forever Address: ${addressFromValidator(networkId, forever).toBech32()}`,
    );
    const found = yield* governedUtxos(
      blueprint,
      "federated ops",
      {
        forever,
        threshold: instances.mainFederatedOpsUpdateThreshold.Script,
        councilForever: instances.councilForever.Script,
        techAuthForever: instances.techAuthForever.Script,
        twoStage: instances.federatedOpsTwoStage.Script,
        logic: instances.federatedOpsLogic.Script,
      },
      {
        forever: "Federated ops forever",
        threshold: "Federated ops threshold",
        twoStage: "Federated ops two stage",
      },
      networkId,
    );

    yield* output.log(
      "\nDecoding federated ops forever datum (version-aware)...",
    );
    const datum = yield* inlineDatum(found.foreverUtxo, "FederatedOps");
    yield* Effect.fromResult(
      requireMigratedDatum(
        yield* Effect.fromResult(datumLogicRound(datum)),
        found.logicRound,
      ),
    );
    const currentData = yield* Effect.fromResult(decodeFederatedOps(datum));
    yield* output.log(
      `  Current candidates count: ${currentData.candidates.length}`,
    );

    const signers = yield* authoritySigners(
      found.councilForeverUtxo,
      found.techAuthForeverUtxo,
    );
    const newCandidates = yield* permissionedCandidates;
    yield* output.log(
      `\nNew federated ops candidates count: ${newCandidates.length}`,
    );
    yield* output.log("\nReading federated ops update threshold...");
    const { deployer, ...fee } = yield* requirementsAndFee(
      found.thresholdUtxo,
      signers,
      signer,
      input,
    );
    const ctx = yield* planningContext({
      command: "change-federated-ops",
      environment: network,
      wallet: deployer,
      contracts: yield* blueprint.contracts,
      resolved: {
        forever,
        ...found,
        ...signers,
        ...fee,
        currentData,
        newCandidates,
      },
    });
    const tx = yield* compileReported(planFederatedOpsChange(ctx), ctx);
    yield* signAndWrite(
      tx,
      txFilePath(input),
      signer,
      "Change Federated Ops Transaction",
    );
    return tx;
  });
