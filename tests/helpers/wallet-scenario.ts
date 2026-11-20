/**
 * One chain state for the wallet commands, the same for this CLI and the
 * Effect 3 reference: fixed keys, a funded deployer, a test user holding
 * ADA and NIGHT, and a reserve forever with two cNIGHT UTxOs under its
 * two-stage main state. Only @blaze-cardano/core and Node's crypto, so the
 * reference can run the same file.
 */
import { createHash } from "crypto";
import {
  addressFromCredential,
  addressFromValidator,
  AssetId,
  blake2b_224,
  Credential,
  CredentialType,
  derivePublicKey,
  Ed25519PrivateNormalKeyHex,
  Hash28ByteBase16,
  HexBlob,
  NetworkId,
  PaymentAddress,
  PlutusData,
  RewardAccount,
  type Script,
  toHex,
  TransactionId,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";

/** 32 bytes of hex from a label: the reference tests' fixed seeds. */
export const seed = (label: string) =>
  createHash("blake2b512")
    .update(`midnight-reserve-contracts/tests/${label}`)
    .digest("hex")
    .slice(0, 64);

/** The enterprise testnet address of a private key. */
export const keyAddressOf = (privateKey: string) =>
  addressFromCredential(
    NetworkId.Testnet,
    Credential.fromCore({
      type: CredentialType.KeyHash,
      hash: Hash28ByteBase16(
        blake2b_224(
          HexBlob(derivePublicKey(Ed25519PrivateNormalKeyHex(privateKey))),
        ),
      ),
    }),
  );

export const DEPLOYER_KEY = seed("deployer");
export const USER_KEY = seed("user");

const hexOf = (text: string) => toHex(new TextEncoder().encode(text));

/** The forever datum of reserve and ICS: Constr 0 [0, 0]. */
const ZERO_FOREVER_DATUM = PlutusData.fromCore({
  constructor: 0n,
  fields: {
    items: [
      PlutusData.newInteger(0n).toCore(),
      PlutusData.newInteger(0n).toCore(),
    ],
  },
});

/** The chain state, from the scripts of the default build and its cNIGHT asset. */
export const walletScenario = (contracts: {
  readonly tcnight: Script;
  readonly reserveForever: Script;
  readonly reserveTwoStage: Script;
  readonly reserveLogic: Script;
  readonly govAuth: Script;
  /** The UpgradeState datum naming this logic and gov auth. */
  readonly upgradeState: (logic: string, auth: string) => PlutusData;
  readonly cnight: string;
}) => {
  const deployer = keyAddressOf(DEPLOYER_KEY);
  const user = keyAddressOf(USER_KEY);
  const night = contracts.tcnight.hash() + hexOf("NIGHT");
  const utxo = (
    txByte: string,
    index: number,
    address: ReturnType<typeof keyAddressOf>,
    coins: bigint,
    assets?: Record<string, bigint>,
    datum?: PlutusData,
  ) =>
    TransactionUnspentOutput.fromCore([
      { txId: TransactionId(txByte.repeat(32)), index },
      {
        address: PaymentAddress(address.toBech32()),
        value: {
          coins,
          assets:
            assets === undefined
              ? undefined
              : new Map(
                  Object.entries(assets).map(([id, n]) => [AssetId(id), n]),
                ),
        },
        datum: datum?.toCore(),
      },
    ]);
  const twoStage = addressFromValidator(
    NetworkId.Testnet,
    contracts.reserveTwoStage,
  );
  const forever = addressFromValidator(
    NetworkId.Testnet,
    contracts.reserveForever,
  );
  return {
    deployer,
    user,
    night: AssetId(night),
    utxos: {
      fee: utxo("f0", 0, deployer, 100_000_000n),
      deployerFunds: utxo("f1", 0, deployer, 50_000_000n),
      user: utxo("a0", 0, user, 20_000_000n),
      userNight: utxo("a1", 0, user, 5_000_000n, { [night]: 10n }),
      reserveMain: utxo(
        "b0",
        0,
        twoStage,
        5_000_000n,
        { [contracts.reserveTwoStage.hash() + hexOf("main")]: 1n },
        contracts.upgradeState(
          contracts.reserveLogic.hash(),
          contracts.govAuth.hash(),
        ),
      ),
      merge1: utxo(
        "c1",
        0,
        forever,
        5_000_000n,
        { [contracts.cnight]: 1n },
        ZERO_FOREVER_DATUM,
      ),
      merge2: utxo(
        "c2",
        1,
        forever,
        7_000_000n,
        { [contracts.cnight]: 2n },
        ZERO_FOREVER_DATUM,
      ),
    },
    logicAccount: RewardAccount.fromCredential(
      {
        type: CredentialType.ScriptHash,
        hash: Hash28ByteBase16(contracts.reserveLogic.hash()),
      },
      NetworkId.Testnet,
    ),
  };
};

/** A TxPlan's parts both CLIs share, as JSON: each SDK object by its core form, bigints as strings. */
export const planJson = (plan: {
  readonly spends: readonly {
    readonly utxo: TransactionUnspentOutput;
    readonly redeemer: { readonly _tag: string };
  }[];
  readonly references: readonly TransactionUnspentOutput[];
  readonly scripts: readonly Script[];
  readonly mints: readonly {
    readonly policy: Script;
    readonly assets: ReadonlyMap<string, bigint>;
    readonly redeemer: { readonly _tag: string };
  }[];
  readonly outputs: readonly { toCore(): unknown }[];
  readonly withdrawals: readonly {
    readonly rewardAccount: string;
    readonly script: Script;
    readonly redeemer: PlutusData;
  }[];
  readonly registrations: readonly Script[];
  readonly collateral: readonly TransactionUnspentOutput[];
}): string => {
  const data = (option: { readonly _tag: string }) =>
    "value" in option ? (option.value as PlutusData).toCbor() : null;
  return JSON.stringify(
    {
      spends: plan.spends.map((s) => ({
        utxo: s.utxo.toCore(),
        redeemer: data(s.redeemer),
      })),
      references: plan.references.map((u) => u.toCore()),
      scripts: plan.scripts.map((s) => s.hash()),
      mints: plan.mints.map((m) => ({
        policy: m.policy.hash(),
        assets: [...m.assets],
        redeemer: data(m.redeemer),
      })),
      outputs: plan.outputs.map((o) => o.toCore()),
      withdrawals: plan.withdrawals.map((w) => ({
        rewardAccount: w.rewardAccount,
        script: w.script.hash(),
        redeemer: w.redeemer.toCbor(),
      })),
      registrations: plan.registrations.map((s) => s.hash()),
      collateral: plan.collateral.map((u) => u.toCore()),
    },
    (_key, value: unknown) =>
      typeof value === "bigint"
        ? value.toString()
        : value instanceof Map
          ? [...value]
          : value,
    2,
  );
};
