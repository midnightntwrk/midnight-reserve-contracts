/**
 * rewards-register: a virtual account's registration (docs/rewards/spec.md
 * §4.3), the operator and demo path; the Lace wallet is the user's
 * surface. The stake key registers itself: the transaction spends the list
 * node the key falls after (key < skh < next), mints the deposit and
 * registration NFTs, and creates the deposit (no NIGHT) and the
 * registration { owner: the stake key, destinations, operator_keys,
 * payout_threshold } under the account's Register withdrawal, through the
 * rewards-scripts reference script. With a sidechain key, operator_keys
 * carry that key and its proof of possession over the stake key hash, the
 * pair the rewards pallet checks before it pairs the account with that
 * block producer. The stake key signs here; the deployer pays and signs at
 * sign-and-submit.
 */
import {
  addressFromValidator,
  AssetId,
  AssetName,
  Ed25519KeyHashHex,
  Ed25519PublicKey,
  type NetworkId,
  PaymentAddress,
  PolicyId,
  type Script,
  TransactionOutput,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { parse, serialize } from "@blaze-cardano/data";
import type {
  Blaze,
  Provider as BlazeProvider,
  Wallet,
} from "@blaze-cardano/sdk";
import type { TxBuilder } from "@blaze-cardano/tx";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { bytesToHex, concatBytes, hexToBytes } from "@noble/hashes/utils.js";
import { Effect, Either, Option } from "effect";
import * as Contracts from "../../contract_blueprint";
import { referenceScripts } from "../bridge/bridge-chain";
import { buildTx } from "../chain/complete-tx";
import { Provider } from "../chain/provider";
import {
  attachWitnesses,
  createRewardAccount,
  publicKeyOf,
  signTransaction,
} from "../chain/transaction";
import { writeTransaction } from "../chain/tx-file";
import { environmentOf } from "../config/network-mapping";
import { Settings } from "../config/settings";
import { Blueprint } from "../contracts/contracts";
import { resolveCollateral } from "../deploy/deployment";
import { DatumParseError, PreconditionFailed } from "../errors";
import { type TxFileInput, txFilePath } from "../input";
import { Output } from "../output";

/** The message a sidechain key signs to claim a stake key hash: "midnight:rewards-operator" || skh. */
const OPERATOR_DOMAIN = new TextEncoder().encode("midnight:rewards-operator");

const utf8Hex = (text: string) => bytesToHex(new TextEncoder().encode(text));

/** A destination weight map: `kind byte ‖ address` (hex) to its weight out of 1000. */
export type Destinations = Readonly<Record<string, bigint>>;

/** `<kind byte ‖ address hex>:<weight>,…`: every weight above 0, summing to 1000. */
export const parseDestinations = (
  text: string,
): Either.Either<Destinations, string> => {
  const entries = text.split(",").map((entry) => entry.trim().split(":"));
  const bad = entries.find(
    ([key = "", weight = ""]) =>
      !/^([0-9a-f]{2})+$/.test(key) || !/^[1-9][0-9]*$/.test(weight),
  );
  if (bad !== undefined)
    return Either.left(
      `'${bad.join(":")}' is not <kind byte and address, lower-case hex>:<positive weight>`,
    );
  const total = entries.reduce((sum, [, w]) => sum + BigInt(w), 0n);
  return total === 1000n
    ? Either.right(Object.fromEntries(entries.map(([k, w]) => [k, BigInt(w)])))
    : Either.left(`the weights sum to ${total}, not 1000`);
};

/** operator_keys naming a block producer: "sidechain" -> its 33-byte key, "sidechain_sig" -> r ‖ s ‖ recovery id over Blake2b-256(domain ‖ skh), signed prehashed. */
export const operatorClaim = (
  sidechainSecret: Uint8Array,
  skh: string,
): Record<string, string> => {
  const digest = blake2b(concatBytes(OPERATOR_DOMAIN, hexToBytes(skh)), {
    dkLen: 32,
  });
  const recovered = secp256k1.sign(digest, sidechainSecret, {
    prehash: false,
    format: "recovered",
  });
  return {
    [utf8Hex("sidechain")]: bytesToHex(
      secp256k1.getPublicKey(sidechainSecret, true),
    ),
    [utf8Hex("sidechain_sig")]: bytesToHex(
      concatBytes(recovered.slice(1), recovered.slice(0, 1)),
    ),
  };
};

/** A head or deposit node of the list: its key ("" for the head) and next key. */
export interface ListNode {
  readonly utxo: TransactionUnspentOutput;
  readonly key: string;
  readonly next: string;
  readonly datum: Contracts.AccountDatum;
}

/** The list's head and deposit nodes among the UTxOs at the account address. */
export const listNodes = (
  utxos: readonly TransactionUnspentOutput[],
  account: string,
): Either.Either<ListNode[], string> =>
  Either.all(
    utxos.flatMap((utxo) => {
      const name = [...(utxo.output().amount().multiasset()?.keys() ?? [])]
        .filter((id) => id.startsWith(account))
        .map((id) => id.slice(56));
      const isNode =
        name.length === 1 && (name[0] === "" || name[0].startsWith("00"));
      const data = utxo.output().datum()?.asInlineData();
      if (!isNode || data === undefined) return [];
      return [
        Either.flatMap(
          Either.try({
            try: () => parse(Contracts.AccountDatum, data),
            catch: () => `the datum at ${name[0]} is not an AccountDatum`,
          }),
          (datum): Either.Either<ListNode[], string> =>
            typeof datum === "object" && "Head" in datum
              ? Either.right([{ utxo, key: "", next: datum.Head.next, datum }])
              : typeof datum === "object" && "Deposit" in datum
                ? Either.right([
                    {
                      utxo,
                      key: name[0].slice(2),
                      next: datum.Deposit.next,
                      datum,
                    },
                  ])
                : Either.right([]),
        ),
      ];
    }),
  ).pipe(Either.map((nodes) => nodes.flat()));

/** The node `skh` links after: key < skh < next. */
export const anchorOf = (nodes: readonly ListNode[], skh: string) =>
  Option.fromNullable(nodes.find((n) => n.key < skh && skh < n.next));

/** What a registration spends, references and creates. */
export interface RegisterInputs {
  readonly account: Script;
  readonly accountRef: TransactionUnspentOutput;
  readonly anchor: ListNode;
  readonly skh: string;
  readonly deposit: bigint;
  readonly destinations: Destinations;
  readonly operatorKeys: Readonly<Record<string, string>>;
  readonly payoutThreshold: bigint;
  readonly collateral: TransactionUnspentOutput;
}

const accountOutput = (
  account: Script,
  networkId: NetworkId,
  coins: bigint,
  name: string,
  datum: Contracts.AccountDatum,
) =>
  TransactionOutput.fromCore({
    address: PaymentAddress(
      addressFromValidator(networkId, account).toBech32(),
    ),
    value: { coins, assets: new Map([[AssetId(account.hash() + name), 1n]]) },
    datum: serialize(Contracts.AccountDatum, datum).toCore(),
  });

/** The anchor with next = skh, then the deposit and the registration (outputs 0..2), under the Register withdrawal; the stake key is a required signer. */
export const buildRegisterTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: RegisterInputs,
  networkId: NetworkId,
): TxBuilder => {
  const { account, anchor, skh } = inputs;
  const user = serialize(Contracts.AccountGate, "User");
  const anchorDatum: Contracts.AccountDatum =
    typeof anchor.datum === "object" && "Deposit" in anchor.datum
      ? { Deposit: { ...anchor.datum.Deposit, next: skh } }
      : { Head: { next: skh } };
  const anchorOut = TransactionOutput.fromCore({
    ...anchor.utxo.output().toCore(),
    datum: serialize(Contracts.AccountDatum, anchorDatum).toCore(),
  });
  return blaze
    .newTransaction()
    .addReferenceInput(inputs.accountRef)
    .addInput(anchor.utxo, user)
    .addMint(
      PolicyId(account.hash()),
      new Map([
        [AssetName(`00${skh}`), 1n],
        [AssetName(`01${skh}`), 1n],
      ]),
      user,
    )
    .addOutput(anchorOut)
    .addOutput(
      accountOutput(account, networkId, inputs.deposit, `00${skh}`, {
        Deposit: {
          cred: { VerificationKey: [skh] },
          next: anchor.next,
          committed: undefined,
        },
      }),
    )
    .addOutput(
      accountOutput(account, networkId, 0n, `01${skh}`, {
        Registration: {
          owner: { VerificationKey: [skh] },
          destinations: { ...inputs.destinations },
          operator_keys: { ...inputs.operatorKeys },
          payout_threshold: inputs.payoutThreshold,
        },
      }),
    )
    .addWithdrawal(
      createRewardAccount(account.hash(), networkId),
      0n,
      serialize(Contracts.AccountAction, { kind: "Register", offset: 0n }),
    )
    .addRequiredSigner(Ed25519KeyHashHex(skh))
    .provideCollateral([inputs.collateral]);
};

