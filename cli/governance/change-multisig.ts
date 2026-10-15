/**
 * Shared engine for change-council and change-tech-auth. The program
 * resolves the contract UTxOs, the two-stage UpgradeState (logic hash and
 * logic_round), the forever datum, the secondary signers for the ML-3 check
 * and the fee UTxO; planMultisigChange is pure over those inputs and is
 * what the tests call, and compile completes it. The config captures the
 * differences between the two commands.
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
import { Effect, Either, Option, Record } from "effect";
import {
  type Signers,
  encodeMultisigState,
  encodeRedeemerMap,
} from "../datum/signers";
import { datumRoundOf } from "../datum/datum-versions";
import { environmentOf, slotConfigOf } from "../config/network-mapping";
import {
  type ContractClass,
  type ContractInstances,
  Blueprint,
} from "../contracts/contracts";
import { contractUtxos, deployerUtxo, deployerWallet } from "../chain/utxo";
import { signersAt, thresholdAt } from "./authority";
import { twoStageLogic } from "./two-stage";
import {
  logicRedeemer,
  mintWitnesses,
  withdrawThroughLogic,
} from "../tx/scripts";
import { signAndWrite, signerFor, witnessCount } from "../signing/signer";
import { compile } from "../tx/compile";
import type { TxPlan } from "../tx/plan";
import {
  type AuthorityThreshold,
  type WitnessRequirement,
  witnessRequirements,
} from "./threshold";
import { type FeeInput, type TxFileInput, txFilePath } from "../input";
import {
  newSigners as readNewSigners,
  type SignersVariable,
} from "../config/intent-env";
import { Output } from "../output";
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

/** The change: spend the primary forever with the new datum, mint both native-script witnesses, withdraw through the logic scripts with the member redeemer. */
export const planMultisigChange = (
  inputs: MultisigChangeInputs,
  params: MultisigChangeParams,
): Either.Either<TxPlan, InputParseError> =>
  Either.gen(function* () {
    const { networkId, newSigners } = params;
    const newForeverStateCbor = yield* encodeMultisigState(
      newSigners,
      BigInt(datumRoundOf(inputs.logicRound)),
    );
    const innerRedeemer = yield* encodeRedeemerMap(newSigners);
    const { primary, secondary } = inputs.requirements;
    return {
      spends: [
        { utxo: inputs.userUtxo, redeemer: Option.none() },
        {
          utxo: inputs.primaryForeverUtxo,
          redeemer: Option.some(PlutusData.newInteger(0n)),
        },
      ],
      references: [
        inputs.primaryThresholdUtxo,
        inputs.secondaryForeverUtxo,
        inputs.primaryTwoStageUtxo,
      ],
      scripts: [inputs.primaryForever],
      ...mintWitnesses(
        [
          { ...primary, signers: inputs.currentPrimarySigners, assetName: "" },
          { ...secondary, signers: inputs.secondarySigners, assetName: "" },
        ],
        networkId,
      ),
      outputs: [
        TransactionOutput.fromCore({
          address: PaymentAddress(
            addressFromValidator(networkId, inputs.primaryForever).toBech32(),
          ),
          value: {
            coins: inputs.primaryForeverUtxo.output().amount().coin(),
            assets: new Map([[AssetId(inputs.primaryForever.hash()), 1n]]),
          },
          datum: newForeverStateCbor.toCore(),
        }),
      ],
      withdrawals: withdrawThroughLogic(
        inputs.logicScript,
        inputs.mitigationLogicScript,
        logicRedeemer(innerRedeemer, inputs.logicRound),
        networkId,
      ),
      registrations: [],
      collateral: [],
    };
  });

/** What the multisig change plan is built from and where its change goes. */
export interface ResolvedMultisigChange {
  readonly inputs: MultisigChangeInputs;
  readonly params: MultisigChangeParams;
  readonly changeAddress: Address;
}

/** Read and report everything the change needs: the primary and secondary forever UTxOs, the threshold, the two-stage state and its logic, both authorities' signers, the new signers and the fee UTxO. */
export const resolveMultisigChange = (
  config: MultisigChangeConfig,
  input: MultisigChangeInput,
) =>
  Effect.gen(function* () {
    const { network, txHash, txIndex } = input;
    const out = yield* Output;
    const blueprint = yield* Blueprint;
    const label = config.commandLabel;
    const lower = label.toLowerCase();

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

    const newSigners = yield* readNewSigners(config.signerEnvVar);
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
    const resolved: ResolvedMultisigChange = {
      inputs: {
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
      },
      params: { newSigners, networkId },
      changeAddress,
    };
    return resolved;
  });

/** Resolve, plan, compile and write the change transaction. */
export const multisigChangeProgram = (
  config: MultisigChangeConfig,
  input: MultisigChangeInput,
) =>
  Effect.gen(function* () {
    const signer = yield* signerFor(input.sign, "both");
    const { inputs, params, changeAddress } = yield* resolveMultisigChange(
      config,
      input,
    );
    const plan = yield* planMultisigChange(inputs, params);
    const tx = yield* compile(plan, {
      commandName: config.commandName,
      slotConfig: slotConfigOf(input.network),
      wallet: yield* deployerWallet,
      changeAddress,
      feePadding: input.feePadding,
      metadata: Option.some(config.commandName),
      expectedWitnesses: witnessCount(signer, plan.requiredSignatures),
      contracts: yield* Effect.flatMap(Blueprint, (b) => b.contracts),
    });
    yield* signAndWrite(tx, txFilePath(input), signer, config.signDescription);
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
