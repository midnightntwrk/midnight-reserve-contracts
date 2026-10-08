/**
 * deploy-staging-track: the six transactions that mint the staging forever
 * NFTs of an environment, each spending its staging one-shot UTxO from the
 * aiken.toml profile, built (never submitted) over the build blueprint and
 * written to <output>/<env>/staging-track-deployment-transactions.json;
 * --components builds only the transactions of those components, and the
 * file holds only them. The deployed-scripts snapshot is extended with the
 * staging forevers it creates, as a deploy --components run extends it,
 * and is saved before the deployment file.
 */
import { serialize } from "@blaze-cardano/data";
import { Clock, Effect, Either, Option } from "effect";
import { relative, resolve } from "path";
import * as Contracts from "../../contract_blueprint";
import { buildTx } from "../chain/complete-tx";
import { type NetworkConfig, Settings } from "../config/settings";
import {
  Blueprint,
  type ContractClass,
  type ContractInstances,
} from "../contracts/contracts";
import {
  prepareDeploySnapshot,
  writeDeploySnapshot,
} from "../contracts/versions";
import {
  BlueprintError,
  type ConfigError,
  type InputParseError,
} from "../errors";
import { type NetworkInput, ZERO_HASH32 } from "../input";
import { Output } from "../output";
import {
  buildStagingForeverDeploymentTx,
  ZERO_FOREVER_DATUM,
} from "./builders";
import {
  buildOf,
  builtDeployment,
  type BuiltDeployment,
  deploymentHeader,
  type DeploymentSetup,
  deploymentSetup,
  federatedOpsForever,
  type ForeverMint,
  multisigForever,
  refusePromoted,
  reportDeployment,
  resolveUnspent,
  selectComponents,
  snapshotKindOf,
  type UtxoRef,
  zeroRedeemer,
} from "./deployment";
import { DEPLOYER_ONLY } from "../chain/transaction";

/** The components --components selects, one per staging forever validator, in build order. */
export const STAGING_TRACK_COMPONENTS = [
  "council",
  "tech-auth",
  "federated-ops",
  "reserve",
  "ics",
  "terms-and-conditions",
] as const;

export type StagingTrackComponent = (typeof STAGING_TRACK_COMPONENTS)[number];

/** A staging track deployment: where the file goes, and which components (None: every one). */
export interface DeployStagingTrackInput extends NetworkInput {
  readonly outputDir: string;
  readonly components: Option.Option<readonly StagingTrackComponent[]>;
}

/** One staging forever validator: its name in the deployment file, one-shot, script and datum. */
interface StagingStep {
  readonly name: string;
  readonly oneShot: (config: NetworkConfig) => UtxoRef;
  readonly contract: (c: ContractInstances) => ContractClass | undefined;
  readonly datum: (
    setup: DeploymentSetup,
  ) => Effect.Effect<ForeverMint, ConfigError | InputParseError, Settings>;
}

/** Each component's staging track transaction: its name, one-shot, script and datum. */
export const STAGING_STEPS: Record<StagingTrackComponent, StagingStep> = {
  council: {
    name: "council-staging-forever-deployment",
    oneShot: (c) => [
      c.council_staging_one_shot_hash,
      c.council_staging_one_shot_index,
    ],
    contract: (c) => c.councilStagingForever,
    datum: (setup) => multisigForever(setup.councilSigners),
  },
  "tech-auth": {
    name: "tech-auth-staging-forever-deployment",
    oneShot: (c) => [
      c.technical_authority_staging_one_shot_hash,
      c.technical_authority_staging_one_shot_index,
    ],
    contract: (c) => c.techAuthStagingForever,
    datum: (setup) => multisigForever(setup.techAuthSigners),
  },
  "federated-ops": {
    name: "federated-ops-staging-forever-deployment",
    oneShot: (c) => [
      c.federated_operators_staging_one_shot_hash,
      c.federated_operators_staging_one_shot_index,
    ],
    contract: (c) => c.federatedOpsStagingForever,
    datum: () => federatedOpsForever,
  },
  reserve: {
    name: "reserve-staging-forever-deployment",
    oneShot: (c) => [
      c.reserve_staging_one_shot_hash,
      c.reserve_staging_one_shot_index,
    ],
    contract: (c) => c.reserveStagingForever,
    datum: () => Effect.succeed(zeroRedeemer(ZERO_FOREVER_DATUM)),
  },
  ics: {
    name: "ics-staging-forever-deployment",
    oneShot: (c) => [c.ics_staging_one_shot_hash, c.ics_staging_one_shot_index],
    contract: (c) => c.icsStagingForever,
    datum: () => Effect.succeed(zeroRedeemer(ZERO_FOREVER_DATUM)),
  },
  "terms-and-conditions": {
    name: "terms-and-conditions-staging-forever-deployment",
    oneShot: (c) => [
      c.terms_and_conditions_staging_one_shot_hash,
      c.terms_and_conditions_staging_one_shot_index,
    ],
    contract: (c) => c.termsAndConditionsStagingForever,
    datum: () =>
      Effect.succeed(
        zeroRedeemer(
          serialize(Contracts.VersionedTermsAndConditions, [
            [ZERO_HASH32, ""],
            0n,
          ]),
        ),
      ),
  },
};

