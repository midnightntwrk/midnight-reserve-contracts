/**
 * One chain state for deploy and deploy-staging-track, the same for this
 * CLI and the Effect 3 reference: a deployer holding every UTxO the
 * profile names (its one-shots and its collateral, 20 ADA each) and one
 * fee UTxO of 1000 ADA, and the env values a deployment reads (three tech
 * auth and three council signers, two permissioned candidates). Only Blaze,
 * Node's crypto and the blueprint, so the reference can run the same file.
 */
import {
  PaymentAddress,
  TransactionId,
  TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { DEPLOYER_KEY, keyAddressOf, seed } from "./wallet-scenario";

/** The chain state over the profile's UTxO references ("txId#index"); `oneShots` sets what each holds but the collateral, which keeps 20 ADA. */
export const deployScenario = (
  profileRefs: Iterable<string>,
  oneShots: { readonly coins: bigint; readonly collateral: string } = {
    coins: 20_000_000n,
    collateral: "",
  },
) => {
  const deployer = keyAddressOf(DEPLOYER_KEY);
  const at = (txId: string, index: number, coins: bigint) =>
    TransactionUnspentOutput.fromCore([
      { txId: TransactionId(txId), index },
      { address: PaymentAddress(deployer.toBech32()), value: { coins } },
    ]);
  const signers = (group: string) =>
    [1, 2, 3]
      .map(
        (n) =>
          `${seed(`${group}-${n}-payment`).slice(0, 56)}:${seed(`${group}-${n}-sr25519`)}`,
      )
      .join(",");
  const candidate = (label: string) =>
    `{ sidechain_pub_key:02${seed(`${label}-sidechain`)}, aura_pub_key:${seed(`${label}-aura`)}, grandpa_pub_key:${seed(`${label}-grandpa`)}, beefy_pub_key:03${seed(`${label}-beefy`)} }`;
  return {
    deployer,
    utxos: [
      at("f0".repeat(32), 0, 1_000_000_000n),
      ...[...new Set(profileRefs)].sort().map((ref) => {
        const [txId, index] = ref.split("#");
        return at(
          txId,
          Number(index),
          ref === oneShots.collateral ? 20_000_000n : oneShots.coins,
        );
      }),
    ],
    env: {
      DEPLOYER_ADDRESS: deployer.toBech32(),
      SIGNING_PRIVATE_KEY: DEPLOYER_KEY,
      TECH_AUTH_SIGNERS: signers("tech-auth"),
      COUNCIL_SIGNERS: signers("council"),
      PERMISSIONED_CANDIDATES: `[ ${candidate("candidate-0")}, ${candidate("candidate-1")} ]`,
      TECH_AUTH_THRESHOLD: "2/3",
      COUNCIL_THRESHOLD: "2/3",
      COUNCIL_STAGING_THRESHOLD: "1/3",
      TECH_AUTH_STAGING_THRESHOLD: "1/2",
    },
  };
};
