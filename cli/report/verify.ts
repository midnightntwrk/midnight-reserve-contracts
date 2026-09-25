/**
 * verify: check an environment's deployed record (deployed-scripts/<env>/
 * plutus.json and versions.json) against the chain's current unspent outputs
 * at the record's scripts. The checks are pure over the record and those
 * outputs:
 *   1. each track's forever embeds its two-stage hash;
 *   2. each forever, two-stage main, two-stage staging and threshold NFT sits
 *      in exactly one unspent output at its script;
 *   3. each two-stage UpgradeState names the record's gov auth, a logic of
 *      its track (`<track>_logic` or `<track>_logic_v<N>`) that versions.json
 *      promoted (main), or promoted or staged (staging), and a mitigation
 *      logic and mitigation auth that are each empty or in the record (each
 *      is set once on chain, so a wrong one is permanent).
 * The six core tracks are always checked; cNIGHT minting is checked where
 * versions.json promotes its forever (mainnet). A validator the record lacks
 * fails the checks that need it.
 */
import {
  AssetId,
  type NetworkId,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { resolve } from "path";
import { Effect, Either, Option } from "effect";
import { environmentOf } from "../config/network-mapping";
import { credentialAddress } from "../contracts/contracts";
import type { PlutusValidator } from "../contracts/plutus-json";
import {
  type DeployedRecord,
  isTrackLogic,
  readRecord,
  validatorName,
} from "../contracts/versions";
import {
  MAIN_TOKEN_HEX,
  STAGING_TOKEN_HEX,
  rawUpgradeStateAt,
} from "../chain/governance-provider";
import { Provider } from "../chain/provider";
import { refOf } from "../chain/transaction";
import { Output } from "../output";
import { renderError, VerificationFailed } from "../errors";
import type { NetworkInput } from "../input";

export interface CheckResult {
  readonly name: string;
  readonly passed: boolean;
  readonly details: string;
}

/** A titled group of checks, one section of the report. */
export interface CheckSection {
  readonly title: string;
  readonly results: readonly CheckResult[];
}

/** The six core upgradable tracks, deployed on every environment: a forever, a two-stage and a logic each. */
export const TRACKS = [
  "tech_auth",
  "council",
  "reserve",
  "ics",
  "federated_ops",
  "terms_and_conditions",
] as const;

/** The seventh upgradable track, cNIGHT minting; only some environments deploy it. */
export const CNIGHT_MINT_TRACK = "cnight_mint";

type Track = (typeof TRACKS)[number] | typeof CNIGHT_MINT_TRACK;

/** The tracks the record deploys: the core six, and cNIGHT minting when versions.json promotes its forever. */
export const tracksOf = ({ versions }: DeployedRecord): readonly Track[] =>
  versions.promoted.includes(`${CNIGHT_MINT_TRACK}_forever`)
    ? [...TRACKS, CNIGHT_MINT_TRACK]
    : TRACKS;

/** The six thresholds the governance transactions read. */
export const THRESHOLDS = [
  "main_gov_threshold",
  "staging_gov_threshold",
  "main_tech_auth_update_threshold",
  "main_council_update_threshold",
  "main_federated_ops_update_threshold",
  "terms_and_conditions_threshold",
] as const;

/** An NFT the chain must hold: its minting validator and asset name. */
interface Nft {
  readonly validator: string;
  readonly assetName: string;
  readonly label: string;
}

/** The NFTs the chain must hold for these tracks and the six thresholds. */
const expectedNfts = (tracks: readonly Track[]): readonly Nft[] => [
  ...tracks.flatMap((track) => [
    { validator: `${track}_forever`, assetName: "", label: `${track}_forever` },
    {
      validator: `${track}_two_stage_upgrade`,
      assetName: MAIN_TOKEN_HEX,
      label: `${track}_two_stage_upgrade main`,
    },
    {
      validator: `${track}_two_stage_upgrade`,
      assetName: STAGING_TOKEN_HEX,
      label: `${track}_two_stage_upgrade staging`,
    },
  ]),
  ...THRESHOLDS.map((threshold) => ({
    validator: threshold,
    assetName: "",
    label: threshold,
  })),
];

/** The record's validator with this name. */
const named = (
  validators: readonly PlutusValidator[],
  name: string,
): Option.Option<PlutusValidator> =>
  Option.fromNullable(validators.find((v) => validatorName(v.title) === name));

const notInRecord = (name: string, missing: string): CheckResult => ({
  name,
  passed: false,
  details: `${missing} is not in the record`,
});

/** The outputs at the script with this hash that hold one of its tokens named `assetName`. */
const holding = (
  outputs: readonly TransactionUnspentOutput[],
  scriptHash: string,
  assetName: string,
): readonly TransactionUnspentOutput[] => {
  const asset = AssetId(scriptHash + assetName);
  return outputs.filter(
    (utxo) =>
      utxo.output().address().getProps().paymentPart?.hash === scriptHash &&
      utxo.output().amount().multiasset()?.get(asset) === 1n,
  );
};

/** Check 1: each track's forever compiled code contains its two-stage hash. */
export const checkEmbedding = (record: DeployedRecord): CheckResult[] =>
  tracksOf(record).map((track) => {
    const { validators } = record;
    const name = `${track}_forever embeds ${track}_two_stage_upgrade`;
    const forever = named(validators, `${track}_forever`);
    const twoStage = named(validators, `${track}_two_stage_upgrade`);
    if (Option.isNone(forever)) return notInRecord(name, `${track}_forever`);
    if (Option.isNone(twoStage)) {
      return notInRecord(name, `${track}_two_stage_upgrade`);
    }
    const passed = forever.value.compiledCode.includes(twoStage.value.hash);
    return {
      name,
      passed,
      details: `${track}_forever ${passed ? "contains" : "does not contain"} ${twoStage.value.hash}`,
    };
  });

/** Check 2: each expected NFT sits in exactly one unspent output at its script. */
export const checkPresence = (
  record: DeployedRecord,
  outputs: readonly TransactionUnspentOutput[],
): CheckResult[] =>
  expectedNfts(tracksOf(record)).map((nft) =>
    Option.match(named(record.validators, nft.validator), {
      onNone: () => notInRecord(nft.label, nft.validator),
      onSome: ({ hash }) => {
        const held = holding(outputs, hash, nft.assetName);
        return {
          name: nft.label,
          passed: held.length === 1,
          details: `${held.length} unspent output(s) at the script hold ${hash}.${nft.assetName}${held.length > 0 ? `: ${held.map((u) => refOf(u.input())).join(", ")}` : ""}`,
        };
      },
    }),
  );

/** One UpgradeState check: the track's main or staging datum against the record. */
const upgradeStateCheck = (
  { validators, versions }: DeployedRecord,
  outputs: readonly TransactionUnspentOutput[],
  track: Track,
  stage: "main" | "staging",
): CheckResult => {
  const name = `${track} ${stage}`;
  const authName = stage === "main" ? "main_gov_auth" : "staging_gov_auth";
  const twoStage = named(validators, `${track}_two_stage_upgrade`);
  const auth = named(validators, authName);
  if (Option.isNone(twoStage)) {
    return notInRecord(name, `${track}_two_stage_upgrade`);
  }
  if (Option.isNone(auth)) return notInRecord(name, authName);
  const held = holding(
    outputs,
    twoStage.value.hash,
    stage === "main" ? MAIN_TOKEN_HEX : STAGING_TOKEN_HEX,
  );
  if (held.length !== 1) {
    return {
      name,
      passed: false,
      details: `${held.length} unspent outputs hold the ${stage} NFT`,
    };
  }
  return Either.match(rawUpgradeStateAt(held[0]), {
    onLeft: (error) => ({ name, passed: false, details: renderError(error) }),
    onRight: ([
      logicHash,
      mitigationLogicHash,
      authHash,
      mitigationAuthHash,
    ]) => {
      const allowed =
        stage === "main"
          ? versions.promoted
          : [...versions.promoted, ...versions.staged];
      const logic = Option.map(
        Option.fromNullable(
          validators.find(
            (v) =>
              v.hash === logicHash &&
              isTrackLogic(track, validatorName(v.title)),
          ),
        ),
        (v) => validatorName(v.title),
      );
      const logicOk = Option.exists(logic, (l) => allowed.includes(l));
      const authOk = authHash === auth.value.hash;
      const mitigations = [
        mitigationCheck(validators, "mitigation logic", mitigationLogicHash),
        mitigationCheck(validators, "mitigation auth", mitigationAuthHash),
      ];
      return {
        name,
        passed: logicOk && authOk && mitigations.every((m) => m.passed),
        details: [
          `UTxO ${refOf(held[0].input())}`,
          Option.match(logic, {
            onNone: () =>
              `logic ${logicHash} is no ${track}_logic or ${track}_logic_v<N> in the record`,
            onSome: (l) =>
              `logic ${l} (${logicHash}) ${logicOk ? "is" : "is not"} ${stage === "main" ? "promoted" : "promoted or staged"} in versions.json`,
          }),
          `auth ${authHash} ${authOk ? "is" : "is not"} ${authName} (${auth.value.hash})`,
          ...mitigations.map((m) => m.detail),
        ].join("\n"),
      };
    },
  });
};

/** A mitigation field of an UpgradeState: empty, or the hash of a validator the record names. */
const mitigationCheck = (
  validators: readonly PlutusValidator[],
  label: string,
  hash: string,
): { readonly passed: boolean; readonly detail: string } => {
  if (hash === "") return { passed: true, detail: `${label} is empty` };
  const known = validators.find((v) => v.hash === hash);
  return known
    ? {
        passed: true,
        detail: `${label} ${validatorName(known.title)} (${hash}) is in the record`,
      }
    : { passed: false, detail: `${label} ${hash} is not in the record` };
};

/** Check 3: each track's main and staging UpgradeState. */
export const checkUpgradeStates = (
  record: DeployedRecord,
  outputs: readonly TransactionUnspentOutput[],
): CheckResult[] =>
  tracksOf(record).flatMap((track) =>
    (["main", "staging"] as const).map((stage) =>
      upgradeStateCheck(record, outputs, track, stage),
    ),
  );

/** Every check of the record against the unspent outputs at its scripts. */
export const verifyChecks = (
  record: DeployedRecord,
  outputs: readonly TransactionUnspentOutput[],
): readonly CheckSection[] => [
  {
    title: "Check 1: each forever embeds its two-stage hash",
    results: checkEmbedding(record),
  },
  {
    title: "Check 2: each NFT sits in one unspent output at its script",
    results: checkPresence(record, outputs),
  },
  {
    title: "Check 3: each UpgradeState names an allowed logic and its gov auth",
    results: checkUpgradeStates(record, outputs),
  },
];

/** The unspent outputs at every script whose NFT verify expects, through the Provider. */
const recordOutputs = (record: DeployedRecord, networkId: NetworkId) =>
  Effect.flatMap(Provider, (provider) =>
    Effect.map(
      Effect.forEach(
        [
          ...new Set(
            expectedNfts(tracksOf(record)).flatMap((nft) =>
              Option.toArray(named(record.validators, nft.validator)).map(
                (v) => v.hash,
              ),
            ),
          ),
        ],
        (hash) => provider.unspentOutputs(credentialAddress(networkId, hash)),
        { concurrency: 4 },
      ),
      (lists) => lists.flat(),
    ),
  );

const reportOf = (
  network: string,
  sections: readonly CheckSection[],
  failed: number,
  total: number,
): string =>
  [
    "# Deployment Verification Report",
    "",
    `**Network:** ${network}`,
    `**Date:** ${new Date().toISOString()}`,
    `**Result:** ${failed === 0 ? "ALL CHECKS PASSED" : `${failed} CHECK(S) FAILED`}`,
    `**Summary:** ${total - failed} passed, ${failed} failed, ${total} total`,
    "",
    "---",
    "",
    ...sections.flatMap(({ title, results }) => [
      `## ${title}`,
      "",
      ...results.flatMap((r) => [
        `### [${r.passed ? "PASS" : "FAIL"}] ${r.name}`,
        "",
        "```",
        r.details,
        "```",
        "",
      ]),
    ]),
  ].join("\n");

/** Check the deployed record against the chain; fails with VerificationFailed when any check fails. */
export const verifyProgram = (input: NetworkInput) =>
  Effect.gen(function* () {
    const { network } = input;
    const output = yield* Output;
    const record = yield* readRecord(network);
    const outputs = yield* recordOutputs(
      record,
      environmentOf(network).networkId,
    );
    yield* output.log(
      `Verifying the ${network} record against ${outputs.length} unspent outputs at its scripts...`,
    );
    yield* output.log("");

    const sections = verifyChecks(record, outputs);
    yield* Effect.forEach(
      sections,
      ({ title, results }) =>
        Effect.zipRight(
          output.log(`${title}...`),
          Effect.forEach(
            results,
            (r) => output.log(`  ${r.passed ? "PASS" : "FAIL"}: ${r.name}`),
            { discard: true },
          ),
        ).pipe(Effect.zipRight(output.log(""))),
      { discard: true },
    );

    const results = sections.flatMap((s) => s.results);
    const failed = results.filter((r) => !r.passed).length;
    const reportPath = resolve(`release/${network}`, "verification-report.md");
    yield* output.writeText(
      reportPath,
      reportOf(network, sections, failed, results.length),
    );
    yield* output.log(`Report saved to ${reportPath}`);
    yield* output.log("");
    if (failed > 0) return yield* new VerificationFailed({ failed });
    yield* output.log("VERIFICATION PASSED: All checks passed.");
    return sections;
  });
