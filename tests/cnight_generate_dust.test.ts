import {
  type Address,
  AssetName,
  Ed25519KeyHashHex,
  PolicyId,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Emulator } from "@blaze-cardano/emulator";
import * as Contracts from "../deployed-scripts/mainnet/contract_blueprint";
import { describe, test } from "bun:test";
import type { TxBuilder } from "@blaze-cardano/tx";
import {
  registerRewardAccount,
  scriptOutput,
  scriptUtxo,
  asFunded,
} from "./helpers/fixtures";

const dustGenerator =
  new Contracts.CnightGeneratesDustCnightGeneratesDustElse();
const create = serialize(Contracts.DustAction, "Create");
const burn = serialize(Contracts.DustAction, "Burn");

const paymentHash = (addr: Address) =>
  addr.asBase()!.getPaymentCredential().hash;

/** The dust mapping datum from the wallet's payment key to the 33-byte dust address. */
const mapping = (addr: Address, dustAddress: string) =>
  serialize(Contracts.DustMappingDatum, {
    c_wallet: { VerificationKey: [paymentHash(addr)] },
    dust_address: dustAddress,
  });

const mappingOutput = (addr: Address, dustAddress: string) =>
  scriptOutput(dustGenerator.Script, "", mapping(addr, dustAddress));

/** Two existing mappings at the dust generator. */
const seedMappings = (emulator: Emulator, addr: Address) => {
  const utxos = [
    scriptUtxo(
      "d1".repeat(32),
      dustGenerator.Script,
      "",
      mapping(addr, "12".repeat(33)),
    ),
    scriptUtxo(
      "d2".repeat(32),
      dustGenerator.Script,
      "",
      mapping(addr, "ab".repeat(33)),
    ),
  ] as const;
  for (const utxo of utxos) emulator.addUtxo(utxo);
  return utxos;
};

/** A dust-generator tx that the user's payment key signs validates. */
const userSigns = (
  build: (tx: TxBuilder, emulator: Emulator, addr: Address) => TxBuilder,
) =>
  asFunded((emulator, blaze, addr, fee) =>
    emulator.expectValidTransaction(
      blaze,
      build(blaze.newTransaction().addInput(fee), emulator, addr)
        .provideScript(dustGenerator.Script)
        .addRequiredSigner(Ed25519KeyHashHex(paymentHash(addr))),
    ),
  );

describe("CNIGHT Generate Dust", () => {
  test("User can assign one dust address", () =>
    userSigns((tx, _emulator, addr) =>
      tx
        .addMint(
          PolicyId(dustGenerator.Script.hash()),
          new Map([[AssetName(""), 1n]]),
          create,
        )
        .addOutput(mappingOutput(addr, "12".repeat(33))),
    ));

  test("User can update 2 UTxOs using withdraw mechanism", () =>
    userSigns((tx, emulator, addr) => {
      const [first, second] = seedMappings(emulator, addr);
      return tx
        .addInput(first, create)
        .addInput(second, create)
        .addWithdrawal(
          registerRewardAccount(emulator, dustGenerator.Script.hash()),
          0n,
          create,
        )
        .addOutput(mappingOutput(addr, "11".repeat(32) + "aa"))
        .addOutput(mappingOutput(addr, "22".repeat(32) + "bb"));
    }));

  test("User can burn 2 NFTs by spending both UTxOs", () =>
    userSigns((tx, emulator, addr) => {
      const [first, second] = seedMappings(emulator, addr);
      return tx
        .addInput(first, burn)
        .addInput(second, burn)
        .addMint(
          PolicyId(dustGenerator.Script.hash()),
          new Map([[AssetName(""), -2n]]),
          burn,
        );
    }));
});
