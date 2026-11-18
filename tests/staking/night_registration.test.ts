/**
 * Agreement between the compiled night_registration script and SREF's golden vectors
 * (tests/vectors/staking/night_registration.json): the transaction must pass exactly when the
 * vector expects accept.
 *
 * The compiled script holds its initialization UTxO and is named by its own hash, so the vectors'
 * script hash and initialization transaction id are renamed to the default profile's; the
 * evaluator runs the compiled script for that hash. Any other script the transaction names (a
 * script owner) runs an always-true script.
 */
import { readFileSync } from "node:fs";
import { parse } from "toml";
import {
  Cardano,
  Ed25519PublicKeyHex,
  Ed25519SignatureHex,
  Hash32ByteBase16,
  NetworkId,
  Transaction,
  TransactionId,
  addressFromCredential,
  Credential as LedgerCredential,
  CredentialType,
  Hash28ByteBase16,
} from "@blaze-cardano/core";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { action, conway, evaluate, flat, nodeDatum } from "./plutus";
import type { Node, RegistrationConstants, Result, Tx } from "./reference";

const ACTIONS = [
  "Init",
  "CreateTwoAnchors",
  "CreateOneAnchor",
  "Update",
  "Deactivate",
];

const vectors: {
  constants: RegistrationConstants;
  vectors: {
    name: string;
    redeemer: string | null;
    tx: Tx<Node>;
    expected: Result;
  }[];
} = JSON.parse(
  readFileSync(
    new URL("../vectors/staking/night_registration.json", import.meta.url),
    "utf8",
  ),
);
const blueprint = JSON.parse(
  readFileSync(new URL("../../plutus-default.json", import.meta.url), "utf8"),
);
const profile: {
  night_registration_hash: { bytes: string };
  night_registration_one_shot_hash: { bytes: string };
  night_registration_one_shot_index: number;
} = parse(readFileSync(new URL("../../aiken.toml", import.meta.url), "utf8"))
  .config.default;

const k = vectors.constants;
const nightRegistration = flat(
  blueprint,
  "night_registration.night_registration.else",
);
const alwaysTrue = flat(
  blueprint,
  "test_cnight_no_audit.tcnight_mint_infinite.else",
);
const own = profile.night_registration_hash.bytes;
/** The profile's hash for each hash the compiled script holds; any other hash stays. */
const rename = (hex: string) =>
  hex === k.script_hash
    ? own
    : hex === k.init_utxo.tx
      ? profile.night_registration_one_shot_hash.bytes
      : hex;
const script = (hash: string) =>
  hash === own ? nightRegistration : alwaysTrue;

describe("night_registration agrees with the golden vectors", () => {
  it("the default profile's initialization UTxO has the vectors' index", () => {
    expect(profile.night_registration_one_shot_index).toBe(k.init_utxo.index);
  });
  it("the default profile holds the compiled script's hash", () => {
    expect(
      blueprint.validators.find(
        (v: { title: string }) =>
          v.title === "night_registration.night_registration.else",
      ).hash,
    ).toBe(own);
  });
  it.live.each(vectors.vectors)("$name", (v) =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        evaluate(v.tx, nodeDatum, rename, script, action(ACTIONS, v.redeemer)),
      ).pipe(Effect.orElseSucceed(() => null));
      // A script that fails is a rejection; any other error is a fault of this harness.
      if (failure !== null)
        expect(failure).toContain("failed script execution");
      expect(failure === null ? "accept" : "reject").toBe(v.expected.result);
    }),
  );
});

/**
 * L4 budget: a Create writes three nodes into one transaction of at most 16,384 bytes (MIP #421
 * ab25a20d, the parameter table). The vector of three nodes at NODE_DATUM_MAX, which the script
 * accepts above, becomes the whole transaction a wallet submits: night_registration read from a
 * reference script, a collateral input with its return, a fee, a script data hash, and a key
 * witness for every key that signs, at the evaluator's ex-unit bounds.
 */
describe("L4 budget", () => {
  it("a CreateTwoAnchors of three nodes at NODE_DATUM_MAX fits in 16,384 bytes", () => {
    const v = vectors.vectors.find(
      (v) => v.name === "create two anchors: three nodes at NODE_DATUM_MAX",
    )!;
    expect(v.expected.result).toBe("accept");
    const { body, redeemers } = conway(
      v.tx,
      nodeDatum,
      rename,
      action(ACTIONS, v.redeemer),
    );
    const collateralKey = "0b".repeat(28);
    const signers = new Set([
      ...v.tx.extra_signatories,
      ...[
        ...v.tx.inputs.map((i) => i.output.address.payment),
        ...v.tx.certificates.map((c) => c.credential),
      ].flatMap((c) => ("VerificationKey" in c ? [c.VerificationKey] : [])),
      collateralKey,
    ]);
    const wallet = addressFromCredential(
      NetworkId.Testnet,
      LedgerCredential.fromCore({
        hash: Hash28ByteBase16(collateralKey),
        type: CredentialType.KeyHash,
      }),
    ).toBech32() as Cardano.PaymentAddress;
    const transaction = Transaction.fromCore({
      id: TransactionId("00".repeat(32)),
      body: {
        ...body,
        referenceInputs: [
          ...(body.referenceInputs ?? []),
          { txId: TransactionId("98".repeat(32)), index: 0 },
        ],
        collaterals: [{ txId: TransactionId("97".repeat(32)), index: 0 }],
        collateralReturn: { address: wallet, value: { coins: 4_000_000_000n } },
        totalCollateral: 5_000_000n,
        fee: 4_000_000n,
        scriptIntegrityHash: Hash32ByteBase16("00".repeat(32)),
      },
      witness: {
        signatures: new Map(
          [...signers].map((_, index) => [
            Ed25519PublicKeyHex((index + 1).toString(16).padStart(64, "0")),
            Ed25519SignatureHex("ff".repeat(64)),
          ]),
        ),
        redeemers,
      },
    });
    expect(transaction.toCbor().length / 2).toBeLessThanOrEqual(16_384);
  });
});
