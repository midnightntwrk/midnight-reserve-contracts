/**
 * What deploy and deploy-staging-track share: the setup (profile, build
 * contracts, deployer, signers, Blaze and the checked collateral), the
 * forever datums, the transaction file entry and the script outputs of a
 * built transaction, and the header and closing report.
 */
import {
  CredentialType,
  PlutusData,
  type Transaction,
} from "@blaze-cardano/core";
import type {
  Blaze,
  Provider as BlazeProvider,
  Wallet,
} from "@blaze-cardano/sdk";
import { calculateRequiredCollateral } from "@blaze-cardano/tx";
import { Effect, Either, Option } from "effect";
import { type Environment, environmentOf } from "../config/network-mapping";
import { type NetworkConfig, Settings } from "../config/settings";
import {
  Blueprint,
  type ContractInstances,
  hasDeployedScripts,
} from "../contracts/contracts";
import { buildOutput, PROJECT_ROOT } from "../contracts/paths";
import { promotedAmong } from "../contracts/versions";
import { initialFederatedOpsDatum } from "../datum/federated-ops";
import {
  encodeMultisigState,
  encodeRedeemerMap,
  type Signers,
} from "../datum/signers";
import type { TxHash, TxIndex } from "../input";
import { Provider } from "../chain/provider";
import { refOf } from "../chain/transaction";
import { transactionFile, type TransactionFile } from "../chain/tx-file";
import { Output, transactionSummaryLines } from "../output";
import {
  type ConfigError,
  type InputParseError,
  PreconditionFailed,
  UtxoNotFound,
} from "../errors";
import type { DeployParams } from "./builders";

/** The fee a deployment's collateral must cover, before the protocol's percentage. */
const ESTIMATED_MAX_FEE = 5_000_000n;

const RULE = "===========================================";

/** A UTxO reference: a transaction hash and an output index. */
export type UtxoRef = readonly [TxHash, TxIndex];

const refKey = ([hash, index]: UtxoRef) => `${hash}#${index}`;

/** The deployer's unspent outputs, read once, as a lookup: the UTxOs at these references in order (only the deployer signs a deploy), UtxoNotFound naming one that is not among them. */
export const deployerUnspent = Effect.gen(function* () {
  const address = yield* Effect.flatMap(Settings, (s) => s.deployerAddress);
  const unspent = new Map(
    (yield* Effect.flatMap(Provider, (p) => p.unspentOutputs(address))).map(
      (utxo) => [refOf(utxo.input()), utxo],
    ),
  );
  return (refs: readonly UtxoRef[]) =>
    Effect.forEach(refs, (ref) =>
      Either.fromNullable(unspent.get(refKey(ref)), () =>
        UtxoNotFound.byRef(refKey(ref), address.toBech32()),
      ),
    );
});

/** The deployer's UTxOs at these references, in order; one that is not among its unspent outputs is UtxoNotFound naming it. */
export const resolveUnspent = (refs: readonly UtxoRef[]) =>
  Effect.flatMap(deployerUnspent, (at) => at(refs));

/** The profile's collateral UTxO from the chain, unspent, checked against the protocol's collateral percentage. */
export const resolveCollateral = (
  command: string,
  config: NetworkConfig,
  collateralPercentage: number,
) =>
  Effect.gen(function* () {
    const { collateral_utxo_hash: hash, collateral_utxo_index: index } = config;
    const out = yield* Output;
    const [collateral] = yield* resolveUnspent([[hash, index]]);
    const available = collateral.output().amount().coin();
    yield* out.log(
      `\nUsing collateral UTxO: ${hash}#${index} with ${available} lovelace`,
    );
    const required = calculateRequiredCollateral(
      ESTIMATED_MAX_FEE,
      collateralPercentage,
    );
    if (available < required) {
      return yield* new PreconditionFailed({
        command,
        refusal: {
          _tag: "CollateralTooSmall",
          lovelace: available,
          required,
          collateralPercentage,
          estimatedMaxFee: ESTIMATED_MAX_FEE,
        },
      });
    }
    yield* out.log(
      `Collateral validation passed: ${available} lovelace >= ${required} lovelace required`,
    );
    return collateral;
  });

