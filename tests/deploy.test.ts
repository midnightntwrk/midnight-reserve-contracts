import { describe, expect, test } from "bun:test";
import {
  type Address,
  NetworkId,
  PlutusData,
  Transaction,
  TxCBOR,
} from "@blaze-cardano/core";
import { parse } from "@blaze-cardano/data";
import type { Emulator } from "@blaze-cardano/emulator";
import type { TxBuilder } from "@blaze-cardano/tx";
import { readFileSync } from "fs";
import { Effect, Either, Layer, Option } from "effect";
import * as Contracts from "../contract_blueprint_default";
import {
  buildThresholdDeploymentTx,
  buildTwoStageDeploymentTx,
  type DeployParams,
} from "../cli/deploy/builders";
import {
  DEPLOY_COMPONENT_VALIDATORS,
  DEPLOY_COMPONENTS,
  DEPLOY_STEPS,
  type DeployComponent,
  type DeployInput,
} from "../cli/deploy/deploy";
import {
  Blueprint,
  BlueprintLive,
  type ContractClass,
} from "../cli/contracts/contracts";
import type { PlutusJson } from "../cli/contracts/plutus-json";
import { validatorName } from "../cli/contracts/versions";
import { resolveCollateral, resolveUnspent } from "../cli/deploy/deployment";
import { completeBuilder, sizeAtSubmit } from "../cli/chain/complete-tx";
import { attachWitnesses, signTransaction } from "../cli/chain/transaction";
import { parsePrivateKey } from "../cli/datum/signers";
import { validatorLabels } from "../cli/chain/validator-labels";
import {
  addCollateral,
  asFunded,
  type BlazeOf,
  councilSigners,
  FEE_TX,
  feeUtxo,
  randomHash,
  techAuthSigners,
  THRESHOLD,
  txHashOf,
  txIndexOf,
  zeroForeverDatum,
} from "./helpers/fixtures";
import {
  buildInstances,
  emulatorProfile,
  emulatorProgram,
  expectFailure,
  PlatformLive,
  runTest,
  SettingsOver,
  SettingsWith,
  testEnv,
} from "./helpers/effect";

const contracts = await buildInstances();
const profile = await emulatorProfile();
const blueprint = BlueprintLive("emulator", "build");

/** The deployer-held one-shot UTxO of a deploy component. */
const oneShotOf = (addr: Address, component: DeployComponent) =>
  feeUtxo(addr, ...DEPLOY_STEPS[component].oneShotOf(profile));

const params = (emulator: Emulator, addr: Address): DeployParams => ({
  networkId: NetworkId.Testnet,
  coinsPerUtxoByte: emulator.params.coinsPerUtxoByte,
  collateral: addCollateral(emulator, addr),
});

/** The script hashes the builder's draft registers as stake credentials. */
const registeredStake = (builder: TxBuilder): string[] =>
  [
    ...(Transaction.fromCbor(TxCBOR(builder.toCbor()))
      .body()
      .certs()
      ?.values() ?? []),
  ].flatMap((cert) => {
    const core = cert.toCore();
    return core.__typename === "RegistrationCertificate"
      ? [core.stakeCredential.hash]
      : [];
  });

/** The one-shot check every deployment minting policy runs first. */
const NOT_ITS_ONE_SHOT = /the validator crashed[\s\S]*one_shot_ref/;

const deployInput: DeployInput = {
  network: "emulator",
  outputDir: "/tmp/deploy-test",
  techAuthThreshold: { numerator: 3n, denominator: 4n },
  councilThreshold: { numerator: 1n, denominator: 5n },
  techAuthStagingThreshold: { numerator: 5n, denominator: 7n },
  councilStagingThreshold: { numerator: 2n, denominator: 9n },
  components: Option.none(),
};

/** The component's step built over its one-shot, as deploy builds it, with Settings over `settings`. */
const stepBuilder = (
  component: DeployComponent,
  emulator: Emulator,
  blaze: BlazeOf,
  addr: Address,
  settings = SettingsOver("emulator"),
) => {
  const oneShotUtxo = oneShotOf(addr, component);
  emulator.addUtxo(oneShotUtxo);
  return runTest(
    Layer.merge(blueprint, settings),
    DEPLOY_STEPS[component].build(
      {
        input: deployInput,
        config: profile,
        contracts,
        deployer: addr.toBech32(),
        techAuthSigners,
        councilSigners,
        blaze,
        params: params(emulator, addr),
        maxTxSize: emulator.params.maxTxSize,
      },
      oneShotUtxo,
    ),
  );
};

