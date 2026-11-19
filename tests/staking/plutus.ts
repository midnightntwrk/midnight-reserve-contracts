/**
 * Runs SREF's golden vectors (tests/vectors/staking) through the Plutus V3 evaluator: each vector
 * becomes a Conway transaction, and every script it names runs. The vectors name the contracts by
 * fixed hashes; `rename` maps each fixed hash (or transaction id) that a compiled script holds to
 * the profile's, and `script` gives the flat bytes the evaluator runs for a (renamed) script hash.
 * A slot is one POSIX millisecond from 0.
 */
import {
  Address,
  AssetId,
  Cardano,
  Costmdls,
  Credential as LedgerCredential,
  CredentialType,
  Ed25519KeyHashHex,
  Hash28ByteBase16,
  Hash32ByteBase16,
  HexBlob,
  NetworkId,
  PlutusV3Script,
  PoolId,
  Redeemers,
  RewardAccount,
  Transaction,
  TransactionBody,
  TransactionId,
  TransactionInput,
  TransactionOutput,
  TransactionWitnessSet,
  addressFromCredentials,
  fromHex,
  hardCodedProtocolParams,
} from "@blaze-cardano/core";
import { eval_phase_two_raw_with_override } from "@blaze-cardano/uplc/wasm";
import { Effect } from "effect";
import type {
  Credential,
  DelegationLock,
  Input,
  Node,
  Output,
  Tx,
} from "./reference";

/** Plutus data in the detailed JSON schema, as the vectors write `attributes` values. */
type DetailedData =
  | { int: string }
  | { bytes: string }
  | { list: DetailedData[] }
  | { map: { k: DetailedData; v: DetailedData }[] }
  | { constructor: string; fields: DetailedData[] };

/** The flat bytes the evaluator runs, out of a blueprint validator's CBOR. */
export const flat = (
  blueprint: { validators: { title: string; compiledCode: string }[] },
  title: string,
) =>
  fromHex(
    new PlutusV3Script(
      HexBlob(
        blueprint.validators.find((v) => v.title === title)!.compiledCode,
      ),
    ).rawBytes(),
  );

const data = (d: DetailedData): Cardano.PlutusData =>
  "int" in d
    ? BigInt(d.int)
    : "bytes" in d
      ? fromHex(d.bytes)
      : "list" in d
        ? { items: d.list.map(data) }
        : "map" in d
          ? { data: new Map(d.map.map((e) => [data(e.k), data(e.v)])) }
          : {
              constructor: BigInt(d.constructor),
              fields: { items: d.fields.map(data) },
            };
const credential = (c: Credential): Cardano.PlutusData => ({
  constructor: "VerificationKey" in c ? 0n : 1n,
  fields: {
    items: [fromHex("VerificationKey" in c ? c.VerificationKey : c.Script)],
  },
});
const pairs = (entries: [string, unknown][]): Cardano.PlutusData => ({
  data: new Map(
    entries.map(([name, value]) => [
      fromHex(name),
      // The vector file writes a key or signature as hex and an attribute value in the detailed schema.
      typeof value === "string" ? fromHex(value) : data(value as DetailedData),
    ]),
  ),
});
export const lockDatum = (d: DelegationLock): Cardano.PlutusData => ({
  constructor: 0n,
  fields: {
    items: [
      credential(d.owner),
      fromHex(d.pool_id),
      fromHex(d.reward_address),
      // return_address: an Address, its stake part None or Some(Inline(credential)).
      {
        constructor: 0n,
        fields: {
          items: [
            credential(d.return_address.payment),
            d.return_address.stake === null
              ? { constructor: 1n, fields: { items: [] } }
              : {
                  constructor: 0n,
                  fields: {
                    items: [
                      {
                        constructor: 0n,
                        fields: { items: [credential(d.return_address.stake)] },
                      },
                    ],
                  },
                },
          ],
        },
      },
      d.unbond_at === null
        ? { constructor: 1n, fields: { items: [] } }
        : { constructor: 0n, fields: { items: [BigInt(d.unbond_at)] } },
      pairs(d.attributes),
    ],
  },
});
/** A registration node: Tail 0, Reserved 1, Registration 2, in the order MIP #421 declares them. */
export const nodeDatum = (n: Node): Cardano.PlutusData => {
  if ("Tail" in n)
    return {
      constructor: 0n,
      fields: {
        items: [fromHex(n.Tail.prev_crch), fromHex(n.Tail.prev_pool)],
      },
    };
  if ("Reserved" in n)
    return {
      constructor: 1n,
      fields: {
        items: [fromHex(n.Reserved.crch), fromHex(n.Reserved.prev_crch)],
      },
    };
  const r = n.Registration;
  return {
    constructor: 2n,
    fields: {
      items: [
        { constructor: r.active ? 1n : 0n, fields: { items: [] } },
        fromHex(r.crch),
        fromHex(r.prev_crch),
        fromHex(r.pool_id),
        fromHex(r.prev_pool),
        credential(r.owner),
        fromHex(r.crch_signature),
        pairs(r.keys),
        pairs(r.signatures),
        fromHex(r.reward_address),
        BigInt(r.fixed_cost),
        pairs(r.attributes),
      ],
    },
  };
};

