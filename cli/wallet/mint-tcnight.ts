/**
 * mint-tcnight: mint TCnight (the test cNIGHT, NIGHT under the
 * tcnight_mint_infinite policy) to an address, or burn it from the user's
 * UTxOs, built (never submitted) with the user's cold wallet and written to
 * a file. Only test environments: --network has no mainnet choice.
 */
import {
  type Address,
  AssetId,
  AssetName,
  HexBlob,
  PaymentAddress,
  PlutusData,
  PolicyId,
  type Script,
  toHex,
  TransactionOutput,
  type TransactionUnspentOutput,
} from "@blaze-cardano/core";
import {
  Blaze,
  type Provider as BlazeProvider,
  type Wallet,
} from "@blaze-cardano/sdk";
import { calculateMinAda, type TxBuilder } from "@blaze-cardano/tx";
import { Effect, Either, Option } from "effect";
import { buildTx } from "../chain/complete-tx";
import { GuardedWallet, Provider } from "../chain/provider";
import { transactionFile } from "../chain/tx-file";
import { environmentOf, type TestEnvironment } from "../config/network-mapping";
import { reservedRefs, Settings } from "../config/settings";
import { Blueprint } from "../contracts/contracts";
import {
  BlueprintError,
  InputParseError,
  PreconditionFailed,
  UtxoNotFound,
} from "../errors";
import { addressOn, type TxFileInput, txFilePath } from "../input";
import { Output } from "../output";
import { DEPLOYER_ONLY } from "../chain/transaction";

/** --burn and --destination as one request: a mint to the destination (None: the user), or a burn from the user's UTxOs. */
export type TcnightRequest =
  | { readonly kind: "mint"; readonly destination: Option.Option<Address> }
  | { readonly kind: "burn" };

/** The request of --burn and --destination; a burn with a destination is Left, the reason. */
export const parseTcnightRequest = (
  burn: boolean,
  destination: Option.Option<Address>,
): Either.Either<TcnightRequest, string> =>
  !burn
    ? Either.right({ kind: "mint", destination })
    : Option.isSome(destination)
      ? Either.left(
          "--destination is only for a mint; a burn returns the remainder to --user-address",
        )
      : Either.right({ kind: "burn" });

/** A mint or burn of `amount` NIGHT on a test environment. */
export interface MintTcnightInput extends TxFileInput {
  readonly network: TestEnvironment;
  readonly amount: bigint;
  readonly userAddress: Address;
  readonly request: TcnightRequest;
}

/** The NIGHT asset name. */
const NIGHT = AssetName(toHex(new TextEncoder().encode("NIGHT")));

/** tcnight_mint_infinite accepts any redeemer; the CLI sends 0. */
const REDEEMER = PlutusData.fromCbor(HexBlob("00"));

/** A mint pays the tokens to an address; a burn spends UTxOs holding them and pays the remainder back to the user. */
export type TcnightAction =
  | { readonly kind: "mint"; readonly destination: Address }
  | {
      readonly kind: "burn";
      readonly spend: readonly TransactionUnspentOutput[];
      readonly remainder: bigint;
      readonly user: Address;
    };

/** An output of `quantity` NIGHT at an address, at its min ADA. */
const nightOutput = (
  address: Address,
  assetId: AssetId,
  quantity: bigint,
  coinsPerUtxoByte: number,
): TransactionOutput => {
  const output = TransactionOutput.fromCore({
    address: PaymentAddress(address.toBech32()),
    value: { coins: 0n, assets: new Map([[assetId, quantity]]) },
  });
  output.amount().setCoin(calculateMinAda(output, coinsPerUtxoByte));
  return output;
};

/** Mint `amount` NIGHT to the destination, or burn it from the spent UTxOs and return the remainder. */
export const buildMintTcnightTx = (
  blaze: Blaze<BlazeProvider, Wallet>,
  inputs: {
    readonly policy: Script;
    readonly amount: bigint;
    readonly action: TcnightAction;
  },
  params: { readonly coinsPerUtxoByte: number },
): TxBuilder => {
  const policyId = PolicyId(inputs.policy.hash());
  const assetId = AssetId.fromParts(policyId, NIGHT);
  const { action } = inputs;
  if (action.kind === "mint") {
    return blaze
      .newTransaction()
      .addMint(policyId, new Map([[NIGHT, inputs.amount]]), REDEEMER)
      .provideScript(inputs.policy)
      .addOutput(
        nightOutput(
          action.destination,
          assetId,
          inputs.amount,
          params.coinsPerUtxoByte,
        ),
      );
  }
  const burned = action.spend
    .reduce((tx, utxo) => tx.addInput(utxo), blaze.newTransaction())
    .addMint(policyId, new Map([[NIGHT, -inputs.amount]]), REDEEMER)
    .provideScript(inputs.policy);
  return action.remainder > 0n
    ? burned.addOutput(
        nightOutput(
          action.user,
          assetId,
          action.remainder,
          params.coinsPerUtxoByte,
        ),
      )
    : burned;
};

/** The NIGHT an output holds. */
const nightIn = (utxo: TransactionUnspentOutput, assetId: AssetId) =>
  utxo.output().amount().multiasset()?.get(assetId) ?? 0n;

