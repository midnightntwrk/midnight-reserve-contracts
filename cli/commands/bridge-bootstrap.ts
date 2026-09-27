import { Command, Options } from "@effect/cli";
import { parseActivationBlock } from "../datum/bridge";
import { parseWith, rpc } from "../options";
import { bridgeBootstrapProgram } from "../bridge/bootstrap";

const activation = parseWith(
  "activation",
  parseActivationBlock,
)(Options.text("activation")).pipe(
  Options.withDescription(
    "The first block BEEFY finalizes for the bridge; the state starts at the block before it",
  ),
);

export const bridgeBootstrap = Command.make(
  "bridge-bootstrap",
  { rpc, activation },
  bridgeBootstrapProgram,
).pipe(
  Command.withDescription(
    "Read the committee bridge's bootstrap state from a Midnight node and print its .env values",
  ),
);