/**
 * The Conway transaction body and redeemers for a vector's transaction, the inputs and reference
 * inputs it spends or reads with their outputs, and the scripts it runs. `datum` encodes the datum
 * of the transaction's inputs and outputs; reference inputs hold nodes. `redeemer` is every
 * script's redeemer: the action the vector names. The body carries no fee, collateral or script
 * data hash, and the witness set no script and no key: the evaluator needs none of them.
 */
export const conway = <D>(
  tx: Tx<D>,
  datum: (d: D) => Cardano.PlutusData,
  rename: (hex: string) => string,
  redeemer: Cardano.PlutusData,
) => {
  const ledgerCredential = (c: Credential) =>
    "VerificationKey" in c
      ? {
          type: CredentialType.KeyHash,
          hash: Hash28ByteBase16(c.VerificationKey),
        }
      : {
          type: CredentialType.ScriptHash,
          hash: Hash28ByteBase16(rename(c.Script)),
        };
  const rewardAccount = (c: Credential) =>
    RewardAccount.fromCredential(ledgerCredential(c), NetworkId.Testnet);
  const assetId = (policy: string, name: string) =>
    AssetId(`${rename(policy)}${name}`);
  const output = <E>(o: Output<E>, encode: (d: E) => Cardano.PlutusData) => {
    const assets = new Map<AssetId, bigint>();
    for (const a of o.value.assets) {
      const id = assetId(a.policy, a.name);
      assets.set(id, (assets.get(id) ?? 0n) + BigInt(a.quantity));
    }
    // An output cannot hold an asset at quantity 0 (the ledger refuses to decode one), so a
    // vector's 0 means the asset is absent.
    for (const [id, quantity] of assets) if (quantity === 0n) assets.delete(id);
    return TransactionOutput.fromCore({
      address: addressFromCredentials(
        NetworkId.Testnet,
        LedgerCredential.fromCore(ledgerCredential(o.address.payment)),
        o.address.stake === null
          ? undefined
          : LedgerCredential.fromCore(ledgerCredential(o.address.stake)),
      ).toBech32() as Cardano.PaymentAddress,
      value: { coins: BigInt(o.value.lovelace), assets },
      datum: o.datum === null ? undefined : encode(o.datum),
      scriptReference:
        o.reference_script === undefined
          ? undefined
          : {
              __type: Cardano.ScriptType.Native,
              kind: Cardano.NativeScriptKind.RequireSignature,
              keyHash: Ed25519KeyHashHex(o.reference_script),
            },
    });
  };
  const input = <E>(i: Input<E>) =>
    new TransactionInput(TransactionId(rename(i.ref.tx)), BigInt(i.ref.index));

  // The ledger orders inputs by transaction id and index, policies by hash, and withdrawals by
  // reward account.
  const byRef = <E>(a: Input<E>, b: Input<E>) =>
    rename(a.ref.tx).localeCompare(rename(b.ref.tx)) ||
    a.ref.index - b.ref.index;
  const inputs = [...tx.inputs].sort(byRef);
  const references = [...tx.reference_inputs].sort(byRef);
  const withdrawals = [...tx.withdrawals].sort((a, b) =>
    Address.fromBech32(rewardAccount(a.credential))
      .toBytes()
      .localeCompare(Address.fromBech32(rewardAccount(b.credential)).toBytes()),
  );
  const policies = [...new Set(tx.mint.map((a) => rename(a.policy)))].sort();
  const mint = new Map<AssetId, bigint>();
  for (const a of tx.mint)
    mint.set(assetId(a.policy, a.name), BigInt(a.quantity));
  const deposit = BigInt(hardCodedProtocolParams.stakeKeyDeposit);
  // A pool id is a 28-byte key hash on the ledger; a certificate to a 27- or 29-byte pool cannot
  // exist, so the transaction carries no such certificate.
  const vectorCertificates = tx.certificates.filter(
    (c) => !("pool" in c) || c.pool === null || c.pool.length === 56,
  );
  const certificates = vectorCertificates.map((c): Cardano.Certificate => {
    const stakeCredential = ledgerCredential(c.credential);
    if (!("pool" in c))
      return {
        __typename:
          c.kind === "register"
            ? Cardano.CertificateType.Registration
            : Cardano.CertificateType.Unregistration,
        stakeCredential,
        deposit,
      };
    // The vectors delegate only to pools.
    const poolId = PoolId.fromKeyHash(Ed25519KeyHashHex(c.pool!));
    return c.kind === "delegate"
      ? {
          __typename: Cardano.CertificateType.StakeDelegation,
          stakeCredential,
          poolId,
        }
      : {
          __typename: Cardano.CertificateType.StakeRegistrationDelegation,
          stakeCredential,
          poolId,
          deposit,
        };
  });
  const body: Cardano.TxBody = {
    inputs: inputs.map((i) => input(i).toCore()),
    referenceInputs: references.map((i) => input(i).toCore()),
    outputs: tx.outputs.map((o) => output(o, datum).toCore()),
    fee: 0n,
    validityInterval: {
      invalidBefore:
        tx.validity.lower === null
          ? undefined
          : Cardano.Slot(Number(tx.validity.lower)),
      invalidHereafter:
        tx.validity.upper === null
          ? undefined
          : Cardano.Slot(Number(tx.validity.upper)),
    },
    withdrawals: withdrawals.map((w) => ({
      stakeAddress: rewardAccount(w.credential),
      quantity: BigInt(w.amount),
    })),
    certificates,
    mint: mint.size > 0 ? mint : undefined,
    // A signer is a 28-byte key hash on the ledger; a vector's 27- or 29-byte key cannot sign.
    requiredExtraSignatures: tx.extra_signatories
      .filter((s) => s.length === 56)
      .map(Ed25519KeyHashHex),
    votingProcedures:
      tx.voters.length === 0
        ? undefined
        : tx.voters.map((v) => ({
            voter: {
              __typename: Cardano.VoterType.dRepScriptHash,
              credential: {
                type: CredentialType.ScriptHash,
                hash: Hash28ByteBase16(
                  "Script" in v ? rename(v.Script) : v.VerificationKey,
                ),
              },
            },
            votes: [
              {
                actionId: {
                  id: TransactionId("ab".repeat(32)),
                  actionIndex: 0,
                },
                votingProcedure: { vote: Cardano.Vote.yes, anchor: null },
              },
            ],
          })),
    proposalProcedures:
      tx.guardrails.length === 0
        ? undefined
        : tx.guardrails.map((g) => ({
            deposit: 100_000_000_000n,
            rewardAccount: rewardAccount({ VerificationKey: "0a".repeat(28) }),
            governanceAction: {
              __typename: Cardano.GovernanceActionType.parameter_change_action,
              governanceActionId: null,
              protocolParamUpdate: { maxTxSize: 16384 },
              policyHash: Hash28ByteBase16(rename(g)),
            },
            anchor: {
              url: "https://example.com",
              dataHash: Hash32ByteBase16("00".repeat(32)),
            },
          })),
  };

  const redeemers: Cardano.Redeemer[] = [];
  const redeem = (purpose: Cardano.RedeemerPurpose, index: number) =>
    redeemers.push({
      purpose,
      index,
      data: redeemer,
      executionUnits: { memory: 14_000_000, steps: 10_000_000_000 },
    });
  inputs.forEach(
    (i, index) =>
      "Script" in i.output.address.payment &&
      redeem(Cardano.RedeemerPurpose.spend, index),
  );
  policies.forEach((_, index) => redeem(Cardano.RedeemerPurpose.mint, index));
  withdrawals.forEach(
    (w, index) =>
      "Script" in w.credential &&
      redeem(Cardano.RedeemerPurpose.withdrawal, index),
  );
  vectorCertificates.forEach(
    (c, index) =>
      "Script" in c.credential &&
      redeem(Cardano.RedeemerPurpose.certificate, index),
  );
  tx.voters.forEach((_, index) => redeem(Cardano.RedeemerPurpose.vote, index));
  tx.guardrails.forEach((_, index) =>
    redeem(Cardano.RedeemerPurpose.propose, index),
  );
  const scripts = [
    ...new Set([
      ...policies,
      ...[
        ...tx.inputs.map((i) => i.output.address.payment),
        ...tx.withdrawals.map((w) => w.credential),
        ...vectorCertificates.map((c) => c.credential),
        ...tx.voters,
      ].flatMap((c) => ("Script" in c ? [rename(c.Script)] : [])),
      ...tx.guardrails.map(rename),
    ]),
  ];
  const utxos: [TransactionInput, TransactionOutput][] = [
    ...inputs.map((i): [TransactionInput, TransactionOutput] => [
      input(i),
      output(i.output, datum),
    ]),
    ...references.map((i): [TransactionInput, TransactionOutput] => [
      input(i),
      output(i.output, nodeDatum),
    ]),
  ];
  return { body, redeemers, utxos, scripts };
};

