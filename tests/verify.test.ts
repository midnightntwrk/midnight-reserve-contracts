import { describe, expect, test } from "bun:test";
import {
  AssetId,
  NetworkId,
  PaymentAddress,
  PlutusData,
  TransactionId,
  TransactionInput,
  TransactionOutput,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Option } from "effect";
import { resolve } from "path";
import * as Contracts from "../contract_blueprint";
import { credentialAddress } from "../cli/contracts/contracts";
import { PROJECT_ROOT } from "../cli/contracts/paths";
import { PlutusJson } from "../cli/contracts/plutus-json";
import {
  type DeployedRecord,
  isTrackLogic,
  validatorName,
} from "../cli/contracts/versions";
import { readJsonFile } from "../cli/input";
import {
  MAIN_TOKEN_HEX,
  STAGING_TOKEN_HEX,
} from "../cli/chain/governance-provider";
import {
  checkEmbedding,
  checkPresence,
  checkUpgradeStates,
  CNIGHT_MINT_TRACK,
  THRESHOLDS,
  tracksOf,
  verifyChecks,
} from "../cli/report/verify";
import { randomHash, upgradeState } from "./helpers/fixtures";
import { PlatformLive, runTest } from "./helpers/effect";

/** The record a deploy of the default build leaves: its validators, each one promoted except the v2 logics. */
const { validators } = await runTest(
  PlatformLive,
  readJsonFile(
    resolve(PROJECT_ROOT, "plutus-default.json"),
    PlutusJson,
    (reason) => new Error(reason),
  ),
);
const record: DeployedRecord = {
  validators,
  versions: {
    promoted: validators
      .map((v) => validatorName(v.title))
      .filter((name) => !name.endsWith("_v2")),
    staged: [],
  },
};

const hashOf = (name: string) =>
  Option.getOrThrow(
    Option.fromNullable(
      record.validators.find((v) => validatorName(v.title) === name),
    ),
  ).hash;

/** An unspent output at the script with this hash, holding its token `assetName` and the datum. */
const nftUtxo = (
  scriptHash: string,
  assetName: string,
  datum: PlutusData = PlutusData.newInteger(0n),
) =>
  new TransactionUnspentOutput(
    new TransactionInput(TransactionId(randomHash(32)), 0n),
    TransactionOutput.fromCore({
      address: PaymentAddress(
        credentialAddress(NetworkId.Testnet, scriptHash).toBech32(),
      ),
      value: {
        coins: 2_000_000n,
        assets: new Map([[AssetId(scriptHash + assetName), 1n]]),
      },
      datum: datum.toCore(),
    }),
  );

/** A two-stage NFT output whose UpgradeState names this logic and gov auth. */
const twoStageUtxo = (
  track: string,
  assetName: string,
  logic: string,
  auth: string,
) =>
  nftUtxo(
    hashOf(`${track}_two_stage_upgrade`),
    assetName,
    upgradeState(hashOf(logic), hashOf(auth)),
  );

/** The chain a deploy of the record leaves: every NFT once (cNIGHT minting has no forever NFT), each UpgradeState on the v1 logic. */
const deployedChain = tracksOf(record)
  .flatMap((track) => [
    ...(track === CNIGHT_MINT_TRACK
      ? []
      : [nftUtxo(hashOf(`${track}_forever`), "")]),
    twoStageUtxo(track, MAIN_TOKEN_HEX, `${track}_logic`, "main_gov_auth"),
    twoStageUtxo(
      track,
      STAGING_TOKEN_HEX,
      `${track}_logic`,
      "staging_gov_auth",
    ),
  ])
  .concat(THRESHOLDS.map((threshold) => nftUtxo(hashOf(threshold), "")));

const failedNames = (results: readonly { name: string; passed: boolean }[]) =>
  results.filter((r) => !r.passed).map((r) => r.name);

