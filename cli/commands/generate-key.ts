import { Command } from "@effect/cli";
import { network } from "../options";
import { generateKeyProgram } from "../wallet/generate-key";

export const generateKey = Command.make(
  "generate-key",
  { network },
  generateKeyProgram,
).pipe(
  Command.withDescription("Generate a new signing key and Cardano address"),
);