/** Check and prepare the snapshot, build the selected staging forever transactions, then save the snapshot and last the staging track deployment file. */
export const deployStagingTrackProgram = (input: DeployStagingTrackInput) =>
  Effect.gen(function* () {
    const { network } = input;
    const out = yield* Output;
    const blueprint = yield* Blueprint;
    const snapshot = snapshotKindOf(network);

    yield* deploymentHeader(
      `Generating staging track deployment transactions for ${network}`,
    );
    const components = selectComponents(
      STAGING_TRACK_COMPONENTS,
      input.components,
    );
    const steps = components.map((component) => STAGING_STEPS[component]);
    const contracts = yield* blueprint.instances;
    const forevers = yield* Effect.forEach(components, (component) =>
      Either.fromNullable(
        STAGING_STEPS[component].contract(contracts),
        () =>
          new BlueprintError({
            environment: network,
            source: blueprint.source,
            reason: `the staging forever validator of ${component} is not in the blueprint`,
          }),
      ),
    );
    const created = new Set(forevers.map((forever) => forever.Script.hash()));
    if (snapshot === "production") {
      yield* refusePromoted("deploy-staging-track", network, created);
    }
    const timestamp = new Date(yield* Clock.currentTimeMillis).toISOString();
    const prepared =
      snapshot === "none"
        ? Option.none()
        : Option.some(
            yield* prepareDeploySnapshot({
              env: network,
              rule: "extend",
              createdHashes: created,
              installedHashes: new Set(),
              ...buildOf(network),
              timestamp,
            }),
          );

    const setup = yield* deploymentSetup("deploy-staging-track", network);
    const oneShots = yield* resolveUnspent(
      steps.map((step) => step.oneShot(setup.config)),
    );
    const built: BuiltDeployment[] = yield* Effect.forEach(steps, (step, i) =>
      Effect.gen(function* () {
        const { datum, redeemer } = yield* step.datum(setup);
        const oneShotUtxo = oneShots[i];
        const tx = yield* buildTx(
          buildStagingForeverDeploymentTx(
            setup.blaze,
            {
              oneShotUtxo,
              stagingForever: forevers[i].Script,
              datum,
              redeemer,
            },
            setup.params,
          ),
          {
            commandName: `deploy-staging-track/${step.name}`,
            environment: network,
            witnesses: DEPLOYER_ONLY,
            knownUtxos: [oneShotUtxo, setup.params.collateral],
          },
        );
        return builtDeployment(step.name, tx);
      }),
    );

    if (Option.isSome(prepared)) {
      yield* writeDeploySnapshot(network, prepared.value);
      yield* out.success(
        `Staging forever scripts saved to ${relative(process.cwd(), prepared.value.dir)}/`,
      );
    }
    yield* reportDeployment(
      `Generated ${built.length} staging track deployment transactions`,
      resolve(
        input.outputDir,
        network,
        "staging-track-deployment-transactions.json",
      ),
      { network, timestamp },
      built,
    );
    return built;
  });
