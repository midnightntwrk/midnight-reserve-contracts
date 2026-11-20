import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, afterEach, describe, expect, it } from "@effect/vitest";
import { Config, ConfigProvider, Console, Effect, Layer, Option } from "effect";
import {
  DeployerAddress,
  ENVIRONMENTS,
  type Environment,
  envLayer,
  environmentOf,
  envOr,
  initialTermsAndConditions,
  loggingLayer,
  newSigners,
  parseNetworkConfig,
  permissionedCandidates,
  reservedRefs,
} from "../cli/config";
import { parsePositiveInteger } from "../cli/input";
import * as TOML from "toml";
import { renderError } from "../cli/errors";
import { type KeyGroup, Keys } from "../cli/keys";

const tmp = mkdtempSync(join(tmpdir(), "env-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const dotEnv = join(tmp, ".env");
writeFileSync(
  dotEnv,
  [
    "MRC_TEST_SHELL_EMPTY=from-dotenv",
    "MRC_TEST_SHELL_SET=from-dotenv",
    "MRC_TEST_DOTENV_ONLY=from-dotenv",
  ].join("\n"),
);

afterEach(() => {
  delete process.env.MRC_TEST_SHELL_EMPTY;
  delete process.env.MRC_TEST_SHELL_SET;
});

/** The values of the test variables through envLayer over the given dotenv file. */
const read = (dotEnvPath: string) =>
  Effect.gen(function* () {
    process.env.MRC_TEST_SHELL_EMPTY = "";
    process.env.MRC_TEST_SHELL_SET = "from-shell";
    const value = (name: string) => Config.option(Config.String(name));
    return yield* Effect.all({
      shellEmpty: value("MRC_TEST_SHELL_EMPTY"),
      shellSet: value("MRC_TEST_SHELL_SET"),
      dotEnvOnly: value("MRC_TEST_DOTENV_ONLY"),
      neither: value("MRC_TEST_NEITHER"),
    }).pipe(
      Effect.provide(Layer.provide(envLayer(dotEnvPath), NodeServices.layer)),
    );
  });

describe("envLayer", () => {
  it.live(
    "the environment wins, an empty value included; .env fills only what it does not set",
    () =>
      Effect.gen(function* () {
        expect(yield* read(dotEnv)).toEqual({
          shellEmpty: Option.some(""),
          shellSet: Option.some("from-shell"),
          dotEnvOnly: Option.some("from-dotenv"),
          neither: Option.none(),
        });
      }),
  );

  it.live("a missing .env adds nothing", () =>
    Effect.gen(function* () {
      expect(yield* read(join(tmp, "absent.env"))).toEqual({
        shellEmpty: Option.some(""),
        shellSet: Option.some("from-shell"),
        dotEnvOnly: Option.none(),
        neither: Option.none(),
      });
    }),
  );
});

/** Run `effect` with `values` as the whole environment, over the DeployerAddress layer of `environment` and the Keys layer. */
const withEnv =
  (values: Record<string, string>, environment: Environment = "preview") =>
  <A, E>(effect: Effect.Effect<A, E, DeployerAddress | Keys>) =>
    Effect.provide(
      effect,
      Layer.mergeAll(
        DeployerAddress.layer(environment),
        Keys.layer,
        ConfigProvider.layer(ConfigProvider.fromUnknown(values)),
      ),
    );

const address = Effect.flatMap(DeployerAddress, (d) => d.address);
const MAINNET_ADDRESS =
  "addr1v9uumy8pse90t4juh8hvx3y0xzn439na3hxadq55luydtgqg8mh8a";
const TESTNET_ADDRESS =
  "addr_test1qruhen60uwzpwnnr7gjs50z2v8u9zyfw6zunet4k42zrpr54mrlv55f93rs6j48wt29w90hlxt4rvpvshe55k5r9mpvqjv2wt4";

describe("DeployerAddress", () => {
  it.live.each([
    {
      value: MAINNET_ADDRESS,
      reason: `'${MAINNET_ADDRESS}' is a Mainnet address; preview is on Testnet`,
    },
    { value: "addr_nope", reason: "'addr_nope' is not a bech32 address" },
    { value: "", reason: "required for non-local environment 'preview'" },
  ])(
    "DEPLOYER_ADDRESS '$value' on preview is a ConfigError",
    ({ value, reason }) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          withEnv({ DEPLOYER_ADDRESS: value })(address),
        );
        expect(error.key).toBe("DEPLOYER_ADDRESS");
        expect(error.reason).toContain(reason);
      }),
  );

  it.live("an address on the environment's network is the deployer", () =>
    Effect.gen(function* () {
      const read = yield* withEnv(
        { DEPLOYER_ADDRESS: MAINNET_ADDRESS },
        "mainnet",
      )(address);
      expect(read.toBech32()).toBe(MAINNET_ADDRESS);
    }),
  );

  it.live("unset on local and the emulator is the fixed test address", () =>
    Effect.gen(function* () {
      for (const environment of ["local", "emulator"] as const) {
        const read = yield* withEnv({}, environment)(address);
        expect(read.toBech32()).toBe(TESTNET_ADDRESS);
      }
    }),
  );
});

