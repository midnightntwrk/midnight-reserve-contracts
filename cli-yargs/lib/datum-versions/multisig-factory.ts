import type { PlutusData } from "@blaze-cardano/core";
import type { DatumVersionHandler, MultisigData } from "./types";
import { extractSignersFromCbor, createMultisigStateCbor } from "../signers";

function decodeMultisig(cbor: PlutusData): MultisigData {
  const outerList = cbor.asList();
  if (!outerList || outerList.getLength() < 2) {
    throw new Error(
      "Invalid VersionedMultisig: expected list with at least 2 elements",
    );
  }
  const multisigTuple = outerList.get(0).asList();
  if (!multisigTuple || multisigTuple.getLength() < 2) {
    throw new Error(
      "Invalid Multisig tuple: expected list with at least 2 elements",
    );
  }
  const totalSignersRaw = multisigTuple.get(0).asInteger();
  if (totalSignersRaw === undefined || totalSignersRaw === null) {
    throw new Error("Invalid Multisig: totalSigners field is not an integer");
  }
  const signers = extractSignersFromCbor(cbor);
  return { totalSigners: totalSignersRaw, signers };
}

function getMemberList(data: MultisigData): string[] {
  return data.signers.map((s) => s.paymentHash);
}

function setMemberList(data: MultisigData, newMembers: string[]): MultisigData {
  const remaining = [...data.signers];
  return {
    totalSigners: BigInt(newMembers.length),
    signers: newMembers.map((paymentHash) => {
      const idx = remaining.findIndex((s) => s.paymentHash === paymentHash);
      if (idx === -1) {
        throw new Error(
          `Cannot set member list: no existing sr25519Key for paymentHash ${paymentHash}. ` +
            `Use encode() with full Signer[] to set entirely new members.`,
        );
      }
      return remaining.splice(idx, 1)[0];
    }),
  };
}

/**
 * Create multisig datum handlers for the given logic rounds.
 *
 * Datum shape: VersionedMultisig = [[totalSigners, signerMap], logic_round]
 * Uses CBOR-preserving decode/encode to handle duplicate keys in signerMap.
 */
export function createMultisigHandlers(
  rounds: number[],
): Record<number, DatumVersionHandler<MultisigData>> {
  const handlers: Record<number, DatumVersionHandler<MultisigData>> = {};
  for (const round of rounds) {
    handlers[round] = {
      logicRound: round,
      decode: decodeMultisig,
      encode(datum: MultisigData): PlutusData {
        return createMultisigStateCbor(
          datum.signers,
          BigInt(round),
          datum.totalSigners,
        );
      },
      getMemberList,
      setMemberList,
    };
  }
  return handlers;
}