/** The deployed chain with the council main UpgradeState replaced. */
const withCouncilMain = (utxo: TransactionUnspentOutput) =>
  deployedChain.map((u, i) => (i === 4 ? utxo : u));

describe("verify checks", () => {
  test("the record over the chain its deploy leaves passes every check", () => {
    const results = verifyChecks(record, deployedChain).flatMap(
      (s) => s.results,
    );
    expect(results).toHaveLength(7 + 26 + 14);
    expect(failedNames(results)).toEqual([]);
  });

  test("a forever whose code lacks its two-stage hash fails the embedding check", () => {
    const validators = record.validators.map((v) =>
      validatorName(v.title) === "council_forever"
        ? { ...v, compiledCode: "00" }
        : v,
    );
    expect(failedNames(checkEmbedding({ ...record, validators }))).toEqual([
      "council_forever embeds council_two_stage_upgrade",
    ]);
  });

  test("an NFT on no output or on two, or a validator the record lacks, fails the presence check", () => {
    const missing = deployedChain.filter(
      (u) =>
        u
          .output()
          .amount()
          .multiasset()
          ?.get(AssetId(hashOf("main_gov_threshold"))) !== 1n,
    );
    expect(failedNames(checkPresence(record, missing))).toEqual([
      "main_gov_threshold",
    ]);

    const doubled = [...deployedChain, nftUtxo(hashOf("reserve_forever"), "")];
    expect(failedNames(checkPresence(record, doubled))).toEqual([
      "reserve_forever",
    ]);

    const withoutThreshold = record.validators.filter(
      (v) => validatorName(v.title) !== "terms_and_conditions_threshold",
    );
    expect(
      failedNames(
        checkPresence(
          { ...record, validators: withoutThreshold },
          deployedChain,
        ),
      ),
    ).toEqual(["terms_and_conditions_threshold"]);
  });

  test("an NFT at another script's address does not count", () => {
    const moved = deployedChain.map((u) =>
      u
        .output()
        .amount()
        .multiasset()
        ?.get(AssetId(hashOf("ics_forever"))) === 1n
        ? new TransactionUnspentOutput(
            u.input(),
            TransactionOutput.fromCore({
              ...u.output().toCore(),
              address: PaymentAddress(
                credentialAddress(
                  NetworkId.Testnet,
                  hashOf("reserve_forever"),
                ).toBech32(),
              ),
            }),
          )
        : u,
    );
    expect(failedNames(checkPresence(record, moved))).toEqual(["ics_forever"]);
  });

  test.each([
    [
      "the staging gov auth in the main datum",
      twoStageUtxo(
        "council",
        MAIN_TOKEN_HEX,
        "council_logic",
        "staging_gov_auth",
      ),
    ],
    [
      "a v2 logic that versions.json does not promote",
      twoStageUtxo(
        "council",
        MAIN_TOKEN_HEX,
        "council_logic_v2",
        "main_gov_auth",
      ),
    ],
    [
      "another track's logic",
      twoStageUtxo("council", MAIN_TOKEN_HEX, "reserve_logic", "main_gov_auth"),
    ],
  ])("a main UpgradeState with %s fails", (_case, utxo) => {
    expect(
      failedNames(checkUpgradeStates(record, withCouncilMain(utxo))),
    ).toEqual(["council main"]);
  });

  test("a staged v2 logic passes in the staging datum and fails in the main datum", () => {
    const staged: DeployedRecord = {
      ...record,
      versions: { ...record.versions, staged: ["council_logic_v2"] },
    };
    const chain = deployedChain.map((u, i) =>
      i === 5
        ? twoStageUtxo(
            "council",
            STAGING_TOKEN_HEX,
            "council_logic_v2",
            "staging_gov_auth",
          )
        : u,
    );
    expect(failedNames(checkUpgradeStates(staged, chain))).toEqual([]);
    expect(
      failedNames(
        checkUpgradeStates(
          staged,
          chain.map((u, i) =>
            i === 4
              ? twoStageUtxo(
                  "council",
                  MAIN_TOKEN_HEX,
                  "council_logic_v2",
                  "main_gov_auth",
                )
              : u,
          ),
        ),
      ),
    ).toEqual(["council main"]);
  });

  test.each([
    ["an unknown mitigation logic", "ab".repeat(28), "", ["council main"]],
    ["an unknown mitigation auth", "", "cd".repeat(28), ["council main"]],
    [
      "a mitigation logic and auth the record names",
      "council_logic_v2",
      "main_gov_auth",
      [],
    ],
  ])(
    "a main UpgradeState with %s",
    (_case, mitigationLogic, mitigationAuth, failed) => {
      const known = (value: string) =>
        value.endsWith("_v2") || value.endsWith("_auth")
          ? hashOf(value)
          : value;
      const utxo = nftUtxo(
        hashOf("council_two_stage_upgrade"),
        MAIN_TOKEN_HEX,
        serialize(Contracts.UpgradeState, [
          hashOf("council_logic"),
          known(mitigationLogic),
          hashOf("main_gov_auth"),
          known(mitigationAuth),
          0n,
          0n,
        ]),
      );
      expect(
        failedNames(checkUpgradeStates(record, withCouncilMain(utxo))),
      ).toEqual(failed);
    },
  );

  test("a promoted council_logic_v3 passes in the main datum", () => {
    const v2 = record.validators.find(
      (v) => validatorName(v.title) === "council_logic_v2",
    )!;
    const v3 = {
      ...v2,
      title: "permissioned_v3.council_logic_v3.else",
      hash: "3a".repeat(28),
    };
    const withV3: DeployedRecord = {
      validators: [...record.validators, v3],
      versions: {
        ...record.versions,
        promoted: [...record.versions.promoted, "council_logic_v3"],
      },
    };
    const utxo = nftUtxo(
      hashOf("council_two_stage_upgrade"),
      MAIN_TOKEN_HEX,
      upgradeState(v3.hash, hashOf("main_gov_auth")),
    );
    expect(
      failedNames(checkUpgradeStates(withV3, withCouncilMain(utxo))),
    ).toEqual([]);
  });

  test("cNIGHT minting is checked only where versions.json promotes its forever", () => {
    const cnightTwoStage = hashOf("cnight_mint_two_stage_upgrade");
    const withoutCnight = deployedChain.filter(
      (u) =>
        u.output().address().getProps().paymentPart?.hash !== cnightTwoStage,
    );
    const notPromoting: DeployedRecord = {
      ...record,
      versions: {
        ...record.versions,
        promoted: record.versions.promoted.filter(
          (name) => name !== `${CNIGHT_MINT_TRACK}_forever`,
        ),
      },
    };
    const results = verifyChecks(notPromoting, withoutCnight).flatMap(
      (section) => section.results,
    );
    expect(results).toHaveLength(6 + 24 + 12);
    expect(failedNames(results)).toEqual([]);
    expect(
      failedNames(
        verifyChecks(record, withoutCnight).flatMap(
          (section) => section.results,
        ),
      ),
    ).toEqual([
      `${CNIGHT_MINT_TRACK}_two_stage_upgrade main`,
      `${CNIGHT_MINT_TRACK}_two_stage_upgrade staging`,
      `${CNIGHT_MINT_TRACK} main`,
      `${CNIGHT_MINT_TRACK} staging`,
    ]);
  });
});

describe("isTrackLogic", () => {
  test.each([
    ["council_logic", true],
    ["council_logic_v2", true],
    ["council_logic_v3", true],
    ["council_logic_v10", true],
    ["council_logic_v1", false],
    ["council_logic_v0", false],
    ["council_logic_v02", false],
    ["council_logic_vx", false],
    ["council_logic_v2_extra", false],
    ["reserve_logic_v3", false],
  ])("%s is a council logic: %p", (name, expected) => {
    expect(isTrackLogic("council", name)).toBe(expected);
  });
});
