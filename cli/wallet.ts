/**
 * Wallet commands: generate-key, and the transactions a deployer or a test
 * user builds without governance signatures: simple-tx, mint-tcnight and
 * merge-utxos. Each resolves its inputs and its PlanningContext, plans
 * from them alone, compiles, and writes the unsigned transaction to a file.
 */
import { randomBytes } from "crypto";
import {
  type Address,
  addressFromCredential,
  addressFromValidator,
  AssetId,
  AssetName,
  blake2b_224,
  Credential,
  CredentialType,
  derivePublicKey,
  Ed25519PrivateNormalKeyHex,
  Hash28ByteBase16,
  HexBlob,
  type NetworkId,
  PaymentAddress,
  PlutusData,
  PolicyId,
  type Script,
  toHex,
  TransactionOutput,
  type TransactionUnspentOutput,
  Value,
} from "@blaze-cardano/core";
import { Effect, Option, Result } from "effect";
import { deployerUtxo, planningContext, Provider } from "./chain";
import {
  addressOn,
  cnightAssetId,
  DeployerAddress,
  type Environment,
  environmentOf,
  envOr,
  Profile,
} from "./config";
import { type Blueprint, ContractResolver } from "./contracts/resolver";
import {
  BlueprintError,
  DatumParseError,
  InputParseError,
  PreconditionFailed,
  UtxoNotFound,
} from "./errors";
import {
  findMainUtxo,
  upgradeScripts,
  upgradeStateAt,
} from "./governance/two-stage";
import {
  parsePositiveBigInt,
  parsePositiveInteger,
  type TxHash,
  type TxIndex,
  txFilePath,
} from "./input";
import { formatLovelaceToAda, Output } from "./output";
import {
  signAndWrite,
  UNSIGNED,
  writeTransaction,
  writeTransactionFile,
} from "./signing";
import {
  compile,
  createRewardAccount,
  logicRedeemer,
  minAda,
  type PlanningContext,
  type TxPlan,
  withdrawThroughLogic,
} from "./tx";

/** A signing key's public key hash and its enterprise address on the network. */
export function keyToAddress(privateKeyHex: string, networkId: NetworkId) {
  const publicKey = derivePublicKey(Ed25519PrivateNormalKeyHex(privateKeyHex));
  const publicKeyHash = blake2b_224(HexBlob(publicKey));
  const credential = Credential.fromCore({
    type: CredentialType.KeyHash,
    hash: Hash28ByteBase16(publicKeyHash),
  });
  const address = addressFromCredential(networkId, credential);
  return { privateKeyHex, publicKeyHash, address: address.toBech32() };
}

/** Generate a key and print the .env lines for it. */
export const generateKeyProgram = (input: { readonly network: Environment }) =>
  Effect.gen(function* () {
    const output = yield* Output;
    const key = yield* Effect.sync(() =>
      keyToAddress(
        randomBytes(32).toString("hex"),
        environmentOf(input.network).networkId,
      ),
    );
    for (const line of [
      `# Generated Cardano signing key and address`,
      `# Network: ${input.network}`,
      `# Add these to your .env file:\n`,
      `SIGNING_PRIVATE_KEY=${key.privateKeyHex}`,
      `DEPLOYER_ADDRESS=${key.address}`,
      `\n# Public key hash (for reference):`,
      `# PUBLIC_KEY_HASH=${key.publicKeyHash}`,
    ]) {
      yield* output.log(line);
    }
    return key;
  });

/** The transaction compile builds, reported as the reference CLI reports it: a local check when the plan spends, references or offers UTxOs, and the transaction id. */
const compileReported = <Resolved>(
  plan: TxPlan,
  ctx: PlanningContext<Resolved>,
) =>
  Effect.gen(function* () {
    const output = yield* Output;
    yield* output.log("\nBuilding transaction...");
    const checked =
      plan.spends.length + plan.references.length + plan.collateral.length > 0;
    if (checked) yield* output.log("  Testing transaction locally (UPLC)...");
    const tx = yield* compile(plan, ctx);
    if (checked) yield* output.success("Local UPLC test passed");
    yield* output.success(`Transaction built: ${tx.getId()}`);
    return tx;
  });

