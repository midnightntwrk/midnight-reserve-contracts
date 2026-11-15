/** Reports: verify's checks over the record a deploy of the default build leaves; the record read; dust-participants' count. */
import { randomBytes } from "crypto";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  addressFromCredential,
  AssetId,
  Credential,
  CredentialType,
  Hash28ByteBase16,
  NetworkId,
  PaymentAddress,
  PlutusData,
  TransactionId,
  TransactionInput,
  TransactionOutput,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import * as Contracts from "../contract_blueprint";
import { DeployedScripts, PROJECT_ROOT } from "../cli/config";
import {
  ContractResolver,
  type DeployedRecord,
} from "../cli/contracts/resolver";
import { validatorName } from "../cli/contracts/snapshot-read";
import {
  isTrackLogic,
  MAIN_TOKEN_HEX,
  STAGING_TOKEN_HEX,
} from "../cli/governance/two-stage";
import {
  checkEmbedding,
  checkPresence,
  checkUpgradeStates,
  CNIGHT_MINT_TRACK,
  dustUtxos,
  THRESHOLDS,
  tracksOf,
  verifyChecks,
} from "../cli/report";

const { validators } = JSON.parse(
  readFileSync(resolve(PROJECT_ROOT, "plutus-default.json"), "utf-8"),
) as {
  validators: { title: string; hash: string; compiledCode: string }[];
};

/** The record a deploy of the default build leaves: its validators, each one promoted except the v2 logics. */
const record: DeployedRecord = {
  validators: validators.map(({ title, hash, compiledCode }) => ({
    name: validatorName(title),
    hash,
    compiledCode,
  })),
  versions: {
    promoted: validators
      .map((v) => validatorName(v.title))
      .filter((name) => !name.endsWith("_v2")),
    staged: [],
  },
};

const hashOf = (name: string) =>
  Option.getOrThrow(
    Option.fromNullishOr(record.validators.find((v) => v.name === name)),
  ).hash;

const randomHash = (bytes: 28 | 32) => randomBytes(bytes).toString("hex");

const scriptAddress = (scriptHash: string) =>
  addressFromCredential(
    NetworkId.Testnet,
    Credential.fromCore({
      type: CredentialType.ScriptHash,
      hash: Hash28ByteBase16(scriptHash),
    }),
  );

/** An UpgradeState naming this logic and gov auth, the mitigations empty. */
const upgradeState = (logic: string, auth: string) =>
  serialize(Contracts.UpgradeState, [logic, "", auth, "", 0n, 0n]);

