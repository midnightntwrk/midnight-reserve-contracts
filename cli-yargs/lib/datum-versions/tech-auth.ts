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
  return {
    totalSigners: BigInt(newMembers.length),
    signers: newMembers.map((paymentHash) => {
      const existing = data.signers.find((s) => s.paymentHash === paymentHash);
      if (!existing) {
        throw new Error(
          `Cannot set member list: no existing sr25519Key for paymentHash ${paymentHash}. ` +
            `Use encode() with full Signer[] to set entirely new members.`,
        );
      }
      return existing;
    }),
  };
}

/**
 * Tech-auth datum handler for logic_round 0.
 *
 * Same datum shape as council: VersionedMultisig = [[totalSigners, signerMap], logic_round]
 * Uses CBOR-preserving decode/encode to handle duplicate keys in signerMap.
 */
export const techAuthRound0: DatumVersionHandler<MultisigData> = {
  logicRound: 0,
  decode: decodeMultisig,
  encode(datum: MultisigData): PlutusData {
    return createMultisigStateCbor(datum.signers, 0n, datum.totalSigners);
  },
  getMemberList,
  setMemberList,
};

/**
 * Tech-auth datum handler for logic_round 1 (v2 logic).
 *
 * Same datum shape as round 0 — only the logic_round field changes.
 */
export const techAuthRound1: DatumVersionHandler<MultisigData> = {
  logicRound: 1,
  decode: decodeMultisig,
  encode(datum: MultisigData): PlutusData {
    return createMultisigStateCbor(datum.signers, 1n, datum.totalSigners);
  },
  getMemberList,
  setMemberList,
};

/** All tech-auth handlers indexed by logic_round. */
export const techAuthHandlers: Record<
  number,
  DatumVersionHandler<MultisigData>
> = {
  0: techAuthRound0,
  1: techAuthRound1,
};