describe("deployment builders", () => {
  test("a two-stage deployment over a UTxO that is not its one-shot is refused", async () => {
    await asFunded(async (emulator, blaze, addr) => {
      const other = feeUtxo(addr, randomHash(32), 0);
      emulator.addUtxo(other);
      await emulator.expectScriptFailure(
        buildTwoStageDeploymentTx(
          blaze,
          {
            oneShotUtxo: other,
            twoStage: contracts.reserveTwoStage.Script,
            forever: contracts.reserveForever.Script,
            logic: contracts.reserveLogic.Script,
            govAuth: contracts.govAuth.Script,
            stagingGovAuth: contracts.stagingGovAuth.Script,
            foreverDatum: zeroForeverDatum,
            foreverRedeemer: PlutusData.newInteger(0n),
            registerLogic: false,
          },
          params(emulator, addr),
        ),
        NOT_ITS_ONE_SHOT,
      );
    });
  });

  test("the size check counts the vkey witnesses: a transaction at the maximum unsigned is over it with one signature", async () => {
    await asFunded(async (emulator, blaze, addr) => {
      const oneShotUtxo = oneShotOf(addr, "main-gov");
      emulator.addUtxo(oneShotUtxo);
      const deployment = () =>
        buildThresholdDeploymentTx(
          blaze,
          {
            oneShotUtxo,
            threshold: contracts.mainGovThreshold.Script,
            datum: THRESHOLD,
          },
          params(emulator, addr),
        );
      const complete = (maxTxSize: number, witnesses: number) =>
        completeBuilder(deployment(), "deploy/main-gov-threshold-deployment", {
          maxTxSize,
          witnesses,
        });
      const tx = await runTest(PlatformLive, complete(16_384, 0));
      const unsigned = sizeAtSubmit(tx, 0);
      const signed = attachWitnesses(
        tx.toCbor(),
        signTransaction(tx.getId(), [
          Either.getOrThrow(parsePrivateKey(testEnv("SIGNING_PRIVATE_KEY"))),
        ]),
      );
      expect(signed.toCbor().length / 2).toBeGreaterThan(unsigned + 100);
      expect(signed.toCbor().length / 2).toBeLessThanOrEqual(
        sizeAtSubmit(tx, 1),
      );
      await runTest(PlatformLive, complete(unsigned, 0));
      const error = await expectFailure(
        PlatformLive,
        complete(unsigned, 1),
        "TxBuildError",
      );
      expect(error.size).toEqual({
        bytes: unsigned + 107,
        witnesses: 1,
        max: unsigned,
      });
    });
  });

  test("validatorLabels names the minted threshold policy by its blueprint class", async () => {
    await asFunded(async (emulator, blaze, addr) => {
      const oneShotUtxo = oneShotOf(addr, "main-gov");
      emulator.addUtxo(oneShotUtxo);
      const tx = await runTest(
        PlatformLive,
        completeBuilder(
          buildThresholdDeploymentTx(
            blaze,
            {
              oneShotUtxo,
              threshold: contracts.mainGovThreshold.Script,
              datum: THRESHOLD,
            },
            params(emulator, addr),
          ),
          "deploy/main-gov-threshold-deployment",
          { maxTxSize: 16_384, witnesses: 0 },
        ),
      );
      const listed = await runTest(
        BlueprintLive("emulator", "build"),
        Effect.flatMap(Blueprint, (b) => b.contracts),
      );
      expect(validatorLabels(tx, [oneShotUtxo], listed)).toEqual({
        "mint[0]": "ThresholdsMainGovThresholdElse",
      });
    });
  });

  test("a threshold deployment over a UTxO that is not its one-shot is refused", async () => {
    await asFunded(async (emulator, blaze, addr) => {
      const other = feeUtxo(addr, randomHash(32), 0);
      emulator.addUtxo(other);
      await emulator.expectScriptFailure(
        buildThresholdDeploymentTx(
          blaze,
          {
            oneShotUtxo: other,
            threshold: contracts.mainGovThreshold.Script,
            datum: THRESHOLD,
          },
          params(emulator, addr),
        ),
        NOT_ITS_ONE_SHOT,
      );
    });
  });
});

const plutus: PlutusJson = JSON.parse(
  readFileSync("plutus-default.json", "utf-8"),
);

/** The validator names of these contracts, through the build plutus.json. */
const namesOf = (classes: readonly ContractClass[]): string[] =>
  classes
    .map((c) =>
      validatorName(
        Option.getOrThrow(
          Option.fromNullable(
            plutus.validators.find((v) => v.hash === c.Script.hash()),
          ),
        ).title,
      ),
    )
    .sort();

/** The components whose deployment is a two-stage triple; its UpgradeState datums install the gov auths. */
const TWO_STAGE_COMPONENTS: readonly DeployComponent[] = [
  "tech-auth",
  "council",
  "reserve",
  "ics",
  "federated-ops",
  "terms-and-conditions",
];

/** The components whose deployment registers its logic's stake credential. */
const REGISTERS_LOGIC: readonly DeployComponent[] = [
  "tech-auth",
  "council",
  "federated-ops",
  "terms-and-conditions",
];

/** The datum of the draft's output that holds one. */
const datumOf = (builder: TxBuilder) =>
  Option.getOrThrow(
    Option.fromNullable(
      Transaction.fromCbor(TxCBOR(builder.toCbor()))
        .body()
        .outputs()
        .find((output) => output.datum() !== undefined)
        ?.datum()
        ?.asInlineData(),
    ),
  );

