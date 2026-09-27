/**
 * mint-staging-state: mint the StagingState NFT of a v2 logic script by
 * spending its one-shot UTxO. The program finds the one-shot and the
 * profile's collateral among the deployer's unspent outputs (resolveUnspent,
 * resolveCollateral, which also checks the collateral's size), the v2 logic
 * script and the staging forever hashes through the build blueprint;
 * buildMintStagingStateTx is pure over the resolved inputs. The datum is
 * the StagingState list [cnight_test_policy, forever_script_hash]; the
 * reserve's StagingStateV2 adds the staging rewards pool forever hash.
 */
import {
  Address,
  addressFromValidator,
  AssetId,
  AssetName,
  type NetworkId,
  PaymentAddress,
  PlutusData,
  PolicyId,
  type ProtocolParameters,
  type Script,
  TransactionOutput,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import type {
  Blaze,
  Provider as BlazeProvider,
  Wallet,
} from "@blaze-cardano/sdk";
import { calculateMinAda, type TxBuilder } from "@blaze-cardano/tx";
import { Effect } from "effect";
import { type FeeInput, type TxFileInput, txFilePath } from "../input";
import { type NetworkConfig, Settings } from "../config/settings";
import { environmentOf } from "../config/network-mapping";
import {
  type ContractClass,
  type ContractInstances,
  Blueprint,
} from "../contracts/contracts";
import {
  createTxMetadata,
  signAndWrite,
  signerFor,
  witnessCount,
} from "../chain/transaction";
import { Output } from "../output";
import { buildTx } from "../chain/complete-tx";
import type { V2TrackValidator } from "./two-stage-upgrade";
import { Provider } from "../chain/provider";
import { BlueprintError } from "../errors";
import {
  resolveCollateral,
  resolveUnspent,
  type UtxoRef,
} from "../deploy/deployment";

/** A staging-state mint: the validator, whether to sign, the fee padding, and where the file goes. */
export interface MintStagingStateInput
  extends TxFileInput, Pick<FeeInput, "feePadding"> {
  readonly validator: V2TrackValidator;
  readonly sign: boolean;
}

/** Where a validator's v2 track lives: its one-shot, the staging forever instances its state names, and v2 logic class names. */
interface V2Track {
  readonly oneShot: (config: NetworkConfig) => UtxoRef;
  readonly stagingForevers: (
    contracts: ContractInstances,
  ) => readonly (ContractClass | undefined)[];
  readonly v2LogicClasses: readonly string[];
}

const V2_TRACKS: Record<V2TrackValidator, V2Track> = {
  "tech-auth": {
    oneShot: (c) => [
      c.technical_authority_logic_v2_one_shot_hash,
      c.technical_authority_logic_v2_one_shot_index,
    ],
    stagingForevers: (c) => [c.techAuthStagingForever],
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
    stagingForevers: (c) => [c.councilStagingForever],
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
    stagingForevers: (c) => [
      c.reserveStagingForever,
      c.rewardsPoolStagingForever,
    ],
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
    stagingForevers: (c) => [c.icsStagingForever],
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
    stagingForevers: (c) => [c.federatedOpsStagingForever],
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
    stagingForevers: (c) => [c.termsAndConditionsStagingForever],
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
  readonly stagingForeverHashes: readonly string[];
  readonly cnightPolicy: string;
  readonly collateralUtxo: TransactionUnspentOutput;
  readonly protocolParams: ProtocolParameters;
}

export interface MintStagingStateParams {
  readonly networkId: NetworkId;
  readonly changeAddress: Address;
  readonly feePadding: bigint;
}

/** StagingState datum: the @list [cnight_test_policy, ...staging forever hashes]. */
const stagingStateDatum = (
  cnightPolicy: string,
  stagingForeverHashes: readonly string[],
): PlutusData =>
  PlutusData.fromCore({
    items: [cnightPolicy, ...stagingForeverHashes].map((hash) =>
      PlutusData.newBytes(Buffer.from(hash, "hex")).toCore(),
    ),
  });

/** The NFT output at the v2 logic address with the StagingState datum and its min UTxO. */
const stagingStateOutput = (
  inputs: MintStagingStateInputs,
  networkId: NetworkId,
): TransactionOutput => {
  const output = TransactionOutput.fromCore({
    address: PaymentAddress(
      addressFromValidator(networkId, inputs.v2LogicScript).toBech32(),
    ),
    value: {
      coins: 0n,
      assets: new Map([[AssetId(inputs.v2LogicScript.hash()), 1n]]),
    },
    datum: stagingStateDatum(
      inputs.cnightPolicy,
      inputs.stagingForeverHashes,
    ).toCore(),
  });
  output
    .amount()
    .setCoin(calculateMinAda(output, inputs.protocolParams.coinsPerUtxoByte));
  return output;
};

/** The mint transaction: spend the one-shot, mint the empty-name NFT under the v2 logic policy, lock it with the datum. */
export const buildMintStagingStateTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: MintStagingStateInputs,
  params: MintStagingStateParams,
): TxBuilder => {
  const txBuilder = blaze
    .newTransaction()
    .addInput(inputs.oneShotUtxo)
    .addMint(
      PolicyId(inputs.v2LogicScript.hash()),
      new Map([[AssetName(""), 1n]]),
      PlutusData.newInteger(0n),
    )
    .provideScript(inputs.v2LogicScript)
    .addOutput(stagingStateOutput(inputs, params.networkId))
    .setChangeAddress(params.changeAddress)
    .setMetadata(createTxMetadata("mint-staging-state"))
    .setFeePadding(params.feePadding);
  return txBuilder.provideCollateral([inputs.collateralUtxo]);
};

/** Resolve the inputs, build, complete and write the mint transaction. */
export const mintStagingStateProgram = (input: MintStagingStateInput) =>
  Effect.gen(function* () {
    const { network, validator, sign } = input;
    const signer = yield* signerFor(sign, "tech-auth");
    const track = V2_TRACKS[validator];
    const out = yield* Output;
    const cfg = yield* Settings;
    const blueprint = yield* Blueprint;
    const provider = yield* Provider;
    const outputPath = txFilePath(input);

    yield* out.log(`\nMinting StagingState NFT for ${validator} on ${network}`);
    const config = yield* cfg.profile;
    const { networkId } = environmentOf(network);
    const deployerAddress = yield* cfg.deployerAddress;
    const contracts = yield* blueprint.instances;

    const v2LogicScript = (yield* blueprint.classOf(track.v2LogicClasses))
      .Script;
    const v2LogicHash = v2LogicScript.hash();
    yield* out.log(`V2 logic script hash (policy ID): ${v2LogicHash}`);

    const oneShotRef = track.oneShot(config);
    yield* out.log(`One-shot UTxO: ${oneShotRef[0]}#${oneShotRef[1]}`);

    const stagingForevers = track.stagingForevers(contracts);
    if (
      !stagingForevers.every(
        (contract): contract is ContractClass => contract !== undefined,
      )
    ) {
      return yield* new BlueprintError({
        environment: network,
        source: "build",
        reason: `Staging forever contract not found for ${validator}. Ensure the blueprint includes staging forever validators.`,
      });
    }
    const stagingForeverHashes = stagingForevers.map((contract) =>
      contract.Script.hash(),
    );
    yield* out.log(
      `Staging forever hashes: ${stagingForeverHashes.join(", ")}`,
    );
    const cnightPolicy = config.cnight_policy;
    yield* out.log(`CNIGHT test policy: ${cnightPolicy}`);

    const blaze = yield* provider.blaze;
    const protocolParams = yield* provider.use("getParameters", (p) =>
      p.getParameters(),
    );
    const [oneShotUtxo] = yield* resolveUnspent([oneShotRef]);
    yield* out.log(
      `One-shot UTxO resolved: ${oneShotUtxo.output().amount().coin()} lovelace`,
    );

    const collateralUtxo = yield* resolveCollateral(
      "mint-staging-state",
      config,
      protocolParams.collateralPercentage,
    );

    const inputs: MintStagingStateInputs = {
      oneShotUtxo,
      v2LogicScript,
      stagingForeverHashes,
      cnightPolicy,
      collateralUtxo,
      protocolParams,
    };
    const v2Output = stagingStateOutput(inputs, networkId);
    yield* out.log(`Min UTxO for output: ${v2Output.amount().coin()} lovelace`);

    const txBuilder = buildMintStagingStateTx(blaze, inputs, {
      networkId,
      changeAddress: deployerAddress,
      feePadding: input.feePadding,
    });
    const tx = yield* buildTx(txBuilder, {
      commandName: "mint-staging-state",
      environment: network,
      witnesses: witnessCount(signer, 0),
      knownUtxos: [oneShotUtxo, collateralUtxo],
    });

    yield* signAndWrite(
      tx,
      outputPath,
      signer,
      "Mint StagingState NFT Transaction",
    );
    yield* out.log("\nStagingState NFT details:");
    yield* out.log(`  Policy ID: ${v2LogicHash}`);
    yield* out.log(`  Asset Name: (empty)`);
    yield* out.log(
      `  Output Address: ${addressFromValidator(networkId, v2LogicScript).toBech32()}`,
    );
    yield* out.log(`  Datum: StagingState`);
    yield* out.log(`    cnight_test_policy: ${cnightPolicy}`);
    yield* out.log(
      `    staging forever hashes: ${stagingForeverHashes.join(", ")}`,
    );
    return tx;
  });
