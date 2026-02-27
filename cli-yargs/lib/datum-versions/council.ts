import { createMultisigHandlers } from "./multisig-factory";
import type { DatumVersionHandler, MultisigData } from "./types";

const handlers = createMultisigHandlers([0, 1]);

export const councilRound0: DatumVersionHandler<MultisigData> = handlers[0];
export const councilRound1: DatumVersionHandler<MultisigData> = handlers[1];

/** All council handlers indexed by logic_round. */
export const councilHandlers: Record<
  number,
  DatumVersionHandler<MultisigData>
> = handlers;
