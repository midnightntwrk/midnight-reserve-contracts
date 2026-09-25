import {
  Address,
  addressFromValidator,
  NetworkId,
  PlutusData,
  type Script,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import { Emulator } from "@blaze-cardano/emulator";
import type { Blaze, Provider, Wallet } from "@blaze-cardano/sdk";
// V2 contracts are not yet deployed to mainnet — the V2 and v1 scripts must
// come from the same compilation so their cross-script hash references match.
import * as Contracts from "../contract_blueprint";
import { describe, expect, test } from "bun:test";
import { Either, Option } from "effect";
import {
  candidateToPermissionedDatum,
  parseCandidates,
} from "../cli/datum/federated-ops";
import { buildFederatedOpsMigrationTx } from "../cli/governance/migrate-federated-ops";
import { MAIN_TOKEN_HEX } from "../cli/chain/governance-provider";
import {
  registerRewardAccount,
  scriptUtxo,
  upgradeState,
  asFunded,
  findUtxoByToken,
} from "./helpers/fixtures";

const govAuth = new Contracts.GovAuthMainGovAuthElse();
const federatedOpsForever = new Contracts.PermissionedFederatedOpsForeverElse();
const federatedOpsTwoStage =
  new Contracts.PermissionedFederatedOpsTwoStageUpgradeElse();
const federatedOpsLogic = new Contracts.PermissionedFederatedOpsLogicElse();
const federatedOpsLogicV2 =
  new Contracts.PermissionedV2FederatedOpsLogicV2Else();

const candidatesInput = `[
  {
    sidechain_pub_key:020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8,
    aura_pub_key:1254f7017f0b8347ce7ab14f96d818802e7e9e0c0d1b7c9acb3c726b080e7a03,
    grandpa_pub_key:5079bcd20fd97d7d2f752c4607012600b401950260a91821f73e692071c82bf5,
    beefy_pub_key:020a617391de0e0291310bf7792bb41d9573e8a054b686205da5553e08fac6d0b8
  }
]`;
const appendix = Either.getOrThrow(parseCandidates(candidatesInput)).map(
  candidateToPermissionedDatum,
);
const federatedOpsDatumV1: Contracts.FederatedOps = [
  PlutusData.fromCore({ constructor: 0n, fields: { items: [] } }),
  appendix,
  1n,
];

/** The user UTxO, the federated-ops forever (v1 datum) and the two-stage main naming `logic`. */
const seed = (
  emulator: Emulator,
  userUtxo: TransactionUnspentOutput,
  logic: Script,
) => {
  const twoStageUtxo = scriptUtxo(
    "aa".repeat(32),
    federatedOpsTwoStage.Script,
    MAIN_TOKEN_HEX,
    upgradeState(logic.hash(), govAuth.Script.hash(), 1n),
  );
  const foreverUtxo = scriptUtxo(
    "cc".repeat(32),
    federatedOpsForever.Script,
    "",
    serialize(Contracts.FederatedOps, federatedOpsDatumV1),
  );
  for (const utxo of [userUtxo, twoStageUtxo, foreverUtxo])
    emulator.addUtxo(utxo);
  registerRewardAccount(emulator, logic.hash());
  return { userUtxo, twoStageUtxo, foreverUtxo };
};

const migration = (
  blaze: Blaze<Provider, Wallet>,
  addr: Address,
  utxos: ReturnType<typeof seed>,
  logicScript: Script,
) =>
  buildFederatedOpsMigrationTx(
    blaze,
    {
      federatedOpsForever: federatedOpsForever.Script,
      ...utxos,
      current: federatedOpsDatumV1,
      logicScript,
      mitigationLogicScript: Option.none(),
    },
    { networkId: NetworkId.Testnet, changeAddress: addr, feePadding: 0n },
  );

describe("Migrate Federated Ops from v1 to v2 datum", () => {
  test("the v2 logic migrates the forever datum to v2: data and appendix kept, round 2", async () => {
    await asFunded(async (emulator, blaze, addr, fee) => {
      const utxos = seed(emulator, fee, federatedOpsLogicV2.Script);
      await emulator.expectValidTransaction(
        blaze,
        migration(blaze, addr, utxos, federatedOpsLogicV2.Script),
      );
      const forever = findUtxoByToken(
        await blaze.provider.getUnspentOutputs(
          addressFromValidator(NetworkId.Testnet, federatedOpsForever.Script),
        ),
        federatedOpsForever.Script.hash(),
        "",
      );
      expect(forever.output().datum()?.asInlineData()?.toCbor()).toBe(
        serialize(Contracts.FederatedOpsV2, [
          federatedOpsDatumV1[0],
          "",
          appendix,
          2n,
        ]).toCbor(),
      );
    });
  });

  test("the v1 logic has no Migrate branch and rejects the withdrawal", async () => {
    await asFunded(async (emulator, blaze, addr, fee) => {
      const utxos = seed(emulator, fee, federatedOpsLogic.Script);
      await emulator.expectScriptFailure(
        migration(blaze, addr, utxos, federatedOpsLogic.Script),
        /Withdraw\[0\]/,
      );
    });
  });
});