/** A plan with nothing in it, which the commands fill. */
const EMPTY_PLAN: TxPlan = {
  spends: [],
  references: [],
  scripts: [],
  mints: [],
  outputs: [],
  withdrawals: [],
  registrations: [],
  collateral: [],
  metadata: Option.none(),
  feePadding: 0n,
  expectedWitnesses: 1,
};

/** The contract names a context carries for trace labels. */
const namedContracts = (blueprint: Blueprint) =>
  Effect.map(blueprint.contracts, (contracts) =>
    contracts.map(({ className, hash }) => ({ className, hash })),
  );

/** An address on the environment's network; another network's is an InputParseError for `source`. */
const onNetwork = (address: Address, network: Environment, source: string) =>
  Effect.mapError(
    addressOn(address, network),
    (issue) => new InputParseError({ source, issues: [issue] }),
  );

// simple-tx

/** The recipient and the payments to it. */
export interface SimpleTx {
  readonly recipient: Address;
  readonly count: number;
  readonly amount: bigint;
}

/** `count` outputs of `amount` lovelace to one address; Blaze raises each to its min ADA. */
export const planSimpleTx = (ctx: PlanningContext<SimpleTx>): TxPlan => ({
  ...EMPTY_PLAN,
  outputs: Array.from(
    { length: ctx.resolved.count },
    () =>
      new TransactionOutput(
        ctx.resolved.recipient,
        new Value(ctx.resolved.amount),
      ),
  ),
});

/** Build (never submit) one transaction paying the deployer or --to `count` times, and write it to a file. --count and --amount fall back to SIMPLE_TX_COUNT (else 16) and SIMPLE_TX_AMOUNT (else 20 ADA). */
export const simpleTxProgram = (input: {
  readonly network: Environment;
  readonly outputDir: string;
  readonly outputFile: string;
  readonly count: Option.Option<number>;
  readonly amount: Option.Option<bigint>;
  readonly to: Option.Option<Address>;
}) =>
  Effect.gen(function* () {
    const { network } = input;
    const output = yield* Output;
    const count = Option.isSome(input.count)
      ? input.count.value
      : yield* envOr("SIMPLE_TX_COUNT", parsePositiveInteger, 16);
    const amount = Option.isSome(input.amount)
      ? input.amount.value
      : yield* envOr("SIMPLE_TX_AMOUNT", parsePositiveBigInt, 20_000_000n);
    const deployer = yield* (yield* DeployerAddress).address;
    const recipient = Option.isSome(input.to)
      ? yield* onNetwork(input.to.value, network, "--to")
      : deployer;

    yield* output.log(`\nGenerating simple transaction on ${network} network`);
    yield* output.log(`Creating ${count} outputs of ${amount} lovelace each`);
    yield* output.log(`Recipient: ${recipient.toBech32()}`);

    const ctx = yield* planningContext({
      command: "simple-tx",
      environment: network,
      wallet: deployer,
      contracts: [],
      resolved: { recipient, count, amount },
    });
    const tx = yield* compileReported(planSimpleTx(ctx), ctx);

    yield* output.log("\nTransaction details:");
    yield* output.log(`  - Outputs: ${count}`);
    yield* output.log(
      `  - Amount per output: ${formatLovelaceToAda(amount)} ADA`,
    );
    yield* output.log(
      `  - Total sent: ${formatLovelaceToAda(amount * BigInt(count))} ADA\n`,
    );
    yield* writeTransaction(txFilePath(input), tx, false, "Simple Transaction");
    return tx;
  });

// mint-tcnight

/** The NIGHT asset name. */
const NIGHT = AssetName(toHex(new TextEncoder().encode("NIGHT")));

/** tcnight_mint_infinite accepts any redeemer; the CLI sends 0. */
const TCNIGHT_REDEEMER = PlutusData.fromCbor(HexBlob("00"));