const privateKeys = (group: KeyGroup) =>
  Effect.flatMap(Keys, (keys) => keys.privateKeys(group));
const signingKey = (variable: string) =>
  Effect.flatMap(Keys, (keys) => keys.signingKey(variable));
const NORMAL_KEY = "ab".repeat(32);
const EXTENDED_KEY = "cd".repeat(64);

describe("Keys", () => {
  it.live("unset or empty private keys are a ConfigError", () =>
    Effect.gen(function* () {
      const unset: Record<string, string>[] = [
        {},
        { COUNCIL_PRIVATE_KEYS: "" },
      ];
      for (const values of unset) {
        const error = yield* Effect.flip(
          withEnv(values)(privateKeys("council")),
        );
        expect(error).toMatchObject({
          key: "COUNCIL_PRIVATE_KEYS",
          reason: "required but not set",
        });
      }
    }),
  );

  it.live("reads 64- and 128-hex keys, trimmed, blanks dropped", () =>
    Effect.gen(function* () {
      const keys = yield* withEnv({
        TECH_AUTH_PRIVATE_KEYS: ` ${NORMAL_KEY} , ,\n${EXTENDED_KEY} `,
      })(privateKeys("techAuth"));
      expect(keys).toEqual([NORMAL_KEY, EXTENDED_KEY]);
    }),
  );

  it.live("only blanks resolve to zero keys", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        withEnv({ COUNCIL_PRIVATE_KEYS: " , " })(privateKeys("council")),
      );
      expect(error.reason).toBe("resolved to zero keys");
    }),
  );

  it.live("a key of the wrong length is refused without quoting it", () =>
    Effect.gen(function* () {
      const bad = "ab".repeat(40);
      const error = yield* Effect.flip(
        withEnv({ COUNCIL_PRIVATE_KEYS: `${NORMAL_KEY},${bad}` })(
          privateKeys("council"),
        ),
      );
      expect(error.key).toBe("COUNCIL_PRIVATE_KEYS");
      expect(error.reason).toBe(
        "a private key must be 64 or 128 hex characters, not 80",
      );
      expect(renderError(error)).not.toContain(bad);
    }),
  );

  it.live("the signing key is read from the named variable, trimmed", () =>
    Effect.gen(function* () {
      const key = yield* withEnv({ MY_SIGNING_KEY: `  ${EXTENDED_KEY}\n` })(
        signingKey("MY_SIGNING_KEY"),
      );
      expect(key).toBe(EXTENDED_KEY);
      const error = yield* Effect.flip(
        withEnv({ MY_SIGNING_KEY: "not hex" })(signingKey("MY_SIGNING_KEY")),
      );
      expect(error).toMatchObject({
        key: "MY_SIGNING_KEY",
        reason: "a private key must be hex",
      });
    }),
  );
});

const HASH = "AB".repeat(28);
const SR25519 = "CD".repeat(32);

