/**
 * change-terms: replace the hash and link in the terms-and-conditions
 * forever datum. The program resolves the forever, threshold, council and
 * tech-auth UTxOs and the two-stage UpgradeState (its logic_round is the
 * new datum's); planTermsChange is pure over the resolved inputs and
 * compile completes it.
 */
import {
  type Address,
  addressFromValidator,
  type NetworkId,
} from "@blaze-cardano/core";
import { Effect, Option, Record } from "effect";
import { environmentOf, slotConfigOf } from "../config/network-mapping";
import { contractUtxos, deployerUtxo, deployerWallet } from "../chain/utxo";
import { signersAt, thresholdAt } from "./authority";
import { inlineDatum } from "../datum/inline";
import { signAndWrite, signerFor, witnessCount } from "../signing/signer";
import { compile } from "../tx/compile";
import type { TxPlan } from "../tx/plan";
import {
  decodeTerms,
  encodeTerms,
  type TermsData,
} from "../datum/terms-and-conditions";
import { datumRoundOf } from "../datum/datum-versions";
import {
  type FeeInput,
  type Hash32,
  type TxFileInput,
  txFilePath,
} from "../input";
import { witnessRequirements } from "./threshold";
import {
  type GovernedForeverInputs,
  planGovernedForeverUpdate,
} from "./governed-forever";
import { twoStageLogic } from "./two-stage";
import { Blueprint } from "../contracts/contracts";
import { Output } from "../output";

const COMMAND = "change-terms";

/** A terms change: the new hash and URL, its fee UTxO, whether to sign, and where the file goes. */
export interface TermsChangeInput extends TxFileInput, FeeInput {
  readonly hash: Hash32;
  readonly url: string;
  readonly sign: boolean;
}

/** What the transaction is built from: the governed forever update's inputs. */
export type TermsChangeInputs = GovernedForeverInputs;

export interface TermsChangeParams {
  /** The new terms: hash and link, both hex. */
  readonly terms: TermsData;
  readonly networkId: NetworkId;
}

/** The change: the governed forever update with the new terms datum. */
export const planTermsChange = (
  inputs: TermsChangeInputs,
  params: TermsChangeParams,
): TxPlan =>
  planGovernedForeverUpdate(
    inputs,
    encodeTerms(params.terms, datumRoundOf(inputs.logicRound)),
    params,
  );

const QUERY = {
  termsForever: "Terms and conditions forever",
  termsThreshold: "Terms and conditions threshold",
  councilForever: "Council forever",
  techAuthForever: "Tech auth forever",
  termsTwoStage: "Terms and conditions two stage",
} as const;

/** What the terms change plan is built from and where its change goes. */
export interface ResolvedTermsChange {
  readonly inputs: TermsChangeInputs;
  readonly params: TermsChangeParams;
  readonly changeAddress: Address;
}

