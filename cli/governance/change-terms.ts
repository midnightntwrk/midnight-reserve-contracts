/**
 * change-terms: replace the hash and link in the terms-and-conditions
 * forever datum. The program resolves the forever, threshold, council and
 * tech-auth UTxOs and the two-stage UpgradeState (its logic_round is the
 * new datum's); buildTermsChangeTx is pure over the resolved inputs.
 */
import {
  type Address,
  addressFromValidator,
  type NetworkId,
} from "@blaze-cardano/core";
import type {
  Blaze,
  Provider as BlazeProvider,
  Wallet,
} from "@blaze-cardano/sdk";
import type { TxBuilder } from "@blaze-cardano/tx";
import { Effect, Record } from "effect";
import { environmentOf } from "../config/network-mapping";
import {
  contractUtxos,
  deployerUtxo,
  signersAt,
  thresholdAt,
} from "../chain/governance-provider";
import {
  inlineDatum,
  signAndWrite,
  signerFor,
  witnessCount,
} from "../chain/transaction";
import { buildTx } from "../chain/complete-tx";
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
  buildGovernedForeverUpdateTx,
  type GovernedForeverInputs,
} from "./governed-forever";
import { twoStageLogic } from "./change-multisig";
import { Blueprint } from "../contracts/contracts";
import { Output } from "../output";
import { Provider } from "../chain/provider";

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
  readonly changeAddress: Address;
  readonly feePadding: bigint;
}

/** The change transaction: the governed forever update with the new terms datum. */
export const buildTermsChangeTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: TermsChangeInputs,
  params: TermsChangeParams,
): TxBuilder =>
  buildGovernedForeverUpdateTx(
    blaze,
    inputs,
    encodeTerms(params.terms, datumRoundOf(inputs.logicRound)),
    { ...params, txType: "change-terms" },
  );

const QUERY = {
  termsForever: "Terms and conditions forever",
  termsThreshold: "Terms and conditions threshold",
  councilForever: "Council forever",
  techAuthForever: "Tech auth forever",
  termsTwoStage: "Terms and conditions two stage",
} as const;

/** Resolve the inputs, build, complete and write the change transaction. */
export const termsChangeProgram = (input: TermsChangeInput) =>
  Effect.gen(function* () {
    const { network, txHash, txIndex, hash, url, sign } = input;
    const signer = yield* signerFor(sign, "both");
    const urlHex = Buffer.from(url).toString("hex");
    const out = yield* Output;
    const blueprint = yield* Blueprint;
    const provider = yield* Provider;
    const outputPath = txFilePath(input);

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

    const blaze = yield* provider.blaze;
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
    const inputs: TermsChangeInputs = {
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
    };
    const { techAuth, council } = requirements;
    yield* out.log(
      `\nRequired tech auth signers: ${techAuth.required}/${techAuth.total}`,
    );
    yield* out.log(
      `Required council signers: ${council.required}/${council.total}`,
    );

    const txBuilder = buildTermsChangeTx(blaze, inputs, {
      terms: { hash, link: urlHex },
      networkId,
      changeAddress,
      feePadding: input.feePadding,
    });
    const tx = yield* buildTx(txBuilder, {
      commandName: "change-terms",
      environment: network,
      witnesses: witnessCount(signer, techAuth.required + council.required),
      knownUtxos: [
        foreverUtxo,
        thresholdUtxo,
        councilForeverUtxo,
        techAuthForeverUtxo,
        twoStageUtxo,
        userUtxo,
      ],
    });
    yield* signAndWrite(
      tx,
      outputPath,
      signer,
      "Change Terms and Conditions Transaction",
    );
    return tx;
  });
