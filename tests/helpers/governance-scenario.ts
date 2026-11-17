/**
 * One chain state for change-council, change-tech-auth, change-terms and
 * change-federated-ops, the same for this CLI and the Effect 3 reference:
 * the council and tech authority (three keys each, from fixed seeds) in
 * their forever UTxOs, a 2/3 threshold for every governed contract, each
 * contract's two-stage main state naming its logic, the terms and the
 * federated-ops (v1) forever datums, a funded deployer, and the env values
 * the commands read. Only Blaze, Node's crypto and the blueprint, so the
 * reference can run the same file.
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

/** A council or tech-auth member: the payment key hash of a private key, and an sr25519 key. */
const memberOf = (privateKey: string, label: string) => ({
  paymentHash: blake2b_224(
    HexBlob(derivePublicKey(Ed25519PrivateNormalKeyHex(privateKey))),
  ) as string,
  sr25519Key: seed(`${label}-sr25519`),
});

/** A permissioned candidate from fixed seeds; `babe` adds the optional key. */
const candidateOf = (label: string, babe: boolean) => ({
  sidechain_pub_key: `02${seed(`${label}-sidechain`)}`,
  aura_pub_key: seed(`${label}-aura`),
  grandpa_pub_key: seed(`${label}-grandpa`),
  beefy_pub_key: `03${seed(`${label}-beefy`)}`,
  ...(babe ? { babe_pub_key: seed(`${label}-babe`) } : {}),
});

type Candidate = ReturnType<typeof candidateOf>;

const KEY_IDS = {
  aura: hexOf("aura"),
  gran: hexOf("gran"),
  beef: hexOf("beef"),
  babe: hexOf("babe"),
};

/** PERMISSIONED_CANDIDATES text of the candidates. */
const candidatesText = (candidates: readonly Candidate[]) =>
  `[ ${candidates
    .map(
      (c) =>
        `{ ${Object.entries(c)
          .map(([key, value]) => `${key}:${value}`)
          .join(", ")} }`,
    )
    .join(", ")} ]`;

/** The governed contracts' scripts in the default build. */
export interface GovernedScripts {
  readonly govAuth: Script;
  readonly councilForever: Script;
  readonly councilTwoStage: Script;
  readonly councilLogic: Script;
  readonly councilThreshold: Script;
  readonly techAuthForever: Script;
  readonly techAuthTwoStage: Script;
  readonly techAuthLogic: Script;
  readonly techAuthThreshold: Script;
  readonly termsForever: Script;
  readonly termsTwoStage: Script;
  readonly termsLogic: Script;
  readonly termsThreshold: Script;
  readonly federatedOpsForever: Script;
  readonly federatedOpsTwoStage: Script;
  readonly federatedOpsLogic: Script;
  readonly federatedOpsThreshold: Script;
}

/** The chain state over the scripts. */
export const governanceScenario = (scripts: GovernedScripts) => {
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
  const upgradeState = (logic: Script) =>
    serialize(Contracts.UpgradeState, [
      logic.hash(),
      "",
      scripts.govAuth.hash(),
      "",
      0n,
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
  const main = hexOf("main");
  const onChainCandidates = [candidateOf("candidate-0", false)];
  const newCandidates = [
    candidateOf("candidate-1", false),
    candidateOf("candidate-2", true),
  ];
  const newCouncil = [
    ...council,
    { paymentHash: council[2].paymentHash, sr25519Key: seed("council-4") },
  ];
  const newTechAuth = [
    ...techAuth,
    memberOf(seed("tech-auth-4"), "tech-auth-4"),
  ];
  const signersText = (signers: typeof council) =>
    signers.map((s) => `${s.paymentHash}:${s.sr25519Key}`).join(",");
  return {
    deployer,
    council,
    techAuth,
    newCouncil,
    newTechAuth,
    newCandidates,
    terms: { hash: "bb".repeat(32), url: "https://new.example.com/terms" },
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
      councilThreshold: at("d2", scripts.councilThreshold, "", threshold),
      techAuthThreshold: at("d3", scripts.techAuthThreshold, "", threshold),
      termsThreshold: at("d4", scripts.termsThreshold, "", threshold),
      federatedOpsThreshold: at(
        "d5",
        scripts.federatedOpsThreshold,
        "",
        threshold,
      ),
      termsForever: at(
        "d6",
        scripts.termsForever,
        "",
        serialize(Contracts.VersionedTermsAndConditions, [
          ["aa".repeat(32), hexOf("https://example.com/terms")],
          0n,
        ]),
      ),
      federatedOpsForever: at(
        "d7",
        scripts.federatedOpsForever,
        "",
        serialize(Contracts.FederatedOps, [
          PlutusData.fromCore({ constructor: 0n, fields: { items: [] } }),
          onChainCandidates.map((c): Contracts.PermissionedCandidateDatumV1 => [
            c.sidechain_pub_key,
            [
              [KEY_IDS.aura, c.aura_pub_key],
              [KEY_IDS.gran, c.grandpa_pub_key],
              [KEY_IDS.beef, c.beefy_pub_key],
            ],
          ]),
          1n,
        ]),
      ),
      councilMain: at(
        "e0",
        scripts.councilTwoStage,
        main,
        upgradeState(scripts.councilLogic),
      ),
      techAuthMain: at(
        "e1",
        scripts.techAuthTwoStage,
        main,
        upgradeState(scripts.techAuthLogic),
      ),
      termsMain: at(
        "e2",
        scripts.termsTwoStage,
        main,
        upgradeState(scripts.termsLogic),
      ),
      federatedOpsMain: at(
        "e3",
        scripts.federatedOpsTwoStage,
        main,
        upgradeState(scripts.federatedOpsLogic),
      ),
    },
    /** The logic reward accounts the commands withdraw from, registered on the emulator. */
    logicAccounts: [
      scripts.councilLogic,
      scripts.techAuthLogic,
      scripts.termsLogic,
      scripts.federatedOpsLogic,
    ].map((logic) =>
      RewardAccount.fromCredential(
        {
          type: CredentialType.ScriptHash,
          hash: Hash28ByteBase16(logic.hash()),
        },
        NetworkId.Testnet,
      ),
    ),
    env: {
      DEPLOYER_ADDRESS: deployer.toBech32(),
      SIGNING_PRIVATE_KEY: DEPLOYER_KEY,
      COUNCIL_PRIVATE_KEYS: councilKeys.join(","),
      TECH_AUTH_PRIVATE_KEYS: techAuthKeys.join(","),
      COUNCIL_SIGNERS: signersText(newCouncil),
      TECH_AUTH_SIGNERS: signersText(newTechAuth),
      PERMISSIONED_CANDIDATES: candidatesText(newCandidates),
    },
  };
};
