/**
 * One chain state for stage-upgrade and promote-upgrade, the same for this
 * CLI and the Effect 3 reference: the council and tech authority (three
 * keys each, from fixed seeds) in their forever UTxOs, 2/3 main and staging
 * gov thresholds, the council two-stage main, and the reserve two-stage
 * main (its logic, main gov auth) and staging (a staged logic, staging gov
 * auth, logic_round 1), with a funded deployer. Over any set of scripts:
 * the default build on the emulator, or a deployed record. Only Blaze,
 * Node's crypto and the blueprint, so the reference can run the same file.
 */
import {
  addressFromValidator,
  AssetId,
  blake2b_224,
  CredentialType,
  derivePublicKey,
  Ed25519PrivateNormalKeyHex,
  Hash28ByteBase16,
  HexBlob,
  NetworkId,
  PaymentAddress,
  type PlutusData,
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

/** The scripts an upgrade reads. */
export interface UpgradeScripts {
  readonly govAuth: Script;
  readonly stagingGovAuth: Script;
  readonly techAuthForever: Script;
  readonly councilForever: Script;
  readonly councilTwoStage: Script;
  readonly councilLogic: Script;
  readonly mainGovThreshold: Script;
  readonly stagingGovThreshold: Script;
  readonly reserveTwoStage: Script;
  readonly reserveLogic: Script;
  /** The logic the reserve staging state already holds. */
  readonly stagedLogic: Script;
}

/** A council or tech-auth member: the payment key hash of a private key, and an sr25519 key. */
const memberOf = (privateKey: string, label: string) => ({
  paymentHash: blake2b_224(
    HexBlob(derivePublicKey(Ed25519PrivateNormalKeyHex(privateKey))),
  ) as string,
  sr25519Key: seed(`${label}-sr25519`),
});

/** The chain state over the scripts. */
export const upgradeScenario = (scripts: UpgradeScripts) => {
  const councilKeys = [1, 2, 3].map((n) => seed(`council-${n}`));
  const techAuthKeys = [1, 2, 3].map((n) => seed(`tech-auth-${n}`));
  const council = councilKeys.map((key, i) =>
    memberOf(key, `council-${i + 1}`),
  );
  const techAuth = techAuthKeys.map((key, i) =>
    memberOf(key, `tech-auth-${i + 1}`),
  );
  const multisig = (signers: typeof council) =>
    serialize(Contracts.VersionedMultisig, [
      [
        BigInt(signers.length),
        Object.fromEntries(
          signers.map((s) => [`8200581c${s.paymentHash}`, s.sr25519Key]),
        ),
      ],
      0n,
    ]);
  const threshold = serialize(Contracts.MultisigThreshold, [2n, 3n, 2n, 3n]);
  const deployer = keyAddressOf(DEPLOYER_KEY);
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
  const funds = (txByte: string, coins: bigint) =>
    TransactionUnspentOutput.fromCore([
      { txId: TransactionId(txByte.repeat(32)), index: 0 },
      { address: PaymentAddress(deployer.toBech32()), value: { coins } },
    ]);
  const state = (
    logic: Script,
    auth: Script,
    logicRound: bigint,
  ): Contracts.UpgradeState => [
    logic.hash(),
    "",
    auth.hash(),
    "",
    0n,
    logicRound,
  ];
  const reserveMainState = state(scripts.reserveLogic, scripts.govAuth, 0n);
  const reserveStagingState = state(
    scripts.stagedLogic,
    scripts.stagingGovAuth,
    1n,
  );
  return {
    deployer,
    council,
    techAuth,
    reserveMainState,
    reserveStagingState,
    utxos: {
      fee: funds("f0", 100_000_000n),
      deployerFunds: funds("f1", 50_000_000n),
      councilForever: at("d0", scripts.councilForever, "", multisig(council)),
      techAuthForever: at(
        "d1",
        scripts.techAuthForever,
        "",
        multisig(techAuth),
      ),
      mainGovThreshold: at("d8", scripts.mainGovThreshold, "", threshold),
      stagingGovThreshold: at("d9", scripts.stagingGovThreshold, "", threshold),
      councilMain: at(
        "e0",
        scripts.councilTwoStage,
        hexOf("main"),
        serialize(
          Contracts.UpgradeState,
          state(scripts.councilLogic, scripts.govAuth, 0n),
        ),
      ),
      reserveMain: at(
        "e5",
        scripts.reserveTwoStage,
        hexOf("main"),
        serialize(Contracts.UpgradeState, reserveMainState),
      ),
      reserveStaging: at(
        "e6",
        scripts.reserveTwoStage,
        hexOf("staging"),
        serialize(Contracts.UpgradeState, reserveStagingState),
      ),
    },
    /** The gov-auth reward accounts the upgrades withdraw from, registered on the emulator. */
    rewardAccounts: [scripts.govAuth, scripts.stagingGovAuth].map((script) =>
      RewardAccount.fromCredential(
        {
          type: CredentialType.ScriptHash,
          hash: Hash28ByteBase16(script.hash()),
        },
        NetworkId.Testnet,
      ),
    ),
    env: {
      DEPLOYER_ADDRESS: deployer.toBech32(),
      SIGNING_PRIVATE_KEY: DEPLOYER_KEY,
      COUNCIL_PRIVATE_KEYS: councilKeys.join(","),
      TECH_AUTH_PRIVATE_KEYS: techAuthKeys.join(","),
    },
  };
};