/** A mint pays the tokens to an address; a burn spends UTxOs holding them and pays the remainder back to the user. */
export type TcnightAction =
  | { readonly kind: "mint"; readonly destination: Address }
  | {
      readonly kind: "burn";
      readonly spend: readonly TransactionUnspentOutput[];
      readonly remainder: bigint;
      readonly user: Address;
    };

/** A mint or burn of `amount` NIGHT under the tcnight policy. */
export interface MintTcnight {
  readonly policy: Script;
  readonly amount: bigint;
  readonly action: TcnightAction;
}

/** Mint `amount` NIGHT to the destination, or burn it from the spent UTxOs and return the remainder; each NIGHT output holds its min ADA. */
export const planMintTcnight = (ctx: PlanningContext<MintTcnight>): TxPlan => {
  const { policy, amount, action } = ctx.resolved;
  const assetId = AssetId.fromParts(PolicyId(policy.hash()), NIGHT);
  const mint = (quantity: bigint): TxPlan["mints"] => [
    {
      policy,
      assets: new Map([[NIGHT, quantity]]),
      redeemer: Option.some(TCNIGHT_REDEEMER),
    },
  ];
  const nightOutput = (address: Address, quantity: bigint) => {
    const output = TransactionOutput.fromCore({
      address: PaymentAddress(address.toBech32()),
      value: { coins: 0n, assets: new Map([[assetId, quantity]]) },
    });
    output.amount().setCoin(minAda(output, ctx.parameters.coinsPerUtxoByte));
    return output;
  };
  return action.kind === "mint"
    ? {
        ...EMPTY_PLAN,
        mints: mint(amount),
        outputs: [nightOutput(action.destination, amount)],
      }
    : {
        ...EMPTY_PLAN,
        spends: action.spend.map((utxo) => ({
          utxo,
          redeemer: Option.none(),
        })),
        mints: mint(-amount),
        outputs:
          action.remainder > 0n
            ? [nightOutput(action.user, action.remainder)]
            : [],
      };
};

/** The NIGHT an output holds. */
const nightIn = (utxo: TransactionUnspentOutput, assetId: AssetId) =>
  utxo.output().amount().multiasset()?.get(assetId) ?? 0n;

/** The user's UTxOs holding NIGHT, in order, until they cover `amount`; the failure is what they hold when they do not. */
export const selectBurn = (
  utxos: readonly TransactionUnspentOutput[],
  assetId: AssetId,
  amount: bigint,
): Result.Result<
  {
    readonly spend: TransactionUnspentOutput[];
    readonly collected: bigint;
    readonly held: bigint;
    readonly holding: number;
  },
  { readonly held: bigint }
> => {
  const holding = utxos.filter((utxo) => nightIn(utxo, assetId) > 0n);
  const held = holding.reduce((sum, utxo) => sum + nightIn(utxo, assetId), 0n);
  if (held < amount) return Result.fail({ held });
  const spend: TransactionUnspentOutput[] = [];
  let collected = 0n;
  for (const utxo of holding) {
    if (collected >= amount) break;
    spend.push(utxo);
    collected += nightIn(utxo, assetId);
  }
  return Result.succeed({ spend, collected, held, holding: holding.length });
};