/** The stake key variable, the optional sidechain key variable, the registration's fields, and where the file goes. */
export interface RewardsRegisterInput extends TxFileInput {
  readonly stakeKey: string;
  readonly sidechainKey: Option.Option<string>;
  readonly destinations: Destinations;
  readonly payoutThreshold: bigint;
  readonly deposit: bigint;
}

/** Resolve the list and the reference script, build the registration, sign it with the stake key and write it for the deployer. */
export const rewardsRegisterProgram = (input: RewardsRegisterInput) =>
  Effect.gen(function* () {
    const out = yield* Output;
    const { network } = input;
    const { networkId } = environmentOf(network);
    const settings = yield* Settings;
    const config = yield* settings.profile;
    const stakeKey = yield* settings.signingKey(input.stakeKey);
    const skh = Ed25519PublicKey.fromHex(publicKeyOf(stakeKey)).hash().hex();
    const operatorKeys = yield* Option.match(input.sidechainKey, {
      onNone: () => Effect.succeed({}),
      onSome: (variable) =>
        Effect.map(settings.secp256k1Key(variable), (secret) =>
          operatorClaim(secret, skh),
        ),
    });
    const account = (yield* Effect.flatMap(Blueprint, (b) =>
      b.optional("virtualAccount"),
    )).Script;
    const provider = yield* Provider;
    const utxos = yield* provider.unspentOutputs(
      addressFromValidator(networkId, account),
    );
    const nodes = yield* Either.mapLeft(
      listNodes(utxos, account.hash()),
      (reason) =>
        new DatumParseError({ what: "AccountDatum", cbor: "", reason }),
    );
    if (nodes.some((n) => n.key === skh)) {
      return yield* new PreconditionFailed({
        command: "rewards-register",
        refusal: { _tag: "AccountExists", skh },
      });
    }
    const anchor = yield* Either.fromOption(
      anchorOf(nodes, skh),
      () =>
        new DatumParseError({
          what: "virtual account list",
          cbor: "",
          reason: `no node at ${addressFromValidator(networkId, account).toBech32()} links ${skh}; is the list initialised?`,
        }),
    );
    const [accountRef] = yield* referenceScripts([account.hash()]);
    const { collateralPercentage } = yield* provider.use("getParameters", (p) =>
      p.getParameters(),
    );
    const collateral = yield* resolveCollateral(
      "rewards-register",
      config,
      collateralPercentage,
    );
    yield* out.log(`\nVirtual account registration on ${network}`);
    yield* out.log(
      `Stake key hash: ${skh}, after node ${anchor.key || "(head)"}`,
    );
    yield* out.log(
      `Deposit: ${input.deposit} lovelace; payout threshold: ${input.payoutThreshold}; operator keys: ${Object.keys(operatorKeys).length}`,
    );
    const blaze = yield* provider.blaze;
    const tx = yield* buildTx(
      buildRegisterTx(
        blaze,
        {
          account,
          accountRef,
          anchor,
          skh,
          deposit: input.deposit,
          destinations: input.destinations,
          operatorKeys,
          payoutThreshold: input.payoutThreshold,
          collateral,
        },
        networkId,
      ),
      {
        commandName: "rewards-register",
        environment: network,
        witnesses: 2,
        knownUtxos: [anchor.utxo, accountRef, collateral],
      },
    );
    const signed = attachWitnesses(
      tx.toCbor(),
      signTransaction(tx.getId(), [stakeKey]),
    );
    yield* writeTransaction(
      txFilePath(input),
      signed.toCbor(),
      signed.getId(),
      false,
      "Virtual Account Registration",
    );
    return signed;
  });
