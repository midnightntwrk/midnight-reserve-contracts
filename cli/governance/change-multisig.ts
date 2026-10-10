/**
 * Shared engine for change-council and change-tech-auth. The program
 * resolves the contract UTxOs, the two-stage UpgradeState (logic hash and
 * logic_round), the forever datum, the secondary signers for the ML-3 check
 * and the fee UTxO; buildMultisigChangeTx is pure over those inputs and is
 * what the tests call. The config captures the differences between the two
 * commands. twoStageLogic also serves change-terms and change-federated-ops.
 */
import {
  type Address,
  addressFromValidator,
  AssetId,
  type NetworkId,
  PlutusData,
  type Script,
  TransactionOutput,
  type TransactionUnspentOutput,
  PaymentAddress,
} from "@blaze-cardano/core";
import type {
  Blaze,
  Provider as BlazeProvider,
  Wallet,
} from "@blaze-cardano/sdk";
import type { TxBuilder } from "@blaze-cardano/tx";
import { Effect, Either, Option, Record } from "effect";
import {
  type Signers,
  encodeMultisigState,
  encodeRedeemerMap,
} from "../datum/signers";
import { datumRoundOf } from "../datum/datum-versions";
import { environmentOf } from "../config/network-mapping";
import {
  type ContractClass,
  type ContractInstances,
  Blueprint,
} from "../contracts/contracts";
import {
  contractUtxos,
  deployerUtxo,
  signersAt,
  thresholdAt,
  upgradeScripts,
  upgradeStateAt,
} from "../chain/governance-provider";
import {
  createRewardAccount,
  signAndWrite,
  signerFor,
  createTxMetadata,
  logicRedeemer,
  mintWitnesses,
  withdrawThroughLogic,
  witnessCount,
} from "../chain/transaction";
import { buildTx } from "../chain/complete-tx";
import {
  type AuthorityThreshold,
  type WitnessRequirement,
  witnessRequirements,
} from "./threshold";
import { type FeeInput, type TxFileInput, txFilePath } from "../input";
import { Settings, type SignersVariable } from "../config/settings";
import { Output } from "../output";
import { Provider } from "../chain/provider";
import type { InputParseError } from "../errors";

export type MultisigFamily = "council" | "tech-auth";

/** A multisig change. */
export interface MultisigChangeConfig {
  /** Command name for metadata and logging (e.g. "change-council") */
  commandName: string;
  /** Human label for logging (e.g. "Council") */
  commandLabel: string;
  /** Description for the written transaction file (e.g. "Change Council Transaction") */
  signDescription: string;
  /** The authority that changes; the other one is secondary. */
  primaryFamily: MultisigFamily;
  /** Env var holding new signers (e.g. "COUNCIL_SIGNERS") */
  signerEnvVar: SignersVariable;
  /** The primary/secondary contracts and any extras to query. */
  getContracts(contracts: ContractInstances): {
    primaryForever: ContractClass;
    primaryTwoStage: ContractClass;
    primaryThreshold: ContractClass;
    primaryLogic: ContractClass;
    secondaryForever: ContractClass;
  };
}

/** A multisig change: its fee UTxO, whether to sign, and where the file goes. */
export interface MultisigChangeInput extends TxFileInput, FeeInput {
  readonly sign: boolean;
}

/** What the transaction is built from, resolved from the chain and the blueprint. */
export interface MultisigChangeInputs {
  readonly primaryForever: Script;
  readonly primaryForeverUtxo: TransactionUnspentOutput;
  readonly primaryThresholdUtxo: TransactionUnspentOutput;
  readonly secondaryForeverUtxo: TransactionUnspentOutput;
  readonly primaryTwoStageUtxo: TransactionUnspentOutput;
  readonly userUtxo: TransactionUnspentOutput;
  readonly logicScript: Script;
  readonly mitigationLogicScript: Option.Option<Script>;
  readonly logicRound: number;
  readonly currentPrimarySigners: Signers;
  readonly secondarySigners: Signers;
  /** What the threshold demands of the primary and secondary signers above. */
  readonly requirements: MultisigRequirements;
}

export interface MultisigChangeParams {
  readonly newSigners: Signers;
  readonly networkId: NetworkId;
  readonly changeAddress: Address;
  readonly commandName: string;
  readonly feePadding: bigint;
}

/** A requirement with the authority's label. */
interface SignerRequirement extends WitnessRequirement {
  readonly label: string;
}

/** What a threshold demands of the primary and the secondary signers. */
export interface MultisigRequirements {
  readonly primary: SignerRequirement;
  readonly secondary: SignerRequirement;
}