/** Mint NIGHT to an address, or burn it from the user's UTxOs, with the user's wallet; built (never submitted) and written to a file. Only test environments. */
export const mintTcnightProgram = (input: {
  readonly network: Environment;
  readonly outputDir: string;
  readonly outputFile: string;
  readonly amount: bigint;
  readonly userAddress: Address;
  readonly burn: boolean;
  readonly destination: Option.Option<Address>;
}) =>
  Effect.gen(function* () {
    const { network, amount } = input;
    if (input.burn && Option.isSome(input.destination)) {
      return yield* new InputParseError({
        source: "--destination",
        issues: [
          "--destination is only for a mint; a burn returns the remainder to --user-address",
        ],
      });
    }
    const output = yield* Output;
    const outputPath = txFilePath(input);
    const verb = input.burn ? "Burning" : "Minting";
    const user = yield* onNetwork(input.userAddress, network, "--user-address");
    const mintTo = Option.isSome(input.destination)
      ? yield* onNetwork(input.destination.value, network, "--destination")
      : user;

    yield* output.log(`\n${verb} TCnight tokens on ${network} network`);
    yield* output.log(`Amount: ${amount}`);
    yield* output.log(`User address: ${user.toBech32()}`);
    if (!input.burn) yield* output.log(`Destination: ${mintTo.toBech32()}`);

    const blueprint = (yield* ContractResolver).contracts("actsOn");
    const policy = (yield* blueprint.instances).tcnightMintInfinite;
    if (policy === undefined) {
      return yield* new BlueprintError({
        environment: network,
        source: blueprint.source,
        reason: "tcnight_mint_infinite is not in the blueprint",
      });
    }
    const policyId = PolicyId(policy.Script.hash());
    const assetId = AssetId.fromParts(policyId, NIGHT);
    yield* output.log(`\nTCnight Policy ID: ${policyId}`);

    const ctx = yield* planningContext({
      command: "mint-tcnight",
      environment: network,
      wallet: user,
      contracts: yield* namedContracts(blueprint),
      resolved: undefined,
    });
    const userUtxos = ctx.wallet.utxos;
    if (userUtxos.length === 0) {
      return yield* UtxoNotFound.at(user.toBech32());
    }
    yield* output.log(`Found ${userUtxos.length} UTxOs at user address`);

    let action: TcnightAction = { kind: "mint", destination: mintTo };
    if (input.burn) {
      const selected = yield* Effect.mapError(
        Effect.fromResult(selectBurn(userUtxos, assetId, amount)),
        ({ held }) =>
          held === 0n
            ? UtxoNotFound.holding(user.toBech32(), assetId)
            : new PreconditionFailed({
                command: "mint-tcnight",
                refusal: { _tag: "NightTooLow", held, required: amount },
              }),
      );
      yield* output.log(
        `Found ${selected.held} TCnight tokens across ${selected.holding} UTxOs`,
      );
      action = {
        kind: "burn",
        spend: selected.spend,
        remainder: selected.collected - amount,
        user,
      };
    }
    const tx = yield* compileReported(
      planMintTcnight({
        ...ctx,
        resolved: { policy: policy.Script, amount, action },
      }),
      ctx,
    );

    yield* writeTransactionFile(
      outputPath,
      tx,
      false,
      `${verb} TCNight Transaction`,
    );
    yield* output.log("\nTransaction details:");
    yield* output.log(`  - Action: ${verb}`);
    yield* output.log(`  - Amount: ${amount} NIGHT`);
    if (!input.burn) {
      yield* output.log(`  - Destination: ${mintTo.toBech32()}`);
    }
    yield* output.log(`\nTransaction written to ${outputPath}`);
    yield* output.log(
      `\nSign and submit with: just cli sign-and-submit -n ${network} ${outputPath}`,
    );
    return tx;
  });

// merge-utxos

const MERGE = "merge-utxos";

/** What the merge transaction is built from, read from the chain and the blueprint. */
export interface Merge {
  readonly forever: Script;
  readonly utxo1: TransactionUnspentOutput;
  readonly utxo2: TransactionUnspentOutput;
  readonly twoStageMainUtxo: TransactionUnspentOutput;
  readonly feeUtxo: TransactionUnspentOutput;
  /** The logic the two-stage main state names; its logic_round selects the redeemer shape. */
  readonly logicScript: Script;
  readonly logicRound: number;
  readonly cnight: AssetId;
  readonly feePadding: bigint;
}

/** The ADA and cNIGHT of both UTxOs; at least one must hold cNIGHT. */
const mergeAmounts = (
  utxo1: TransactionUnspentOutput,
  utxo2: TransactionUnspentOutput,
  cnight: AssetId,
): Result.Result<
  {
    readonly ada: bigint;
    readonly cnight1: bigint;
    readonly cnight2: bigint;
    readonly cnight: bigint;
  },
  PreconditionFailed