describe("env intent", () => {
  it.live("signers are lower-cased, a duplicate kept", () =>
    Effect.gen(function* () {
      const signers = yield* withEnv({
        COUNCIL_SIGNERS: ` ${HASH}:${SR25519} , ${HASH} : ${SR25519}`,
      })(newSigners("COUNCIL_SIGNERS"));
      const signer = {
        paymentHash: HASH.toLowerCase(),
        sr25519Key: SR25519.toLowerCase(),
      };
      expect(signers).toEqual([signer, signer]);
    }),
  );

  it.live.each([
    {
      value: `${HASH}:${SR25519},,${HASH}:${SR25519}`,
      issue: "signer entry at position 2 is empty",
    },
    {
      value: `${HASH}:${SR25519}:extra`,
      issue: `signer entry '${HASH}:${SR25519}:extra' must contain exactly one ':' delimiter`,
    },
    {
      value: `${HASH}:`,
      issue: `signer entry '${HASH}:' must include non-empty payment hash and sr25519 key`,
    },
    {
      value: `abcd:${SR25519}`,
      issue: "payment hash must be 56 hex characters (28 bytes), got 'abcd'",
    },
  ])("TECH_AUTH_SIGNERS is refused: $issue", ({ value, issue }) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        withEnv({ TECH_AUTH_SIGNERS: value })(newSigners("TECH_AUTH_SIGNERS")),
      );
      expect(error).toMatchObject({
        _tag: "InputParseError",
        source: "TECH_AUTH_SIGNERS",
        issues: [issue],
      });
    }),
  );

  it.live("unset signers are a ConfigError", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        withEnv({})(newSigners("COUNCIL_SIGNERS")),
      );
      expect(error).toMatchObject({
        _tag: "ConfigError",
        key: "COUNCIL_SIGNERS",
      });
    }),
  );

  const candidate = (keys: string) => `{ ${keys} }`;
  const FULL =
    "sidechain_pub_key: 01, aura_pub_key: 02, grandpa_pub_key: 03, beefy_pub_key: 04";

  it.live(
    "candidates: entries split by commas or new lines, babe optional",
    () =>
      Effect.gen(function* () {
        const candidates = yield* withEnv({
          PERMISSIONED_CANDIDATES: `[ ${candidate(FULL)},\n${candidate(
            FULL.replaceAll(", ", "\n") + "\nbabe_pub_key: 05",
          )} ]`,
        })(permissionedCandidates);
        const first = {
          sidechain_pub_key: "01",
          aura_pub_key: "02",
          grandpa_pub_key: "03",
          beefy_pub_key: "04",
        };
        expect(candidates).toEqual([first, { ...first, babe_pub_key: "05" }]);
      }),
  );

  it.live.each([
    {
      value: `[ ${candidate(`${FULL}, babe_pub_key 05`)} ]`,
      issue: "candidate at index 0 has an entry without ':': babe_pub_key 05",
    },
    {
      value: `[ ${candidate("sidechain_pub_key: 01")} ]`,
      issue: "candidate at index 0 is missing required field: aura_pub_key",
    },
    {
      value: `[ ${candidate(FULL.replace("04", "zz"))} ]`,
      issue: "candidate at index 0 has invalid hex value for beefy_pub_key: zz",
    },
    { value: `[ { ${FULL} ]`, issue: "unbalanced braces (depth=1)" },
    { value: FULL, issue: "expected input to be wrapped in [ ]" },
  ])("PERMISSIONED_CANDIDATES is refused: $issue", ({ value, issue }) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        withEnv({ PERMISSIONED_CANDIDATES: value })(permissionedCandidates),
      );
      expect(error).toMatchObject({
        _tag: "InputParseError",
        source: "PERMISSIONED_CANDIDATES",
        issues: [issue],
      });
    }),
  );

  it.live(
    "the first terms and conditions: zeros and an empty link when unset",
    () =>
      Effect.gen(function* () {
        expect(yield* withEnv({})(initialTermsAndConditions)).toEqual({
          hash: "00".repeat(32),
          link: "",
        });
        expect(
          yield* withEnv({
            TERMS_AND_CONDITIONS_INITIAL_HASH: "AB".repeat(32),
            TERMS_AND_CONDITIONS_INITIAL_LINK: "https://x",
          })(initialTermsAndConditions),
        ).toEqual({
          hash: "ab".repeat(32),
          link: Buffer.from("https://x").toString("hex"),
        });
        const error = yield* Effect.flip(
          withEnv({ TERMS_AND_CONDITIONS_INITIAL_HASH: "ab" })(
            initialTermsAndConditions,
          ),
        );
        expect(error).toMatchObject({
          key: "TERMS_AND_CONDITIONS_INITIAL_HASH",
          reason: "'ab' must be 64 hex characters",
        });
      }),
  );
});

