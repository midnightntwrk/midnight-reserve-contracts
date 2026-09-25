import { Command, HelpDoc, Options, ValidationError } from "@effect/cli";
import { Either } from "effect";
import {
  outputDir,
  outputFile,
  parsedText,
  provider,
  testNetwork,
  useBuild,
} from "../options";
import { withServicesUseBuild } from "../run";
import { parseBech32Address, parsePositiveBigInt } from "../input";
import {
  mintTcnightProgram,
  parseTcnightRequest,
} from "../wallet/mint-tcnight";

const amount = parsedText("amount", parsePositiveBigInt).pipe(
  Options.withDescription("Amount of NIGHT tokens to mint or burn"),
);

const userAddress = parsedText("user-address", parseBech32Address).pipe(
  Options.withAlias("u"),
  Options.withDescription("User address (wallet for signing and burn source)"),
);

const destination = parsedText("destination", parseBech32Address).pipe(
  Options.withAlias("d"),
  Options.withDescription(
    "Destination address for minted tokens, mint only (default: user address)",
  ),
  Options.optional,
);

const burn = Options.boolean("burn").pipe(
  Options.withAlias("b"),
  Options.withDescription("Burn tokens instead of minting"),
);

const request = Options.all({ burn, destination }).pipe(
  Options.mapEffect(({ burn, destination }) =>
    Either.mapLeft(parseTcnightRequest(burn, destination), (reason) =>
      ValidationError.invalidValue(HelpDoc.p(reason)),
    ),
  ),
);

export const mintTcnight = Command.make(
  "mint-tcnight",
  {
    network: testNetwork,
    provider,
    outputDir,
    useBuild,
    amount,
    userAddress,
    request,
    outputFile: outputFile("mint-tcnight-tx.json"),
  },
  mintTcnightProgram,
).pipe(
  Command.withDescription("Mint or burn TCnight tokens (non-mainnet only)"),
  withServicesUseBuild,
);
