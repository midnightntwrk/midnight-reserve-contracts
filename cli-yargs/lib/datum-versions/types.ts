import type { PlutusData } from "@blaze-cardano/core";
import type { Signer } from "../types";
import type { PermissionedCandidate } from "../candidates";

/**
 * Datum families corresponding to forever contracts.
 *
 * NOTE: UpgradeState (two-stage datum) is NOT handled here.
 * That is the responsibility of governance-provider.ts.
 */
export type DatumFamily =
  | "council"
  | "tech-auth"
  | "federated-ops"
  | "terms-and-conditions";

/**
 * Decoded Terms & Conditions data.
 */
export interface TermsData {
  hash: string;
  link: string;
}

/**
 * Decoded FederatedOps data (covers both v1 and v2).
 * v2 adds the `message` field (empty bytes by default).
 */
export interface FederatedOpsData {
  /** Raw PlutusData for the "data" field (Unit in practice). */
  data: PlutusData;
  /** v2 only: message bytes as hex. Absent in v1. */
  message?: string;
  /** Decoded permissioned candidates from the appendix. */
  candidates: PermissionedCandidate[];
  /** Raw appendix PlutusData (preserved for CBOR fidelity). */
  appendixRaw: PlutusData;
}

/**
 * Decoded Multisig data (council or tech-auth).
 * Signers list preserves duplicate keys from CBOR.
 */
export interface MultisigData {
  totalSigners: bigint;
  signers: Signer[];
}

/**
 * Version-aware handler for a single datum family at a specific logic_round.
 *
 * decode() takes raw on-chain PlutusData and returns a typed structure.
 * encode() takes the typed structure and returns PlutusData for on-chain use.
 *
 * The encode/decode cycle MUST produce byte-equivalent CBOR for unchanged
 * fields, particularly for Multisig datums where CBOR maps may contain
 * duplicate keys.
 */
export interface DatumVersionHandler<TDatum> {
  /** The logic_round this handler corresponds to. */
  logicRound: number;

  /** Decode raw on-chain PlutusData into a typed datum. */
  decode(cbor: PlutusData): TDatum;

  /** Encode a typed datum back to PlutusData for on-chain use. */
  encode(datum: TDatum): PlutusData;

  /** Get member payment hashes (council, tech-auth). */
  getMemberList?(data: TDatum): string[];

  /** Replace the member list, returning a new datum. */
  setMemberList?(data: TDatum, newMembers: string[]): TDatum;

  /** Get decoded permissioned candidates (federated-ops). */
  getCandidates?(data: TDatum): PermissionedCandidate[];

  /** Replace the candidate list, returning a new datum. */
  setCandidates?(data: TDatum, candidates: PermissionedCandidate[]): TDatum;

  /** Get decoded terms data (terms-and-conditions). */
  getTerms?(data: TDatum): TermsData;

  /** Replace terms data, returning a new datum. */
  setTerms?(data: TDatum, terms: TermsData): TDatum;
}
