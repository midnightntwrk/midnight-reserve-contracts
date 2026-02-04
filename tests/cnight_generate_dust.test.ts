import {
  addressFromValidator,
  AssetId,
  AssetName,
  Credential,
  CredentialType,
  Ed25519KeyHashHex,
  NetworkId,
  PaymentAddress,
  PolicyId,
  RewardAccount,
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

  // Mock 33-byte dust address (66 hex characters)
  const mockDustAddress =
    "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdefff";

  test("User can assign one dust address", async () => {
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

      // Create dust mapping datum with user's payment credential and dust address
      const dustMappingDatum: Contracts.DustMappingDatum = {
        c_wallet: {
          VerificationKey: [addr.asBase()?.getPaymentCredential().hash!],
        },
        dust_address: mockDustAddress,
      };

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

  test("User can update 2 UTxOs using withdraw mechanism", async () => {
    const emulator = new Emulator([]);

    await emulator.as("user", async (blaze, addr) => {
      // Add UTxO for user (for collateral)
      const userUtxo = TransactionUnspentOutput.fromCore([
        {
          index: 0,
          txId: TransactionId(
            "2222222222222222222222222222222222222222222222222222222222222222",
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

      // Create first dust mapping datum
      const dustMappingDatum1: Contracts.DustMappingDatum = {
        c_wallet: {
          VerificationKey: [addr.asBase()?.getPaymentCredential().hash!],
        },
        dust_address: mockDustAddress,
      };

      // Create second dust mapping datum with different dust address
      const mockDustAddress2 =
        "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab";
      const dustMappingDatum2: Contracts.DustMappingDatum = {
        c_wallet: {
          VerificationKey: [addr.asBase()?.getPaymentCredential().hash!],
        },
        dust_address: mockDustAddress2,
      };

      // Manually add two script UTxOs with NFTs (simulating they were created earlier)
      emulator.addUtxo(
        TransactionUnspentOutput.fromCore([
          {
            index: 2,
            txId: TransactionId(
              "2222222222222222222222222222222222222222222222222222222222222222",
            ),
          },
          {
            address: PaymentAddress(dustGeneratorAddress.toBech32()),
            value: {
              coins: 2_000_000n,
              assets: new Map([[AssetId(dustGenerator.Script.hash()), 1n]]),
            },
            datum: serialize(
              Contracts.DustMappingDatum,
              dustMappingDatum1,
            ).toCore(),
          },
        ]),
      );

      emulator.addUtxo(
        TransactionUnspentOutput.fromCore([
          {
            index: 1,
            txId: TransactionId(
              "2222222222222222222222222222222222222222222222222222222222222222",
            ),
          },
          {
            address: PaymentAddress(dustGeneratorAddress.toBech32()),
            value: {
              coins: 2_000_000n,
              assets: new Map([[AssetId(dustGenerator.Script.hash()), 1n]]),
            },
            datum: serialize(
              Contracts.DustMappingDatum,
              dustMappingDatum2,
            ).toCore(),
          },
        ]),
      );

      // Get the script UTxOs
      const scriptUtxos =
        await blaze.provider.getUnspentOutputs(dustGeneratorAddress);

      // Register the reward account in emulator
      const dustGeneratorRewardAccount = RewardAccount.fromCredential(
        Credential.fromCore({
          hash: dustGenerator.Script.hash(),
          type: CredentialType.ScriptHash,
        }).toCore(),
        NetworkId.Testnet,
      );
      emulator.accounts.set(dustGeneratorRewardAccount, 0n);

      // Update both UTxOs using withdraw mechanism
      const updatedDustAddress1 =
        "1111111111111111111111111111111111111111111111111111111111111111aa";
      const updatedDustMappingDatum1: Contracts.DustMappingDatum = {
        c_wallet: {
          VerificationKey: [addr.asBase()?.getPaymentCredential().hash!],
        },
        dust_address: updatedDustAddress1,
      };

      const updatedDustAddress2 =
        "2222222222222222222222222222222222222222222222222222222222222222bb";
      const updatedDustMappingDatum2: Contracts.DustMappingDatum = {
        c_wallet: {
          VerificationKey: [addr.asBase()?.getPaymentCredential().hash!],
        },
        dust_address: updatedDustAddress2,
      };

      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addInput(scriptUtxos[0], serialize(Contracts.DustAction, "Create"))
          .addInput(scriptUtxos[1], serialize(Contracts.DustAction, "Create"))
          .addWithdrawal(
            RewardAccount.fromCredential(
              Credential.fromCore({
                hash: dustGenerator.Script.hash(),
                type: CredentialType.ScriptHash,
              }).toCore(),
              NetworkId.Testnet,
            ),
            0n,
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
                updatedDustMappingDatum1,
              ).toCore(),
            }),
          )
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(dustGeneratorAddress.toBech32()),
              value: {
                coins: 2_000_000n,
                assets: new Map([[AssetId(dustGenerator.Script.hash()), 1n]]),
              },
              datum: serialize(
                Contracts.DustMappingDatum,
                updatedDustMappingDatum2,
              ).toCore(),
            }),
          )
          .addRequiredSigner(
            Ed25519KeyHashHex(addr.asBase()?.getPaymentCredential().hash!),
          ),
      );
    });
  });

  test("User can burn 2 NFTs by spending both UTxOs", async () => {
    const emulator = new Emulator([]);

    await emulator.as("user", async (blaze, addr) => {
      // Add UTxO for user (for collateral)
      const userUtxo = TransactionUnspentOutput.fromCore([
        {
          index: 0,
          txId: TransactionId(
            "3333333333333333333333333333333333333333333333333333333333333333",
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

      // Create first dust mapping datum
      const dustMappingDatum1: Contracts.DustMappingDatum = {
        c_wallet: {
          VerificationKey: [addr.asBase()?.getPaymentCredential().hash!],
        },
        dust_address: mockDustAddress,
      };

      // Create second dust mapping datum
      const mockDustAddress2 =
        "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321cc";
      const dustMappingDatum2: Contracts.DustMappingDatum = {
        c_wallet: {
          VerificationKey: [addr.asBase()?.getPaymentCredential().hash!],
        },
        dust_address: mockDustAddress2,
      };

      // Manually add two script UTxOs with NFTs (simulating they were created earlier)
      emulator.addUtxo(
        TransactionUnspentOutput.fromCore([
          {
            index: 1,
            txId: TransactionId(
              "3333333333333333333333333333333333333333333333333333333333333333",
            ),
          },
          {
            address: PaymentAddress(dustGeneratorAddress.toBech32()),
            value: {
              coins: 2_000_000n,
              assets: new Map([[AssetId(dustGenerator.Script.hash()), 1n]]),
            },
            datum: serialize(
              Contracts.DustMappingDatum,
              dustMappingDatum1,
            ).toCore(),
          },
        ]),
      );

      emulator.addUtxo(
        TransactionUnspentOutput.fromCore([
          {
            index: 2,
            txId: TransactionId(
              "3333333333333333333333333333333333333333333333333333333333333333",
            ),
          },
          {
            address: PaymentAddress(dustGeneratorAddress.toBech32()),
            value: {
              coins: 2_000_000n,
              assets: new Map([[AssetId(dustGenerator.Script.hash()), 1n]]),
            },
            datum: serialize(
              Contracts.DustMappingDatum,
              dustMappingDatum2,
            ).toCore(),
          },
        ]),
      );

      // Get the script UTxOs
      const scriptUtxos =
        await blaze.provider.getUnspentOutputs(dustGeneratorAddress);

      // Burn both NFTs by spending both UTxOs and minting -2
      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addInput(scriptUtxos[0], serialize(Contracts.DustAction, "Burn"))
          .addInput(scriptUtxos[1], serialize(Contracts.DustAction, "Burn"))
          .addMint(
            PolicyId(dustGenerator.Script.hash()),
            new Map([[AssetName(""), -2n]]),
            serialize(Contracts.DustAction, "Burn"),
          )
          .provideScript(dustGenerator.Script)
          .addRequiredSigner(
            Ed25519KeyHashHex(addr.asBase()?.getPaymentCredential().hash!),
          ),
      );
    });
  });
});
