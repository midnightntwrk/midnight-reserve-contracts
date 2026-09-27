import { describe, test } from "bun:test";
import { NetworkId } from "@blaze-cardano/core";
import * as Contracts from "../contract_blueprint_default";
import { buildMintStagingStateTx } from "../cli/governance/mint-staging-state";
import { emulatorProfile } from "./helpers/effect";
import { addCollateral, asFunded, feeUtxo } from "./helpers/fixtures";

describe("mint-staging-state", () => {
  test("mints the StagingState NFT from the council v2 one-shot", async () => {
    const config = await emulatorProfile();
    await asFunded(async (emulator, blaze, addr) => {
      const oneShotUtxo = feeUtxo(
        addr,
        config.council_logic_v2_one_shot_hash,
        config.council_logic_v2_one_shot_index,
        20_000_000n,
      );
      emulator.addUtxo(oneShotUtxo);
      const builder = buildMintStagingStateTx(
        blaze,
        {
          oneShotUtxo,
          v2LogicScript: new Contracts.PermissionedV2CouncilLogicV2Else()
            .Script,
          stagingForeverHashes: [
            new Contracts.StagingPermissionedCouncilStagingForeverElse().Script.hash(),
          ],
          cnightPolicy: config.cnight_policy,
          collateralUtxo: addCollateral(emulator, addr),
          protocolParams: await blaze.provider.getParameters(),
        },
        { networkId: NetworkId.Testnet, changeAddress: addr, feePadding: 0n },
      );
      await emulator.expectValidTransaction(blaze, builder);
    });
  });

  test("mints the reserve StagingStateV2 NFT with the staging pool forever", async () => {
    const config = await emulatorProfile();
    await asFunded(async (emulator, blaze, addr) => {
      const oneShotUtxo = feeUtxo(
        addr,
        config.reserve_logic_v2_one_shot_hash,
        config.reserve_logic_v2_one_shot_index,
        20_000_000n,
      );
      emulator.addUtxo(oneShotUtxo);
      const builder = buildMintStagingStateTx(
        blaze,
        {
          oneShotUtxo,
          v2LogicScript: new Contracts.ReserveV2ReserveLogicV2Else().Script,
          stagingForeverHashes: [
            new Contracts.StagingReserveIcsReserveStagingForeverElse().Script.hash(),
            new Contracts.StagingRewardsPoolRewardsPoolStagingForeverElse().Script.hash(),
          ],
          cnightPolicy: config.cnight_policy,
          collateralUtxo: addCollateral(emulator, addr),
          protocolParams: await blaze.provider.getParameters(),
        },
        { networkId: NetworkId.Testnet, changeAddress: addr, feePadding: 0n },
      );
      await emulator.expectValidTransaction(blaze, builder);
    });
  });
});
