import {
  addressFromCredential,
  addressFromValidator,
  AssetId,
  AssetName,
  Credential,
  CredentialType,
  Hash28ByteBase16,
  NativeScripts,
  NetworkId,
  PaymentAddress,
  PlutusData,
  PlutusList,
  PolicyId,
  RewardAccount,
  Script,
  toHex,
  TransactionId,
  TransactionOutput,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Emulator } from "@blaze-cardano/emulator";
// V2 contracts are not yet deployed to mainnet — the V2 and v1 scripts must
// come from the same compilation so their cross-script hash references match.
import * as Contracts from "../contract_blueprint";
import {
  createMultisigStateCbor,
  createRedeemerMapCbor,
} from "../cli-yargs/lib/signers";
import { describe, expect, test } from "bun:test";

/**
 * Wrap an inner redeemer in LogicRedeemer::Normal(inner).
 * This is constructor 0 with a single field containing the inner redeemer.
 */
function wrapLogicRedeemerNormal(inner: PlutusData): PlutusData {
  return PlutusData.fromCore({
    constructor: 0n,
    fields: { items: [inner.toCore()] },
  });
}

const MAIN_TOKEN_HEX = toHex(new TextEncoder().encode("main"));

// Shared signer hashes — same 3 signers used in the working v1 council test.
// These are arbitrary fixed hashes (NOT emulator wallet hashes) that appear
// in the datum AND are used to build native scripts whose policies the
// validator checks against the mint.
const SIGNERS = [
  {
    paymentHash: "3958ae4a79fa36f52c9e0f5fab7aac2d4c4446a290b44e2d2f53d387",
    sr25519Key:
      "d2a9e63d7a883dfe271d2ca91c06917fdb459126162c77ff83b480d6415a551f",
  },
  {
    paymentHash: "c6f2de5adbbf0b77adcc6883d562a4f5a535017eaedc6804c5e55b33",
    sr25519Key:
      "9e6619809817313de02029b0b9232ccc880d8ee37e2fed8cabc73694045fee29",
  },
  {
    paymentHash: "a7b42151bbc97e9ecd40f454d6dd0a24cf3e579c675f6552bd059c82",
    sr25519Key:
      "ecfc4d62911bae419efea459f9f2271da3f9df5b8cebbda599116aa034b15c55",
  },
];

const THRESHOLD: Contracts.MultisigThreshold = [2n, 3n, 2n, 3n];
const REQUIRED_SIGNERS = 2;

/** Build a NativeScripts.atLeastNOfK from the shared SIGNERS, matching what
 *  the validator rebuilds from the datum via build_native_script. */
function buildNativeScriptFromSigners() {
  return NativeScripts.atLeastNOfK(
    REQUIRED_SIGNERS,
    ...SIGNERS.map((s) => {
      const bech32 = addressFromCredential(
        NetworkId.Testnet,
        Credential.fromCore({
          type: CredentialType.KeyHash,
          hash: Hash28ByteBase16(s.paymentHash),
        }),
      ).toBech32();
      return NativeScripts.justAddress(bech32, NetworkId.Testnet);
    }),
  );
}

/** Build a VersionedMultisig datum from the shared SIGNERS at the given logicRound. */
function buildMultisigState(logicRound: bigint): Contracts.VersionedMultisig {
  const signerMap: Record<string, string> = {};
  for (const s of SIGNERS) {
    signerMap["8200581c" + s.paymentHash] = s.sr25519Key;
  }
  return [[BigInt(SIGNERS.length), signerMap], logicRound];
}