/**
 * Runs every script the vector's transaction names; fails with the evaluator's message. `script`
 * gives the flat bytes the evaluator runs for a (renamed) script hash.
 */
export const evaluate = <D>(
  tx: Tx<D>,
  datum: (d: D) => Cardano.PlutusData,
  rename: (hex: string) => string,
  script: (hash: string) => Uint8Array,
  redeemer: Cardano.PlutusData,
) => {
  const { body, redeemers, utxos, scripts } = conway(
    tx,
    datum,
    rename,
    redeemer,
  );
  const witnesses = new TransactionWitnessSet();
  witnesses.setRedeemers(Redeemers.fromCore(redeemers));
  return Effect.try({
    try: () =>
      eval_phase_two_raw_with_override(
        fromHex(
          new Transaction(TransactionBody.fromCore(body), witnesses).toCbor(),
        ),
        utxos.map(([i]) => fromHex(i.toCbor())),
        utxos.map(([, o]) => fromHex(o.toCbor())),
        fromHex(Costmdls.fromCore(hardCodedProtocolParams.costModels).toCbor()),
        BigInt(hardCodedProtocolParams.maxExecutionUnitsPerTransaction.steps),
        BigInt(hardCodedProtocolParams.maxExecutionUnitsPerTransaction.memory),
        0n,
        0n,
        1,
        scripts.map(fromHex),
        scripts.map(script),
        new Uint8Array(scripts.map(() => 3)),
      ),
    catch: (error) => String(error),
  });
};

/**
 * A field-free redeemer constructor by its name, in the order the Aiken type declares them; a
 * vector without a redeemer gets the first constructor, which no script it runs reads.
 */
export const action = (
  names: string[],
  name: string | null,
): Cardano.PlutusData => ({
  constructor: BigInt(name === null ? 0 : names.indexOf(name)),
  fields: { items: [] },
});
