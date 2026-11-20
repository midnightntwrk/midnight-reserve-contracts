/**
 * One chain state for migrate-federated-ops, mint-staging-state,
 * register-gov-auth, register-cnight-mint-logic and run-cnight-mint-mainnet,
 * the same for this CLI and the Effect 3 reference: a funded deployer
 * holding the profile's council v2 one-shot and collateral, the
 * federated-ops forever with a v1 datum under a two-stage main naming the
 * given logic (the v2 one for a migration), and the cNIGHT mint two-stage
 * main naming the given mint logic. The
 * reward accounts are listed, not registered: each command's test
 * registers what it withdraws from. Only Blaze, Node's crypto and the
 * blueprint, so the reference can run the same file.
 */
import {
  addressFromValidator,
  AssetId,
  CredentialType,
  Hash28ByteBase16,
  NetworkId,
  PaymentAddress,
  PlutusData,
  RewardAccount,
  type Script,
  toHex,
  TransactionId,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { serialize } from "@blaze-cardano/data";
import * as Contracts from "../../contract_blueprint";
import { DEPLOYER_KEY, keyAddressOf, seed } from "./wallet-scenario";

const hexOf = (text: string) => toHex(new TextEncoder().encode(text));

/** The scripts of the default build the commands read; `federatedOpsLogic` and `cnightMintLogic` are the logics the two-stage main states name. */
export interface OperationsScripts {
  readonly govAuth: Script;
  readonly federatedOpsForever: Script;
  readonly federatedOpsTwoStage: Script;
  readonly federatedOpsLogic: Script;
  readonly cnightMintForever: Script;
  readonly cnightMintTwoStage: Script;
  readonly cnightMintLogic: Script;
}

/** A UTxO reference the profile names. */
type Ref = readonly [string, number];

const rewardAccountOf = (script: Script) =>
  RewardAccount.fromCredential(
    { type: CredentialType.ScriptHash, hash: Hash28ByteBase16(script.hash()) },
    NetworkId.Testnet,
  );

/** The chain state over the scripts and the profile's council v2 one-shot and collateral references. */
export const operationsScenario = (
  scripts: OperationsScripts,
  profile: { readonly councilV2OneShot: Ref; readonly collateral: Ref },
) => {
  const deployer = keyAddressOf(DEPLOYER_KEY);
  const funds = ([txId, index]: Ref, coins: bigint) =>
    TransactionUnspentOutput.fromCore([
      { txId: TransactionId(txId), index },
      { address: PaymentAddress(deployer.toBech32()), value: { coins } },
    ]);
  const at = (
    txByte: string,
    script: Script,
    assetName: string,
    datum: PlutusData,
  ) =>
    TransactionUnspentOutput.fromCore([
      { txId: TransactionId(txByte.repeat(32)), index: 0 },
      {
        address: PaymentAddress(
          addressFromValidator(NetworkId.Testnet, script).toBech32(),
        ),
        value: {
          coins: 5_000_000n,
          assets: new Map([[AssetId(script.hash() + assetName), 1n]]),
        },
        datum: datum.toCore(),
      },
    ]);
  const upgradeState = (logic: Script, logicRound: bigint) =>
    serialize(Contracts.UpgradeState, [
      logic.hash(),
      "",
      scripts.govAuth.hash(),
      "",
      0n,
      logicRound,
    ]);
  const candidate = (label: string): Contracts.PermissionedCandidateDatumV1 => [
    `02${seed(`${label}-sidechain`)}`,
    [
      [hexOf("aura"), seed(`${label}-aura`)],
      [hexOf("gran"), seed(`${label}-grandpa`)],
      [hexOf("beef"), `03${seed(`${label}-beefy`)}`],
    ],
  ];
  const federatedOpsV1: Contracts.FederatedOps = [
    PlutusData.fromCore({ constructor: 0n, fields: { items: [] } }),
    [candidate("candidate-0"), candidate("candidate-1")],
    1n,
  ];
  return {
    deployer,
    federatedOpsV1,
    utxos: {
      fee: funds(["f0".repeat(32), 0], 100_000_000n),
      deployerFunds: funds(["f1".repeat(32), 0], 50_000_000n),
      councilV2OneShot: funds(profile.councilV2OneShot, 20_000_000n),
      collateral: funds(profile.collateral, 10_000_000n),
      federatedOpsForever: at(
        "d7",
        scripts.federatedOpsForever,
        "",
        serialize(Contracts.FederatedOps, federatedOpsV1),
      ),
      federatedOpsMain: at(
        "e3",
        scripts.federatedOpsTwoStage,
        hexOf("main"),
        upgradeState(scripts.federatedOpsLogic, 1n),
      ),
      cnightMintMain: at(
        "e4",
        scripts.cnightMintTwoStage,
        hexOf("main"),
        upgradeState(scripts.cnightMintLogic, 0n),
      ),
    },
    rewardAccounts: {
      federatedOpsLogic: rewardAccountOf(scripts.federatedOpsLogic),
      cnightMintForever: rewardAccountOf(scripts.cnightMintForever),
      cnightMintLogic: rewardAccountOf(scripts.cnightMintLogic),
    },
    env: {
      DEPLOYER_ADDRESS: deployer.toBech32(),
      SIGNING_PRIVATE_KEY: DEPLOYER_KEY,
      TECH_AUTH_PRIVATE_KEYS: [1, 2, 3]
        .map((n) => seed(`tech-auth-${n}`))
        .join(","),
    },
  };
};