/** An unspent output at the script with this hash, holding its token `assetName` and the datum. */
const nftUtxo = (
  scriptHash: string,
  assetName: string,
  datum: PlutusData = PlutusData.newInteger(0n),
) =>
  new TransactionUnspentOutput(
    new TransactionInput(TransactionId(randomHash(32)), 0n),
    TransactionOutput.fromCore({
      address: PaymentAddress(scriptAddress(scriptHash).toBech32()),
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
  it.live(
    "the record over the chain its deploy leaves passes every check",
    () =>
      Effect.gen(function* () {
        const results = (yield* verifyChecks(record, deployedChain)).flatMap(
          (s) => s.results,
        );
        expect(results).toHaveLength(7 + 26 + 14);
        expect(failedNames(results)).toEqual([]);
      }),
  );

  it("a forever whose code lacks its two-stage hash fails the embedding check", () => {
    const changed = record.validators.map((v) =>
      v.name === "council_forever" ? { ...v, compiledCode: "00" } : v,
    );
    expect(
      failedNames(checkEmbedding({ ...record, validators: changed })),
    ).toEqual(["council_forever embeds council_two_stage_upgrade"]);
  });

  it("an NFT on no output or on two, or a validator the record lacks, fails the presence check", () => {
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
      (v) => v.name !== "terms_and_conditions_threshold",
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

  it("an NFT at another script's address does not count", () => {
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
                scriptAddress(hashOf("reserve_forever")).toBech32(),
              ),
            }),
          )
        : u,
    );
    expect(failedNames(checkPresence(record, moved))).toEqual(["ics_forever"]);
  });

  it.live.each<[string, TransactionUnspentOutput]>([
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
    [
      "a datum that is not an UpgradeState",
      nftUtxo(hashOf("council_two_stage_upgrade"), MAIN_TOKEN_HEX),
    ],
  ])("a main UpgradeState with %s fails", ([, utxo]) =>
    Effect.map(checkUpgradeStates(record, withCouncilMain(utxo)), (results) =>
      expect(failedNames(results)).toEqual(["council main"]),
    ),
  );

  it.live(
    "a staged v2 logic passes in the staging datum and fails in the main datum",
    () =>
      Effect.gen(function* () {
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
        expect(failedNames(yield* checkUpgradeStates(staged, chain))).toEqual(
          [],
        );
        expect(
          failedNames(
            yield* checkUpgradeStates(
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
      }),
  );

  it.live.each<[string, string, string, string[]]>([
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
    ([, mitigationLogic, mitigationAuth, failed]) => {
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
      return Effect.map(
        checkUpgradeStates(record, withCouncilMain(utxo)),
        (results) => expect(failedNames(results)).toEqual(failed),
      );
    },
  );

  it.live("a promoted council_logic_v3 passes in the main datum", () => {
    const v2 = record.validators.find((v) => v.name === "council_logic_v2")!;
    const v3 = { ...v2, name: "council_logic_v3", hash: "3a".repeat(28) };
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
    return Effect.map(
      checkUpgradeStates(withV3, withCouncilMain(utxo)),
      (results) => expect(failedNames(results)).toEqual([]),
    );
  });

  it.live(
    "cNIGHT minting is checked only where versions.json promotes its forever",
    () =>
      Effect.gen(function* () {
        const cnightTwoStage = hashOf("cnight_mint_two_stage_upgrade");
        const withoutCnight = deployedChain.filter(
          (u) =>
            u.output().address().getProps().paymentPart?.hash !==
            cnightTwoStage,
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
        const results = (yield* verifyChecks(
          notPromoting,
          withoutCnight,
        )).flatMap((section) => section.results);
        expect(results).toHaveLength(6 + 24 + 12);
        expect(failedNames(results)).toEqual([]);
        expect(
          failedNames(
            (yield* verifyChecks(record, withoutCnight)).flatMap(
              (section) => section.results,
            ),
          ),
        ).toEqual([
          `${CNIGHT_MINT_TRACK}_two_stage_upgrade main`,
          `${CNIGHT_MINT_TRACK}_two_stage_upgrade staging`,
          `${CNIGHT_MINT_TRACK} main`,
          `${CNIGHT_MINT_TRACK} staging`,
        ]);
      }),
  );
});

describe("isTrackLogic", () => {
  it.each<[string, boolean]>([
    ["council_logic", true],
    ["council_logic_v2", true],
    ["council_logic_v10", true],
    ["council_logic_v1", false],
    ["council_logic_v0", false],
    ["council_logic_v02", false],
    ["council_logic_vx", false],
    ["council_logic_v2_extra", false],
    ["reserve_logic_v3", false],
  ])("%s is a council logic: %s", (name, expected) => {
    expect(isTrackLogic("council", name)).toBe(expected);
  });
});

describe("ContractResolver.record", () => {
  const resolver = (environment: "preview" | "local") =>
    Layer.provide(
      ContractResolver.layer(environment),
      Layer.merge(NodeServices.layer, DeployedScripts.layer),
    );

  it.live(
    "reads the repository's preview record: its validators by name and versions.json",
    () =>
      Effect.gen(function* () {
        const read = yield* Effect.provide(
          Effect.flatMap(ContractResolver, (r) => r.record),
          resolver("preview"),
        );
        const plutus = JSON.parse(
          readFileSync(
            resolve(PROJECT_ROOT, "deployed-scripts/preview/plutus.json"),
            "utf-8",
          ),
        ) as { validators: { title: string; hash: string }[] };
        expect(read.validators.map((v) => [v.name, v.hash])).toEqual(
          plutus.validators.map((v) => [validatorName(v.title), v.hash]),
        );
        expect(read.versions).toEqual(
          JSON.parse(
            readFileSync(
              resolve(PROJECT_ROOT, "deployed-scripts/preview/versions.json"),
              "utf-8",
            ),
          ),
        );
      }),
  );

  it.live("local has no record", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.provide(
          Effect.flatMap(ContractResolver, (r) => r.record),
          resolver("local"),
        ),
      );
      expect(error).toMatchObject({
        _tag: "BlueprintError",
        environment: "local",
        source: "deployed",
      });
    }),
  );
});

describe("dustUtxos", () => {
  it("counts the outputs holding any token of the dust policy", () => {
    const policy = "d0".repeat(28);
    const holder = nftUtxo(policy, "");
    const named = nftUtxo(policy, "6e616d65");
    const other = nftUtxo("e0".repeat(28), "");
    expect(dustUtxos([holder, named, other], policy)).toEqual([holder, named]);
  });
});
