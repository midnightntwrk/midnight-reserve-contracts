import { relative, resolve } from "path";
import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import type { Profile } from "../config/network-mapping";
import {
  buildContracts,
  type BuildSource,
  type TraceLevel,
} from "./build-engine";
import { buildOutput, PROJECT_ROOT } from "./paths";
import { generateBlueprint } from "./versions";
import { Output } from "../output";
import { FileWriteError } from "../errors";

/** The profile to build, the aiken trace level, and what the build compiles against. */
export interface BuildInput {
  readonly network: Profile;
  readonly trace: TraceLevel;
  readonly source: BuildSource;
}

/** Build the contracts, then generate contract_blueprint_<env>.ts and copy it to contract_blueprint.ts. */
export const buildProgram = (input: BuildInput) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const projectRoot = PROJECT_ROOT;
    const env = input.network;
    yield* buildContracts({
      network: env,
      traceLevel: input.trace,
      source: input.source,
      projectRoot,
    });

    const { plutusPath, blueprintPath } = buildOutput(projectRoot, env);
    yield* output.log(`\nGenerating TypeScript bindings...`);
    yield* generateBlueprint(env, "build", plutusPath, blueprintPath);

    const fs = yield* FileSystem.FileSystem;
    yield* Effect.mapError(
      fs.copyFile(blueprintPath, resolve(projectRoot, "contract_blueprint.ts")),
      (cause) =>
        new FileWriteError({
          path: resolve(projectRoot, "contract_blueprint.ts"),
          reason: cause.message,
        }),
    );
    yield* output.log(
      `TypeScript bindings written to: ${relative(projectRoot, blueprintPath)}`,
    );
    yield* output.log(`Copied to: contract_blueprint.ts`);
  });