/** Read and report everything the change needs: the forever, threshold, authority and two-stage UTxOs, the current terms, both authorities' signers, the threshold's requirements and the fee UTxO. */
export const resolveTermsChange = (input: TermsChangeInput) =>
  Effect.gen(function* () {
    const { network, txHash, txIndex, hash, url } = input;
    const urlHex = Buffer.from(url).toString("hex");
    const out = yield* Output;
    const blueprint = yield* Blueprint;

    yield* out.log(`\nChanging Terms and Conditions on ${network} network`);
    yield* out.log(`Using UTxO: ${txHash}#${txIndex}`);
    yield* out.log(`New hash: ${hash}`);
    yield* out.log(`New URL: ${url}`);
    yield* out.log(`  (hex: ${urlHex})`);

    const { networkId } = environmentOf(network);
    const contracts = yield* blueprint.instances;
    const forever = contracts.termsAndConditionsForever.Script;
    const foreverAddress = addressFromValidator(networkId, forever);
    yield* out.log(
      `\nTerms and Conditions Forever Address: ${foreverAddress.toBech32()}`,
    );

    const scripts = {
      termsForever: forever,
      termsThreshold: contracts.termsAndConditionsThreshold.Script,
      councilForever: contracts.councilForever.Script,
      techAuthForever: contracts.techAuthForever.Script,
      termsTwoStage: contracts.termsAndConditionsTwoStage.Script,
    };
    const found = yield* contractUtxos(scripts, networkId);
    yield* out.log("\nFound contract UTxOs:");
    for (const [key, label] of Record.toEntries(QUERY)) {
      yield* out.log(`  ${label}: ${found.at(key).length}`);
    }

    const foreverUtxo = yield* found.first("termsForever");
    const thresholdUtxo = yield* found.first("termsThreshold");
    const councilForeverUtxo = yield* found.first("councilForever");
    const techAuthForeverUtxo = yield* found.first("techAuthForever");
    const twoStageUtxo = yield* found.main("termsTwoStage");

    const { logicRound, logicScript, mitigationLogicScript } =
      yield* twoStageLogic(
        "terms and conditions",
        twoStageUtxo,
        contracts.termsAndConditionsLogic.Script.hash(),
        networkId,
      );

    yield* out.log(
      "\nDecoding terms and conditions forever datum (version-aware)...",
    );
    const foreverDatum = yield* inlineDatum(
      foreverUtxo,
      "VersionedTermsAndConditions",
    );
    const currentData = yield* decodeTerms(foreverDatum);
    yield* out.log(`  Current hash: ${currentData.hash}`);
    yield* out.log(
      `  Current URL: ${Buffer.from(currentData.link, "hex").toString("utf8")}`,
    );
    yield* out.log(`    (hex: ${currentData.link})`);
    yield* out.log("\nNew terms and conditions:");
    yield* out.log(`  Hash: ${hash}`);
    yield* out.log(`  URL: ${url}`);
    yield* out.log(`    (hex: ${urlHex})`);

    yield* out.log("\nReading current council state for ML-3 validation...");
    const councilSigners = yield* signersAt(councilForeverUtxo);
    yield* out.log("\nReading current tech auth state for ML-3 validation...");
    const techAuthSigners = yield* signersAt(techAuthForeverUtxo);

    yield* out.log("\nReading terms and conditions threshold...");
    const threshold = yield* thresholdAt(thresholdUtxo);
    const requirements = witnessRequirements(threshold, {
      techAuthSigners,
      councilSigners,
    });

    const { address: changeAddress, utxo: userUtxo } = yield* deployerUtxo(
      txHash,
      txIndex,
    );
    const { techAuth, council } = requirements;
    yield* out.log(
      `\nRequired tech auth signers: ${techAuth.required}/${techAuth.total}`,
    );
    yield* out.log(
      `Required council signers: ${council.required}/${council.total}`,
    );
    const resolved: ResolvedTermsChange = {
      inputs: {
        forever,
        foreverUtxo,
        thresholdUtxo,
        councilForeverUtxo,
        techAuthForeverUtxo,
        twoStageUtxo,
        userUtxo,
        logicScript,
        mitigationLogicScript,
        logicRound,
        councilSigners,
        techAuthSigners,
        requirements,
      },
      params: { terms: { hash, link: urlHex }, networkId },
      changeAddress,
    };
    return resolved;
  });

/** Resolve, plan, compile and write the change transaction. */
export const termsChangeProgram = (input: TermsChangeInput) =>
  Effect.gen(function* () {
    const signer = yield* signerFor(input.sign, "both");
    const { inputs, params, changeAddress } = yield* resolveTermsChange(input);
    const plan = planTermsChange(inputs, params);
    const tx = yield* compile(plan, {
      commandName: COMMAND,
      slotConfig: slotConfigOf(input.network),
      wallet: yield* deployerWallet,
      changeAddress,
      feePadding: input.feePadding,
      metadata: Option.some(COMMAND),
      expectedWitnesses: witnessCount(signer, plan.requiredSignatures),
      contracts: yield* Effect.flatMap(Blueprint, (b) => b.contracts),
    });
    yield* signAndWrite(
      tx,
      txFilePath(input),
      signer,
      "Change Terms and Conditions Transaction",
    );
    return tx;
  });