/** The user's UTxOs holding NIGHT, in order, until they cover `amount`; Left is the reason when they do not. */
export const selectBurn = (
  utxos: readonly TransactionUnspentOutput[],
  assetId: AssetId,
  amount: bigint,
): Either.Either<
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
  if (held < amount) return Either.left({ held });
  const spend: TransactionUnspentOutput[] = [];
  let collected = 0n;
  for (const utxo of holding) {
    if (collected >= amount) break;
    spend.push(utxo);
    collected += nightIn(utxo, assetId);
  }
  return Either.right({ spend, collected, held, holding: holding.length });
};

/** An address from an option, on the environment's network. */
const onNetwork = (
  address: Address,
  network: TestEnvironment,
  source: string,
) =>
  Either.mapLeft(
    addressOn(address, network),
    (issue) => new InputParseError({ source, issues: [issue] }),
  );

/** A burn of `amount` from the user's NIGHT-holding UTxOs, the remainder back to the user. */
export const burnAction = (
  user: Address,
  utxos: readonly TransactionUnspentOutput[],
  assetId: AssetId,
  amount: bigint,
) =>
  Effect.gen(function* () {
    const out = yield* Output;
    const selected = yield* Either.mapLeft(
      selectBurn(utxos, assetId, amount),
      ({ held }) =>
        held === 0n
          ? new UtxoNotFound({
              lookup: { by: "asset", address: user.toBech32(), asset: assetId },
            })
          : new PreconditionFailed({
              command: "mint-tcnight",
              refusal: { _tag: "NightTooLow", held, required: amount },
            }),
    );
    yield* out.log(
      `Found ${selected.held} TCnight tokens across ${selected.holding} UTxOs`,
    );
    const action: TcnightAction = {
      kind: "burn",
      spend: selected.spend,
      remainder: selected.collected - amount,
      user,
    };
    return action;
  });

/** Resolve the user's UTxOs, build, complete and write the mint or burn transaction. */
export const mintTcnightProgram = (input: MintTcnightInput) =>
  Effect.gen(function* () {
    const { network, amount, request } = input;
    const out = yield* Output;
    const provider = yield* Provider;
    const blueprint = yield* Blueprint;
    const outputPath = txFilePath(input);
    const verb = request.kind === "mint" ? "Minting" : "Burning";

    const user = yield* onNetwork(input.userAddress, network, "--user-address");
    const mintTo =
      request.kind === "mint"
        ? yield* Option.match(request.destination, {
            onNone: () => Either.right(user),
            onSome: (address) => onNetwork(address, network, "--destination"),
          })
        : user;

    yield* out.log(`\n${verb} TCnight tokens on ${network} network`);
    yield* out.log(`Amount: ${amount}`);
    yield* out.log(`User address: ${user.toBech32()}`);
    if (request.kind === "mint") {
      yield* out.log(`Destination: ${mintTo.toBech32()}`);
    }

    const policy = yield* Either.fromNullable(
      (yield* blueprint.instances).tcnightMintInfinite,
      () =>
        new BlueprintError({
          environment: network,
          source: blueprint.source,
          reason: "tcnight_mint_infinite is not in the blueprint",
        }),
    );
    const policyId = PolicyId(policy.Script.hash());
    const assetId = AssetId.fromParts(policyId, NIGHT);
    yield* out.log(`\nTCnight Policy ID: ${policyId}`);

    const { networkId } = environmentOf(network);
    const reserved = reservedRefs(
      yield* Effect.flatMap(Settings, (s) => s.profile),
    );
    const blaze = yield* provider.use("Blaze.from", (p) =>
      Blaze.from(p, new GuardedWallet(user, networkId, p, reserved)),
    );
    const protocolParams = yield* provider.use("getParameters", (p) =>
      p.getParameters(),
    );
    const userUtxos = yield* provider.unspentOutputs(user);
    if (userUtxos.length === 0) {
      return yield* new UtxoNotFound({
        lookup: { by: "address", address: user.toBech32() },
      });
    }
    yield* out.log(`Found ${userUtxos.length} UTxOs at user address`);

    const action: TcnightAction =
      request.kind === "mint"
        ? { kind: "mint", destination: mintTo }
        : yield* burnAction(user, userUtxos, assetId, amount);
    const tx = yield* buildTx(
      buildMintTcnightTx(
        blaze,
        { policy: policy.Script, amount, action },
        { coinsPerUtxoByte: protocolParams.coinsPerUtxoByte },
      ),
      {
        commandName: "mint-tcnight",
        witnesses: DEPLOYER_ONLY,
        // A mint draft has no inputs before coin selection, so only a burn can run the local test.
        knownUtxos: action.kind === "burn" ? userUtxos : [],
      },
    );

    yield* out.writeJson(
      outputPath,
      transactionFile(
        tx.toCbor(),
        tx.getId(),
        false,
        `${verb} TCNight Transaction`,
      ),
    );
    yield* out.log("\nTransaction details:");
    yield* out.log(`  - Action: ${verb}`);
    yield* out.log(`  - Amount: ${amount} NIGHT`);
    if (request.kind === "mint") {
      yield* out.log(`  - Destination: ${mintTo.toBech32()}`);
    }
    yield* out.log(`\nTransaction written to ${outputPath}`);
    yield* out.log(
      `\nSign and submit with: bun cli sign-and-submit -n ${network} ${outputPath}`,
    );
    return tx;
  });
