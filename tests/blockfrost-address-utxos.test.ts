import { describe, expect, test } from "bun:test";
import {
  parseBlockfrostAddressUtxos,
  type BlockfrostAddressUtxo,
} from "../cli-yargs/lib/blockfrost";

describe("parseBlockfrostAddressUtxos", () => {
  test("accepts valid Blockfrost address UTxO payloads", () => {
    const payload = [
      {
        tx_hash:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        tx_index: 0,
        output_index: 1,
        amount: [
          { unit: "lovelace", quantity: "1234567" },
          {
            unit: "a".repeat(56) + "6d61696e",
            quantity: "1",
          },
        ],
        inline_datum: "d87980",
        data_hash: null,
        extra_field: { ignored: true },
      },
    ] satisfies unknown[];

    const expected: BlockfrostAddressUtxo[] = [
      {
        tx_hash:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        tx_index: 0,
        output_index: 1,
        amount: [
          { unit: "lovelace", quantity: "1234567" },
          {
            unit: "a".repeat(56) + "6d61696e",
            quantity: "1",
          },
        ],
        inline_datum: "d87980",
        data_hash: null,
      },
    ];

    expect(
      parseBlockfrostAddressUtxos(payload, "/addresses/test/utxos"),
    ).toEqual(expected);
  });

  test("rejects Blockfrost error objects instead of treating them as empty UTxO arrays", () => {
    const payload = {
      status_code: 400,
      error: "Bad Request",
      message: "Invalid address",
    };

    expect(() =>
      parseBlockfrostAddressUtxos(payload, "/addresses/test/utxos"),
    ).toThrow(
      "Invalid Blockfrost /addresses/test/utxos response: expected an array",
    );
  });

  test("rejects malformed UTxO entries with actionable field paths", () => {
    const payload = [
      {
        tx_hash:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        tx_index: 0,
        output_index: 0,
        amount: [{ unit: "lovelace", quantity: 1234567 }],
      },
    ];

    expect(() =>
      parseBlockfrostAddressUtxos(payload, "/addresses/test/utxos"),
    ).toThrow(
      "Invalid Blockfrost /addresses/test/utxos[0].amount[0].quantity response: expected quantity to be a string",
    );
  });
});
