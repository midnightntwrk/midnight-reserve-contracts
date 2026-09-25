import { describe, expect, test } from "bun:test";
import {
  type Address,
  AssetId,
  AssetName,
  PaymentAddress,
  PolicyId,
  toHex,
  Transaction,
  TransactionId,
  TransactionUnspentOutput,
  TxCBOR,
} from "@blaze-cardano/core";
import { Either, Option } from "effect";
import type { TxBuilder } from "@blaze-cardano/tx";
import {
  buildMintTcnightTx,
  burnAction,
  selectBurn,
} from "../cli/wallet/mint-tcnight";
import { asFunded, keyAddress, randomHash } from "./helpers/fixtures";
import {
  buildInstances,
  captureOutput,
  expectFailure,
  OutputCaptured,
  runTest,
} from "./helpers/effect";

const policy = Option.getOrThrow(
  Option.fromNullable((await buildInstances()).tcnightMintInfinite),
).Script;

const NIGHT = AssetId.fromParts(
  PolicyId(policy.hash()),
  AssetName(toHex(new TextEncoder().encode("NIGHT"))),
);

/** A UTxO at the address with 5 ADA and `night` NIGHT. */
const holding = (address: Address, night: bigint) =>
  TransactionUnspentOutput.fromCore([
    { txId: TransactionId(randomHash(32)), index: 0 },
    {
      address: PaymentAddress(address.toBech32()),
      value: {
        coins: 5_000_000n,
        assets: night > 0n ? new Map([[NIGHT, night]]) : undefined,
      },
    },
  ]);

describe("selectBurn", () => {
  const user = keyAddress("01".repeat(28));
  const five = holding(user, 5n);
  const none = holding(user, 0n);
  const seven = holding(user, 7n);

  test("spends the NIGHT-holding UTxOs in order until they cover the amount", () => {
    expect(selectBurn([five, none, seven], NIGHT, 6n)).toEqual(
      Either.right({
        spend: [five, seven],
        collected: 12n,
        held: 12n,
        holding: 2,
      }),
    );
    expect(selectBurn([five, none, seven], NIGHT, 5n)).toEqual(
      Either.right({ spend: [five], collected: 5n, held: 12n, holding: 2 }),
    );
  });

  test("is Left with what is held when it does not cover the amount", () => {
    expect(selectBurn([five, seven], NIGHT, 13n)).toEqual(
      Either.left({ held: 12n }),
    );
    expect(selectBurn([none], NIGHT, 1n)).toEqual(Either.left({ held: 0n }));
  });
});

/** The NIGHT of each of the draft's outputs at the address. */
const nightAt = (builder: TxBuilder, address: Address) =>
  draftOf(builder)
    .body()
    .outputs()
    .filter((output) => output.address().toBech32() === address.toBech32())
    .map((output) => output.amount().multiasset()?.get(NIGHT) ?? 0n);

const draftOf = (builder: TxBuilder) =>
  Transaction.fromCbor(TxCBOR(builder.toCbor()));

describe("the mint-tcnight builder", () => {
  test("mints NIGHT to a destination that is not the wallet", async () => {
    await asFunded(async (emulator, blaze) => {
      const destination = keyAddress("04".repeat(28));
      const builder = buildMintTcnightTx(
        blaze,
        { policy, amount: 100n, action: { kind: "mint", destination } },
        { coinsPerUtxoByte: emulator.params.coinsPerUtxoByte },
      );
      expect(draftOf(builder).body().mint()?.get(NIGHT)).toBe(100n);
      expect(nightAt(builder, destination)).toEqual([100n]);
      await emulator.expectValidTransaction(blaze, builder);
    });
  });

  test("burns NIGHT from the spent UTxO and pays the remainder back", async () => {
    await asFunded(async (emulator, blaze, addr) => {
      const tokens = holding(addr, 10n);
      emulator.addUtxo(tokens);
      const builder = buildMintTcnightTx(
        blaze,
        {
          policy,
          amount: 4n,
          action: {
            kind: "burn",
            spend: [tokens],
            remainder: 6n,
            user: addr,
          },
        },
        { coinsPerUtxoByte: emulator.params.coinsPerUtxoByte },
      );
      expect(draftOf(builder).body().mint()?.get(NIGHT)).toBe(-4n);
      expect(nightAt(builder, addr)).toEqual([6n]);
      await emulator.expectValidTransaction(blaze, builder);
    });
  });
});

describe("burnAction", () => {
  const user = keyAddress("05".repeat(28));
  const burn = (utxos: readonly TransactionUnspentOutput[]) =>
    burnAction(user, utxos, NIGHT, 50n);
  const output = OutputCaptured(captureOutput());

  test("spends the user's NIGHT and returns the remainder to the user", async () => {
    const tokens = holding(user, 80n);
    expect(await runTest(output, burn([holding(user, 0n), tokens]))).toEqual({
      kind: "burn",
      spend: [tokens],
      remainder: 30n,
      user,
    });
  });

  test("no NIGHT is UtxoNotFound for the asset; too little is PreconditionFailed", async () => {
    const none = await expectFailure(
      output,
      burn([holding(user, 0n)]),
      "UtxoNotFound",
    );
    expect(none.lookup).toEqual({
      by: "asset",
      address: user.toBech32(),
      asset: NIGHT,
    });
    const short = await expectFailure(
      output,
      burn([holding(user, 10n)]),
      "PreconditionFailed",
    );
    expect(short.command).toBe("mint-tcnight");
    expect(short.refusal).toEqual({
      _tag: "NightTooLow",
      held: 10n,
      required: 50n,
    });
  });
});
