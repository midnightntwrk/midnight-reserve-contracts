/**
 * Datum version registry.
 *
 * Maps (DatumFamily, logicRound) to the correct DatumVersionHandler.
 * Fails hard with an explicit error on unknown family/logicRound combinations.
 *
 * BOUNDARY: This module handles forever contract datum only.
 * UpgradeState (two-stage datum) is handled by governance-provider.ts.
 */
export type {
  DatumFamily,
  DatumVersionHandler,
  MultisigData,
  FederatedOpsData,
  TermsData,
} from "./types";

export { councilRound0, councilRound1, councilHandlers } from "./council";
export { techAuthRound0, techAuthRound1, techAuthHandlers } from "./tech-auth";
export {
  federatedOpsRound1,
  federatedOpsRound2,
  federatedOpsHandlers,
} from "./federated-ops";
export {
  termsRound0,
  termsRound1,
  termsHandlers,
} from "./terms-and-conditions";

import type { DatumFamily, DatumVersionHandler } from "./types";
import type { MultisigData } from "./types";
import type { FederatedOpsData } from "./types";
import type { TermsData } from "./types";
import { councilHandlers } from "./council";
import { techAuthHandlers } from "./tech-auth";
import { federatedOpsHandlers } from "./federated-ops";
import { termsHandlers } from "./terms-and-conditions";

/** Handler lookup tables per family. */
const registry: Record<
  DatumFamily,
  Record<number, DatumVersionHandler<unknown>>
> = {
  council: councilHandlers as Record<number, DatumVersionHandler<unknown>>,
  "tech-auth": techAuthHandlers as Record<number, DatumVersionHandler<unknown>>,
  "federated-ops": federatedOpsHandlers as Record<
    number,
    DatumVersionHandler<unknown>
  >,
  "terms-and-conditions": termsHandlers as Record<
    number,
    DatumVersionHandler<unknown>
  >,
};

/**
 * Get the datum handler for a specific family and logic_round.
 * Throws on unknown family or unsupported logic_round.
 */
export function getDatumHandler(
  family: "council",
  logicRound: number,
): DatumVersionHandler<MultisigData>;
export function getDatumHandler(
  family: "tech-auth",
  logicRound: number,
): DatumVersionHandler<MultisigData>;
export function getDatumHandler(
  family: "council" | "tech-auth",
  logicRound: number,
): DatumVersionHandler<MultisigData>;
export function getDatumHandler(
  family: "federated-ops",
  logicRound: number,
): DatumVersionHandler<FederatedOpsData>;
export function getDatumHandler(
  family: "terms-and-conditions",
  logicRound: number,
): DatumVersionHandler<TermsData>;
export function getDatumHandler(
  family: DatumFamily,
  logicRound: number,
): DatumVersionHandler<unknown>;
export function getDatumHandler(
  family: DatumFamily,
  logicRound: number,
): DatumVersionHandler<unknown> {
  const familyHandlers = registry[family];
  if (!familyHandlers) {
    throw new Error(`Unknown datum family: "${family}"`);
  }

  const handler = familyHandlers[logicRound];
  if (handler) return handler;

  // Fallback: use the highest available round handler when the exact round
  // isn't registered. This handles logic_round values that have been
  // incremented by multiple stage/promote cycles without a datum format change.
  const availableRounds = Object.keys(familyHandlers)
    .map(Number)
    .sort((a, b) => a - b);
  const maxRound = availableRounds[availableRounds.length - 1];
  if (maxRound !== undefined && logicRound > maxRound) {
    console.warn(
      `[datum-versions] logic_round ${logicRound} not registered for "${family}", falling back to round ${maxRound}`,
    );
    return familyHandlers[maxRound];
  }

  const supported = availableRounds.join(", ");
  throw new Error(
    `Unsupported logic_round ${logicRound} for datum family "${family}". ` +
      `Supported rounds: ${supported}`,
  );
}

/**
 * Extract the logic_round from raw on-chain PlutusData.
 *
 * For all current datum families, the logic_round is the last element
 * in the top-level list.
 */
export function extractLogicRound(
  cbor: import("@blaze-cardano/core").PlutusData,
): number {
  const list = cbor.asList();
  if (!list || list.getLength() < 2) {
    throw new Error(
      "Cannot extract logic_round: datum is not a list with >= 2 elements",
    );
  }

  const lastElement = list.get(list.getLength() - 1);
  const round = lastElement.asInteger();
  if (round === undefined || round === null) {
    throw new Error(
      "Cannot extract logic_round: last element is not an integer",
    );
  }

  return Number(round);
}
