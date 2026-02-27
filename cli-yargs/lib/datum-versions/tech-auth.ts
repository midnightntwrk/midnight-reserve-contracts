import { createMultisigHandlers } from "./multisig-factory";
import type { DatumVersionHandler, MultisigData } from "./types";

const handlers = createMultisigHandlers([0, 1]);

export const techAuthRound0: DatumVersionHandler<MultisigData> = handlers[0];
export const techAuthRound1: DatumVersionHandler<MultisigData> = handlers[1];

/** All tech-auth handlers indexed by logic_round. */
export const techAuthHandlers: Record<
  number,
  DatumVersionHandler<MultisigData>
> = handlers;
