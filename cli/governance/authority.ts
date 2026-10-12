/**
 * The multisig authority of a governance transaction: the signer and
 * threshold datums of its forever and threshold UTxOs, and the governance
 * authority (gov-auth withdrawal, threshold reference, both authority
 * witnesses) a two-stage upgrade runs.
 */
import {
  type NetworkId,
  type Script,
  toHex,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { parse, serialize } from "@blaze-cardano/data";
import type { TxBuilder } from "@blaze-cardano/tx";
import { Effect, Either, Option } from "effect";
import * as Contracts from "../../contract_blueprint";
import { decodeSigners, type Signers } from "../datum/signers";
import { decodeDatum, inlineDatum } from "../datum/inline";
import {
  type AuthorityThreshold,
  authorityThreshold,
  type WitnessRequirements,
  witnessRequirements,
} from "./threshold";
import type { Environment } from "../config/network-mapping";
import type { ContractUtxos } from "../chain/utxo";
import { ensureRegistered } from "../chain/registration";
import {
  createRewardAccount,
  mintWitnesses,
  planMintWitnesses,
} from "../tx/scripts";
import type { TxPlan } from "../tx/plan";
import { Output } from "../output";
import { DatumParseError } from "../errors";

const TECH_WITNESS_ASSET = toHex(new TextEncoder().encode("tech-auth-witness"));
const COUNCIL_WITNESS_ASSET = toHex(
  new TextEncoder().encode("council-auth-witness"),
);

/** The current signers in a multisig authority's forever UTxO. */
export const signersAt = (
  utxo: TransactionUnspentOutput,
): Either.Either<Signers, DatumParseError> =>
  Either.flatMap(inlineDatum(utxo, "VersionedMultisig"), decodeSigners);

/** The fractions of a threshold UTxO's MultisigThreshold datum, each checked. */
export const thresholdAt = (
  utxo: TransactionUnspentOutput,
): Either.Either<AuthorityThreshold, DatumParseError> =>
  Either.flatMap(inlineDatum(utxo, "MultisigThreshold"), (data) =>
    Either.flatMap(
      decodeDatum(data, "MultisigThreshold", (d) =>
        parse(Contracts.MultisigThreshold, d),
      ),
      (datum) =>
        Either.mapLeft(
          authorityThreshold(datum),
          (reason) =>
            new DatumParseError({
              what: "MultisigThreshold",
              cbor: data.toCbor(),
              reason,
            }),
        ),
    ),
  );

/** The gov-auth script that runs, its threshold, and both authorities' forever states. */
export interface GovernanceAuthority {
  readonly govAuth: Script;
  readonly thresholdUtxo: TransactionUnspentOutput;
  readonly techAuthForeverUtxo: TransactionUnspentOutput;
  readonly councilForeverUtxo: TransactionUnspentOutput;
  readonly techAuthSigners: Signers;
  readonly councilSigners: Signers;
  /** What the threshold demands of both signer sets above. */
  readonly requirements: WitnessRequirements;
  /** The council main UTxO the staging authority reads; None when the target's own main already is it. */
  readonly councilMainUtxo: Option.Option<TransactionUnspentOutput>;
}

/** The authority as plan parts: reference the threshold and both forevers (and the council main when the staging authority reads it), mint both witness tokens, withdraw through gov-auth with the first tech-auth signer as redeemer. */
export const governanceAuthorityPlan = (
  authority: GovernanceAuthority,
  networkId: NetworkId,
): Pick<
  TxPlan,
  "references" | "mints" | "withdrawals" | "requiredSignatures"
> => {
  const { techAuth, council } = authority.requirements;
  const [firstSigner] = authority.techAuthSigners;
  return {
    references: [
      authority.thresholdUtxo,
      authority.techAuthForeverUtxo,
      authority.councilForeverUtxo,
      ...Option.toArray(authority.councilMainUtxo),
    ],
    ...planMintWitnesses(
      [
        {
          ...techAuth,
          signers: authority.techAuthSigners,
          assetName: TECH_WITNESS_ASSET,
        },
        {
          ...council,
          signers: authority.councilSigners,
          assetName: COUNCIL_WITNESS_ASSET,
        },
      ],
      networkId,
    ),
    withdrawals: [
      {
        rewardAccount: createRewardAccount(authority.govAuth.hash(), networkId),
        script: authority.govAuth,
        redeemer: serialize(Contracts.PermissionedRedeemer, {
          [firstSigner.paymentHash]: firstSigner.sr25519Key,
        }),
      },
    ],
  };
};

/** Run the authority: reference the threshold and both forevers, mint both witness tokens, withdraw through gov-auth with the first tech-auth signer as redeemer. */
export const withGovernanceAuthority = (
  txBuilder: TxBuilder,
  authority: GovernanceAuthority,
  networkId: NetworkId,
): TxBuilder => {
  const { techAuth, council } = authority.requirements;
  const [firstSigner] = authority.techAuthSigners;
  const govAuthRedeemer = serialize(Contracts.PermissionedRedeemer, {
    [firstSigner.paymentHash]: firstSigner.sr25519Key,
  });
  const authorized = mintWitnesses(
    txBuilder
      .addReferenceInput(authority.thresholdUtxo)
      .addReferenceInput(authority.techAuthForeverUtxo)
      .addReferenceInput(authority.councilForeverUtxo)
      .provideScript(authority.govAuth),
    [
      {
        ...techAuth,
        signers: authority.techAuthSigners,
        assetName: TECH_WITNESS_ASSET,
      },
      {
        ...council,
        signers: authority.councilSigners,
        assetName: COUNCIL_WITNESS_ASSET,
      },
    ],
    networkId,
  ).addWithdrawal(
    createRewardAccount(authority.govAuth.hash(), networkId),
    0n,
    govAuthRedeemer,
  );
  return Option.match(authority.councilMainUtxo, {
    onNone: () => authorized,
    onSome: (councilMain) => authorized.addReferenceInput(councilMain),
  });
};

/** The multisig signatures an unsigned transaction of this authority needs: tech auth's and council's. */
export const requiredSignatures = ({ requirements }: GovernanceAuthority) =>
  requirements.techAuth.required + requirements.council.required;

/** The authority from its queried UTxOs: both signer sets and the threshold read, the witness requirements logged, its gov-auth reward account checked. */
export const resolveAuthority = (
  found: ContractUtxos<"techAuthForever" | "councilForever" | "threshold">,
  scope: "Staging" | "Main",
  govAuth: Script,
  councilMainUtxo: Option.Option<TransactionUnspentOutput>,
  networkId: NetworkId,
  environment: Environment,
) =>
  Effect.gen(function* () {
    const out = yield* Output;
    const techAuthForeverUtxo = yield* found.first("techAuthForever");
    const councilForeverUtxo = yield* found.first("councilForever");
    const thresholdUtxo = yield* found.first("threshold");
    yield* out.log("\nReading current tech auth state...");
    const techAuthSigners = yield* signersAt(techAuthForeverUtxo);
    yield* out.log("Reading current council state...");
    const councilSigners = yield* signersAt(councilForeverUtxo);
    yield* out.log(`Reading ${scope.toLowerCase()} gov threshold...`);
    const threshold = yield* thresholdAt(thresholdUtxo);
    const requirements = witnessRequirements(threshold, {
      techAuthSigners,
      councilSigners,
    });

    const authority: GovernanceAuthority = {
      govAuth,
      thresholdUtxo,
      techAuthForeverUtxo,
      councilForeverUtxo,
      techAuthSigners,
      councilSigners,
      requirements,
      councilMainUtxo,
    };
    const { techAuth, council } = requirements;
    yield* out.log(
      `\nRequired tech auth signers: ${techAuth.required}/${techAuth.total}`,
    );
    yield* out.log(
      `Required council signers: ${council.required}/${council.total}`,
    );
    yield* ensureRegistered(
      [
        {
          label: `${scope} Gov Auth`,
          rewardAccount: createRewardAccount(govAuth.hash(), networkId),
          scriptHash: govAuth.hash(),
        },
      ],
      environment,
    );
    return authority;
  });