/** The threshold's council and tech-auth requirements as primary and secondary; the family decides which is which. */
export const signerRequirements = (
  threshold: AuthorityThreshold,
  primarySigners: Signers,
  secondarySigners: Signers,
  family: MultisigFamily,
): MultisigRequirements => {
  const councilPrimary = family === "council";
  const requirements = witnessRequirements(threshold, {
    councilSigners: councilPrimary ? primarySigners : secondarySigners,
    techAuthSigners: councilPrimary ? secondarySigners : primarySigners,
  });
  const council = { label: "council", ...requirements.council };
  const techAuth = { label: "tech auth", ...requirements.techAuth };
  return councilPrimary
    ? { primary: council, secondary: techAuth }
    : { primary: techAuth, secondary: council };
};

/** The change transaction: spend the primary forever with the new datum, mint both native-script witnesses, withdraw through the logic scripts with the member redeemer. */
export const buildMultisigChangeTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: MultisigChangeInputs,
  params: MultisigChangeParams,
): Either.Either<TxBuilder, InputParseError> =>
  Either.gen(function* () {
    const { networkId, newSigners } = params;
    const newForeverStateCbor = yield* encodeMultisigState(
      newSigners,
      BigInt(datumRoundOf(inputs.logicRound)),
    );
    const innerRedeemer = yield* encodeRedeemerMap(newSigners);
    const { primary, secondary } = inputs.requirements;
    const primaryForeverAddress = addressFromValidator(
      networkId,
      inputs.primaryForever,
    );

    const spent = blaze
      .newTransaction()
      .addInput(inputs.userUtxo)
      .addInput(inputs.primaryForeverUtxo, PlutusData.newInteger(0n))
      .addReferenceInput(inputs.primaryThresholdUtxo)
      .addReferenceInput(inputs.secondaryForeverUtxo)
      .addReferenceInput(inputs.primaryTwoStageUtxo)
      .provideScript(inputs.primaryForever);
    const witnessed = mintWitnesses(
      spent,
      [
        { ...primary, signers: inputs.currentPrimarySigners, assetName: "" },
        { ...secondary, signers: inputs.secondarySigners, assetName: "" },
      ],
      networkId,
    ).addOutput(
      TransactionOutput.fromCore({
        address: PaymentAddress(primaryForeverAddress.toBech32()),
        value: {
          coins: inputs.primaryForeverUtxo.output().amount().coin(),
          assets: new Map([[AssetId(inputs.primaryForever.hash()), 1n]]),
        },
        datum: newForeverStateCbor.toCore(),
      }),
    );
    return withdrawThroughLogic(
      witnessed,
      inputs.logicScript,
      inputs.mitigationLogicScript,
      logicRedeemer(innerRedeemer, inputs.logicRound),
      networkId,
    )
      .setChangeAddress(params.changeAddress)
      .setMetadata(createTxMetadata(params.commandName))
      .setFeePadding(params.feePadding);
  });

/** The logic scripts a two-stage main state names, logged with the reward accounts the transaction withdraws from. */
export const twoStageLogic = (
  label: string,
  twoStageMain: TransactionUnspentOutput,
  expectedLogic: string,
  networkId: NetworkId,
) =>
  Effect.gen(function* () {
    const out = yield* Output;
    yield* out.log(`\nReading ${label} two-stage upgrade state...`);
    const state = yield* upgradeStateAt(twoStageMain);
    yield* out.log(`  Logic hash: ${state.logicHash}`);
    yield* out.log(
      `  Mitigation logic hash: ${state.mitigationLogicHash || "(empty)"}`,
    );
    yield* out.log(`  Logic round: ${state.logicRound}`);
    const { logic, mitigationLogic } = yield* upgradeScripts(
      state,
      expectedLogic,
    );
    yield* out.log(
      `\nLogic reward account: ${createRewardAccount(state.logicHash, networkId)}`,
    );
    if (Option.isSome(mitigationLogic)) {
      yield* out.log(
        `Mitigation logic reward account: ${createRewardAccount(state.mitigationLogicHash, networkId)}`,
      );
      yield* out.log("  Adding mitigation logic withdrawal...");
    }
    return {
      logicRound: state.logicRound,
      logicScript: logic,
      mitigationLogicScript: mitigationLogic,
    };
  });

