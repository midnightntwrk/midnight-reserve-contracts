import { Command, Options } from "@effect/cli";
import { parseLovelace } from "../datum/bridge";
import {
  network,
  outputDir,
  outputFile,
  parsedText,
  provider,
  useBuild,
} from "../options";
import { withServicesUseBuild } from "../run";
import { parseDestinations, rewardsRegisterProgram } from "../rewards/register";

const stakeKey = Options.text("stake-key").pipe(
  Options.withDescription(
    "Environment variable holding the stake key that registers (default: REWARDS_STAKE_KEY)",
  ),
  Options.withDefault("REWARDS_STAKE_KEY"),
);

const sidechainKey = Options.text("sidechain-key").pipe(
  Options.withDescription(
    "Environment variable holding the block producer's sidechain secp256k1 key; operator_keys then carry the key and its claim over the stake key hash",
  ),
  Options.optional,
);

const destinations = parsedText("destinations", parseDestinations).pipe(
  Options.withDescription(
    "<kind byte and address hex>:<weight>,…: where the rewards go (kind 00 a DUST address, 01 a NIGHT address), weights summing to 1000",
  ),
);

const payoutThreshold = parsedText("payout-threshold", parseLovelace).pipe(
  Options.withDescription(
    "STAR above the distribution fee at which the account enters a payout tree",
  ),
);

const deposit = parsedText("deposit", parseLovelace).pipe(
  Options.withDescription(
    "The deposit's ADA in lovelace, within the profile's deposit_min_lovelace and deposit_cap_lovelace (default: 10000000)",
  ),
  Options.withDefault(10_000_000n),
);

export const rewardsRegister = Command.make(
  "rewards-register",
  {
    network,
    provider,
    useBuild,
    outputDir,
    outputFile: outputFile("rewards-register.json"),
    stakeKey,
    sidechainKey,
    destinations,
    payoutThreshold,
    deposit,
  },
  rewardsRegisterProgram,
).pipe(
  Command.withDescription(
    "Build a virtual account registration signed by its stake key, for the deployer to submit",
  ),
  withServicesUseBuild,
);
