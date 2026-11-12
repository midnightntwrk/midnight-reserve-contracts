import { describe, test } from "bun:test";
import { NetworkId, PlutusData } from "@blaze-cardano/core";
import { Layer, Option } from "effect";
import { planStagingForeverDeployment } from "../cli/deploy/builders";
import {
  STAGING_STEPS,
  STAGING_TRACK_COMPONENTS,
} from "../cli/deploy/staging-track";
import { BlueprintLive } from "../cli/contracts/contracts";
import { toTxBuilder } from "../cli/tx/compile";
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
  ConfigOver,
} from "./helpers/effect";

const contracts = await buildInstances();
const profile = await emulatorProfile();

const settings = Layer.merge(
  ConfigOver("emulator"),
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
        const { datum, redeemer } = await runTest(
          settings,
          step.datum({ techAuthSigners, councilSigners }),
        );
        await emulator.expectValidTransaction(
          blaze,
          toTxBuilder(
            blaze,
            planStagingForeverDeployment(
              {
                oneShotUtxo,
                collateral: addCollateral(emulator, addr),
                stagingForever,
                datum,
                redeemer,
              },
              {
                networkId: NetworkId.Testnet,
                coinsPerUtxoByte: emulator.params.coinsPerUtxoByte,
              },
            ),
            { changeAddress: addr, feePadding: 0n, metadata: Option.none() },
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
        toTxBuilder(
          blaze,
          planStagingForeverDeployment(
            {
              oneShotUtxo: other,
              collateral: addCollateral(emulator, addr),
              stagingForever,
              datum: zeroForeverDatum,
              redeemer: PlutusData.newInteger(0n),
            },
            {
              networkId: NetworkId.Testnet,
              coinsPerUtxoByte: emulator.params.coinsPerUtxoByte,
            },
          ),
          { changeAddress: addr, feePadding: 0n, metadata: Option.none() },
        ),
        /the validator crashed[\s\S]*one_shot_ref/,
      );
    });
  });
});