describe("the deploy steps", () => {
  test.each(DEPLOY_COMPONENTS.map((component) => [component]))(
    "%s creates its DEPLOY_COMPONENT_VALIDATORS, and a two-stage one installs the gov auths",
    async (component) => {
      const step = DEPLOY_STEPS[component];
      const { created, installed } = await runTest(
        blueprint,
        Effect.all({ created: step.validators, installed: step.installs }),
      );
      expect(namesOf(created)).toEqual(
        [...DEPLOY_COMPONENT_VALIDATORS[component]].sort(),
      );
      expect(namesOf(installed)).toEqual(
        TWO_STAGE_COMPONENTS.includes(component)
          ? ["main_gov_auth", "staging_gov_auth"]
          : [],
      );
    },
  );

  test.each([
    ...DEPLOY_COMPONENTS.map(
      (component) => [component, component, SettingsOver("emulator")] as const,
    ),
    [
      "federated-ops with no candidates",
      "federated-ops",
      SettingsWith("emulator", { PERMISSIONED_CANDIDATES: "[]" }),
    ] as const,
  ])(
    "the %s step mints from its one-shot, registering the logic where it should",
    async (_name, component, settings) => {
      const [, , logic] = await runTest(
        blueprint,
        DEPLOY_STEPS[component].validators,
      );
      await asFunded(async (emulator, blaze, addr) => {
        const builder = await stepBuilder(
          component,
          emulator,
          blaze,
          addr,
          settings,
        );
        expect(registeredStake(builder)).toEqual(
          REGISTERS_LOGIC.includes(component) ? [logic.Script.hash()] : [],
        );
        await emulator.expectValidTransaction(blaze, builder);
      });
    },
  );

  test.each([
    ["main-gov", [3n, 4n, 1n, 5n]],
    ["staging-gov", [5n, 7n, 2n, 9n]],
  ] as const)(
    "the %s datum carries the tech-auth then the council fraction",
    async (component, expected) => {
      await asFunded(async (emulator, blaze, addr) => {
        const builder = await stepBuilder(component, emulator, blaze, addr);
        expect(parse(Contracts.MultisigThreshold, datumOf(builder))).toEqual([
          ...expected,
        ]);
        await emulator.expectValidTransaction(blaze, builder);
      });
    },
  );
});

describe("resolveUnspent", () => {
  test("returns the UTxOs in the order of the references", async () => {
    const { emulator, layer, deployer } = await emulatorProgram();
    const first = txHashOf(randomHash(32));
    const second = txHashOf(randomHash(32));
    emulator.addUtxo(feeUtxo(deployer, first, 0));
    emulator.addUtxo(feeUtxo(deployer, second, 1));
    const resolved = await runTest(
      layer,
      resolveUnspent([
        [second, txIndexOf(1)],
        [first, txIndexOf(0)],
      ]),
    );
    expect(
      resolved.map(
        (utxo) => `${utxo.input().transactionId()}#${utxo.input().index()}`,
      ),
    ).toEqual([`${second}#1`, `${first}#0`]);
  });

  test("a reference that is not an unspent output of the deployer is UtxoNotFound naming it", async () => {
    const { layer, deployer } = await emulatorProgram();
    const missing = txHashOf(randomHash(32));
    const error = await expectFailure(
      layer,
      resolveUnspent([
        [FEE_TX, txIndexOf(0)],
        [missing, txIndexOf(3)],
      ]),
      "UtxoNotFound",
    );
    expect(error.lookup).toEqual({
      by: "ref",
      ref: `${missing}#3`,
      address: deployer.toBech32(),
    });
  });
});

describe("resolveCollateral", () => {
  const collateralOf = async (coins: Option.Option<bigint>) => {
    const program = await emulatorProgram();
    Option.map(coins, (lovelace) =>
      program.emulator.addUtxo(
        feeUtxo(
          program.deployer,
          profile.collateral_utxo_hash,
          profile.collateral_utxo_index,
          lovelace,
        ),
      ),
    );
    return {
      ...program,
      resolve: resolveCollateral(
        "deploy",
        profile,
        program.emulator.params.collateralPercentage,
      ),
    };
  };

  test("returns the profile's collateral when it covers the protocol's requirement", async () => {
    const { layer, resolve } = await collateralOf(Option.some(10_000_000n));
    const collateral = await runTest(layer, resolve);
    expect(collateral.input().transactionId()).toBe(
      profile.collateral_utxo_hash,
    );
  });

  test("a collateral below the requirement is PreconditionFailed", async () => {
    const { layer, resolve } = await collateralOf(Option.some(1_000_000n));
    const error = await expectFailure(layer, resolve, "PreconditionFailed");
    expect(error.command).toBe("deploy");
    expect(error.refusal).toMatchObject({
      _tag: "CollateralTooSmall",
      lovelace: 1_000_000n,
    });
  });

  test("a missing collateral is UtxoNotFound", async () => {
    const { layer, resolve } = await collateralOf(Option.none());
    await expectFailure(layer, resolve, "UtxoNotFound");
  });
});
