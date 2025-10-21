import {
  addressFromValidator,
  AssetId,
  AssetName,
  Ed25519KeyHashHex,
  NetworkId,
  PaymentAddress,
  PlutusData,
  PolicyId,
  TransactionId,
  TransactionOutput,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Emulator } from "@blaze-cardano/emulator";
import * as Contracts from "../contract_blueprint";
import { describe, test } from "bun:test";

describe("CNIGHT Generate Dust", () => {
  const amount = 100_000_000n; // 100 ADA

  const dustGenerator =
    new Contracts.CnightGeneratesDustCnightGeneratesDustElse();

  // Mock 32-byte dust address (64 hex characters)
  const mockDustAddress =
    "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";

  test("User can mint one dust token", async () => {
    const emulator = new Emulator([]);

    await emulator.as("user", async (blaze, addr) => {
      // Add UTxO for user
      const userUtxo = TransactionUnspentOutput.fromCore([
        {
          index: 0,
          txId: TransactionId(
            "1111111111111111111111111111111111111111111111111111111111111111",
          ),
        },
        {
          address: PaymentAddress(addr.toBech32()),
          value: {
            coins: amount,
          },
        },
      ]);

      emulator.addUtxo(userUtxo);

      const dustGeneratorAddress = addressFromValidator(
        NetworkId.Testnet,
        dustGenerator.Script,
      );

      // Create dust mapping datum with user's credential and dust address
      const dustMappingDatum: Contracts.DustMappingDatum = {
        c_wallet: {
          VerificationKey: [addr.asBase()?.getPaymentCredential().hash!],
        },
        dust_address: mockDustAddress,
      };

      // Mint 1 dust token and create output UTxO
      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addInput(userUtxo)
          .addMint(
            PolicyId(dustGenerator.Script.hash()),
            new Map([[AssetName(""), 1n]]),
            serialize(Contracts.DustAction, "Create"),
          )
          .provideScript(dustGenerator.Script)
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(dustGeneratorAddress.toBech32()),
              value: {
                coins: 2_000_000n,
                assets: new Map([[AssetId(dustGenerator.Script.hash()), 1n]]),
              },
              datum: serialize(
                Contracts.DustMappingDatum,
                dustMappingDatum,
              ).toCore(),
            }),
          )
          .addRequiredSigner(
            Ed25519KeyHashHex(addr.asBase()?.getPaymentCredential().hash!),
          ),
      );
    });
  });
});
