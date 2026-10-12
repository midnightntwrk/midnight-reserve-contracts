import { describe, test } from "bun:test";
import { NetworkId } from "@blaze-cardano/core";
import { Option } from "effect";
import * as Contracts from "../contract_blueprint_default";
import { planMintStagingState } from "../cli/governance/mint-staging-state";
import { toTxBuilder } from "../cli/tx/compile";
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
      const plan = planMintStagingState(
        {
          oneShotUtxo,
          v2LogicScript: new Contracts.PermissionedV2CouncilLogicV2Else()
            .Script,
          stagingForeverHash:
            new Contracts.StagingPermissionedCouncilStagingForeverElse().Script.hash(),
          cnightPolicy: config.cnight_policy,
          collateralUtxo: addCollateral(emulator, addr),
        },
        {
          networkId: NetworkId.Testnet,
          coinsPerUtxoByte: (await blaze.provider.getParameters())
            .coinsPerUtxoByte,
        },
      );
      const builder = toTxBuilder(blaze, plan, {
        changeAddress: addr,
        feePadding: 0n,
        metadata: Option.some("mint-staging-state"),
      });
      await emulator.expectValidTransaction(blaze, builder);
    });
  });
});
