/**
 * bridge-set-fee and bridge-set-threshold: a new BEEFY threshold datum under
 * Council + Tech Auth (spec §6): the fee cap with the fraction kept, or the
 * fraction with the fee cap kept. main_gov_threshold sets how many of each
 * authority's signers witness it; --no-sign leaves them to
 * combine-signatures.
 */
import { Effect } from "effect";
import type { BeefyThreshold } from "../../contract_blueprint";
import { buildTx } from "../chain/complete-tx";
import {
  contractUtxos,
  deployerUtxo,
  signersAt,
  thresholdAt,
} from "../chain/governance-provider";
import { Provider } from "../chain/provider";
import { signAndWrite, signerFor, witnessCount } from "../chain/transaction";
import { environmentOf } from "../config/network-mapping";
import { Blueprint } from "../contracts/contracts";
import { type Threshold, witnessRequirements } from "../governance/threshold";
import { type FeeInput, type TxFileInput, txFilePath } from "../input";
import { Output } from "../output";
import { buildBridgeThresholdTx } from "./bridge-tx";
import { beefyThresholdAt, bridgeScripts } from "./bridge-chain";

interface ThresholdEditInput extends TxFileInput, FeeInput {
  readonly sign: boolean;
}

/** The new fee cap, in lovelace. */
export interface BridgeSetFeeInput extends ThresholdEditInput {
  readonly base: bigint;
  readonly perSigner: bigint;
}

/** The new signer fraction. */
export interface BridgeSetThresholdInput extends ThresholdEditInput {
  readonly threshold: Threshold;
}

const datumText = (datum: BeefyThreshold) =>
  `${datum.numerator}/${datum.denominator}, fee cap ${datum.base} + ${datum.per_signer} per signer`;

/** Resolve the threshold and both authorities, build the edit to `change(current)`, and write it signed by `--sign`'s keys. */
const thresholdEditProgram = (
  input: ThresholdEditInput,
  command: string,
  change: (current: BeefyThreshold) => BeefyThreshold,
) =>
  Effect.gen(function* () {
    const { network } = input;
    const signer = yield* signerFor(input.sign, "both");
    const out = yield* Output;
    const { networkId } = environmentOf(network);
    const { threshold } = yield* bridgeScripts;
    const contracts = yield* Effect.flatMap(Blueprint, (b) => b.instances);
    const found = yield* contractUtxos(
      {
        threshold,
        mainGovThreshold: contracts.mainGovThreshold.Script,
        councilForever: contracts.councilForever.Script,
        techAuthForever: contracts.techAuthForever.Script,
      },
      networkId,
    );
    const thresholdUtxo = yield* found.nft("threshold");
    const mainGovThresholdUtxo = yield* found.nft("mainGovThreshold");
    const councilForeverUtxo = yield* found.nft("councilForever");
    const techAuthForeverUtxo = yield* found.nft("techAuthForever");
    const current = yield* beefyThresholdAt(thresholdUtxo);
    const next = change(current);
    const councilSigners = yield* signersAt(councilForeverUtxo);
    const techAuthSigners = yield* signersAt(techAuthForeverUtxo);
    const requirements = witnessRequirements(
      yield* thresholdAt(mainGovThresholdUtxo),
      { techAuthSigners, councilSigners },
    );
    const { address: changeAddress, utxo: userUtxo } = yield* deployerUtxo(
      input.txHash,
      input.txIndex,
    );

    yield* out.log(`\nChanging the BEEFY threshold on ${network}`);
    yield* out.log(`Current: ${datumText(current)}`);
    yield* out.log(`New: ${datumText(next)}`);
    yield* out.log(
      `Required tech auth signers: ${requirements.techAuth.required}/${requirements.techAuth.total}`,
    );
    yield* out.log(
      `Required council signers: ${requirements.council.required}/${requirements.council.total}`,
    );

    const blaze = yield* Effect.flatMap(Provider, (p) => p.blaze);
    const tx = yield* buildTx(
      buildBridgeThresholdTx(
        blaze,
        {
          threshold,
          thresholdUtxo,
          userUtxo,
          mainGovThresholdUtxo,
          councilForeverUtxo,
          techAuthForeverUtxo,
          councilSigners,
          techAuthSigners,
          requirements,
        },
        next,
        {
          networkId,
          changeAddress,
          feePadding: input.feePadding,
          txType: command,
        },
      ),
      {
        commandName: command,
        environment: network,
        witnesses: witnessCount(
          signer,
          requirements.techAuth.required + requirements.council.required,
        ),
        knownUtxos: [
          thresholdUtxo,
          userUtxo,
          mainGovThresholdUtxo,
          councilForeverUtxo,
          techAuthForeverUtxo,
        ],
      },
    );
    yield* signAndWrite(
      tx,
      txFilePath(input),
      signer,
      "BEEFY Threshold Change",
    );
    return tx;
  });

/** A new fee cap; the fraction stays. */
export const bridgeSetFeeProgram = (input: BridgeSetFeeInput) =>
  thresholdEditProgram(input, "bridge-set-fee", (current) => ({
    ...current,
    base: input.base,
    per_signer: input.perSigner,
  }));

/** A new signer fraction; the fee cap stays. */
export const bridgeSetThresholdProgram = (input: BridgeSetThresholdInput) =>
  thresholdEditProgram(input, "bridge-set-threshold", (current) => ({
    ...current,
    numerator: input.threshold.numerator,
    denominator: input.threshold.denominator,
  }));