/** Resolve the inputs, build, complete and write the change transaction. */
export const multisigChangeProgram = (
  config: MultisigChangeConfig,
  input: MultisigChangeInput,
) =>
  Effect.gen(function* () {
    const { network, txHash, txIndex, sign } = input;
    const signer = yield* signerFor(sign, "both");
    const out = yield* Output;
    const cfg = yield* Settings;
    const blueprint = yield* Blueprint;
    const provider = yield* Provider;
    const label = config.commandLabel;
    const lower = label.toLowerCase();
    const outputPath = txFilePath(input);

    yield* out.log(`\nChanging ${label} members on ${network} network`);
    yield* out.log(`Using UTxO: ${txHash}#${txIndex}`);

    const { networkId } = environmentOf(network);
    const contracts = yield* blueprint.instances;
    const selected = config.getContracts(contracts);
    const primaryForeverAddress = addressFromValidator(
      networkId,
      selected.primaryForever.Script,
    );
    yield* out.log(
      `\n${label} Forever Address: ${primaryForeverAddress.toBech32()}`,
    );

    const blaze = yield* provider.blaze;
    const queryMap = {
      primaryForever: selected.primaryForever.Script,
      primaryThreshold: selected.primaryThreshold.Script,
      secondaryForever: selected.secondaryForever.Script,
      primaryTwoStage: selected.primaryTwoStage.Script,
    };
    const found = yield* contractUtxos(queryMap, networkId);
    yield* out.log("\nFound contract UTxOs:");
    for (const name of Record.keys(queryMap)) {
      yield* out.log(`  ${name}: ${found.at(name).length}`);
    }

    const primaryForeverUtxo = yield* found.first("primaryForever");
    const primaryThresholdUtxo = yield* found.first("primaryThreshold");
    const secondaryForeverUtxo = yield* found.first("secondaryForever");
    const primaryTwoStageUtxo = yield* found.main("primaryTwoStage");

    const { logicRound, logicScript, mitigationLogicScript } =
      yield* twoStageLogic(
        lower,
        primaryTwoStageUtxo,
        selected.primaryLogic.Script.hash(),
        networkId,
      );

    yield* out.log(`\nDecoding ${lower} forever datum (version-aware)...`);
    const currentPrimarySigners = yield* signersAt(primaryForeverUtxo);

    yield* out.log("\nReading current secondary state for ML-3 validation...");
    const secondarySigners = yield* signersAt(secondaryForeverUtxo);

    const newSigners = yield* cfg.newSigners(config.signerEnvVar);
    yield* out.log(`New ${lower} signers count: ${newSigners.length}`);
    yield* out.log(
      `  Unique payment hashes: ${new Set(newSigners.map((s) => s.paymentHash)).size}`,
    );

    yield* out.log(`\nReading ${lower} update threshold...`);
    const threshold = yield* thresholdAt(primaryThresholdUtxo);

    const requirements = signerRequirements(
      threshold,
      currentPrimarySigners,
      secondarySigners,
      config.primaryFamily,
    );
    const { primary, secondary } = requirements;
    yield* out.log(
      `\nRequired ${primary.label} signers: ${primary.required}/${primary.total}`,
    );
    yield* out.log(
      `Required ${secondary.label} signers: ${secondary.required}/${secondary.total}`,
    );

    const { address: changeAddress, utxo: userUtxo } = yield* deployerUtxo(
      txHash,
      txIndex,
    );
    const inputs: MultisigChangeInputs = {
      primaryForever: selected.primaryForever.Script,
      primaryForeverUtxo,
      primaryThresholdUtxo,
      secondaryForeverUtxo,
      primaryTwoStageUtxo,
      userUtxo,
      logicScript,
      mitigationLogicScript,
      logicRound,
      currentPrimarySigners,
      secondarySigners,
      requirements,
    };
    const txBuilder = yield* buildMultisigChangeTx(blaze, inputs, {
      newSigners,
      networkId,
      changeAddress,
      commandName: config.commandName,
      feePadding: input.feePadding,
    });
    const tx = yield* buildTx(txBuilder, {
      commandName: config.commandName,
      environment: network,
      witnesses: witnessCount(signer, primary.required + secondary.required),
      knownUtxos: [
        primaryForeverUtxo,
        primaryThresholdUtxo,
        secondaryForeverUtxo,
        primaryTwoStageUtxo,
        userUtxo,
      ],
    });
    yield* signAndWrite(tx, outputPath, signer, config.signDescription);
    return tx;
  });

/** Council is primary; the tech-auth forever datum gives the secondary signers (raw map read). */
export const changeCouncilConfig: MultisigChangeConfig = {
  commandName: "change-council",
  commandLabel: "Council",
  signDescription: "Change Council Transaction",
  primaryFamily: "council",
  signerEnvVar: "COUNCIL_SIGNERS",
  getContracts: (contracts) => ({
    primaryForever: contracts.councilForever,
    primaryTwoStage: contracts.councilTwoStage,
    primaryThreshold: contracts.mainCouncilUpdateThreshold,
    primaryLogic: contracts.councilLogic,
    secondaryForever: contracts.techAuthForever,
  }),
};

/** Tech auth is primary; the council forever datum gives the secondary signers. */
export const changeTechAuthConfig: MultisigChangeConfig = {
  commandName: "change-tech-auth",
  commandLabel: "Tech Auth",
  signDescription: "Change Technical Authority Transaction",
  primaryFamily: "tech-auth",
  signerEnvVar: "TECH_AUTH_SIGNERS",
  getContracts: (contracts) => ({
    primaryForever: contracts.techAuthForever,
    primaryTwoStage: contracts.techAuthTwoStage,
    primaryThreshold: contracts.mainTechAuthUpdateThreshold,
    primaryLogic: contracts.techAuthLogic,
    secondaryForever: contracts.councilForever,
  }),
};
