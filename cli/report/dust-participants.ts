import type { TransactionUnspentOutput } from "@blaze-cardano/core";
import { Effect } from "effect";
import { environmentOf } from "../config/network-mapping";
import { Provider, requireOnChainNetwork } from "../chain/provider";
import { credentialAddress, Blueprint } from "../contracts/contracts";
import { Output } from "../output";
import { type Format, type NetworkInput } from "../input";

/** The environment whose dust participants to count, and the output format. */
export interface DustParticipantsInput extends NetworkInput {
  readonly format: Format;
}

/** UTxOs holding a token under the dust policy; one per registered participant. */
export const dustUtxos = (
  utxos: readonly TransactionUnspentOutput[],
  policyId: string,
): TransactionUnspentOutput[] =>
  utxos.filter((utxo) =>
    [...(utxo.output().amount().multiasset()?.keys() ?? [])].some((assetId) =>
      assetId.startsWith(policyId),
    ),
  );

/** Count the UTxOs at the cnight_generates_dust address that hold a dust token. */
export const dustParticipantsProgram = (input: DustParticipantsInput) =>
  Effect.gen(function* () {
    const { network, format } = input;
    yield* requireOnChainNetwork(network);
    const output = yield* Output;
    const contracts = yield* Effect.flatMap(Blueprint, (b) => b.instances);
    const policyId = contracts.cnightGeneratesDust.Script.hash();
    const { networkId } = environmentOf(network);
    const scriptAddress = credentialAddress(networkId, policyId);
    const address = scriptAddress.toBech32();

    if (format !== "json") {
      yield* output.log(
        `\nQuerying dust participants for ${network} network...\n`,
      );
      yield* output.log(`  Policy ID: ${policyId}`);
      yield* output.log(`  Address:   ${address}\n`);
    }

    const utxos = yield* Effect.flatMap(Provider, (p) =>
      p.unspentOutputs(scriptAddress),
    );
    const participantCount = dustUtxos(utxos, policyId).length;

    if (format === "json") {
      yield* output.log(
        JSON.stringify(
          {
            network,
            policyId,
            address,
            totalUtxos: utxos.length,
            participantCount,
          },
          null,
          2,
        ),
      );
    } else {
      yield* output.log(`  Total UTxOs at address: ${utxos.length}`);
      yield* output.log(`  UTxOs with dust token:  ${participantCount}`);
      yield* output.log(
        `\n  Registered dust participants: ${participantCount}\n`,
      );
    }
    return { policyId, address, totalUtxos: utxos.length, participantCount };
  });
