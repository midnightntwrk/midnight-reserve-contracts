/**
 * mint-staging-state: mint the StagingState NFT of a v2 logic script by
 * spending its one-shot UTxO. resolveMintStagingState finds the one-shot and
 * the profile's collateral among the deployer's unspent outputs
 * (resolveUnspent, resolveCollateral, which also checks the collateral's
 * size), the v2 logic script and the staging forever hash through the build
 * blueprint; planMintStagingState is pure over the resolved inputs and
 * compile completes it. The datum is the StagingState list
 * [cnight_test_policy, forever_script_hash].
 */
import {
  type Address,
  addressFromValidator,
  AssetId,
  AssetName,
  type NetworkId,
  PaymentAddress,
  PlutusData,
  type ProtocolParameters,
  type Script,
  TransactionOutput,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import { calculateMinAda } from "@blaze-cardano/tx";
import { Effect, Option } from "effect";
import { type FeeInput, type TxFileInput, txFilePath } from "../input";
import { type NetworkConfig, Profile } from "../config/profile";
import { DeployerAddress } from "../config/deployer";
import { deployerWallet } from "../chain/utxo";
import { environmentOf, slotConfigOf } from "../config/network-mapping";
import {
  type ContractClass,
  type ContractInstances,
  Blueprint,
  type V2TrackValidator,
} from "../contracts/contracts";
import type { TxPlan } from "../tx/plan";
import { signAndWrite, signerFor, witnessCount } from "../signing/signer";
import { Output } from "../output";
import { compile } from "../tx/compile";
import { Provider } from "../chain/provider";
import { BlueprintError } from "../errors";
import {
  resolveCollateral,
  resolveUnspent,
  type UtxoRef,
} from "../deploy/deployment";

const COMMAND = "mint-staging-state";

/** A staging-state mint: the validator, whether to sign, the fee padding, and where the file goes. */
export interface MintStagingStateInput
  extends TxFileInput, Pick<FeeInput, "feePadding"> {
  readonly validator: V2TrackValidator;
  readonly sign: boolean;
}

/** Where a validator's v2 track lives: its one-shot, staging forever instance and v2 logic class names. */
interface V2Track {
  readonly oneShot: (config: NetworkConfig) => UtxoRef;
  readonly stagingForever: (
    contracts: ContractInstances,
  ) => ContractClass | undefined;
  readonly v2LogicClasses: readonly string[];
}

const V2_TRACKS: Record<V2TrackValidator, V2Track> = {
  "tech-auth": {
    oneShot: (c) => [
      c.technical_authority_logic_v2_one_shot_hash,
      c.technical_authority_logic_v2_one_shot_index,
    ],
    stagingForever: (c) => c.techAuthStagingForever,
    v2LogicClasses: [
      "PermissionedV2TechAuthLogicV2Else",
      "PermissionedTechAuthLogicV2Else",
    ],
  },
  council: {
    oneShot: (c) => [
      c.council_logic_v2_one_shot_hash,
      c.council_logic_v2_one_shot_index,
    ],
    stagingForever: (c) => c.councilStagingForever,
    v2LogicClasses: [
      "PermissionedV2CouncilLogicV2Else",
      "PermissionedCouncilLogicV2Else",
    ],
  },
  reserve: {
    oneShot: (c) => [
      c.reserve_logic_v2_one_shot_hash,
      c.reserve_logic_v2_one_shot_index,
    ],
    stagingForever: (c) => c.reserveStagingForever,
    v2LogicClasses: [
      "ReserveV2ReserveLogicV2Else",
      "ReserveReserveLogicV2Else",
    ],
  },
  ics: {
    oneShot: (c) => [
      c.ics_logic_v2_one_shot_hash,
      c.ics_logic_v2_one_shot_index,
    ],
    stagingForever: (c) => c.icsStagingForever,
    v2LogicClasses: [
      "IlliquidCirculationSupplyV2IcsLogicV2Else",
      "IlliquidCirculationSupplyIcsLogicV2Else",
    ],
  },
  "federated-ops": {
    oneShot: (c) => [
      c.federated_operators_logic_v2_one_shot_hash,
      c.federated_operators_logic_v2_one_shot_index,
    ],
    stagingForever: (c) => c.federatedOpsStagingForever,
    v2LogicClasses: [
      "PermissionedV2FederatedOpsLogicV2Else",
      "PermissionedFederatedOpsLogicV2Else",
    ],
  },
  "terms-and-conditions": {
    oneShot: (c) => [
      c.terms_and_conditions_logic_v2_one_shot_hash,
      c.terms_and_conditions_logic_v2_one_shot_index,
    ],
    stagingForever: (c) => c.termsAndConditionsStagingForever,
    v2LogicClasses: [
      "TermsAndConditionsV2TermsAndConditionsLogicV2Else",
      "TermsAndConditionsTermsAndConditionsLogicV2Else",
    ],
  },
};

/** What the transaction is built from, resolved from the chain and the blueprint. */
export interface MintStagingStateInputs {
  readonly oneShotUtxo: TransactionUnspentOutput;
  /** The v2 logic script: the NFT's minting policy and the output's address. */
  readonly v2LogicScript: Script;
  readonly stagingForeverHash: string;
  readonly cnightPolicy: string;
  readonly collateralUtxo: TransactionUnspentOutput;
}

export interface MintStagingStateParams {
  readonly networkId: NetworkId;
  /** The protocol parameter that prices the staging output's min UTxO. */
  readonly coinsPerUtxoByte: ProtocolParameters["coinsPerUtxoByte"];
}

/** StagingState datum: the @list [cnight_test_policy, forever_script_hash]. */
const stagingStateDatum = (
  cnightPolicy: string,
  stagingForeverHash: string,
): PlutusData =>
  PlutusData.fromCore({
    items: [
      PlutusData.newBytes(Buffer.from(cnightPolicy, "hex")).toCore(),
      PlutusData.newBytes(Buffer.from(stagingForeverHash, "hex")).toCore(),
    ],
  });

/** The NFT output at the v2 logic address with the StagingState datum and its min UTxO. */
const stagingStateOutput = (
  inputs: MintStagingStateInputs,
  params: MintStagingStateParams,
): TransactionOutput => {
  const output = TransactionOutput.fromCore({
    address: PaymentAddress(
      addressFromValidator(params.networkId, inputs.v2LogicScript).toBech32(),
    ),
    value: {
      coins: 0n,
      assets: new Map([[AssetId(inputs.v2LogicScript.hash()), 1n]]),
    },
    datum: stagingStateDatum(
      inputs.cnightPolicy,
      inputs.stagingForeverHash,
    ).toCore(),
  });
  output.amount().setCoin(calculateMinAda(output, params.coinsPerUtxoByte));
  return output;
};

/** The mint: spend the one-shot, mint the empty-name NFT under the v2 logic policy, lock it with the datum. */
export const planMintStagingState = (
  inputs: MintStagingStateInputs,
  params: MintStagingStateParams,
): TxPlan => ({
  spends: [{ utxo: inputs.oneShotUtxo, redeemer: Option.none() }],
  references: [],
  scripts: [],
  mints: [
    {
      policy: inputs.v2LogicScript,
      assets: new Map([[AssetName(""), 1n]]),
      redeemer: Option.some(PlutusData.newInteger(0n)),
    },
  ],
  outputs: [stagingStateOutput(inputs, params)],
  withdrawals: [],
  registrations: [],
  collateral: [inputs.collateralUtxo],
  requiredSignatures: 0,
});

/** What the mint plan is built from and where its change goes. */
export interface ResolvedMintStagingState {
  readonly inputs: MintStagingStateInputs;
  readonly params: MintStagingStateParams;
  readonly changeAddress: Address;
}

/** Read and report everything the mint needs: the v2 logic script, the staging forever hash, the one-shot, the collateral and the staging output's min UTxO. */
export const resolveMintStagingState = (input: MintStagingStateInput) =>
  Effect.gen(function* () {
    const { network, validator } = input;
    const track = V2_TRACKS[validator];
    const out = yield* Output;
    const blueprint = yield* Blueprint;
    const provider = yield* Provider;

    yield* out.log(`\nMinting StagingState NFT for ${validator} on ${network}`);
    const config = yield* Profile.config;
    const { networkId } = environmentOf(network);
    const changeAddress = yield* DeployerAddress.address;
    const contracts = yield* blueprint.instances;

    const v2LogicScript = (yield* blueprint.classOf(track.v2LogicClasses))
      .Script;
    yield* out.log(`V2 logic script hash (policy ID): ${v2LogicScript.hash()}`);

    const oneShotRef = track.oneShot(config);
    yield* out.log(`One-shot UTxO: ${oneShotRef[0]}#${oneShotRef[1]}`);

    const stagingForever = track.stagingForever(contracts);
    if (!stagingForever) {
      return yield* new BlueprintError({
        environment: network,
        source: "build",
        reason: `Staging forever contract not found for ${validator}. Ensure the blueprint includes staging forever validators.`,
      });
    }
    const stagingForeverHash = stagingForever.Script.hash();
    yield* out.log(`Staging forever hash: ${stagingForeverHash}`);
    const cnightPolicy = config.cnight_policy;
    yield* out.log(`CNIGHT test policy: ${cnightPolicy}`);

    const { coinsPerUtxoByte, collateralPercentage } =
      yield* provider.parameters;
    const [oneShotUtxo] = yield* resolveUnspent([oneShotRef]);
    yield* out.log(
      `One-shot UTxO resolved: ${oneShotUtxo.output().amount().coin()} lovelace`,
    );

    const collateralUtxo = yield* resolveCollateral(
      COMMAND,
      config,
      collateralPercentage,
    );

    const inputs: MintStagingStateInputs = {
      oneShotUtxo,
      v2LogicScript,
      stagingForeverHash,
      cnightPolicy,
      collateralUtxo,
    };
    const params: MintStagingStateParams = { networkId, coinsPerUtxoByte };
    yield* out.log(
      `Min UTxO for output: ${stagingStateOutput(inputs, params).amount().coin()} lovelace`,
    );
    const resolved: ResolvedMintStagingState = {
      inputs,
      params,
      changeAddress,
    };
    return resolved;
  });

/** Resolve, plan, compile and write the mint transaction. */
export const mintStagingStateProgram = (input: MintStagingStateInput) =>
  Effect.gen(function* () {
    const signer = yield* signerFor(input.sign, "tech-auth");
    const out = yield* Output;
    const { inputs, params, changeAddress } =
      yield* resolveMintStagingState(input);
    const plan = planMintStagingState(inputs, params);
    const tx = yield* compile(plan, {
      commandName: COMMAND,
      slotConfig: slotConfigOf(input.network),
      wallet: yield* deployerWallet,
      changeAddress,
      feePadding: input.feePadding,
      metadata: Option.some(COMMAND),
      expectedWitnesses: witnessCount(signer, plan.requiredSignatures),
      contracts: yield* Effect.flatMap(Blueprint, (b) => b.contracts),
    });

    yield* signAndWrite(
      tx,
      txFilePath(input),
      signer,
      "Mint StagingState NFT Transaction",
    );
    yield* out.log("\nStagingState NFT details:");
    yield* out.log(`  Policy ID: ${inputs.v2LogicScript.hash()}`);
    yield* out.log(`  Asset Name: (empty)`);
    yield* out.log(
      `  Output Address: ${addressFromValidator(params.networkId, inputs.v2LogicScript).toBech32()}`,
    );
    yield* out.log(`  Datum: StagingState`);
    yield* out.log(`    cnight_test_policy: ${inputs.cnightPolicy}`);
    yield* out.log(`    forever_script_hash: ${inputs.stagingForeverHash}`);
    return tx;
  });
