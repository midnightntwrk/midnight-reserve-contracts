import {
  addressFromCredential,
  addressFromValidator,
  AssetId,
  Credential,
  CredentialType,
  Hash28ByteBase16,
  NativeScripts,
  NetworkId,
  PaymentAddress,
  PlutusData,
  Script,
  toHex,
  TransactionId,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import type { Emulator } from "@blaze-cardano/emulator";
import * as Contracts from "../../deployed-scripts/mainnet/contract_blueprint";
import { expect } from "bun:test";

export const MAIN_TOKEN_HEX = toHex(new TextEncoder().encode("main"));
export const STAGING_TOKEN_HEX = toHex(new TextEncoder().encode("staging"));
export const TECH_WITNESS_ASSET = toHex(
  new TextEncoder().encode("tech-auth-witness"),
);
export const COUNCIL_WITNESS_ASSET = toHex(
  new TextEncoder().encode("council-auth-witness"),
);

export type UpgradeActors = {
  twoStage: { Script: Script };
  initialDatum: Contracts.UpgradeState;
  mainTx: string;
  stagingTx: string;
};

export const addTwoStageState = (emulator: Emulator, actor: UpgradeActors) => {
  const address = addressFromValidator(
    NetworkId.Testnet,
    actor.twoStage.Script,
  );

  const buildUtxo = (txId: string, tokenHex: string) =>
    TransactionUnspentOutput.fromCore([
      {
        index: 0,
        txId: TransactionId(txId),
      },
      {
        address: PaymentAddress(address.toBech32()),
        value: {
          coins: 2_000_000n,
          assets: new Map([
            [AssetId(actor.twoStage.Script.hash() + tokenHex), 1n],
          ]),
        },
        datum: serialize(Contracts.UpgradeState, actor.initialDatum).toCore(),
      },
    ]);

  emulator.addUtxo(buildUtxo(actor.mainTx, MAIN_TOKEN_HEX));
  emulator.addUtxo(buildUtxo(actor.stagingTx, STAGING_TOKEN_HEX));
};

export const findUtxoByToken = (
  utxos: TransactionUnspentOutput[],
  scriptHash: string,
  tokenHex: string,
) => {
  const target = AssetId(scriptHash + tokenHex);
  const match = utxos.find((utxo) => {
    const [, output] = utxo.toCore();
    const assets = output.value.assets;
    return assets ? (assets.get(target) ?? 0n) === 1n : false;
  });

  if (!match) {
    throw new Error(`Missing ${tokenHex} UTxO for ${scriptHash}`);
  }

  return match;
};

export const datumCbor = (datum: PlutusData) => datum.toCbor();

export const expectDatum = (
  utxo: TransactionUnspentOutput,
  expected: Contracts.UpgradeState,
) => {
  const [, output] = utxo.toCore();
  if (!output.datum) throw new Error("Missing datum on output");

  const actual = PlutusData.fromCore(output.datum);
  const expectedDatum = serialize(
    Contracts.UpgradeState,
    expected,
  ) as PlutusData;
  expect(datumCbor(actual)).toBe(datumCbor(expectedDatum));
};

export const buildNativeScriptFromState = (
  state: Contracts.VersionedMultisig,
  numerator: bigint,
  denominator: bigint,
) => {
  const [multisig] = state;
  const [totalSigners, signers] = multisig;
  const signerScripts = Object.keys(signers)
    .sort()
    .map((key) => {
      const paymentHash = key.slice("8200581c".length);
      const addr = addressFromCredential(
        NetworkId.Testnet,
        Credential.fromCore({
          type: CredentialType.KeyHash,
          hash: Hash28ByteBase16(paymentHash),
        }),
      );
      return NativeScripts.justAddress(addr.toBech32(), NetworkId.Testnet);
    });

  const minSigners = Number(
    (totalSigners * numerator + (denominator - 1n)) / denominator,
  );

  return NativeScripts.atLeastNOfK(minSigners, ...signerScripts);
};