> => {
  const value1 = utxo1.output().amount();
  const value2 = utxo2.output().amount();
  const cnight1 = value1.multiasset()?.get(cnight) ?? 0n;
  const cnight2 = value2.multiasset()?.get(cnight) ?? 0n;
  return cnight1 === 0n && cnight2 === 0n
    ? Result.fail(
        new PreconditionFailed({
          command: MERGE,
          refusal: { _tag: "NoCnight", asset: cnight },
        }),
      )
    : Result.succeed({
        ada: value1.coin() + value2.coin(),
        cnight1,
        cnight2,
        cnight: cnight1 + cnight2,
      });
};

/** Spend both forever UTxOs and the fee UTxO, withdraw through the logic, and pay one output with exactly their ADA and cNIGHT and the first datum. */
export const planMerge = (
  ctx: PlanningContext<Merge>,
): Result.Result<TxPlan, PreconditionFailed | DatumParseError> =>
  Result.gen(function* () {
    const merge = ctx.resolved;
    const amounts = yield* mergeAmounts(merge.utxo1, merge.utxo2, merge.cnight);
    const datum = merge.utxo1.output().datum();
    if (datum === undefined) {
      return yield* Result.fail(
        new DatumParseError({
          what: "forever",
          cbor: "",
          reason: "First UTxO missing datum",
        }),
      );
    }
    const merged = new TransactionOutput(
      addressFromValidator(ctx.networkId, merge.forever),
      new Value(amounts.ada, new Map([[merge.cnight, amounts.cnight]])),
    );
    merged.setDatum(datum);
    const spend = Option.some(PlutusData.newInteger(0n));
    return {
      ...EMPTY_PLAN,
      spends: [
        { utxo: merge.utxo1, redeemer: spend },
        { utxo: merge.utxo2, redeemer: spend },
        { utxo: merge.feeUtxo, redeemer: Option.none() },
      ],
      references: [merge.twoStageMainUtxo],
      scripts: [merge.forever],
      outputs: [merged],
      withdrawals: withdrawThroughLogic(
        merge.logicScript,
        Option.none(),
        logicRedeemer(PlutusData.newInteger(0n), merge.logicRound),
        ctx.networkId,
      ),
      metadata: Option.some(MERGE),
      feePadding: merge.feePadding,
    };
  });

