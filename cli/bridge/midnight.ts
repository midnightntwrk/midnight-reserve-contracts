/**
 * A Midnight node's JSON-RPC over HTTP, and the BEEFY reads the bridge
 * commands make through it: block hashes, the finalized head, a header's
 * MMR root, the committee commitments and validator set by runtime call,
 * a block's BEEFY justification, and a leaf with its MMR proof. Node bytes
 * decode through `./scale`; a malformed answer is a `Decode` ProviderError.
 */
import {
  HttpClient,
  type HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "@effect/platform";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { Duration, Effect, Either, Option, ParseResult, Schema } from "effect";
import { retryRead } from "../chain/blockfrost";
import { PreconditionFailed, ProviderError } from "../errors";
import {
  decodeAuthoritySet,
  decodeFinalityProof,
  type FinalityProof,
  decodeLeafProof,
  decodeSingleLeaf,
  decodeValidatorSet,
  mmrRootOfDigest,
} from "./scale";

const RPC_TIMEOUT = Duration.seconds(30);

/** `0x`-prefixed hex as bytes. */
const HexBytes = Schema.transform(
  Schema.String.pipe(Schema.pattern(/^0x(?:[0-9a-fA-F]{2})*$/)),
  Schema.Uint8ArrayFromSelf,
  {
    strict: true,
    decode: (text) => hexToBytes(text.slice(2)),
    encode: (bytes) => `0x${bytesToHex(bytes)}`,
  },
);

/** A block number as the node writes it in a header: `0x`-prefixed hex. */
const HexNumber = Schema.transform(
  Schema.String.pipe(Schema.pattern(/^0x[0-9a-fA-F]+$/)),
  Schema.Number,
  {
    strict: true,
    decode: (text) => Number.parseInt(text, 16),
    encode: (n) => `0x${n.toString(16)}`,
  },
);

const Envelope = <A, I>(result: Schema.Schema<A, I>) =>
  Schema.Union(
    Schema.Struct({ result }),
    Schema.Struct({
      error: Schema.Struct({ code: Schema.Number, message: Schema.String }),
    }),
  );

const failure = (
  op: string,
  cause: unknown,
  reason?: ProviderError["reason"],
) =>
  new ProviderError({
    op,
    cause: cause instanceof Error ? cause : new Error(String(cause)),
    retryable: reason === "Transport" || reason === "Timeout",
    reason,
  });

const clientFailure =
  (op: string) =>
  (error: HttpClientError.HttpClientError): ProviderError =>
    failure(op, error.cause ?? new Error(error.message), error.reason);

/** One JSON-RPC call under RPC_TIMEOUT, retried on a transport failure or a timeout; the result decodes through `result`, an RPC error is a ProviderError with its code and message. */
export const midnightCall = <A, I>(
  rpc: string,
  method: string,
  params: readonly unknown[],
  result: Schema.Schema<A, I>,
): Effect.Effect<A, ProviderError, HttpClient.HttpClient> => {
  const op = `${method} on ${rpc}`;
  const request = HttpClientRequest.post(rpc).pipe(
    HttpClientRequest.bodyUnsafeJson({ jsonrpc: "2.0", id: 1, method, params }),
  );
  return Effect.flatMap(HttpClient.HttpClient, (client) =>
    client.execute(request).pipe(
      Effect.mapError(clientFailure(op)),
      Effect.flatMap((response) =>
        response.status < 200 || response.status >= 300
          ? Effect.fail(
              new ProviderError({
                op,
                cause: new Error(`the node answered ${response.status}`),
                retryable: response.status >= 500,
                status: response.status,
                reason: "StatusCode",
              }),
            )
          : HttpClientResponse.schemaBodyJson(Envelope(result))(response).pipe(
              Effect.mapError((error) =>
                ParseResult.isParseError(error)
                  ? failure(
                      op,
                      `invalid response: ${ParseResult.TreeFormatter.formatErrorSync(error)}`,
                      "Decode",
                    )
                  : clientFailure(op)(error),
              ),
            ),
      ),
      Effect.flatMap((envelope) =>
        "error" in envelope
          ? Effect.fail(
              failure(
                op,
                `RPC error ${envelope.error.code}: ${envelope.error.message}`,
              ),
            )
          : Effect.succeed(envelope.result),
      ),
      Effect.timeoutFail({
        duration: RPC_TIMEOUT,
        onTimeout: () =>
          failure(
            op,
            `timed out after ${Duration.format(RPC_TIMEOUT)}`,
            "Timeout",
          ),
      }),
      retryRead(op, (error) => error.retryable),
    ),
  );
};

/** A decoded value, or a Decode ProviderError naming `op`. */
const decoded = <A>(op: string, value: Either.Either<A, string>) =>
  Effect.mapError(value, (reason) => failure(op, reason, "Decode"));

/** The hash of block `block`; MidnightBlockMissing when the node has none. */
export const blockHash = (rpc: string, block: number) =>
  Effect.flatMap(
    midnightCall(
      rpc,
      "chain_getBlockHash",
      [block],
      Schema.NullOr(Schema.String),
    ),
    (hash) =>
      hash === null
        ? Effect.fail(
            new PreconditionFailed({
              command: "Midnight node",
              refusal: { _tag: "MidnightBlockMissing", block, rpc },
            }),
          )
        : Effect.succeed(hash),
  );

const Header = Schema.Struct({
  number: HexNumber,
  digest: Schema.Struct({ logs: Schema.Array(HexBytes) }),
});

const header = (rpc: string, hash: string) =>
  midnightCall(rpc, "chain_getHeader", [hash], Header);

/** The number of the node's GRANDPA-finalized head. */
export const finalizedNumber = (rpc: string) =>
  Effect.flatMap(
    midnightCall(rpc, "chain_getFinalizedHead", [], Schema.String),
    (hash) => Effect.map(header(rpc, hash), (h) => h.number),
  );

/** The number of the node's BEEFY-finalized head. */
export const beefyFinalizedNumber = (rpc: string) =>
  Effect.flatMap(
    midnightCall(rpc, "beefy_getFinalizedHead", [], Schema.String),
    (hash) => Effect.map(header(rpc, hash), (h) => h.number),
  );

/** The first block of BEEFY validator set `setId`, once the BEEFY-finalized head has reached it. */
export const sessionStart = (rpc: string, setId: bigint) =>
  Effect.gen(function* () {
    const setAt = (block: number) =>
      Effect.flatMap(blockHash(rpc, block), (at) =>
        Effect.map(validatorSetAt(rpc, at), (set) => set.id),
      );
    const head = yield* beefyFinalizedNumber(rpc);
    if ((yield* setAt(head)) < setId) return Option.none<number>();
    let [low, high] = [1, head];
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if ((yield* setAt(mid)) >= setId) high = mid;
      else low = mid + 1;
    }
    return Option.some(low);
  });

