import { PlutusData, toHex } from "@blaze-cardano/core";
import type * as Contracts from "../../contract_blueprint";

export interface PermissionedCandidate {
  sidechain_pub_key: string;
  aura_pub_key: string;
  grandpa_pub_key: string;
  beefy_pub_key: string;
}

// 4-character key identifiers as hex
const KEY_IDS = {
  aura: toHex(new TextEncoder().encode("aura")), // 61757261
  gran: toHex(new TextEncoder().encode("gran")), // 6772616e
  beef: toHex(new TextEncoder().encode("beef")), // 62656566
} as const;

/**
 * Parses the relaxed JSON-like format for permissioned candidates from an environment variable.
 *
 * Expected format:
 * ```
 * PERMISSIONED_CANDIDATES="[
 *   {
 *     sidechain_pub_key:020a617391...,
 *     aura_pub_key:1254f70...,
 *     grandpa_pub_key:5079bcd...,
 *     beefy_pub_key:020a617391...
 *   },
 *   ...
 * ]"
 * ```
 */
export function parsePermissionedCandidates(
  envVar: string = "PERMISSIONED_CANDIDATES",
): PermissionedCandidate[] {
  const candidatesEnv = process.env[envVar];
  if (!candidatesEnv) {
    throw new Error(`${envVar} environment variable is required`);
  }

  return parsePermissionedCandidatesString(candidatesEnv);
}

/**
 * Parses the relaxed JSON-like format string directly (useful for testing).
 */
export function parsePermissionedCandidatesString(
  input: string,
): PermissionedCandidate[] {
  // Remove outer brackets and whitespace
  let content = input.trim();
  if (!content.startsWith("[") || !content.endsWith("]")) {
    throw new Error("Expected input to be wrapped in [ ]");
  }
  content = content.slice(1, -1).trim();

  // Split by },{ to get individual candidate blocks
  const candidateBlocks = splitCandidateBlocks(content);

  return candidateBlocks.map((block, index) => {
    const candidate = parseCandidateBlock(block);
    validateCandidate(candidate, index);
    return candidate;
  });
}

/**
 * Splits the content into individual candidate blocks.
 * Handles the format: { ... }, { ... }, ...
 */
function splitCandidateBlocks(content: string): string[] {
  const blocks: string[] = [];
  let depth = 0;
  let currentBlock = "";

  for (const char of content) {
    if (char === "{") {
      depth++;
      if (depth === 1) {
        currentBlock = "";
        continue;
      }
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        blocks.push(currentBlock.trim());
        currentBlock = "";
        continue;
      }
    }

    if (depth > 0) {
      currentBlock += char;
    }
  }

  return blocks.filter((b) => b.length > 0);
}

/**
 * Parses a single candidate block into a PermissionedCandidate object.
 */
function parseCandidateBlock(block: string): PermissionedCandidate {
  const result: Record<string, string> = {};

  // Split by comma or newline to get key:value pairs
  const lines = block
    .split(/[,\n]/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (const line of lines) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) {
      continue;
    }

    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();

    if (key && value) {
      result[key] = value;
    }
  }

  return {
    sidechain_pub_key: result.sidechain_pub_key || "",
    aura_pub_key: result.aura_pub_key || "",
    grandpa_pub_key: result.grandpa_pub_key || "",
    beefy_pub_key: result.beefy_pub_key || "",
  };
}

/**
 * Validates that a candidate has all required fields.
 */
function validateCandidate(
  candidate: PermissionedCandidate,
  index: number,
): void {
  const requiredFields = [
    "sidechain_pub_key",
    "aura_pub_key",
    "grandpa_pub_key",
    "beefy_pub_key",
  ] as const;

  for (const field of requiredFields) {
    if (!candidate[field]) {
      throw new Error(
        `Candidate at index ${index} is missing required field: ${field}`,
      );
    }
    // Validate hex format (should be valid hex string)
    if (!/^[0-9a-fA-F]+$/.test(candidate[field])) {
      throw new Error(
        `Candidate at index ${index} has invalid hex value for ${field}: ${candidate[field]}`,
      );
    }
  }
}

/**
 * Converts a PermissionedCandidate to the PermissionedCandidateDatumV1 type.
 *
 * PermissionedCandidateDatumV1 = [SidechainPublicKey, List<CandidateKey>]
 * CandidateKey = [id (4-byte hex), bytes (hex)]
 */
export function candidateToPermissionedDatum(
  candidate: PermissionedCandidate,
): Contracts.PermissionedCandidateDatumV1 {
  const candidateKeys: Contracts.CandidateKey[] = [
    [KEY_IDS.aura, candidate.aura_pub_key],
    [KEY_IDS.gran, candidate.grandpa_pub_key],
    [KEY_IDS.beef, candidate.beefy_pub_key],
  ];

  return [candidate.sidechain_pub_key, candidateKeys];
}

/**
 * Parses environment variable and returns the full FederatedOps appendix.
 */
export function parsePermissionedCandidatesToAppendix(
  envVar: string = "PERMISSIONED_CANDIDATES",
): Contracts.PermissionedCandidateDatumV1[] {
  const candidates = parsePermissionedCandidates(envVar);
  return candidates.map(candidateToPermissionedDatum);
}

/**
 * Creates a complete FederatedOps datum from environment variable.
 *
 * FederatedOps = [Unit, List<PermissionedCandidateDatumV1>, logic_round]
 */
export function createFederatedOpsDatum(
  envVar: string = "PERMISSIONED_CANDIDATES",
  logic_round: bigint = 0n,
): Contracts.FederatedOps {
  const appendix = parsePermissionedCandidatesToAppendix(envVar);
  return [
    PlutusData.fromCore({ constructor: 0n, fields: { items: [] } }),
    appendix,
    logic_round,
  ];
}

/**
 * Creates a FederatedOps datum from a string input (useful for testing).
 */
export function createFederatedOpsDatumFromString(
  input: string,
  logic_round: bigint = 0n,
): Contracts.FederatedOps {
  const candidates = parsePermissionedCandidatesString(input);
  const appendix = candidates.map(candidateToPermissionedDatum);
  return [
    PlutusData.fromCore({ constructor: 0n, fields: { items: [] } }),
    appendix,
    logic_round,
  ];
}
