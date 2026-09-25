/** The Blockfrost adapter: local checks always; real requests against preview under TEST_NETWORK=preview. */
import { beforeAll, describe, expect, test } from "bun:test";
import {
  addressFromCredential,
  Credential,
  CredentialType,
  Hash28ByteBase16,
  NetworkId,
} from "@blaze-cardano/core";
import { Effect, Layer, Redacted, Schema } from "effect";
import { Blueprint, BlueprintLive } from "../cli/contracts/contracts";
import { rewardAccountRegistered } from "../cli/chain/governance-provider";
import { createRewardAccount } from "../cli/chain/transaction";
import { Provider, ProviderLive } from "../cli/chain/provider";
import {
  blockfrostAccessTo,
  blockfrostGet,
  type BlockfrostAccess,
} from "../cli/chain/blockfrost";
import {
  captureOutput,
  expectFailure,
  LoggerCaptured,
  onPreview,
  PlatformLive,
  PreviewLive,
  runTest,
  SettingsOver,
} from "./helpers/effect";
import { randomHash } from "./helpers/fixtures";

const PREVIEW_TIMEOUT = 60_000;

/** A random reward account's `/accounts` path. */
const accountPath = () =>
  `/accounts/${createRewardAccount(randomHash(28), NetworkId.Testnet)}`;

describe("Blockfrost locally", () => {
  test("a refused connection is a retryable transport failure, tried three times with backoff", async () => {
    const capture = captureOutput();
    const path = accountPath();
    const error = await expectFailure(
      Layer.mergeAll(PlatformLive, LoggerCaptured(capture)),
      blockfrostGet(
        "http://127.0.0.1:9/api/v0",
        Redacted.make("unused"),
        path,
        Schema.Unknown,
      ),
      "ProviderError",
    );
    expect(error).toMatchObject({ reason: "Transport", retryable: true });
    const op = `GET ${path}`;
    expect(capture.logs).toEqual([
      {
        level: "WARN",
        message: `${op} failed, retrying in 250ms`,
        annotations: { op, delaySeconds: 0.25 },
      },
      {
        level: "WARN",
        message: `${op} failed, retrying in 500ms`,
        annotations: { op, delaySeconds: 0.5 },
      },
    ]);
  });
});

describe.if(onPreview)("Blockfrost on preview", () => {
  let access: BlockfrostAccess;
  beforeAll(async () => {
    access = await runTest(PreviewLive, blockfrostAccessTo("preview"));
  });

  test(
    "a bad API key is a 403 ProviderError that is not retried",
    async () => {
      const error = await expectFailure(
        PlatformLive,
        blockfrostGet(
          access.baseUrl,
          Redacted.make("previewInvalidKey"),
          accountPath(),
          Schema.Unknown,
        ),
        "ProviderError",
      );
      expect(error).toMatchObject({ status: 403, retryable: false });
    },
    PREVIEW_TIMEOUT,
  );

  test(
    "the Provider reads an address the chain has never seen as empty",
    async () => {
      const unseen = addressFromCredential(
        NetworkId.Testnet,
        Credential.fromCore({
          type: CredentialType.ScriptHash,
          hash: Hash28ByteBase16(randomHash(28)),
        }),
      );
      const utxos = await runTest(
        Layer.provide(ProviderLive("preview"), SettingsOver("preview")),
        Effect.flatMap(Provider, (p) => p.unspentOutputs(unseen)),
      );
      expect(utxos).toEqual([]);
    },
    PREVIEW_TIMEOUT,
  );

  test(
    "the preview gov-auth reward account is registered; a random one is not",
    async () => {
      const layer = Layer.mergeAll(
        PreviewLive,
        BlueprintLive("preview", "deployed"),
      );
      const govAuth = await runTest(
        layer,
        Effect.flatMap(Blueprint, (b) =>
          Effect.map(b.instances, (i) => i.govAuth.Script.hash()),
        ),
      );
      const registered = (hash: string) =>
        runTest(
          layer,
          rewardAccountRegistered(
            createRewardAccount(hash, NetworkId.Testnet),
            "preview",
          ),
        );
      expect(await registered(govAuth)).toBe(true);
      expect(await registered(randomHash(28))).toBe(false);
    },
    PREVIEW_TIMEOUT,
  );
});