/** The MMR root in the digest of the block with hash `hash` (`ConsensusLog::MmrRoot`). */
export const digestMmrRoot = (rpc: string, hash: string) =>
  Effect.flatMap(header(rpc, hash), (h) =>
    decoded(`the digest of block ${h.number}`, mmrRootOfDigest(h.digest.logs)),
  );

const stateCall = (rpc: string, method: string, at: string) =>
  midnightCall(rpc, "state_call", [method, "0x", at], HexBytes);

/** The committee commitment `pallet-beefy-mmr` holds at `at`: the current set, or with `next` the queued one. */
export const authoritySetAt = (rpc: string, at: string, next: boolean) => {
  const method = next
    ? "BeefyMmrApi_next_authority_set_proof"
    : "BeefyMmrApi_authority_set_proof";
  return Effect.flatMap(stateCall(rpc, method, at), (bytes) =>
    decoded(method, decodeAuthoritySet(bytes)),
  );
};

/** The BEEFY validator set at `at`: a key once per seat. */
export const validatorSetAt = (rpc: string, at: string) =>
  Effect.flatMap(stateCall(rpc, "BeefyApi_validator_set", at), (bytes) =>
    decoded("BeefyApi_validator_set", decodeValidatorSet(bytes)),
  );

const BlockBody = Schema.Struct({
  block: Schema.Struct({
    header: Schema.Struct({
      parentHash: HexBytes,
      number: HexNumber,
      stateRoot: HexBytes,
      extrinsicsRoot: HexBytes,
      digest: Schema.Struct({ logs: Schema.Array(HexBytes) }),
    }),
    extrinsics: Schema.Array(HexBytes),
  }),
});

/** The header and the extrinsics of the block with hash `hash`. */
export const blockAt = (rpc: string, hash: string) =>
  Effect.map(
    midnightCall(rpc, "chain_getBlock", [hash], BlockBody),
    ({ block }) => block,
  );

const Block = Schema.Struct({
  justifications: Schema.NullOr(
    Schema.Array(
      Schema.Tuple(Schema.Array(Schema.Number), Schema.Array(Schema.Number)),
    ),
  ),
});

/** The BEEFY justification (engine `BEEF`) block `block` carries; NoBeefyJustification when it has none. */
export const justificationAt = (rpc: string, block: number, at: string) =>
  Effect.flatMap(
    midnightCall(rpc, "chain_getBlock", [at], Block),
    ({
      justifications,
    }): Effect.Effect<FinalityProof, PreconditionFailed | ProviderError> => {
      const beef = justifications?.find(
        ([engine]) =>
          new TextDecoder().decode(Uint8Array.from(engine)) === "BEEF",
      );
      return beef === undefined
        ? Effect.fail(
            new PreconditionFailed({
              command: "Midnight node",
              refusal: { _tag: "NoBeefyJustification", block },
            }),
          )
        : decoded(
            `the BEEFY justification of block ${block}`,
            decodeFinalityProof(Uint8Array.from(beef[1])),
          );
    },
  );

const MmrProof = Schema.Struct({ leaves: HexBytes, proof: HexBytes });

/** The leaf block `block` adds and its proof in the MMR of `block` leaves' block (`mmr_generateProof([block], block)`). */
export const leafProofAt = (rpc: string, block: number, at: string) =>
  leafProofIn(rpc, block, block, at);

/** The leaf block `block` adds and its proof in the MMR of `count` leaves, block `count` with hash `at` (`mmr_generateProof([block], count)`). */
export const leafProofIn = (
  rpc: string,
  block: number,
  count: number,
  at: string,
) =>
  Effect.flatMap(
    midnightCall(rpc, "mmr_generateProof", [[block], count, at], MmrProof),
    ({ leaves, proof }) =>
      Effect.all({
        leaf: decoded("mmr_generateProof leaves", decodeSingleLeaf(leaves)),
        proof: decoded("mmr_generateProof proof", decodeLeafProof(proof)),
      }),
  );