describe("aiken.toml profile parsing", () => {
  const AIKEN_TOML = readFileSync("aiken.toml", "utf-8");
  const hashProfile = (index: string, hashField: string) =>
    [
      "[config.mainnet]",
      `technical_authority_one_shot_index = ${index}`,
      "",
      "[config.mainnet.technical_authority_one_shot_hash]",
      hashField,
      "",
    ].join("\n");
  const HEX_HASH = `bytes = '${"ab".repeat(32)}'\nencoding = 'hex'`;

  it.live.each([
    {
      name: "the missing config table",
      toml: "[other]\nvalue = 1\n",
      key: ".config",
      reason: "expected a table",
    },
    {
      name: "a profile that is not a table",
      toml: "[config]\nmainnet = 'oops'\n",
      key: "config.mainnet",
      reason: "expected a table",
    },
    {
      name: "a hash field that is not hex-encoded",
      toml: hashProfile("0", "bytes = 'NIGHT'\nencoding = 'utf8'"),
      key: "config.mainnet.technical_authority_one_shot_hash.encoding",
      reason: 'expected "hex"',
    },
    {
      name: "a hash field without bytes",
      toml: hashProfile("0", "value = 'not-bytes'\nencoding = 'hex'"),
      key: "config.mainnet.technical_authority_one_shot_hash.bytes",
      reason: "expected hex",
    },
    {
      name: "a hash field whose bytes are not hex",
      toml: hashProfile("0", "bytes = 'zz'\nencoding = 'hex'"),
      key: "config.mainnet.technical_authority_one_shot_hash.bytes",
      reason: "expected hex",
    },
    {
      name: "an index that is not an integer",
      toml: hashProfile("1.5", HEX_HASH),
      key: "config.mainnet.technical_authority_one_shot_index",
      reason: "expected an integer",
    },
    {
      name: "an index below zero",
      toml: hashProfile("-1", HEX_HASH),
      key: "config.mainnet.technical_authority_one_shot_index",
      reason: "'-1' is not a non-negative base-10 integer",
    },
    {
      name: "unparsable TOML as the file itself",
      toml: "config = \n",
      key: "",
      reason: undefined,
    },
  ])("names $name", ({ toml, key, reason }) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(parseNetworkConfig("mainnet", toml));
      expect(error.source).toBe("aiken.toml");
      expect(error.key).toBe(key);
      if (reason) expect(error.reason).toBe(reason);
    }),
  );

  it.live("parses every profile of the repository aiken.toml", () =>
    Effect.gen(function* () {
      for (const environment of ENVIRONMENTS) {
        yield* parseNetworkConfig(environment, AIKEN_TOML);
      }
      const mainnet = yield* parseNetworkConfig("mainnet", AIKEN_TOML);
      expect(mainnet.cnight_name).toBe("NIGHT");
    }),
  );

  it.live(
    "an empty collateral hash is refused: every profile names its collateral",
    () =>
      Effect.gen(function* () {
        const { collateral_utxo_hash } = yield* parseNetworkConfig(
          "mainnet",
          AIKEN_TOML,
        );
        const table = `[config.mainnet.collateral_utxo_hash]\nbytes = "${collateral_utxo_hash}"`;
        expect(AIKEN_TOML).toContain(table);
        const error = yield* Effect.flip(
          parseNetworkConfig(
            "mainnet",
            AIKEN_TOML.replace(
              table,
              `[config.mainnet.collateral_utxo_hash]\nbytes = ""`,
            ),
          ),
        );
        expect(error).toMatchObject({
          key: "config.mainnet.collateral_utxo_hash.bytes",
          reason: "'' must be 64 hex characters",
        });
      }),
  );

  it.live("reads hex bytes in lower case", () =>
    Effect.gen(function* () {
      const { cnight_policy } = yield* parseNetworkConfig(
        "mainnet",
        AIKEN_TOML,
      );
      const upper = AIKEN_TOML.replaceAll(
        `"${cnight_policy}"`,
        `"${cnight_policy.toUpperCase()}"`,
      );
      expect(upper).not.toBe(AIKEN_TOML);
      const parsed = yield* parseNetworkConfig("mainnet", upper);
      expect(parsed.cnight_policy).toBe(cnight_policy);
    }),
  );
});

