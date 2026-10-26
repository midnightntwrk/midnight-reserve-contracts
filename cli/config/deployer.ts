/** The deployer's address: DEPLOYER_ADDRESS on the environment's network, or a fixed test address on local and emulator. */
import { Address } from "@blaze-cardano/core";
import { Context, Effect, Either, Layer, Option } from "effect";
import type { ConfigError } from "../errors";
import { parseAddressOn } from "../input";
import { envError, optionalString } from "./env";
import { type Environment, environmentOf } from "./network-mapping";

const DEFAULT_LOCAL_DEPLOYER =
  "addr_test1qruhen60uwzpwnnr7gjs50z2v8u9zyfw6zunet4k42zrpr54mrlv55f93rs6j48wt29w90hlxt4rvpvshe55k5r9mpvqjv2wt4";

/** The deployer's address, read when asked. */
export class DeployerAddress extends Context.Tag("cli/DeployerAddress")<
  DeployerAddress,
  { readonly address: Effect.Effect<Address, ConfigError> }
>() {
  /** The deployer's address, through the service. */
  static readonly address: Effect.Effect<
    Address,
    ConfigError,
    DeployerAddress
  > = Effect.flatMap(DeployerAddress, (d) => d.address);
}

export const DeployerAddressLive = (environment: Environment) =>
  Layer.succeed(DeployerAddress, {
    address: Effect.gen(function* () {
      const value = yield* optionalString("DEPLOYER_ADDRESS");
      if (Option.isSome(value)) {
        return yield* Either.mapLeft(
          parseAddressOn(value.value, environment),
          (reason) => envError("DEPLOYER_ADDRESS", reason),
        );
      }
      return environmentOf(environment).local
        ? Address.fromBech32(DEFAULT_LOCAL_DEPLOYER)
        : yield* envError(
            "DEPLOYER_ADDRESS",
            `required for non-local environment '${environment}'`,
          );
    }),
  });