/** What every deployment builds from. */
export interface DeploymentSetup {
  readonly config: NetworkConfig;
  readonly contracts: ContractInstances;
  readonly deployer: string;
  readonly techAuthSigners: Signers;
  readonly councilSigners: Signers;
  readonly blaze: Blaze<BlazeProvider, Wallet>;
  readonly params: DeployParams;
  readonly maxTxSize: number;
}

/** The profile, the build contracts, the deployer, the signers to install, Blaze and the DeployParams with the checked collateral. */
export const deploymentSetup = (command: string, network: Environment) =>
  Effect.gen(function* () {
    const out = yield* Output;
    const settings = yield* Settings;
    const provider = yield* Provider;
    const config = yield* settings.profile;
    const contracts = yield* Effect.flatMap(Blueprint, (b) => b.instances);
    const deployer = (yield* settings.deployerAddress).toBech32();
    const techAuthSigners = yield* settings.newSigners("TECH_AUTH_SIGNERS");
    const councilSigners = yield* settings.newSigners("COUNCIL_SIGNERS");
    yield* out.log(`\nTotal tech auth signers: ${techAuthSigners.length}`);
    yield* out.log(
      `Number of tech auth signer pairs: ${techAuthSigners.length}`,
    );
    yield* out.log(`Total council signers: ${councilSigners.length}`);
    yield* out.log(`Number of council signer pairs: ${councilSigners.length}`);

    const blaze = yield* provider.blaze;
    const protocolParams = yield* provider.use("getParameters", (p) =>
      p.getParameters(),
    );
    const collateral = yield* resolveCollateral(
      command,
      config,
      protocolParams.collateralPercentage,
    );
    const setup: DeploymentSetup = {
      config,
      contracts,
      deployer,
      techAuthSigners,
      councilSigners,
      blaze,
      params: {
        networkId: environmentOf(network).networkId,
        coinsPerUtxoByte: protocolParams.coinsPerUtxoByte,
        collateral,
      },
      maxTxSize: protocolParams.maxTxSize,
    };
    return setup;
  });

/** A forever NFT's datum and its mint redeemer. */
export interface ForeverMint {
  readonly datum: PlutusData;
  readonly redeemer: PlutusData;
}

/** A forever datum minted with redeemer 0. */
export const zeroRedeemer = (datum: PlutusData): ForeverMint => ({
  datum,
  redeemer: PlutusData.newInteger(0n),
});

/** The signers' multisig state, minted with their redeemer map. */
export const multisigForever = (
  signers: Signers,
): Either.Either<ForeverMint, InputParseError> =>
  Either.all({
    datum: encodeMultisigState(signers),
    redeemer: encodeRedeemerMap(signers),
  });

/** The FederatedOps datum over PERMISSIONED_CANDIDATES, minted with redeemer 0. */
export const federatedOpsForever: Effect.Effect<
  ForeverMint,
  ConfigError | InputParseError,
  Settings
> = Effect.map(
  Effect.flatMap(Settings, (s) => s.permissionedCandidates),
  (candidates) => zeroRedeemer(initialFederatedOpsDatum(candidates)),
);

/** The --components selection in build order; None selects the defaults (every one unless given). */
export const selectComponents = <Component extends string>(
  all: readonly Component[],
  components: Option.Option<readonly Component[]>,
  defaults: readonly Component[] = all,
): Component[] =>
  Option.match(components, {
    onNone: () => [...defaults],
    onSome: (selected) => all.filter((c) => selected.includes(c)),
  });

/** An output a deployment reports: at a script, holding a token (the first one shown), or carrying a reference script (its hash shown). */
export interface ScriptOutput {
  readonly address: string;
  readonly token: Option.Option<{
    readonly policyId: string;
    readonly assetName: string;
  }>;
  readonly referenceScript: Option.Option<string>;
}

const PRINTABLE = /^[\x20-\x7E]*$/;

/** An asset name as text when it is printable ASCII, else its hex; "(empty)" for the empty name. */
const displayAssetName = (hex: string): string => {
  if (hex === "") return "(empty)";
  const text = new TextDecoder().decode(Buffer.from(hex, "hex"));
  return PRINTABLE.test(text) ? text : hex;
};