describe("reservedRefs", () => {
  it.live.each(ENVIRONMENTS)(
    "%s: holds every UTxO reference its profile names, the bridge one-shots included",
    (environment) =>
      Effect.gen(function* () {
        const text = readFileSync("aiken.toml", "utf-8");
        const profile = (
          TOML.parse(text) as {
            config: Record<string, Record<string, unknown>>;
          }
        ).config[environmentOf(environment).aikenConfigSection];
        const named = Object.keys(profile)
          .filter((key) => key.endsWith("_index"))
          .map((key) => {
            const hash = profile[key.replace(/_index$/, "_hash")] as {
              bytes: string;
            };
            return `${hash.bytes.toLowerCase()}#${String(profile[key])}`;
          });
        const reserved = reservedRefs(
          yield* parseNetworkConfig(environment, text),
        );
        expect([...new Set(named)].sort()).toEqual([...reserved].sort());
      }),
  );
});

describe("envOr", () => {
  const read = (values: Record<string, string>) =>
    Effect.provide(
      envOr("SIMPLE_TX_COUNT", parsePositiveInteger, 16),
      ConfigProvider.layer(ConfigProvider.fromUnknown(values)),
    );

  it.live("an unset or empty value is the fallback; a set one is parsed", () =>
    Effect.gen(function* () {
      expect(yield* read({})).toBe(16);
      expect(yield* read({ SIMPLE_TX_COUNT: "" })).toBe(16);
      expect(yield* read({ SIMPLE_TX_COUNT: "3" })).toBe(3);
    }),
  );

  it.live(
    "a value the parser refuses is a ConfigError naming the variable",
    () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(read({ SIMPLE_TX_COUNT: "0" }));
        expect(error).toMatchObject({
          _tag: "ConfigError",
          key: "SIMPLE_TX_COUNT",
        });
      }),
  );
});

/** Log a warning, an info and a debug line under `loggingLayer` with `values` as the environment; what a recording Console received on stdout (log) and on stderr (error). */
const logged = (values: Record<string, string>) =>
  Effect.gen(function* () {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const recording = {
      ...console,
      log: (...args: unknown[]) => void stdout.push(args.join(" ")),
      error: (...args: unknown[]) => void stderr.push(args.join(" ")),
    };
    yield* Effect.gen(function* () {
      yield* Effect.logWarning("a warning");
      yield* Effect.logInfo("an info");
      yield* Effect.logDebug("a debug");
    }).pipe(
      Effect.provide(
        Layer.provide(
          loggingLayer,
          ConfigProvider.layer(ConfigProvider.fromUnknown(values)),
        ),
      ),
      Effect.provideService(Console.Console, recording),
    );
    return { stdout, stderr };
  });

describe("loggingLayer", () => {
  it.live("logs go to stderr, never stdout, from Info up by default", () =>
    Effect.gen(function* () {
      for (const values of [{}, { LOG_LEVEL: "" }] as Record<
        string,
        string
      >[]) {
        const { stdout, stderr } = yield* logged(values);
        expect(stdout).toEqual([]);
        expect(stderr).toHaveLength(2);
        expect(stderr[0]).toContain("WARN");
        expect(stderr[0]).toContain("a warning");
        expect(stderr[1]).toContain("INFO");
      }
    }),
  );

  it.live("LOG_LEVEL sets the minimum level, in any case", () =>
    Effect.gen(function* () {
      const warn = yield* logged({ LOG_LEVEL: "warn" });
      expect(warn.stderr).toHaveLength(1);
      expect(warn.stdout).toEqual([]);
      const debug = yield* logged({ LOG_LEVEL: "DEBUG" });
      expect(debug.stderr).toHaveLength(3);
      expect(debug.stdout).toEqual([]);
      const none = yield* logged({ LOG_LEVEL: "None" });
      expect(none).toEqual({ stdout: [], stderr: [] });
    }),
  );

  it.live("the Effect 3 CLI's Warning and OFF still work", () =>
    Effect.gen(function* () {
      const warning = yield* logged({ LOG_LEVEL: "Warning" });
      expect(warning.stderr).toHaveLength(1);
      const off = yield* logged({ LOG_LEVEL: "OFF" });
      expect(off).toEqual({ stdout: [], stderr: [] });
    }),
  );

  it.live("a bad LOG_LEVEL is a ConfigError naming the variable", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(logged({ LOG_LEVEL: "loud" }));
      expect(error).toMatchObject({ _tag: "ConfigError", key: "LOG_LEVEL" });
      expect(error.reason).toContain("'loud' is not a log level");
    }),
  );
});