describe("LogicRedeemer::Normal v2 wrapping", () => {
  // ================================================================
  // change-council with v2 logic
  // ================================================================
  describe("change-council", () => {
    const councilForever = new Contracts.PermissionedCouncilForeverElse();
    const councilLogicV2 = new Contracts.PermissionedV2CouncilLogicV2Else();
    const councilTwoStage =
      new Contracts.PermissionedCouncilTwoStageUpgradeElse();
    const mainCouncilUpdateThreshold =
      new Contracts.ThresholdsMainCouncilUpdateThresholdElse();
    const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();

    test("wrapped redeemer succeeds with v2 logic", async () => {
      const emulator = new Emulator([]);
      const amount = 100_000_000n;

      await emulator.as("deployer", async (blaze, addr) => {
        await emulator.as("signer1", async () => {
          await emulator.as("signer2", async () => {
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                {
                  index: 11,
                  txId: TransactionId(
                    "b451d1433cd54772f42dff46fecc76ba6d1c89202ffe10309fda5bb3313fbd48",
                  ),
                },
                {
                  address: PaymentAddress(addr.toBech32()),
                  value: { coins: amount * 10n },
                },
              ]),
            );

            const councilForeverAddress = addressFromValidator(
              NetworkId.Testnet,
              councilForever.Script,
            );
            const councilTwoStageAddress = addressFromValidator(
              NetworkId.Testnet,
              councilTwoStage.Script,
            );
            const councilUpdateThresholdAddress = addressFromValidator(
              NetworkId.Testnet,
              mainCouncilUpdateThreshold.Script,
            );
            const techAuthForeverAddress = addressFromValidator(
              NetworkId.Testnet,
              techAuthForever.Script,
            );

            // Council state at logic_round = 1 (v2)
            const councilState = buildMultisigState(1n);
            // Tech auth state at logic_round = 0 (unchanged)
            const techAuthState = buildMultisigState(0n);

            // UpgradeState: [logic, mitigation_logic, auth, mitigation_auth, round, logic_round]
            const upgradeState: Contracts.UpgradeState = [
              councilLogicV2.Script.hash(),
              "",
              councilForever.Script.hash(),
              "",
              0n,
              1n,
            ];

            // Add council forever UTxO (will be spent as input)
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                {
                  index: 0,
                  txId: TransactionId("ee".repeat(32)),
                },
                {
                  address: PaymentAddress(councilForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(councilForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.VersionedMultisig,
                    councilState,
                  ).toCore(),
                },
              ]),
            );

            // Add threshold UTxO (reference input)
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                {
                  index: 0,
                  txId: TransactionId("c0".repeat(32)),
                },
                {
                  address: PaymentAddress(
                    councilUpdateThresholdAddress.toBech32(),
                  ),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(mainCouncilUpdateThreshold.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.MultisigThreshold,
                    THRESHOLD,
                  ).toCore(),
                },
              ]),
            );

            // Add tech auth forever UTxO (reference input)
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                {
                  index: 0,
                  txId: TransactionId("dd".repeat(32)),
                },
                {
                  address: PaymentAddress(techAuthForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(techAuthForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.VersionedMultisig,
                    techAuthState,
                  ).toCore(),
                },
              ]),
            );

            // Add two-stage UTxO (reference input) with "main" token
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                {
                  index: 0,
                  txId: TransactionId("c1".repeat(32)),
                },
                {
                  address: PaymentAddress(councilTwoStageAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [
                        AssetId(councilTwoStage.Script.hash() + MAIN_TOKEN_HEX),
                        1n,
                      ],
                    ]),
                  },
                  datum: serialize(
                    Contracts.UpgradeState,
                    upgradeState,
                  ).toCore(),
                },
              ]),
            );

            // Register v2 logic reward account
            const logicRewardAccount = RewardAccount.fromCredential(
              Credential.fromCore({
                hash: councilLogicV2.Script.hash(),
                type: CredentialType.ScriptHash,
              }).toCore(),
              NetworkId.Testnet,
            );
            emulator.accounts.set(logicRewardAccount, { balance: 0n });

            // New council state (same signers, logic_round = 1)
            const newStateCbor = createMultisigStateCbor(SIGNERS, 1n);
            const innerRedeemerCbor = createRedeemerMapCbor(SIGNERS);
            const wrappedRedeemer = wrapLogicRedeemerNormal(innerRedeemerCbor);

            // Build native scripts from the SAME signers as in the datum.
            // The validator rebuilds the native script from the datum signers
            // and checks the mint includes the matching policy.
            const nativeScript = buildNativeScriptFromSigners();
            const nativeScriptPolicyId = PolicyId(nativeScript.hash());

            const txBuilder = blaze
              .newTransaction()
              .addInput(
                TransactionUnspentOutput.fromCore([
                  {
                    index: 0,
                    txId: TransactionId("ee".repeat(32)),
                  },
                  {
                    address: PaymentAddress(councilForeverAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [AssetId(councilForever.Script.hash()), 1n],
                      ]),
                    },
                    datum: serialize(
                      Contracts.VersionedMultisig,
                      councilState,
                    ).toCore(),
                  },
                ]),
                PlutusData.newInteger(0n),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  {
                    index: 0,
                    txId: TransactionId("c0".repeat(32)),
                  },
                  {
                    address: PaymentAddress(
                      councilUpdateThresholdAddress.toBech32(),
                    ),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [AssetId(mainCouncilUpdateThreshold.Script.hash()), 1n],
                      ]),
                    },
                    datum: serialize(
                      Contracts.MultisigThreshold,
                      THRESHOLD,
                    ).toCore(),
                  },
                ]),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  {
                    index: 0,
                    txId: TransactionId("dd".repeat(32)),
                  },
                  {
                    address: PaymentAddress(techAuthForeverAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [AssetId(techAuthForever.Script.hash()), 1n],
                      ]),
                    },
                    datum: serialize(
                      Contracts.VersionedMultisig,
                      techAuthState,
                    ).toCore(),
                  },
                ]),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  {
                    index: 0,
                    txId: TransactionId("c1".repeat(32)),
                  },
                  {
                    address: PaymentAddress(councilTwoStageAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [
                          AssetId(
                            councilTwoStage.Script.hash() + MAIN_TOKEN_HEX,
                          ),
                          1n,
                        ],
                      ]),
                    },
                    datum: serialize(
                      Contracts.UpgradeState,
                      upgradeState,
                    ).toCore(),
                  },
                ]),
              )
              .provideScript(councilForever.Script)
              .addMint(nativeScriptPolicyId, new Map([[AssetName(""), 1n]]))
              .provideScript(Script.newNativeScript(nativeScript))
              .addOutput(
                TransactionOutput.fromCore({
                  address: PaymentAddress(councilForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(councilForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: newStateCbor.toCore(),
                }),
              )
              .addWithdrawal(logicRewardAccount, 0n, wrappedRedeemer)
              .provideScript(councilLogicV2.Script);

            await emulator.expectValidTransaction(blaze, txBuilder);
          });
        });
      });
    });

    test("bare redeemer fails with v2 logic", async () => {
      const emulator = new Emulator([]);
      const amount = 100_000_000n;

      await emulator.as("deployer", async (blaze, addr) => {
        await emulator.as("signer1", async () => {
          await emulator.as("signer2", async () => {
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                {
                  index: 11,
                  txId: TransactionId(
                    "b451d1433cd54772f42dff46fecc76ba6d1c89202ffe10309fda5bb3313fbd48",
                  ),
                },
                {
                  address: PaymentAddress(addr.toBech32()),
                  value: { coins: amount * 10n },
                },
              ]),
            );

            const councilForeverAddress = addressFromValidator(
              NetworkId.Testnet,
              councilForever.Script,
            );
            const councilTwoStageAddress = addressFromValidator(
              NetworkId.Testnet,
              councilTwoStage.Script,
            );
            const councilUpdateThresholdAddress = addressFromValidator(
              NetworkId.Testnet,
              mainCouncilUpdateThreshold.Script,
            );
            const techAuthForeverAddress = addressFromValidator(
              NetworkId.Testnet,
              techAuthForever.Script,
            );

            const councilState = buildMultisigState(1n);
            const techAuthState = buildMultisigState(0n);

            const upgradeState: Contracts.UpgradeState = [
              councilLogicV2.Script.hash(),
              "",
              councilForever.Script.hash(),
              "",
              0n,
              1n,
            ];

            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("ee".repeat(32)) },
                {
                  address: PaymentAddress(councilForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(councilForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.VersionedMultisig,
                    councilState,
                  ).toCore(),
                },
              ]),
            );

            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("c0".repeat(32)) },
                {
                  address: PaymentAddress(
                    councilUpdateThresholdAddress.toBech32(),
                  ),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(mainCouncilUpdateThreshold.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.MultisigThreshold,
                    THRESHOLD,
                  ).toCore(),
                },
              ]),
            );

            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("dd".repeat(32)) },
                {
                  address: PaymentAddress(techAuthForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(techAuthForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.VersionedMultisig,
                    techAuthState,
                  ).toCore(),
                },
              ]),
            );

            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("c1".repeat(32)) },
                {
                  address: PaymentAddress(councilTwoStageAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [
                        AssetId(councilTwoStage.Script.hash() + MAIN_TOKEN_HEX),
                        1n,
                      ],
                    ]),
                  },
                  datum: serialize(
                    Contracts.UpgradeState,
                    upgradeState,
                  ).toCore(),
                },
              ]),
            );

            const logicRewardAccount = RewardAccount.fromCredential(
              Credential.fromCore({
                hash: councilLogicV2.Script.hash(),
                type: CredentialType.ScriptHash,
              }).toCore(),
              NetworkId.Testnet,
            );
            emulator.accounts.set(logicRewardAccount, { balance: 0n });

            const newStateCbor = createMultisigStateCbor(SIGNERS, 1n);
            // Bare redeemer — NOT wrapped in LogicRedeemer::Normal
            const bareRedeemer = createRedeemerMapCbor(SIGNERS);

            const nativeScript = buildNativeScriptFromSigners();
            const nativeScriptPolicyId = PolicyId(nativeScript.hash());

            const txBuilder = blaze
              .newTransaction()
              .addInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("ee".repeat(32)) },
                  {
                    address: PaymentAddress(councilForeverAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [AssetId(councilForever.Script.hash()), 1n],
                      ]),
                    },
                    datum: serialize(
                      Contracts.VersionedMultisig,
                      councilState,
                    ).toCore(),
                  },
                ]),
                PlutusData.newInteger(0n),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("c0".repeat(32)) },
                  {
                    address: PaymentAddress(
                      councilUpdateThresholdAddress.toBech32(),
                    ),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [AssetId(mainCouncilUpdateThreshold.Script.hash()), 1n],
                      ]),
                    },
                    datum: serialize(
                      Contracts.MultisigThreshold,
                      THRESHOLD,
                    ).toCore(),
                  },
                ]),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("dd".repeat(32)) },
                  {
                    address: PaymentAddress(techAuthForeverAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [AssetId(techAuthForever.Script.hash()), 1n],
                      ]),
                    },
                    datum: serialize(
                      Contracts.VersionedMultisig,
                      techAuthState,
                    ).toCore(),
                  },
                ]),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("c1".repeat(32)) },
                  {
                    address: PaymentAddress(councilTwoStageAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [
                          AssetId(
                            councilTwoStage.Script.hash() + MAIN_TOKEN_HEX,
                          ),
                          1n,
                        ],
                      ]),
                    },
                    datum: serialize(
                      Contracts.UpgradeState,
                      upgradeState,
                    ).toCore(),
                  },
                ]),
              )
              .provideScript(councilForever.Script)
              .addMint(nativeScriptPolicyId, new Map([[AssetName(""), 1n]]))
              .provideScript(Script.newNativeScript(nativeScript))
              .addOutput(
                TransactionOutput.fromCore({
                  address: PaymentAddress(councilForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(councilForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: newStateCbor.toCore(),
                }),
              )
              .addWithdrawal(logicRewardAccount, 0n, bareRedeemer)
              .provideScript(councilLogicV2.Script);

            await expect(
              emulator.expectValidTransaction(blaze, txBuilder),
            ).rejects.toThrow();
          });
        });
      });
    });
  });

  // ================================================================
  // change-tech-auth with v2 logic
  // ================================================================
  describe("change-tech-auth", () => {
    const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();
    const techAuthLogicV2 = new Contracts.PermissionedV2TechAuthLogicV2Else();
    const techAuthTwoStage =
      new Contracts.PermissionedTechAuthTwoStageUpgradeElse();
    const mainTechAuthUpdateThreshold =
      new Contracts.ThresholdsMainTechAuthUpdateThresholdElse();
    const councilForever = new Contracts.PermissionedCouncilForeverElse();

    test("wrapped redeemer succeeds with v2 logic", async () => {
      const emulator = new Emulator([]);
      const amount = 100_000_000n;

      await emulator.as("deployer", async (blaze, addr) => {
        await emulator.as("signer1", async () => {
          await emulator.as("signer2", async () => {
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                {
                  index: 11,
                  txId: TransactionId(
                    "b451d1433cd54772f42dff46fecc76ba6d1c89202ffe10309fda5bb3313fbd48",
                  ),
                },
                {
                  address: PaymentAddress(addr.toBech32()),
                  value: { coins: amount * 10n },
                },
              ]),
            );

            const techAuthForeverAddress = addressFromValidator(
              NetworkId.Testnet,
              techAuthForever.Script,
            );
            const techAuthTwoStageAddress = addressFromValidator(
              NetworkId.Testnet,
              techAuthTwoStage.Script,
            );
            const techAuthUpdateThresholdAddress = addressFromValidator(
              NetworkId.Testnet,
              mainTechAuthUpdateThreshold.Script,
            );
            const councilForeverAddress = addressFromValidator(
              NetworkId.Testnet,
              councilForever.Script,
            );

            // Tech auth state at logic_round = 1 (v2)
            const techAuthState = buildMultisigState(1n);
            // Council state at logic_round = 0 (unchanged)
            const councilState = buildMultisigState(0n);

            const upgradeState: Contracts.UpgradeState = [
              techAuthLogicV2.Script.hash(),
              "",
              techAuthForever.Script.hash(),
              "",
              0n,
              1n,
            ];

            // Tech auth forever UTxO (will be spent as input)
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("ee".repeat(32)) },
                {
                  address: PaymentAddress(techAuthForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(techAuthForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.VersionedMultisig,
                    techAuthState,
                  ).toCore(),
                },
              ]),
            );

            // Threshold UTxO (reference input)
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("c0".repeat(32)) },
                {
                  address: PaymentAddress(
                    techAuthUpdateThresholdAddress.toBech32(),
                  ),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(mainTechAuthUpdateThreshold.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.MultisigThreshold,
                    THRESHOLD,
                  ).toCore(),
                },
              ]),
            );

            // Council forever UTxO (reference input)
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("dd".repeat(32)) },
                {
                  address: PaymentAddress(councilForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(councilForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.VersionedMultisig,
                    councilState,
                  ).toCore(),
                },
              ]),
            );

            // Two-stage UTxO with "main" token (reference input)
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("c1".repeat(32)) },
                {
                  address: PaymentAddress(techAuthTwoStageAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [
                        AssetId(
                          techAuthTwoStage.Script.hash() + MAIN_TOKEN_HEX,
                        ),
                        1n,
                      ],
                    ]),
                  },
                  datum: serialize(
                    Contracts.UpgradeState,
                    upgradeState,
                  ).toCore(),
                },
              ]),
            );

            const logicRewardAccount = RewardAccount.fromCredential(
              Credential.fromCore({
                hash: techAuthLogicV2.Script.hash(),
                type: CredentialType.ScriptHash,
              }).toCore(),
              NetworkId.Testnet,
            );
            emulator.accounts.set(logicRewardAccount, { balance: 0n });

            const newStateCbor = createMultisigStateCbor(SIGNERS, 1n);
            const innerRedeemerCbor = createRedeemerMapCbor(SIGNERS);
            const wrappedRedeemer = wrapLogicRedeemerNormal(innerRedeemerCbor);

            const nativeScript = buildNativeScriptFromSigners();
            const nativeScriptPolicyId = PolicyId(nativeScript.hash());

            const txBuilder = blaze
              .newTransaction()
              .addInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("ee".repeat(32)) },
                  {
                    address: PaymentAddress(techAuthForeverAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [AssetId(techAuthForever.Script.hash()), 1n],
                      ]),
                    },
                    datum: serialize(
                      Contracts.VersionedMultisig,
                      techAuthState,
                    ).toCore(),
                  },
                ]),
                PlutusData.newInteger(0n),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("c0".repeat(32)) },
                  {
                    address: PaymentAddress(
                      techAuthUpdateThresholdAddress.toBech32(),
                    ),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [
                          AssetId(mainTechAuthUpdateThreshold.Script.hash()),
                          1n,
                        ],
                      ]),
                    },
                    datum: serialize(
                      Contracts.MultisigThreshold,
                      THRESHOLD,
                    ).toCore(),
                  },
                ]),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("dd".repeat(32)) },
                  {
                    address: PaymentAddress(councilForeverAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [AssetId(councilForever.Script.hash()), 1n],
                      ]),
                    },
                    datum: serialize(
                      Contracts.VersionedMultisig,
                      councilState,
                    ).toCore(),
                  },
                ]),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("c1".repeat(32)) },
                  {
                    address: PaymentAddress(techAuthTwoStageAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [
                          AssetId(
                            techAuthTwoStage.Script.hash() + MAIN_TOKEN_HEX,
                          ),
                          1n,
                        ],
                      ]),
                    },
                    datum: serialize(
                      Contracts.UpgradeState,
                      upgradeState,
                    ).toCore(),
                  },
                ]),
              )
              .provideScript(techAuthForever.Script)
              .addMint(nativeScriptPolicyId, new Map([[AssetName(""), 1n]]))
              .provideScript(Script.newNativeScript(nativeScript))
              .addOutput(
                TransactionOutput.fromCore({
                  address: PaymentAddress(techAuthForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(techAuthForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: newStateCbor.toCore(),
                }),
              )
              .addWithdrawal(logicRewardAccount, 0n, wrappedRedeemer)
              .provideScript(techAuthLogicV2.Script);

            await emulator.expectValidTransaction(blaze, txBuilder);
          });
        });
      });
    });

    test("bare redeemer fails with v2 logic", async () => {
      const emulator = new Emulator([]);
      const amount = 100_000_000n;

      await emulator.as("deployer", async (blaze, addr) => {
        await emulator.as("signer1", async () => {
          await emulator.as("signer2", async () => {
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                {
                  index: 11,
                  txId: TransactionId(
                    "b451d1433cd54772f42dff46fecc76ba6d1c89202ffe10309fda5bb3313fbd48",
                  ),
                },
                {
                  address: PaymentAddress(addr.toBech32()),
                  value: { coins: amount * 10n },
                },
              ]),
            );

            const techAuthForeverAddress = addressFromValidator(
              NetworkId.Testnet,
              techAuthForever.Script,
            );
            const techAuthTwoStageAddress = addressFromValidator(
              NetworkId.Testnet,
              techAuthTwoStage.Script,
            );
            const techAuthUpdateThresholdAddress = addressFromValidator(
              NetworkId.Testnet,
              mainTechAuthUpdateThreshold.Script,
            );
            const councilForeverAddress = addressFromValidator(
              NetworkId.Testnet,
              councilForever.Script,
            );

            const techAuthState = buildMultisigState(1n);
            const councilState = buildMultisigState(0n);

            const upgradeState: Contracts.UpgradeState = [
              techAuthLogicV2.Script.hash(),
              "",
              techAuthForever.Script.hash(),
              "",
              0n,
              1n,
            ];

            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("ee".repeat(32)) },
                {
                  address: PaymentAddress(techAuthForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(techAuthForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.VersionedMultisig,
                    techAuthState,
                  ).toCore(),
                },
              ]),
            );

            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("c0".repeat(32)) },
                {
                  address: PaymentAddress(
                    techAuthUpdateThresholdAddress.toBech32(),
                  ),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(mainTechAuthUpdateThreshold.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.MultisigThreshold,
                    THRESHOLD,
                  ).toCore(),
                },
              ]),
            );

            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("dd".repeat(32)) },
                {
                  address: PaymentAddress(councilForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(councilForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.VersionedMultisig,
                    councilState,
                  ).toCore(),
                },
              ]),
            );

            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("c1".repeat(32)) },
                {
                  address: PaymentAddress(techAuthTwoStageAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [
                        AssetId(
                          techAuthTwoStage.Script.hash() + MAIN_TOKEN_HEX,
                        ),
                        1n,
                      ],
                    ]),
                  },
                  datum: serialize(
                    Contracts.UpgradeState,
                    upgradeState,
                  ).toCore(),
                },
              ]),
            );

            const logicRewardAccount = RewardAccount.fromCredential(
              Credential.fromCore({
                hash: techAuthLogicV2.Script.hash(),
                type: CredentialType.ScriptHash,
              }).toCore(),
              NetworkId.Testnet,
            );
            emulator.accounts.set(logicRewardAccount, { balance: 0n });

            const newStateCbor = createMultisigStateCbor(SIGNERS, 1n);
            const bareRedeemer = createRedeemerMapCbor(SIGNERS);

            const nativeScript = buildNativeScriptFromSigners();
            const nativeScriptPolicyId = PolicyId(nativeScript.hash());

            const txBuilder = blaze
              .newTransaction()
              .addInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("ee".repeat(32)) },
                  {
                    address: PaymentAddress(techAuthForeverAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [AssetId(techAuthForever.Script.hash()), 1n],
                      ]),
                    },
                    datum: serialize(
                      Contracts.VersionedMultisig,
                      techAuthState,
                    ).toCore(),
                  },
                ]),
                PlutusData.newInteger(0n),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("c0".repeat(32)) },
                  {
                    address: PaymentAddress(
                      techAuthUpdateThresholdAddress.toBech32(),
                    ),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [
                          AssetId(mainTechAuthUpdateThreshold.Script.hash()),
                          1n,
                        ],
                      ]),
                    },
                    datum: serialize(
                      Contracts.MultisigThreshold,
                      THRESHOLD,
                    ).toCore(),
                  },
                ]),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("dd".repeat(32)) },
                  {
                    address: PaymentAddress(councilForeverAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [AssetId(councilForever.Script.hash()), 1n],
                      ]),
                    },
                    datum: serialize(
                      Contracts.VersionedMultisig,
                      councilState,
                    ).toCore(),
                  },
                ]),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("c1".repeat(32)) },
                  {
                    address: PaymentAddress(techAuthTwoStageAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [
                          AssetId(
                            techAuthTwoStage.Script.hash() + MAIN_TOKEN_HEX,
                          ),
                          1n,
                        ],
                      ]),
                    },
                    datum: serialize(
                      Contracts.UpgradeState,
                      upgradeState,
                    ).toCore(),
                  },
                ]),
              )
              .provideScript(techAuthForever.Script)
              .addMint(nativeScriptPolicyId, new Map([[AssetName(""), 1n]]))
              .provideScript(Script.newNativeScript(nativeScript))
              .addOutput(
                TransactionOutput.fromCore({
                  address: PaymentAddress(techAuthForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(techAuthForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: newStateCbor.toCore(),
                }),
              )
              .addWithdrawal(logicRewardAccount, 0n, bareRedeemer)
              .provideScript(techAuthLogicV2.Script);

            await expect(
              emulator.expectValidTransaction(blaze, txBuilder),
            ).rejects.toThrow();
          });
        });
      });
    });
  });

  // ================================================================
  // change-federated-ops with v2 logic
  // ================================================================
  describe("change-federated-ops", () => {
    const federatedOpsForever =
      new Contracts.PermissionedFederatedOpsForeverElse();
    const federatedOpsLogicV2 =
      new Contracts.PermissionedV2FederatedOpsLogicV2Else();
    const federatedOpsTwoStage =
      new Contracts.PermissionedFederatedOpsTwoStageUpgradeElse();
    const mainFederatedOpsUpdateThreshold =
      new Contracts.ThresholdsMainFederatedOpsUpdateThresholdElse();
    const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();
    const councilForever = new Contracts.PermissionedCouncilForeverElse();

    /** Build a v2 FederatedOps datum as a raw PlutusData list:
     *  [data (Unit), message (empty bytes), appendix (list), logic_round (2)] */
    function buildFederatedOpsV2Datum(): PlutusData {
      const list = new PlutusList();
      // data: Unit = Constr(0, [])
      list.add(
        PlutusData.fromCore({
          constructor: 0n,
          fields: { items: [] },
        }),
      );
      // message: empty ByteString
      list.add(PlutusData.newBytes(new Uint8Array()));
      // appendix: empty list
      list.add(PlutusData.newList(new PlutusList()));
      // logic_round: 2
      list.add(PlutusData.newInteger(2n));
      return PlutusData.newList(list);
    }

    test("wrapped redeemer succeeds with v2 logic", async () => {
      const emulator = new Emulator([]);
      const amount = 100_000_000n;

      await emulator.as("deployer", async (blaze, addr) => {
        await emulator.as("signer1", async () => {
          await emulator.as("signer2", async () => {
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                {
                  index: 11,
                  txId: TransactionId(
                    "b451d1433cd54772f42dff46fecc76ba6d1c89202ffe10309fda5bb3313fbd48",
                  ),
                },
                {
                  address: PaymentAddress(addr.toBech32()),
                  value: { coins: amount * 10n },
                },
              ]),
            );

            const federatedOpsForeverAddress = addressFromValidator(
              NetworkId.Testnet,
              federatedOpsForever.Script,
            );
            const federatedOpsTwoStageAddress = addressFromValidator(
              NetworkId.Testnet,
              federatedOpsTwoStage.Script,
            );
            const fedOpsThresholdAddress = addressFromValidator(
              NetworkId.Testnet,
              mainFederatedOpsUpdateThreshold.Script,
            );
            const techAuthForeverAddress = addressFromValidator(
              NetworkId.Testnet,
              techAuthForever.Script,
            );
            const councilForeverAddress = addressFromValidator(
              NetworkId.Testnet,
              councilForever.Script,
            );

            // Council and tech-auth multisig states (logic_round = 0)
            const councilState = buildMultisigState(0n);
            const techAuthState = buildMultisigState(0n);

            const thresholdDatum: Contracts.MultisigThreshold = THRESHOLD;

            const upgradeState: Contracts.UpgradeState = [
              federatedOpsLogicV2.Script.hash(),
              "",
              federatedOpsForever.Script.hash(),
              "",
              0n,
              1n,
            ];

            // FederatedOps v2 datum
            const v2Datum = buildFederatedOpsV2Datum();

            // Federated ops forever UTxO (will be spent as input)
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("f1".repeat(32)) },
                {
                  address: PaymentAddress(
                    federatedOpsForeverAddress.toBech32(),
                  ),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(federatedOpsForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: v2Datum.toCore(),
                },
              ]),
            );

            // Threshold UTxO (reference input)
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("f2".repeat(32)) },
                {
                  address: PaymentAddress(fedOpsThresholdAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [
                        AssetId(mainFederatedOpsUpdateThreshold.Script.hash()),
                        1n,
                      ],
                    ]),
                  },
                  datum: serialize(
                    Contracts.MultisigThreshold,
                    thresholdDatum,
                  ).toCore(),
                },
              ]),
            );

            // Tech auth forever UTxO (reference input)
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("f3".repeat(32)) },
                {
                  address: PaymentAddress(techAuthForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(techAuthForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.VersionedMultisig,
                    techAuthState,
                  ).toCore(),
                },
              ]),
            );

            // Council forever UTxO (reference input)
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("f4".repeat(32)) },
                {
                  address: PaymentAddress(councilForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(councilForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.VersionedMultisig,
                    councilState,
                  ).toCore(),
                },
              ]),
            );

            // Two-stage UTxO with "main" token (reference input)
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("f5".repeat(32)) },
                {
                  address: PaymentAddress(
                    federatedOpsTwoStageAddress.toBech32(),
                  ),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [
                        AssetId(
                          federatedOpsTwoStage.Script.hash() + MAIN_TOKEN_HEX,
                        ),
                        1n,
                      ],
                    ]),
                  },
                  datum: serialize(
                    Contracts.UpgradeState,
                    upgradeState,
                  ).toCore(),
                },
              ]),
            );

            const logicRewardAccount = RewardAccount.fromCredential(
              Credential.fromCore({
                hash: federatedOpsLogicV2.Script.hash(),
                type: CredentialType.ScriptHash,
              }).toCore(),
              NetworkId.Testnet,
            );
            emulator.accounts.set(logicRewardAccount, { balance: 0n });

            // For federated ops, redeemer is PlutusData.newInteger(0n) wrapped
            const innerRedeemer = PlutusData.newInteger(0n);
            const wrappedRedeemer = wrapLogicRedeemerNormal(innerRedeemer);

            const nativeScript = buildNativeScriptFromSigners();
            const nativeScriptPolicyId = PolicyId(nativeScript.hash());

            // Output: same v2 datum at forever address
            const outputV2Datum = buildFederatedOpsV2Datum();

            const txBuilder = blaze
              .newTransaction()
              .addInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("f1".repeat(32)) },
                  {
                    address: PaymentAddress(
                      federatedOpsForeverAddress.toBech32(),
                    ),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [AssetId(federatedOpsForever.Script.hash()), 1n],
                      ]),
                    },
                    datum: v2Datum.toCore(),
                  },
                ]),
                PlutusData.newInteger(0n),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("f2".repeat(32)) },
                  {
                    address: PaymentAddress(fedOpsThresholdAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [
                          AssetId(
                            mainFederatedOpsUpdateThreshold.Script.hash(),
                          ),
                          1n,
                        ],
                      ]),
                    },
                    datum: serialize(
                      Contracts.MultisigThreshold,
                      thresholdDatum,
                    ).toCore(),
                  },
                ]),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("f3".repeat(32)) },
                  {
                    address: PaymentAddress(techAuthForeverAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [AssetId(techAuthForever.Script.hash()), 1n],
                      ]),
                    },
                    datum: serialize(
                      Contracts.VersionedMultisig,
                      techAuthState,
                    ).toCore(),
                  },
                ]),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("f4".repeat(32)) },
                  {
                    address: PaymentAddress(councilForeverAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [AssetId(councilForever.Script.hash()), 1n],
                      ]),
                    },
                    datum: serialize(
                      Contracts.VersionedMultisig,
                      councilState,
                    ).toCore(),
                  },
                ]),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("f5".repeat(32)) },
                  {
                    address: PaymentAddress(
                      federatedOpsTwoStageAddress.toBech32(),
                    ),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [
                          AssetId(
                            federatedOpsTwoStage.Script.hash() + MAIN_TOKEN_HEX,
                          ),
                          1n,
                        ],
                      ]),
                    },
                    datum: serialize(
                      Contracts.UpgradeState,
                      upgradeState,
                    ).toCore(),
                  },
                ]),
              )
              .provideScript(federatedOpsForever.Script)
              .addMint(nativeScriptPolicyId, new Map([[AssetName(""), 1n]]))
              .provideScript(Script.newNativeScript(nativeScript))
              .addOutput(
                TransactionOutput.fromCore({
                  address: PaymentAddress(
                    federatedOpsForeverAddress.toBech32(),
                  ),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(federatedOpsForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: outputV2Datum.toCore(),
                }),
              )
              .addWithdrawal(logicRewardAccount, 0n, wrappedRedeemer)
              .provideScript(federatedOpsLogicV2.Script);

            await emulator.expectValidTransaction(blaze, txBuilder);
          });
        });
      });
    });

    test("bare redeemer fails with v2 logic", async () => {
      const emulator = new Emulator([]);
      const amount = 100_000_000n;

      await emulator.as("deployer", async (blaze, addr) => {
        await emulator.as("signer1", async () => {
          await emulator.as("signer2", async () => {
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                {
                  index: 11,
                  txId: TransactionId(
                    "b451d1433cd54772f42dff46fecc76ba6d1c89202ffe10309fda5bb3313fbd48",
                  ),
                },
                {
                  address: PaymentAddress(addr.toBech32()),
                  value: { coins: amount * 10n },
                },
              ]),
            );

            const federatedOpsForeverAddress = addressFromValidator(
              NetworkId.Testnet,
              federatedOpsForever.Script,
            );
            const federatedOpsTwoStageAddress = addressFromValidator(
              NetworkId.Testnet,
              federatedOpsTwoStage.Script,
            );
            const fedOpsThresholdAddress = addressFromValidator(
              NetworkId.Testnet,
              mainFederatedOpsUpdateThreshold.Script,
            );
            const techAuthForeverAddress = addressFromValidator(
              NetworkId.Testnet,
              techAuthForever.Script,
            );
            const councilForeverAddress = addressFromValidator(
              NetworkId.Testnet,
              councilForever.Script,
            );

            const councilState = buildMultisigState(0n);
            const techAuthState = buildMultisigState(0n);

            const upgradeState: Contracts.UpgradeState = [
              federatedOpsLogicV2.Script.hash(),
              "",
              federatedOpsForever.Script.hash(),
              "",
              0n,
              1n,
            ];

            const v2Datum = buildFederatedOpsV2Datum();

            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("f1".repeat(32)) },
                {
                  address: PaymentAddress(
                    federatedOpsForeverAddress.toBech32(),
                  ),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(federatedOpsForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: v2Datum.toCore(),
                },
              ]),
            );

            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("f2".repeat(32)) },
                {
                  address: PaymentAddress(fedOpsThresholdAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [
                        AssetId(mainFederatedOpsUpdateThreshold.Script.hash()),
                        1n,
                      ],
                    ]),
                  },
                  datum: serialize(
                    Contracts.MultisigThreshold,
                    THRESHOLD,
                  ).toCore(),
                },
              ]),
            );

            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("f3".repeat(32)) },
                {
                  address: PaymentAddress(techAuthForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(techAuthForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.VersionedMultisig,
                    techAuthState,
                  ).toCore(),
                },
              ]),
            );

            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("f4".repeat(32)) },
                {
                  address: PaymentAddress(councilForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(councilForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.VersionedMultisig,
                    councilState,
                  ).toCore(),
                },
              ]),
            );

            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("f5".repeat(32)) },
                {
                  address: PaymentAddress(
                    federatedOpsTwoStageAddress.toBech32(),
                  ),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [
                        AssetId(
                          federatedOpsTwoStage.Script.hash() + MAIN_TOKEN_HEX,
                        ),
                        1n,
                      ],
                    ]),
                  },
                  datum: serialize(
                    Contracts.UpgradeState,
                    upgradeState,
                  ).toCore(),
                },
              ]),
            );

            const logicRewardAccount = RewardAccount.fromCredential(
              Credential.fromCore({
                hash: federatedOpsLogicV2.Script.hash(),
                type: CredentialType.ScriptHash,
              }).toCore(),
              NetworkId.Testnet,
            );
            emulator.accounts.set(logicRewardAccount, { balance: 0n });

            // Bare redeemer — NOT wrapped in LogicRedeemer::Normal
            const bareRedeemer = PlutusData.newInteger(0n);

            const nativeScript = buildNativeScriptFromSigners();
            const nativeScriptPolicyId = PolicyId(nativeScript.hash());

            const outputV2Datum = buildFederatedOpsV2Datum();

            const txBuilder = blaze
              .newTransaction()
              .addInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("f1".repeat(32)) },
                  {
                    address: PaymentAddress(
                      federatedOpsForeverAddress.toBech32(),
                    ),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [AssetId(federatedOpsForever.Script.hash()), 1n],
                      ]),
                    },
                    datum: v2Datum.toCore(),
                  },
                ]),
                PlutusData.newInteger(0n),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("f2".repeat(32)) },
                  {
                    address: PaymentAddress(fedOpsThresholdAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [
                          AssetId(
                            mainFederatedOpsUpdateThreshold.Script.hash(),
                          ),
                          1n,
                        ],
                      ]),
                    },
                    datum: serialize(
                      Contracts.MultisigThreshold,
                      THRESHOLD,
                    ).toCore(),
                  },
                ]),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("f3".repeat(32)) },
                  {
                    address: PaymentAddress(techAuthForeverAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [AssetId(techAuthForever.Script.hash()), 1n],
                      ]),
                    },
                    datum: serialize(
                      Contracts.VersionedMultisig,
                      techAuthState,
                    ).toCore(),
                  },
                ]),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("f4".repeat(32)) },
                  {
                    address: PaymentAddress(councilForeverAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [AssetId(councilForever.Script.hash()), 1n],
                      ]),
                    },
                    datum: serialize(
                      Contracts.VersionedMultisig,
                      councilState,
                    ).toCore(),
                  },
                ]),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("f5".repeat(32)) },
                  {
                    address: PaymentAddress(
                      federatedOpsTwoStageAddress.toBech32(),
                    ),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [
                          AssetId(
                            federatedOpsTwoStage.Script.hash() + MAIN_TOKEN_HEX,
                          ),
                          1n,
                        ],
                      ]),
                    },
                    datum: serialize(
                      Contracts.UpgradeState,
                      upgradeState,
                    ).toCore(),
                  },
                ]),
              )
              .provideScript(federatedOpsForever.Script)
              .addMint(nativeScriptPolicyId, new Map([[AssetName(""), 1n]]))
              .provideScript(Script.newNativeScript(nativeScript))
              .addOutput(
                TransactionOutput.fromCore({
                  address: PaymentAddress(
                    federatedOpsForeverAddress.toBech32(),
                  ),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(federatedOpsForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: outputV2Datum.toCore(),
                }),
              )
              .addWithdrawal(logicRewardAccount, 0n, bareRedeemer)
              .provideScript(federatedOpsLogicV2.Script);

            await expect(
              emulator.expectValidTransaction(blaze, txBuilder),
            ).rejects.toThrow();
          });
        });
      });
    });
  });

  // ================================================================
  // change-terms with v2 logic
  // ================================================================
  describe("change-terms", () => {
    const termsForever =
      new Contracts.TermsAndConditionsTermsAndConditionsForeverElse();
    const termsLogicV2 =
      new Contracts.TermsAndConditionsV2TermsAndConditionsLogicV2Else();
    const termsTwoStage =
      new Contracts.TermsAndConditionsTermsAndConditionsTwoStageUpgradeElse();
    const termsThreshold =
      new Contracts.ThresholdsTermsAndConditionsThresholdElse();
    const techAuthForever = new Contracts.PermissionedTechAuthForeverElse();
    const councilForever = new Contracts.PermissionedCouncilForeverElse();

    test("wrapped redeemer succeeds with v2 logic", async () => {
      const emulator = new Emulator([]);
      const amount = 100_000_000n;

      await emulator.as("deployer", async (blaze, addr) => {
        await emulator.as("signer1", async () => {
          await emulator.as("signer2", async () => {
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                {
                  index: 11,
                  txId: TransactionId(
                    "b451d1433cd54772f42dff46fecc76ba6d1c89202ffe10309fda5bb3313fbd48",
                  ),
                },
                {
                  address: PaymentAddress(addr.toBech32()),
                  value: { coins: amount * 10n },
                },
              ]),
            );

            const termsForeverAddress = addressFromValidator(
              NetworkId.Testnet,
              termsForever.Script,
            );
            const termsTwoStageAddress = addressFromValidator(
              NetworkId.Testnet,
              termsTwoStage.Script,
            );
            const termsThresholdAddress = addressFromValidator(
              NetworkId.Testnet,
              termsThreshold.Script,
            );
            const techAuthForeverAddress = addressFromValidator(
              NetworkId.Testnet,
              techAuthForever.Script,
            );
            const councilForeverAddress = addressFromValidator(
              NetworkId.Testnet,
              councilForever.Script,
            );

            // v2 terms datum: logic_round = 1
            const initialTerms: Contracts.VersionedTermsAndConditions = [
              [
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "68747470733a2f2f6578616d706c652e636f6d",
              ],
              1n,
            ];

            const newTerms: Contracts.VersionedTermsAndConditions = [
              [
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "68747470733a2f2f6e65772e636f6d",
              ],
              1n,
            ];

            // Council and tech-auth states (both reference inputs)
            const councilState = buildMultisigState(0n);
            const techAuthState = buildMultisigState(0n);

            const upgradeState: Contracts.UpgradeState = [
              termsLogicV2.Script.hash(),
              "",
              termsForever.Script.hash(),
              "",
              0n,
              1n,
            ];

            // Terms forever UTxO (will be spent as input)
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("d1".repeat(32)) },
                {
                  address: PaymentAddress(termsForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(termsForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.VersionedTermsAndConditions,
                    initialTerms,
                  ).toCore(),
                },
              ]),
            );

            // Threshold UTxO (reference input)
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("d2".repeat(32)) },
                {
                  address: PaymentAddress(termsThresholdAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(termsThreshold.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.MultisigThreshold,
                    THRESHOLD,
                  ).toCore(),
                },
              ]),
            );

            // Tech auth forever UTxO (reference input)
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("d3".repeat(32)) },
                {
                  address: PaymentAddress(techAuthForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(techAuthForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.VersionedMultisig,
                    techAuthState,
                  ).toCore(),
                },
              ]),
            );

            // Council forever UTxO (reference input)
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("d4".repeat(32)) },
                {
                  address: PaymentAddress(councilForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(councilForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.VersionedMultisig,
                    councilState,
                  ).toCore(),
                },
              ]),
            );

            // Two-stage UTxO with "main" token (reference input)
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("d5".repeat(32)) },
                {
                  address: PaymentAddress(termsTwoStageAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [
                        AssetId(termsTwoStage.Script.hash() + MAIN_TOKEN_HEX),
                        1n,
                      ],
                    ]),
                  },
                  datum: serialize(
                    Contracts.UpgradeState,
                    upgradeState,
                  ).toCore(),
                },
              ]),
            );

            const logicRewardAccount = RewardAccount.fromCredential(
              Credential.fromCore({
                hash: termsLogicV2.Script.hash(),
                type: CredentialType.ScriptHash,
              }).toCore(),
              NetworkId.Testnet,
            );
            emulator.accounts.set(logicRewardAccount, { balance: 0n });

            // Terms redeemer: PlutusData.newInteger(0n) wrapped in LogicRedeemer::Normal
            const innerRedeemer = PlutusData.newInteger(0n);
            const wrappedRedeemer = wrapLogicRedeemerNormal(innerRedeemer);

            const nativeScript = buildNativeScriptFromSigners();
            const nativeScriptPolicyId = PolicyId(nativeScript.hash());

            const txBuilder = blaze
              .newTransaction()
              .addInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("d1".repeat(32)) },
                  {
                    address: PaymentAddress(termsForeverAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [AssetId(termsForever.Script.hash()), 1n],
                      ]),
                    },
                    datum: serialize(
                      Contracts.VersionedTermsAndConditions,
                      initialTerms,
                    ).toCore(),
                  },
                ]),
                PlutusData.newInteger(0n),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("d2".repeat(32)) },
                  {
                    address: PaymentAddress(termsThresholdAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [AssetId(termsThreshold.Script.hash()), 1n],
                      ]),
                    },
                    datum: serialize(
                      Contracts.MultisigThreshold,
                      THRESHOLD,
                    ).toCore(),
                  },
                ]),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("d3".repeat(32)) },
                  {
                    address: PaymentAddress(techAuthForeverAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [AssetId(techAuthForever.Script.hash()), 1n],
                      ]),
                    },
                    datum: serialize(
                      Contracts.VersionedMultisig,
                      techAuthState,
                    ).toCore(),
                  },
                ]),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("d4".repeat(32)) },
                  {
                    address: PaymentAddress(councilForeverAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [AssetId(councilForever.Script.hash()), 1n],
                      ]),
                    },
                    datum: serialize(
                      Contracts.VersionedMultisig,
                      councilState,
                    ).toCore(),
                  },
                ]),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("d5".repeat(32)) },
                  {
                    address: PaymentAddress(termsTwoStageAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [
                          AssetId(termsTwoStage.Script.hash() + MAIN_TOKEN_HEX),
                          1n,
                        ],
                      ]),
                    },
                    datum: serialize(
                      Contracts.UpgradeState,
                      upgradeState,
                    ).toCore(),
                  },
                ]),
              )
              .provideScript(termsForever.Script)
              .addMint(nativeScriptPolicyId, new Map([[AssetName(""), 1n]]))
              .provideScript(Script.newNativeScript(nativeScript))
              .addOutput(
                TransactionOutput.fromCore({
                  address: PaymentAddress(termsForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(termsForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.VersionedTermsAndConditions,
                    newTerms,
                  ).toCore(),
                }),
              )
              .addWithdrawal(logicRewardAccount, 0n, wrappedRedeemer)
              .provideScript(termsLogicV2.Script);

            await emulator.expectValidTransaction(blaze, txBuilder);
          });
        });
      });
    });

    test("bare redeemer fails with v2 logic", async () => {
      const emulator = new Emulator([]);
      const amount = 100_000_000n;

      await emulator.as("deployer", async (blaze, addr) => {
        await emulator.as("signer1", async () => {
          await emulator.as("signer2", async () => {
            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                {
                  index: 11,
                  txId: TransactionId(
                    "b451d1433cd54772f42dff46fecc76ba6d1c89202ffe10309fda5bb3313fbd48",
                  ),
                },
                {
                  address: PaymentAddress(addr.toBech32()),
                  value: { coins: amount * 10n },
                },
              ]),
            );

            const termsForeverAddress = addressFromValidator(
              NetworkId.Testnet,
              termsForever.Script,
            );
            const termsTwoStageAddress = addressFromValidator(
              NetworkId.Testnet,
              termsTwoStage.Script,
            );
            const termsThresholdAddress = addressFromValidator(
              NetworkId.Testnet,
              termsThreshold.Script,
            );
            const techAuthForeverAddress = addressFromValidator(
              NetworkId.Testnet,
              techAuthForever.Script,
            );
            const councilForeverAddress = addressFromValidator(
              NetworkId.Testnet,
              councilForever.Script,
            );

            const initialTerms: Contracts.VersionedTermsAndConditions = [
              [
                "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "68747470733a2f2f6578616d706c652e636f6d",
              ],
              1n,
            ];

            const newTerms: Contracts.VersionedTermsAndConditions = [
              [
                "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "68747470733a2f2f6e65772e636f6d",
              ],
              1n,
            ];

            const councilState = buildMultisigState(0n);
            const techAuthState = buildMultisigState(0n);

            const upgradeState: Contracts.UpgradeState = [
              termsLogicV2.Script.hash(),
              "",
              termsForever.Script.hash(),
              "",
              0n,
              1n,
            ];

            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("d1".repeat(32)) },
                {
                  address: PaymentAddress(termsForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(termsForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.VersionedTermsAndConditions,
                    initialTerms,
                  ).toCore(),
                },
              ]),
            );

            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("d2".repeat(32)) },
                {
                  address: PaymentAddress(termsThresholdAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(termsThreshold.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.MultisigThreshold,
                    THRESHOLD,
                  ).toCore(),
                },
              ]),
            );

            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("d3".repeat(32)) },
                {
                  address: PaymentAddress(techAuthForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(techAuthForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.VersionedMultisig,
                    techAuthState,
                  ).toCore(),
                },
              ]),
            );

            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("d4".repeat(32)) },
                {
                  address: PaymentAddress(councilForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(councilForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.VersionedMultisig,
                    councilState,
                  ).toCore(),
                },
              ]),
            );

            emulator.addUtxo(
              TransactionUnspentOutput.fromCore([
                { index: 0, txId: TransactionId("d5".repeat(32)) },
                {
                  address: PaymentAddress(termsTwoStageAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [
                        AssetId(termsTwoStage.Script.hash() + MAIN_TOKEN_HEX),
                        1n,
                      ],
                    ]),
                  },
                  datum: serialize(
                    Contracts.UpgradeState,
                    upgradeState,
                  ).toCore(),
                },
              ]),
            );

            const logicRewardAccount = RewardAccount.fromCredential(
              Credential.fromCore({
                hash: termsLogicV2.Script.hash(),
                type: CredentialType.ScriptHash,
              }).toCore(),
              NetworkId.Testnet,
            );
            emulator.accounts.set(logicRewardAccount, { balance: 0n });

            // Bare redeemer — NOT wrapped in LogicRedeemer::Normal
            const bareRedeemer = PlutusData.newInteger(0n);

            const nativeScript = buildNativeScriptFromSigners();
            const nativeScriptPolicyId = PolicyId(nativeScript.hash());

            const txBuilder = blaze
              .newTransaction()
              .addInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("d1".repeat(32)) },
                  {
                    address: PaymentAddress(termsForeverAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [AssetId(termsForever.Script.hash()), 1n],
                      ]),
                    },
                    datum: serialize(
                      Contracts.VersionedTermsAndConditions,
                      initialTerms,
                    ).toCore(),
                  },
                ]),
                PlutusData.newInteger(0n),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("d2".repeat(32)) },
                  {
                    address: PaymentAddress(termsThresholdAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [AssetId(termsThreshold.Script.hash()), 1n],
                      ]),
                    },
                    datum: serialize(
                      Contracts.MultisigThreshold,
                      THRESHOLD,
                    ).toCore(),
                  },
                ]),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("d3".repeat(32)) },
                  {
                    address: PaymentAddress(techAuthForeverAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [AssetId(techAuthForever.Script.hash()), 1n],
                      ]),
                    },
                    datum: serialize(
                      Contracts.VersionedMultisig,
                      techAuthState,
                    ).toCore(),
                  },
                ]),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("d4".repeat(32)) },
                  {
                    address: PaymentAddress(councilForeverAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [AssetId(councilForever.Script.hash()), 1n],
                      ]),
                    },
                    datum: serialize(
                      Contracts.VersionedMultisig,
                      councilState,
                    ).toCore(),
                  },
                ]),
              )
              .addReferenceInput(
                TransactionUnspentOutput.fromCore([
                  { index: 0, txId: TransactionId("d5".repeat(32)) },
                  {
                    address: PaymentAddress(termsTwoStageAddress.toBech32()),
                    value: {
                      coins: 2_000_000n,
                      assets: new Map([
                        [
                          AssetId(termsTwoStage.Script.hash() + MAIN_TOKEN_HEX),
                          1n,
                        ],
                      ]),
                    },
                    datum: serialize(
                      Contracts.UpgradeState,
                      upgradeState,
                    ).toCore(),
                  },
                ]),
              )
              .provideScript(termsForever.Script)
              .addMint(nativeScriptPolicyId, new Map([[AssetName(""), 1n]]))
              .provideScript(Script.newNativeScript(nativeScript))
              .addOutput(
                TransactionOutput.fromCore({
                  address: PaymentAddress(termsForeverAddress.toBech32()),
                  value: {
                    coins: 2_000_000n,
                    assets: new Map([
                      [AssetId(termsForever.Script.hash()), 1n],
                    ]),
                  },
                  datum: serialize(
                    Contracts.VersionedTermsAndConditions,
                    newTerms,
                  ).toCore(),
                }),
              )
              .addWithdrawal(logicRewardAccount, 0n, bareRedeemer)
              .provideScript(termsLogicV2.Script);

            await expect(
              emulator.expectValidTransaction(blaze, txBuilder),
            ).rejects.toThrow();
          });
        });
      });
    });
  });
});
