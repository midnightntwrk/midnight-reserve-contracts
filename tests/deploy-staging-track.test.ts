import { describe, test } from "bun:test";
import { NetworkId, PlutusData } from "@blaze-cardano/core";
import { Layer, Option } from "effect";
import { buildStagingForeverDeploymentTx } from "../cli/deploy/builders";
import {
  STAGING_STEPS,
  STAGING_TRACK_COMPONENTS,
} from "../cli/deploy/staging-track";
import { BlueprintLive } from "../cli/contracts/contracts";
import {
  addCollateral,
  asFunded,
  councilSigners,
  feeUtxo,
  randomHash,
  techAuthSigners,
  zeroForeverDatum,
} from "./helpers/fixtures";
import {
  buildInstances,
  emulatorProfile,
  runTest,
  SettingsOver,
} from "./helpers/effect";

const contracts = await buildInstances();
const profile = await emulatorProfile();

const settings = Layer.merge(
  SettingsOver("emulator"),
  BlueprintLive("emulator", "build"),
);

describe("the staging forever builder", () => {
  test.each(STAGING_TRACK_COMPONENTS.map((component) => [component]))(
    "the %s step mints its staging forever NFT from its one-shot",
    async (component) => {
      const step = STAGING_STEPS[component];
      const stagingForever = Option.getOrThrow(
        Option.fromNullable(step.contract(contracts)),
      ).Script;
      await asFunded(async (emulator, blaze, addr) => {
        const [hash, index] = step.oneShot(profile);
        const oneShotUtxo = feeUtxo(addr, hash, index);
        emulator.addUtxo(oneShotUtxo);
        const params = {
          networkId: NetworkId.Testnet,
          coinsPerUtxoByte: emulator.params.coinsPerUtxoByte,
          collateral: addCollateral(emulator, addr),
        };
        const { datum, redeemer } = await runTest(
          settings,
          step.datum({
            config: profile,
            contracts,
            deployer: addr.toBech32(),
            techAuthSigners,
            councilSigners,
            blaze,
            params,
            maxTxSize: emulator.params.maxTxSize,
          }),
        );
        await emulator.expectValidTransaction(
          blaze,
          buildStagingForeverDeploymentTx(
            blaze,
            { oneShotUtxo, stagingForever, datum, redeemer },
            params,
          ),
        );
      });
    },
  );

  test("a staging forever deployment over a UTxO that is not its one-shot is refused", async () => {
    const stagingForever = Option.getOrThrow(
      Option.fromNullable(contracts.reserveStagingForever),
    ).Script;
    await asFunded(async (emulator, blaze, addr) => {
      const other = feeUtxo(addr, randomHash(32), 0);
      emulator.addUtxo(other);
      await emulator.expectScriptFailure(
        buildStagingForeverDeploymentTx(
          blaze,
          {
            oneShotUtxo: other,
            stagingForever,
            datum: zeroForeverDatum,
            redeemer: PlutusData.newInteger(0n),
          },
          {
            networkId: NetworkId.Testnet,
            coinsPerUtxoByte: emulator.params.coinsPerUtxoByte,
            collateral: addCollateral(emulator, addr),
          },
        ),
        /the validator crashed[\s\S]*one_shot_ref/,
      );
    });
  });
});
