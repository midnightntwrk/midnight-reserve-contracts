import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { TOML } from "bun";
import { Effect, Either, Layer, LogLevel, Schema } from "effect";
import { DotEnvFallback } from "../cli/run";
import { ENVIRONMENTS, environmentOf } from "../cli/config/network-mapping";
import {
  Settings,
  SettingsLive,
  parseLogLevel,
  parseNetworkConfig,
  reservedRefs,
} from "../cli/config/settings";
import { SIMPLE_TX_AMOUNT, SIMPLE_TX_COUNT } from "../cli/wallet/simple-tx";
import {
  EnvValues,
  expectFailure,
  runTest,
  leftOf,
  PlatformLive,
  SettingsWith,
  testEnv as env,
  TestEnvLive,
} from "./helpers/effect";

describe("simple-tx env fallbacks", () => {
  test("an empty or unset value reads as the fallback", async () => {
    const unset: Record<string, string>[] = [
      { SIMPLE_TX_COUNT: "", SIMPLE_TX_AMOUNT: "" },
      {},
    ];
    for (const values of unset) {
      expect(
        await runTest(
          EnvValues(values),
          Effect.all([SIMPLE_TX_COUNT, SIMPLE_TX_AMOUNT]),
        ),
      ).toEqual([16, 20_000_000n]);
    }
  });
});

describe("env values through SettingsLive", () => {
  test("an empty required value reads as unset", async () => {
    const error = await expectFailure(
      SettingsWith("emulator", { BLOCKFROST_PREVIEW_API_KEY: "" }),
      Effect.flatMap(Settings, (s) => s.blockfrostApiKey("preview")),
      "ConfigError",
    );
    expect(error).toMatchObject({
      key: "BLOCKFROST_PREVIEW_API_KEY",
      reason: "required but not set",
    });
  });
});

describe("DEPLOYER_ADDRESS", () => {
  const mainnet = "addr1v9uumy8pse90t4juh8hvx3y0xzn439na3hxadq55luydtgqg8mh8a";
  const deployerAddress = Effect.flatMap(Settings, (s) => s.deployerAddress);

  test.each([
    [mainnet, `'${mainnet}' is a Mainnet address; preview is on Testnet`],
    ["addr_nope", "is not a bech32 address"],
    ["", "required for non-local environment 'preview'"],
  ])(
    "preview with '%s' is a ConfigError naming the key",
    async (value, reason) => {
      const error = await expectFailure(
        SettingsWith("preview", { DEPLOYER_ADDRESS: value }),
        deployerAddress,
        "ConfigError",
      );
      expect(error.key).toBe("DEPLOYER_ADDRESS");
      expect(error.reason).toContain(reason);
    },
  );
});

describe("aiken.toml profile parsing", () => {
  const hashProfile = (index: string, hashField: string) =>
    [
      "[config.mainnet]",
      `technical_authority_one_shot_index = ${index}`,
      "",
      "[config.mainnet.technical_authority_one_shot_hash]",
      hashField,
      "",
    ].join("\n");

  test.each([
    [
      "the missing config table",
      "[other]\nvalue = 1\n",
      ".config",
      "expected a table",
    ],
    [
      "a profile that is not a table",
      "[config]\nmainnet = 'oops'\n",
      "config.mainnet",
      undefined,
    ],
    [
      "a hash field that is not hex-encoded",
      hashProfile("0", "bytes = 'NIGHT'\nencoding = 'utf8'"),
      "config.mainnet.technical_authority_one_shot_hash.encoding",
      'expected "hex"',
    ],
    [
      "a hash field without bytes",
      hashProfile("0", "value = 'not-bytes'\nencoding = 'hex'"),
      "config.mainnet.technical_authority_one_shot_hash.bytes",
      "expected hex",
    ],
    [
      "a hash field whose bytes are not hex",
      hashProfile("0", "bytes = 'zz'\nencoding = 'hex'"),
      "config.mainnet.technical_authority_one_shot_hash.bytes",
      "expected hex",
    ],
    [
      "an index field that is not an integer",
      hashProfile("1.5", `bytes = '${"ab".repeat(32)}'\nencoding = 'hex'`),
      "config.mainnet.technical_authority_one_shot_index",
      "expected an integer",
    ],
    ["unparsable TOML as the file itself", "config = \n", "", undefined],
  ])("names %s", (_name, toml, key, reason) => {
    const error = leftOf(parseNetworkConfig("mainnet", toml));
    expect(error.source).toBe("aiken.toml");
    expect(error.key).toBe(key);
    if (reason) expect(error.reason).toBe(reason);
  });

  test("parses every profile of the repository aiken.toml", () => {
    const text = readFileSync("aiken.toml", "utf-8");
    for (const env of ENVIRONMENTS) {
      Either.getOrThrow(parseNetworkConfig(env, text));
    }
    expect(
      Either.map(parseNetworkConfig("mainnet", text), (c) => c.cnight_name),
    ).toEqual(Either.right("NIGHT"));
  });

  test("an empty collateral hash is refused: every profile names its collateral", () => {
    const text = readFileSync("aiken.toml", "utf-8");
    const hash = Either.getOrThrow(
      parseNetworkConfig("mainnet", text),
    ).collateral_utxo_hash;
    const table = `[config.mainnet.collateral_utxo_hash]\nbytes = "${hash}"`;
    expect(text).toContain(table);
    const error = leftOf(
      parseNetworkConfig(
        "mainnet",
        text.replace(
          table,
          `[config.mainnet.collateral_utxo_hash]\nbytes = ""`,
        ),
      ),
    );
    expect(error.key).toBe("config.mainnet.collateral_utxo_hash.bytes");
    expect(error.reason).toBe("'' must be 64 hex characters");
  });

  test("a one-shot index below zero is refused", () => {
    const error = leftOf(
      parseNetworkConfig(
        "mainnet",
        hashProfile("-1", `bytes = '${"ab".repeat(32)}'\nencoding = 'hex'`),
      ),
    );
    expect(error.key).toBe("config.mainnet.technical_authority_one_shot_index");
  });

  test("reads hex bytes in lower case", () => {
    const text = readFileSync("aiken.toml", "utf-8");
    const policy = Either.getOrThrow(
      parseNetworkConfig("mainnet", text),
    ).cnight_policy;
    const upper = text.replaceAll(`"${policy}"`, `"${policy.toUpperCase()}"`);
    expect(upper).not.toBe(text);
    expect(
      Either.map(parseNetworkConfig("mainnet", upper), (c) => c.cnight_policy),
    ).toEqual(Either.right(policy));
  });
});

