import {
  addressFromValidator,
  AssetId,
  AssetName,
  Credential,
  CredentialType,
  NetworkId,
  PaymentAddress,
  PlutusData,
  PolicyId,
  toHex,
  TransactionOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Emulator } from "@blaze-cardano/emulator";
import * as Contracts from "../contract_blueprint";
import { describe, test, expect } from "bun:test";
import {
  addFundingUtxo,
  createContracts,
  createOneShotUtxo,
  DEFAULT_CONFIG,
  deployTechAuthAndCouncil,
} from "./helpers/deploy";
import {
  createFederatedOpsDatumFromString,
  candidateToPermissionedDatum,
} from "../cli/lib/candidates";

describe("Federated Ops Deploy with FederatedOps Datum", () => {
  const amount = 100_000_000n;
  const contracts = createContracts();
  const config = DEFAULT_CONFIG;

  // Test candidates in the relaxed JSON-like format
  const testCandidatesInput = `[
    {
      sidechain_pub_key:020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8,
      aura_pub_key:1254f7017f0b8347ce7ab14f96d818802e7e9e0c0d1b7c9acb3c726b080e7a03,
      grandpa_pub_key:5079bcd20fd97d7d2f752c4607012600b401950260a91821f73e692071c82bf5,
      beefy_pub_key:020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8
    },
    {
      sidechain_pub_key:0287aa09f21089003413b37602a3f6909f8695901c70a28175cafd99d5976a202a,
      aura_pub_key:b0521e374b0586d6829dad320753c62cdc6ef5edbd37ffdd36da0ae97c521819,
      grandpa_pub_key:3f7f2fc8829c649501a0fb72a79abf885aa89e6c4ee2d00c6041dfa85e320980,
      beefy_pub_key:0287aa09f21089003413b37602a3f6909f8695901c70a28175cafd99d5976a202a
    },
    {
      sidechain_pub_key:0291f1217d5a04cb83312ee3d88a6e6b33284e053e6ccfc3a90339a0299d12967c,
      aura_pub_key:1cbd2d43530a44705ad088af313e18f80b53ef16b36177cd4b77b846f2a5f07c,
      grandpa_pub_key:568cb4a574c6d178feb39c27dfc8b3f789e5f5423e19c71633c748b9acf086b5,
      beefy_pub_key:0291f1217d5a04cb83312ee3d88a6e6b33284e053e6ccfc3a90339a0299d12967c
    }
  ]`;

  test("Can deploy Federated Operators contract with FederatedOps datum", async () => {
    const emulator = new Emulator([]);
    await emulator.as("deployer", async (blaze, addr) => {
      addFundingUtxo(
        emulator,
        addr,
        "4444444444444444444444444444444444444444444444444444444444444444",
        amount * 10n,
      );

      await deployTechAuthAndCouncil(emulator, blaze, addr, contracts, config);

      const federatedOpsOneShotUtxo = createOneShotUtxo(
        addr,
        config.federated_operators_one_shot_hash,
        config.federated_operators_one_shot_index,
      );
      emulator.addUtxo(federatedOpsOneShotUtxo);

      const federatedOpsForeverAddress = addressFromValidator(
        NetworkId.Testnet,
        contracts.federatedOpsForever.Script,
      );

      const federatedOpsTwoStageAddress = addressFromValidator(
        NetworkId.Testnet,
        contracts.federatedOpsTwoStage.Script,
      );

      const federatedOpsUpgradeState: Contracts.UpgradeState = [
        contracts.federatedOpsLogic.Script.hash(),
        "",
        contracts.govAuth.Script.hash(),
        "",
        0n,
        0n,
      ];

      // Create FederatedOps datum from test candidates
      const federatedOpsDatum = createFederatedOpsDatumFromString(
        testCandidatesInput,
        0n,
      );

      // Verify datum structure
      expect(federatedOpsDatum[0]).toEqual({}); // Unit
      expect(federatedOpsDatum[1]).toHaveLength(3); // 3 candidates
      expect(federatedOpsDatum[2]).toBe(0n); // version

      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addInput(federatedOpsOneShotUtxo)
          .addMint(
            PolicyId(contracts.federatedOpsForever.Script.hash()),
            new Map([[AssetName(""), 1n]]),
            PlutusData.newInteger(0n),
          )
          .addMint(
            PolicyId(contracts.federatedOpsTwoStage.Script.hash()),
            new Map([
              [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
              [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
            ]),
            PlutusData.newInteger(0n),
          )
          .provideScript(contracts.federatedOpsForever.Script)
          .provideScript(contracts.federatedOpsTwoStage.Script)
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(federatedOpsTwoStageAddress.toBech32()),
              value: {
                coins: 2_000_000n,
                assets: new Map([
                  [
                    AssetId(
                      contracts.federatedOpsTwoStage.Script.hash() +
                        toHex(new TextEncoder().encode("main")),
                    ),
                    1n,
                  ],
                ]),
              },
              datum: serialize(
                Contracts.UpgradeState,
                federatedOpsUpgradeState,
              ).toCore(),
            }),
          )
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(federatedOpsTwoStageAddress.toBech32()),
              value: {
                coins: 2_000_000n,
                assets: new Map([
                  [
                    AssetId(
                      contracts.federatedOpsTwoStage.Script.hash() +
                        toHex(new TextEncoder().encode("staging")),
                    ),
                    1n,
                  ],
                ]),
              },
              datum: serialize(
                Contracts.UpgradeState,
                federatedOpsUpgradeState,
              ).toCore(),
            }),
          )
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(federatedOpsForeverAddress.toBech32()),
              value: {
                coins: 2_000_000n,
                assets: new Map([
                  [AssetId(contracts.federatedOpsForever.Script.hash()), 1n],
                ]),
              },
              datum: serialize(
                Contracts.FederatedOps,
                federatedOpsDatum,
              ).toCore(),
            }),
          )
          .addRegisterStake(
            Credential.fromCore({
              hash: contracts.federatedOpsLogic.Script.hash(),
              type: CredentialType.ScriptHash,
            }),
          ),
      );
    });
  });

  test("Can deploy with empty permissioned candidates list", async () => {
    const emulator = new Emulator([]);
    await emulator.as("deployer", async (blaze, addr) => {
      addFundingUtxo(
        emulator,
        addr,
        "5555555555555555555555555555555555555555555555555555555555555555",
        amount * 10n,
      );

      await deployTechAuthAndCouncil(emulator, blaze, addr, contracts, config);

      const federatedOpsOneShotUtxo = createOneShotUtxo(
        addr,
        config.federated_operators_one_shot_hash,
        config.federated_operators_one_shot_index,
      );
      emulator.addUtxo(federatedOpsOneShotUtxo);

      const federatedOpsForeverAddress = addressFromValidator(
        NetworkId.Testnet,
        contracts.federatedOpsForever.Script,
      );

      const federatedOpsTwoStageAddress = addressFromValidator(
        NetworkId.Testnet,
        contracts.federatedOpsTwoStage.Script,
      );

      const federatedOpsUpgradeState: Contracts.UpgradeState = [
        contracts.federatedOpsLogic.Script.hash(),
        "",
        contracts.govAuth.Script.hash(),
        "",
        0n,
        0n,
      ];

      // Create FederatedOps datum with empty appendix
      const emptyFederatedOpsDatum: Contracts.FederatedOps = [
        {}, // Unit
        [], // Empty appendix
        0n, // version
      ];

      await emulator.expectValidTransaction(
        blaze,
        blaze
          .newTransaction()
          .addInput(federatedOpsOneShotUtxo)
          .addMint(
            PolicyId(contracts.federatedOpsForever.Script.hash()),
            new Map([[AssetName(""), 1n]]),
            PlutusData.newInteger(0n),
          )
          .addMint(
            PolicyId(contracts.federatedOpsTwoStage.Script.hash()),
            new Map([
              [AssetName(toHex(new TextEncoder().encode("main"))), 1n],
              [AssetName(toHex(new TextEncoder().encode("staging"))), 1n],
            ]),
            PlutusData.newInteger(0n),
          )
          .provideScript(contracts.federatedOpsForever.Script)
          .provideScript(contracts.federatedOpsTwoStage.Script)
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(federatedOpsTwoStageAddress.toBech32()),
              value: {
                coins: 2_000_000n,
                assets: new Map([
                  [
                    AssetId(
                      contracts.federatedOpsTwoStage.Script.hash() +
                        toHex(new TextEncoder().encode("main")),
                    ),
                    1n,
                  ],
                ]),
              },
              datum: serialize(
                Contracts.UpgradeState,
                federatedOpsUpgradeState,
              ).toCore(),
            }),
          )
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(federatedOpsTwoStageAddress.toBech32()),
              value: {
                coins: 2_000_000n,
                assets: new Map([
                  [
                    AssetId(
                      contracts.federatedOpsTwoStage.Script.hash() +
                        toHex(new TextEncoder().encode("staging")),
                    ),
                    1n,
                  ],
                ]),
              },
              datum: serialize(
                Contracts.UpgradeState,
                federatedOpsUpgradeState,
              ).toCore(),
            }),
          )
          .addOutput(
            TransactionOutput.fromCore({
              address: PaymentAddress(federatedOpsForeverAddress.toBech32()),
              value: {
                coins: 2_000_000n,
                assets: new Map([
                  [AssetId(contracts.federatedOpsForever.Script.hash()), 1n],
                ]),
              },
              datum: serialize(
                Contracts.FederatedOps,
                emptyFederatedOpsDatum,
              ).toCore(),
            }),
          )
          .addRegisterStake(
            Credential.fromCore({
              hash: contracts.federatedOpsLogic.Script.hash(),
              type: CredentialType.ScriptHash,
            }),
          ),
      );
    });
  });

  test("FederatedOps datum serializes candidate keys correctly", () => {
    const candidate = {
      sidechain_pub_key:
        "020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8",
      aura_pub_key:
        "1254f7017f0b8347ce7ab14f96d818802e7e9e0c0d1b7c9acb3c726b080e7a03",
      grandpa_pub_key:
        "5079bcd20fd97d7d2f752c4607012600b401950260a91821f73e692071c82bf5",
      beefy_pub_key:
        "020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8",
    };

    const datum = candidateToPermissionedDatum(candidate);

    // Verify structure: [sidechain_pub_key, [[id, bytes], ...]]
    expect(datum[0]).toBe(candidate.sidechain_pub_key);
    expect(datum[1]).toHaveLength(3);

    // Verify key identifiers are correct hex encodings
    const [auraKey, granKey, beefKey] = datum[1];
    expect(auraKey[0]).toBe("61757261"); // "aura" in hex
    expect(granKey[0]).toBe("6772616e"); // "gran" in hex
    expect(beefKey[0]).toBe("62656566"); // "beef" in hex

    // Verify key values
    expect(auraKey[1]).toBe(candidate.aura_pub_key);
    expect(granKey[1]).toBe(candidate.grandpa_pub_key);
    expect(beefKey[1]).toBe(candidate.beefy_pub_key);

    // Verify serialization doesn't throw
    const federatedOpsDatum: Contracts.FederatedOps = [{}, [datum], 0n];
    const serialized = serialize(Contracts.FederatedOps, federatedOpsDatum);
    expect(serialized).toBeDefined();
  });
});