/** The outputs of a transaction at a script address, holding a token or carrying a reference script. */
const scriptOutputsOf = (tx: Transaction): ScriptOutput[] =>
  tx
    .body()
    .outputs()
    .flatMap((output) => {
      const multiasset = output.amount().multiasset();
      const referenceScript = Option.map(
        Option.fromNullable(output.scriptRef()),
        (script) => script.hash(),
      );
      const atScript =
        output.address().getProps().paymentPart?.type ===
        CredentialType.ScriptHash;
      if (!atScript && !multiasset && Option.isNone(referenceScript)) {
        return [];
      }
      const [assetId] = multiasset?.keys() ?? [];
      return [
        {
          address: output.address().toBech32(),
          token: Option.map(Option.fromNullable(assetId), (assetId) => ({
            policyId: assetId.slice(0, 56),
            assetName: displayAssetName(assetId.slice(56)),
          })),
          referenceScript,
        },
      ];
    });

/** A built deployment transaction: its file entry and its reported outputs. */
export interface BuiltDeployment {
  readonly file: TransactionFile;
  readonly outputs: readonly ScriptOutput[];
}

/** The file entry and reported outputs of a deployment transaction named `name`. */
export const builtDeployment = (
  name: string,
  tx: Transaction,
): BuiltDeployment => ({
  file: transactionFile(tx.toCbor(), tx.getId(), false, name),
  outputs: scriptOutputsOf(tx),
});

/** Write the deployment file of the built transactions, then the closing report: the count, the file, the transaction summary and each transaction's script outputs. */
export const reportDeployment = (
  generated: string,
  outputFile: string,
  {
    network,
    timestamp,
  }: { readonly network: string; readonly timestamp: string },
  built: readonly BuiltDeployment[],
) =>
  Effect.gen(function* () {
    const out = yield* Output;
    yield* out.writeJson(outputFile, {
      network,
      timestamp,
      transactions: built.map((b) => b.file),
    });
    yield* out.log(RULE);
    yield* out.success(generated);
    yield* out.log(`Output file: ${outputFile}`);
    yield* out.log(RULE);
    for (const line of transactionSummaryLines(built.map((b) => b.file)))
      yield* out.log(line);
    yield* out.log("\nScript Outputs:");
    yield* out.log(RULE);
    for (const { file, outputs } of built) {
      if (outputs.length === 0) continue;
      yield* out.log(`\n${file.description}:`);
      for (const output of outputs) {
        yield* out.log(`  Address: ${output.address}`);
        if (Option.isSome(output.token)) {
          yield* out.log(`  Policy ID: ${output.token.value.policyId}`);
          yield* out.log(`  Asset Name: ${output.token.value.assetName}`);
        }
        if (Option.isSome(output.referenceScript)) {
          yield* out.log(`  Reference Script: ${output.referenceScript.value}`);
        }
        yield* out.log("");
      }
      yield* out.log("");
    }
  });

/** The header lines every deployment prints. */
export const deploymentHeader = (title: string) =>
  Effect.flatMap(Output, (out) =>
    Effect.forEach([RULE, title, RULE], (line) => out.log(line), {
      discard: true,
    }),
  );

/** The build output of an environment's profile. */
export const buildOf = (network: Environment) =>
  buildOutput(PROJECT_ROOT, environmentOf(network).aikenConfigSection);

/** The snapshot a deploy keeps: none (local, the emulator), a test one a full run starts again, or a production one it only extends. */
export type SnapshotKind = "none" | "test" | "production";

/** Production comes first, so preprod and mainnet always keep a snapshot and are always checked. */
export const snapshotKindOf = (network: Environment): SnapshotKind =>
  environmentOf(network).production
    ? "production"
    : hasDeployedScripts(network)
      ? "test"
      : "none";

/** Refuse a run that would create a validator the snapshot's versions.json already promotes. */
export const refusePromoted = (
  command: string,
  network: Environment,
  targets: ReadonlySet<string>,
) =>
  Effect.gen(function* () {
    const promoted = yield* promotedAmong(
      network,
      buildOf(network).plutusPath,
      targets,
    );
    if (promoted.length > 0) {
      return yield* new PreconditionFailed({
        command,
        refusal: {
          _tag: "Promoted",
          environment: network,
          validators: promoted,
        },
      });
    }
  });