describe("DotEnvFallback", () => {
  const dotEnv = join(mkdtempSync(join(tmpdir(), "dotenv-")), ".env");
  writeFileSync(
    dotEnv,
    `KUPO_URL=http://kupo.from-dotenv-file\nDOTENV_FALLBACK_ONLY=${"ab".repeat(32)}\n`,
  );
  /** Settings over the mode's env values, with `path` as the fallback. */
  const over = (path: string) =>
    Layer.mergeAll(
      Layer.provide(SettingsLive("emulator"), PlatformLive),
      Layer.provide(DotEnvFallback(path), TestEnvLive),
    );

  test("fills what the primary env lacks; the primary env wins", async () => {
    const read = await runTest(
      over(dotEnv),
      Effect.flatMap(Settings, (c) =>
        Effect.all({
          kupmios: c.kupmios,
          only: c.signingKey("DOTENV_FALLBACK_ONLY"),
        }),
      ),
    );
    expect(read.kupmios.kupoUrl).toBe(env("KUPO_URL"));
    expect(read.only).toBe("ab".repeat(32));
  });

  test("a missing file adds nothing", async () => {
    const error = await expectFailure(
      over(join(tmpdir(), "no-such-dir", ".env")),
      Effect.flatMap(Settings, (c) => c.signingKey("DOTENV_FALLBACK_ONLY")),
      "ConfigError",
    );
    expect(error.key).toBe("DOTENV_FALLBACK_ONLY");
  });
});

/** The raw profiles of aiken.toml, and a `{ bytes }` table: read independently of parseNetworkConfig. */
const AikenProfiles = Schema.Struct({
  config: Schema.Record({
    key: Schema.String,
    value: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  }),
});
const HexBytes = Schema.Struct({ bytes: Schema.String });

describe("reservedRefs", () => {
  test("holds every UTxO reference each profile names, the bridge one-shots included", () => {
    const text = readFileSync(join(import.meta.dir, "../aiken.toml"), "utf8");
    const { config } = Schema.decodeUnknownSync(AikenProfiles)(
      TOML.parse(text),
    );
    for (const environment of ENVIRONMENTS) {
      const profile = config[environmentOf(environment).aikenConfigSection];
      const named = Object.keys(profile)
        .filter((key) => key.endsWith("_index"))
        .map((key) => {
          const { bytes } = Schema.decodeUnknownSync(HexBytes)(
            profile[key.replace(/_index$/, "_hash")],
          );
          return `${bytes.toLowerCase()}#${String(profile[key])}`;
        });
      const reserved = reservedRefs(
        Either.getOrThrow(parseNetworkConfig(environment, text)),
      );
      expect([...new Set(named)].sort()).toEqual([...reserved].sort());
    }
  });
});

describe("parseLogLevel", () => {
  test.each([
    ["WARN", LogLevel.Warning],
    ["warning", LogLevel.Warning],
    ["None", LogLevel.None],
    ["off", LogLevel.None],
    ["", LogLevel.Info],
  ])("'%s'", (value, level) => {
    expect(Either.getOrThrow(parseLogLevel(value))).toBe(level);
  });

  test("an unknown level is a ConfigError on LOG_LEVEL", () => {
    expect(leftOf(parseLogLevel("loud")).key).toBe("LOG_LEVEL");
  });
});