/** Merge two value-holding UTxOs at a reserve or ICS forever validator into one, under the logic the two-stage main state names; built (never submitted) and written to a file. */
export const mergeUtxosProgram = (input: {
  readonly network: Environment;
  readonly outputDir: string;
  readonly outputFile: string;
  readonly validator: "reserve" | "ics";
  readonly utxo1Hash: TxHash;
  readonly utxo1Index: TxIndex;
  readonly utxo2Hash: TxHash;
  readonly utxo2Index: TxIndex;
  readonly txHash: TxHash;
  readonly txIndex: TxIndex;
  readonly feePadding: bigint;
}) =>
  Effect.gen(function* () {
    const { network, validator, utxo1Hash, utxo1Index, utxo2Hash, utxo2Index } =
      input;
    if (utxo1Hash === utxo2Hash && utxo1Index === utxo2Index) {
      return yield* new InputParseError({
        source: "--utxo2-hash/--utxo2-index",
        issues: [
          `UTxO 2 is UTxO 1 (${utxo1Hash}#${utxo1Index}): a merge needs two different UTxOs`,
        ],
      });
    }
    const { txHash, txIndex } = input;
    const output = yield* Output;
    const provider = yield* Provider;
    const blueprint = (yield* ContractResolver).contracts("actsOn");

    yield* output.log(`\nMerging UTxOs on ${network} network`);
    yield* output.log(`Validator: ${validator}`);
    yield* output.log(`UTxO 1: ${utxo1Hash}#${utxo1Index}`);
    yield* output.log(`UTxO 2: ${utxo2Hash}#${utxo2Index}`);
    yield* output.log(`Fee UTxO: ${txHash}#${txIndex}`);

    const { networkId } = environmentOf(network);
    const cnight = cnightAssetId(yield* (yield* Profile).config);
    const { twoStage, forever, logic } = yield* blueprint.twoStage(validator);
    const foreverAddress = addressFromValidator(networkId, forever.Script);
    const twoStageAddress = addressFromValidator(networkId, twoStage.Script);
    yield* output.log(`\nForever address: ${foreverAddress.toBech32()}`);
    yield* output.log(`Two-stage address: ${twoStageAddress.toBech32()}`);

    const [foreverUtxos, twoStageUtxos] = yield* Effect.all(
      [
        provider.unspentOutputs(foreverAddress),
        provider.unspentOutputs(twoStageAddress),
      ],
      { concurrency: "unbounded" },
    );
    yield* output.log("\nFound contract UTxOs:");
    yield* output.log(`  Forever: ${foreverUtxos.length}`);
    yield* output.log(`  Two-stage: ${twoStageUtxos.length}`);
    const twoStageMainUtxo = findMainUtxo(
      twoStageUtxos,
      twoStage.Script.hash(),
    );
    if (twoStageMainUtxo === undefined) {
      return yield* UtxoNotFound.holding(
        twoStageAddress.toBech32(),
        `${twoStage.Script.hash()}.main`,
      );
    }
    const foreverUtxo = (hash: TxHash, index: TxIndex) => {
      const found = foreverUtxos.find(
        (utxo) =>
          String(utxo.input().transactionId()) === hash &&
          utxo.input().index() === BigInt(index),
      );
      return found === undefined
        ? Effect.fail(
            UtxoNotFound.byRef(`${hash}#${index}`, foreverAddress.toBech32()),
          )
        : Effect.succeed(found);
    };
    const utxo1 = yield* foreverUtxo(utxo1Hash, utxo1Index);
    const utxo2 = yield* foreverUtxo(utxo2Hash, utxo2Index);

    yield* output.log("\nReading two-stage upgrade state...");
    const { logicHash, mitigationLogicHash, logicRound } =
      yield* upgradeStateAt(twoStageMainUtxo);
    yield* output.log(`  Logic hash: ${logicHash}`);
    yield* output.log(
      `  Mitigation logic hash: ${mitigationLogicHash || "(empty)"}`,
    );
    yield* output.log(`  Logic round: ${logicRound}`);
    if (mitigationLogicHash) {
      return yield* new PreconditionFailed({
        command: MERGE,
        refusal: { _tag: "MitigationActive", mitigationLogicHash },
      });
    }
    const { logic: logicScript } = yield* upgradeScripts(
      blueprint,
      { logicHash, mitigationLogicHash },
      logic.Script.hash(),
    );
    yield* output.log(
      `\nLogic reward account: ${createRewardAccount(logicHash, networkId)}`,
    );

    const { address: deployer, utxo: feeUtxo } = yield* deployerUtxo(
      txHash,
      txIndex,
    );

    yield* output.log("\nMerging values:");
    const amounts = yield* Effect.fromResult(
      mergeAmounts(utxo1, utxo2, cnight),
    );
    yield* output.log(
      `  UTxO 1: ${utxo1.output().amount().coin()} lovelace, ${amounts.cnight1} CNIGHT`,
    );
    yield* output.log(
      `  UTxO 2: ${utxo2.output().amount().coin()} lovelace, ${amounts.cnight2} CNIGHT`,
    );
    yield* output.log(
      `  Merged: ${amounts.ada} lovelace, ${amounts.cnight} CNIGHT`,
    );

    const ctx = yield* planningContext({
      command: MERGE,
      environment: network,
      wallet: deployer,
      contracts: yield* namedContracts(blueprint),
      resolved: {
        forever: forever.Script,
        utxo1,
        utxo2,
        twoStageMainUtxo,
        feeUtxo,
        logicScript,
        logicRound,
        cnight,
        feePadding: input.feePadding,
      },
    });
    const tx = yield* compileReported(
      yield* Effect.fromResult(planMerge(ctx)),
      ctx,
    );
    yield* signAndWrite(
      tx,
      txFilePath(input),
      UNSIGNED,
      "Merge UTxOs Transaction",
    );
    return tx;
  });
