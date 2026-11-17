/**
 * Two-stage contracts: the main and staging NFTs, the UpgradeState in a
 * two-stage UTxO's inline datum, which validator names are a track's
 * logic, and the logic scripts a main state names. twoStageLogic serves
 * change-council, change-tech-auth, change-terms and change-federated-ops.
 * register-gov-auth registers the stake credentials of the main and
 * staging gov auth, which every upgrade runs through.
 */
import {
  addressFromValidator,
  AssetId,
  type NetworkId,
  type Script,
  toHex,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { parse } from "@blaze-cardano/data";
import { Effect, Option } from "effect";
import * as Contracts from "../../contract_blueprint";
import { planningContext, refuseRegistered } from "../chain";
import { DeployerAddress, type Environment } from "../config";
import { type Blueprint, ContractResolver } from "../contracts/resolver";
import { decodeInlineDatum } from "../datum";
import {
  type BlueprintError,
  type DatumParseError,
  UtxoNotFound,
} from "../errors";
import { txFilePath } from "../input";
import { Output } from "../output";
import {
  compileReported,
  signAndWrite,
  UNSIGNED,
  witnessCount,
} from "../signing";
import { createRewardAccount, type PlanningContext, type TxPlan } from "../tx";

/** Hex of the "main" NFT name every two-stage contract mints. */
export const MAIN_TOKEN_HEX = toHex(new TextEncoder().encode("main"));
/** Hex of the "staging" NFT name every two-stage contract mints. */
export const STAGING_TOKEN_HEX = toHex(new TextEncoder().encode("staging"));

/** The UTxO holding the "main" NFT of this two-stage policy. */
export const findMainUtxo = (
  utxos: readonly TransactionUnspentOutput[],
  policyId: string,
): TransactionUnspentOutput | undefined =>
  utxos.find(
    (utxo) =>
      utxo
        .output()
        .amount()
        .multiasset()
        ?.get(AssetId(policyId + MAIN_TOKEN_HEX)) === 1n,
  );

/** The UTxO among `utxos` holding the "main" NFT of the two-stage script, or UtxoNotFound at its address. */
export const mainUtxoAt = (
  utxos: readonly TransactionUnspentOutput[],
  twoStage: Script,
  networkId: NetworkId,
): Effect.Effect<TransactionUnspentOutput, UtxoNotFound> => {
  const utxo = findMainUtxo(utxos, twoStage.hash());
  return utxo === undefined
    ? Effect.fail(
        UtxoNotFound.holding(
          addressFromValidator(networkId, twoStage).toBech32(),
          `${twoStage.hash()}.main`,
        ),
      )
    : Effect.succeed(utxo);
};

/** The UpgradeState fields the CLI reads. */
export interface UpgradeState {
  readonly logicHash: string;
  readonly mitigationLogicHash: string;
  readonly authHash: string;
  readonly logicRound: number;
}

/** The blueprint UpgradeState tuple in a two-stage UTxO's inline datum. */
export const rawUpgradeStateAt = (
  utxo: TransactionUnspentOutput,
): Effect.Effect<Contracts.UpgradeState, DatumParseError> =>
  decodeInlineDatum(utxo, "UpgradeState", (data) =>
    parse(Contracts.UpgradeState, data),
  );

/** The UpgradeState in a two-stage UTxO's inline datum. */
export const upgradeStateAt = (
  utxo: TransactionUnspentOutput,
): Effect.Effect<UpgradeState, DatumParseError> =>
  Effect.map(
    rawUpgradeStateAt(utxo),
    ([logicHash, mitigationLogicHash, authHash, , , logicRound]) => ({
      logicHash,
      mitigationLogicHash,
      authHash,
      logicRound: Number(logicRound),
    }),
  );

/** Whether `name` is a logic of `track`: `<track>_logic`, or `<track>_logic_v<N>` for any N from 2 up. */
export const isTrackLogic = (track: string, name: string): boolean =>
  name === `${track}_logic` ||
  new RegExp(`^${track}_logic_v([2-9]|[1-9][0-9]+)$`).test(name);

/** The logic and mitigation logic scripts an UpgradeState names, from the blueprint; `expected` describes the logic the unknown-logic error asks for. */
export const upgradeScripts = (
  blueprint: Blueprint,
  state: Pick<UpgradeState, "logicHash" | "mitigationLogicHash">,
  expected: string,
): Effect.Effect<
  {
    readonly logic: Script;
    readonly mitigationLogic: Option.Option<Script>;
  },
  BlueprintError
> =>
  Effect.all({
    logic: blueprint.scriptByHash(
      state.logicHash,
      `Unknown logic script hash in UpgradeState: ${state.logicHash}. Expected: ${expected}`,
    ),
    mitigationLogic: state.mitigationLogicHash
      ? Effect.map(
          blueprint.scriptByHash(
            state.mitigationLogicHash,
            `Unknown mitigation logic script hash in UpgradeState: ${state.mitigationLogicHash}`,
          ),
          Option.some,
        )
      : Effect.succeed(Option.none<Script>()),
  });

/** The logic scripts a two-stage main state names, logged with the reward accounts the transaction withdraws from; `label` names the contract in the log. */
export const twoStageLogic = (
  blueprint: Blueprint,
  label: string,
  twoStageMain: TransactionUnspentOutput,
  expectedLogic: string,
  networkId: NetworkId,
) =>
  Effect.gen(function* () {
    const output = yield* Output;
    yield* output.log(`\nReading ${label} two-stage upgrade state...`);
    const state = yield* upgradeStateAt(twoStageMain);
    yield* output.log(`  Logic hash: ${state.logicHash}`);
    yield* output.log(
      `  Mitigation logic hash: ${state.mitigationLogicHash || "(empty)"}`,
    );
    yield* output.log(`  Logic round: ${state.logicRound}`);
    const { logic, mitigationLogic } = yield* upgradeScripts(
      blueprint,
      state,
      expectedLogic,
    );
    yield* output.log(
      `\nLogic reward account: ${createRewardAccount(state.logicHash, networkId)}`,
    );
    if (Option.isSome(mitigationLogic)) {
      yield* output.log(
        `Mitigation logic reward account: ${createRewardAccount(state.mitigationLogicHash, networkId)}`,
      );
      yield* output.log("  Adding mitigation logic withdrawal...");
    }
    return {
      logicRound: state.logicRound,
      logicScript: logic,
      mitigationLogicScript: mitigationLogic,
    };
  });

// register-gov-auth

/** The gov-auth scripts every two-stage contract's upgrades run through. */
export interface GovAuthScripts {
  readonly govAuth: Script;
  readonly stagingGovAuth: Script;
}

/** Register the main and staging gov-auth scripts as stake credentials in one transaction; the wallet pays. */
export const planRegisterGovAuth = (
  ctx: PlanningContext<GovAuthScripts>,
): TxPlan => ({
  spends: [],
  references: [],
  scripts: [],
  mints: [],
  outputs: [],
  withdrawals: [],
  registrations: [ctx.resolved.govAuth, ctx.resolved.stagingGovAuth],
  collateral: [],
  metadata: Option.none(),
  feePadding: 0n,
  expectedWitnesses: witnessCount(UNSIGNED, 0),
});

/** Register the main and staging gov-auth stake credentials, refused when the chain already has either; the deployer wallet pays and takes the change; built (never submitted), unsigned, and written to a file. */
export const registerGovAuthProgram = (input: {
  readonly network: Environment;
  readonly outputDir: string;
  readonly outputFile: string;
}) =>
  Effect.gen(function* () {
    const { network } = input;
    const output = yield* Output;
    yield* output.log(`\nRegistering Gov Auth scripts on ${network} network`);

    const blueprint = (yield* ContractResolver).contracts("actsOn");
    const instances = yield* blueprint.instances;
    const govAuth = instances.govAuth.Script;
    const stagingGovAuth = instances.stagingGovAuth.Script;
    yield* output.log(`\nMain Gov Auth script hash: ${govAuth.hash()}`);
    yield* output.log(`Staging Gov Auth script hash: ${stagingGovAuth.hash()}`);
    yield* refuseRegistered("register-gov-auth", network, [
      { label: "Main Gov Auth", scriptHash: govAuth.hash() },
      { label: "Staging Gov Auth", scriptHash: stagingGovAuth.hash() },
    ]);

    const ctx = yield* planningContext({
      command: "register-gov-auth",
      environment: network,
      wallet: yield* (yield* DeployerAddress).address,
      contracts: yield* blueprint.contracts,
      resolved: { govAuth, stagingGovAuth },
    });
    const tx = yield* compileReported(planRegisterGovAuth(ctx), ctx);
    yield* signAndWrite(
      tx,
      txFilePath(input),
      UNSIGNED,
      "Register Government Authority Transaction",
    );
    return tx;
  });
