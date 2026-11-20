/**
 * change-council, change-tech-auth, change-terms and change-federated-ops
 * on one chain state (helpers/governance-scenario.ts): L2, each plan from
 * its inputs and a frozen context equals the plan the Effect 3 reference
 * makes for the same inputs (tests/golden/governance/, written by the
 * reference); L3, each command builds and signs its transaction over the
 * emulator, sign-and-submit gets it accepted by the ledger, and the
 * forever holds the new datum. The validators refuse a witness over the
 * wrong signers.
 */
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  addressFromValidator,
  Ed25519PublicKey,
  NetworkId,
  SLOT_CONFIG_NETWORK,
  toHex,
  Transaction,
  type TransactionUnspentOutput,
  TxCBOR,
} from "@blaze-cardano/core";
import { Emulator, EmulatorProvider } from "@blaze-cardano/emulator";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import {
  Array as Arr,
  ConfigProvider,
  Effect,
  Layer,
  Option,
  Result,
} from "effect";
import { HttpClient } from "effect/http";
import { Provider } from "../cli/chain";
import { DeployedScripts, DeployerAddress, Profile } from "../cli/config";
import { ContractResolver } from "../cli/contracts/resolver";
import {
  decodeFederatedOps,
  decodeSigners,
  decodeTerms,
  inlineDatum,
} from "../cli/datum";
import {
  federatedOpsChangeProgram,
  type GovernedForever,
  planFederatedOpsChange,
  planTermsChange,
  requireMigratedDatum,
  termsChangeProgram,
} from "../cli/governance/forever";
import {
  authorityThreshold,
  type MultisigFamily,
  multisigChangeProgram,
  planMultisigChange,
  signerRequirements,
  witnessRequirements,
} from "../cli/governance/multisig";
import type { Signer, TxHash, TxIndex } from "../cli/input";
import { Keys } from "../cli/keys";
import type { DatumParseError, TxBuildError } from "../cli/errors";
import { readTransactionFile, signAndSubmitProgram } from "../cli/signing";
import { compile, type PlanningContext } from "../cli/tx";
import {
  type GovernedScripts,
  governanceScenario,
} from "./helpers/governance-scenario";
import { captureOutput } from "./helpers/output";
import { planJson } from "./helpers/wallet-scenario";

const tmp = mkdtempSync(join(tmpdir(), "governance-"));

const nonEmpty = (signers: readonly Signer[]) =>
  signers as Arr.NonEmptyReadonlyArray<Signer>;

/** The emulator's contracts (the default build), the scenario over them, and every service a command needs. */
const setup = Effect.gen(function* () {
  const resolver = Layer.provide(
    Layer.merge(ContractResolver.layer("emulator"), Profile.layer("emulator")),
    Layer.merge(NodeServices.layer, DeployedScripts.layer),
  );
  const i = yield* Effect.provide(
    Effect.gen(function* () {
      return yield* (yield* ContractResolver).contracts("actsOn").instances;
    }),
    resolver,
  );
  const scripts: GovernedScripts = {
    govAuth: i.govAuth.Script,
    councilForever: i.councilForever.Script,
    councilTwoStage: i.councilTwoStage.Script,
    councilLogic: i.councilLogic.Script,
    councilThreshold: i.mainCouncilUpdateThreshold.Script,
    techAuthForever: i.techAuthForever.Script,
    techAuthTwoStage: i.techAuthTwoStage.Script,
    techAuthLogic: i.techAuthLogic.Script,
    techAuthThreshold: i.mainTechAuthUpdateThreshold.Script,
    termsForever: i.termsAndConditionsForever.Script,
    termsTwoStage: i.termsAndConditionsTwoStage.Script,
    termsLogic: i.termsAndConditionsLogic.Script,
    termsThreshold: i.termsAndConditionsThreshold.Script,
    federatedOpsForever: i.federatedOpsForever.Script,
    federatedOpsTwoStage: i.federatedOpsTwoStage.Script,
    federatedOpsLogic: i.federatedOpsLogic.Script,
    federatedOpsThreshold: i.mainFederatedOpsUpdateThreshold.Script,
  };
  const scenario = governanceScenario(scripts);
  const emulator = new Emulator([]);
  for (const utxo of Object.values(scenario.utxos)) emulator.addUtxo(utxo);
  for (const account of scenario.logicAccounts) {
    emulator.accounts.set(account, { balance: 0n });
  }
  const output = captureOutput();
  const layer = Layer.mergeAll(
    Layer.provide(
      Provider.over(new EmulatorProvider(emulator)),
      Layer.succeed(HttpClient.HttpClient)(
        HttpClient.make(() => Effect.die("no HTTP in this test")),
      ),
    ),
    resolver,
    DeployerAddress.layer("emulator"),
    Keys.layer,
    ConfigProvider.layer(ConfigProvider.fromUnknown(scenario.env)),
    NodeServices.layer,
    DeployedScripts.layer,
    output.layer,
  );
  return { scenario, scripts, emulator, layer, output };
});

type Base = Effect.Success<typeof setup>;

/** A frozen context over the scenario: nothing in it reads the chain. */
const frozen = <Resolved>(
  base: Base,
  command: string,
  resolved: Resolved,
): PlanningContext<Resolved> => ({
  command,
  networkId: NetworkId.Testnet,
  slotConfig: SLOT_CONFIG_NETWORK.Preview,
  parameters: base.emulator.params,
  wallet: {
    address: base.scenario.deployer,
    utxos: [base.scenario.utxos.deployerFunds],
  },
  reserved: new Set(),
  contracts: [],
  resolved,
});

const THRESHOLD = Result.getOrThrow(authorityThreshold([2n, 3n, 2n, 3n]));

/** What a multisig change of the family is built from on the scenario; `secondary` replaces the secondary witness signers. */
const multisigChange = (
  base: Base,
  family: MultisigFamily,
  secondary?: readonly Signer[],
) => {
  const { scenario, scripts } = base;
  const u = scenario.utxos;
  const council = family === "council";
  const primarySigners = nonEmpty(
    council ? scenario.council : scenario.techAuth,
  );
  const secondarySigners = nonEmpty(
    secondary ?? (council ? scenario.techAuth : scenario.council),
  );
  return {
    primaryForever: council ? scripts.councilForever : scripts.techAuthForever,
    primaryForeverUtxo: council ? u.councilForever : u.techAuthForever,
    primaryThresholdUtxo: council ? u.councilThreshold : u.techAuthThreshold,
    secondaryForeverUtxo: council ? u.techAuthForever : u.councilForever,
    primaryTwoStageUtxo: council ? u.councilMain : u.techAuthMain,
    feeUtxo: u.fee,
    logicScript: council ? scripts.councilLogic : scripts.techAuthLogic,
    mitigationLogicScript: Option.none(),
    logicRound: 0,
    currentPrimarySigners: primarySigners,
    secondarySigners,
    requirements: signerRequirements(
      THRESHOLD,
      primarySigners,
      secondarySigners,
      family,
    ),
    newSigners: nonEmpty(council ? scenario.newCouncil : scenario.newTechAuth),
    feePadding: 50_000n,
    expectedWitnesses: 7,
  };
};

/** What a governed forever update is built from on the scenario; `council` replaces the council witness signers. */
const governed = (
  base: Base,
  contract: "terms" | "federatedOps",
  council?: readonly Signer[],
): GovernedForever => {
  const { scenario, scripts } = base;
  const u = scenario.utxos;
  const terms = contract === "terms";
  const councilSigners = nonEmpty(council ?? scenario.council);
  const techAuthSigners = nonEmpty(scenario.techAuth);
  return {
    forever: terms ? scripts.termsForever : scripts.federatedOpsForever,
    foreverUtxo: terms ? u.termsForever : u.federatedOpsForever,
    thresholdUtxo: terms ? u.termsThreshold : u.federatedOpsThreshold,
    councilForeverUtxo: u.councilForever,
    techAuthForeverUtxo: u.techAuthForever,
    twoStageUtxo: terms ? u.termsMain : u.federatedOpsMain,
    feeUtxo: u.fee,
    logicScript: terms ? scripts.termsLogic : scripts.federatedOpsLogic,
    mitigationLogicScript: Option.none(),
    logicRound: 0,
    councilSigners,
    techAuthSigners,
    requirements: witnessRequirements(THRESHOLD, {
      councilSigners,
      techAuthSigners,
    }),
    feePadding: 50_000n,
    expectedWitnesses: 7,
  };
};

const termsOf = (base: Base) => ({
  hash: base.scenario.terms.hash,
  link: toHex(new TextEncoder().encode(base.scenario.terms.url)),
});

const federatedOpsChange = (base: Base, council?: readonly Signer[]) =>
  Effect.map(
    inlineDatum(base.scenario.utxos.federatedOpsForever, "FederatedOps"),
    (datum) => ({
      ...governed(base, "federatedOps", council),
      currentData: Result.getOrThrow(decodeFederatedOps(datum)),
      newCandidates: base.scenario.newCandidates,
    }),
  );

const golden = (name: string) =>
  readFileSync(`tests/golden/governance/${name}-plan.json`, "utf-8").trimEnd();

describe("plans equal the reference's for the same inputs (L2)", () => {
  it.live.each([
    ["council", "change-council"],
    ["tech-auth", "change-tech-auth"],
  ] as const)("%s", ([family, command]) =>
    Effect.gen(function* () {
      const base = yield* setup;
      const plan = Result.getOrThrow(
        planMultisigChange(frozen(base, command, multisigChange(base, family))),
      );
      expect(planJson(plan)).toBe(golden(family));
      expect(plan).toMatchObject({ feePadding: 50_000n, expectedWitnesses: 7 });
      expect(Option.getOrUndefined(plan.metadata)).toBe(command);
    }),
  );

  it.live("terms", () =>
    Effect.gen(function* () {
      const base = yield* setup;
      const plan = planTermsChange(
        frozen(base, "change-terms", {
          ...governed(base, "terms"),
          terms: termsOf(base),
        }),
      );
      expect(planJson(plan)).toBe(golden("terms"));
      expect(Option.getOrUndefined(plan.metadata)).toBe("change-terms");
    }),
  );

  it.live("federated ops", () =>
    Effect.gen(function* () {
      const base = yield* setup;
      const plan = planFederatedOpsChange(
        frozen(base, "change-federated-ops", yield* federatedOpsChange(base)),
      );
      expect(planJson(plan)).toBe(golden("federated-ops"));
    }),
  );

  it.live("more than 255 new signers cannot be encoded", () =>
    Effect.gen(function* () {
      const base = yield* setup;
      const [first] = base.scenario.council;
      const change = {
        ...multisigChange(base, "council"),
        newSigners: nonEmpty(Array.from({ length: 256 }, () => first)),
      };
      expect(
        planMultisigChange(frozen(base, "change-council", change)),
      ).toMatchObject(
        Result.fail({
          _tag: "InputParseError",
          source: "signers",
          issues: ["too many signers for simple CBOR encoding"],
        }),
      );
    }),
  );

  it("a v1 datum under the active v2 logic is DatumNotMigrated; a migrated one passes", () => {
    expect(requireMigratedDatum(1, 2)).toMatchObject(
      Result.fail({
        _tag: "PreconditionFailed",
        command: "change-federated-ops",
        refusal: { _tag: "DatumNotMigrated", datumRound: 1, logicRound: 2 },
      }),
    );
    expect(Result.isSuccess(requireMigratedDatum(2, 2))).toBe(true);
  });
});

describe("the validators refuse a witness over the wrong signers", () => {
  /** The compile of a plan whose witness signers are two of three, under the scenario's 2/3 threshold. */
  const refused = (
    plan: (
      base: Base,
      twoOfThree: readonly Signer[],
    ) => Effect.Effect<Transaction, TxBuildError | DatumParseError>,
  ) =>
    Effect.gen(function* () {
      const base = yield* setup;
      const error = yield* Effect.flip(
        plan(base, base.scenario.council.slice(0, 2)),
      );
      expect(error).toMatchObject({
        _tag: "TxBuildError",
        traces: expect.arrayContaining([
          expect.stringMatching(/Withdraw\[0\][\s\S]*Validator returned false/),
        ]),
      });
    });

  it.live("change-tech-auth with a council witness over two of three", () =>
    refused((base, twoOfThree) => {
      const ctx = frozen(
        base,
        "change-tech-auth",
        multisigChange(base, "tech-auth", twoOfThree),
      );
      return compile(Result.getOrThrow(planMultisigChange(ctx)), ctx);
    }),
  );

  it.live("change-federated-ops with a council witness over two of three", () =>
    refused((base, twoOfThree) =>
      Effect.flatMap(federatedOpsChange(base, twoOfThree), (change) => {
        const ctx = frozen(base, "change-federated-ops", change);
        return compile(planFederatedOpsChange(ctx), ctx);
      }),
    ),
  );
});

describe("each command's transaction is accepted by the emulator ledger (L3)", () => {
  /** The flags of a command whose file is left unsigned: the Blaze emulator does not run native scripts, so it refuses the authorities' signatures as extraneous; the real ledger takes them. */
  const input = (outputFile: string, sign = false) => ({
    network: "emulator" as const,
    outputDir: tmp,
    outputFile,
    txHash: "f0".repeat(32) as TxHash,
    txIndex: 0 as TxIndex,
    feePadding: 50_000n,
    sign,
  });

  /** Run the command, then sign-and-submit its file with the deployer key; the transaction, the output and the forever UTxO afterwards. */
  const accepted = (
    file: string,
    command: (base: Base) => Effect.Effect<Transaction, unknown, never>,
    forever: (base: Base) => string,
  ) =>
    Effect.gen(function* () {
      const base = yield* setup;
      const tx = yield* command(base);
      yield* Effect.provide(
        signAndSubmitProgram({
          signingKey: "SIGNING_PRIVATE_KEY",
          signDeployer: true,
          jsonFile: join(tmp, "emulator", file),
        }),
        base.layer,
      );
      const after = base.emulator
        .utxos()
        .find(
          (utxo: TransactionUnspentOutput) =>
            utxo.output().address().toBech32() === forever(base),
        );
      return { tx, lines: base.output.lines, base, after: after! };
    });

  const addressOf = (base: Base, script: keyof GovernedScripts) =>
    addressFromValidator(NetworkId.Testnet, base.scripts[script]).toBech32();

  it.live("change-council installs four signers, one payment hash twice", () =>
    Effect.gen(function* () {
      const { tx, lines, base, after } = yield* accepted(
        "change-council-tx.json",
        (b) =>
          Effect.provide(
            multisigChangeProgram("council", input("change-council-tx.json")),
            b.layer,
          ),
        (b) => addressOf(b, "councilForever"),
      );
      expect(lines).toContain(
        `Confirmed: Change Council Transaction - ${tx.getId()}`,
      );
      expect(
        yield* decodeSigners(yield* inlineDatum(after, "VersionedMultisig")),
      ).toEqual(base.scenario.newCouncil);
    }),
  );

  it.live("change-tech-auth adds a member", () =>
    Effect.gen(function* () {
      const { tx, lines, base, after } = yield* accepted(
        "change-tech-auth-tx.json",
        (b) =>
          Effect.provide(
            multisigChangeProgram(
              "tech-auth",
              input("change-tech-auth-tx.json"),
            ),
            b.layer,
          ),
        (b) => addressOf(b, "techAuthForever"),
      );
      expect(lines).toContain(
        `Confirmed: Change Technical Authority Transaction - ${tx.getId()}`,
      );
      expect(
        yield* decodeSigners(yield* inlineDatum(after, "VersionedMultisig")),
      ).toEqual(base.scenario.newTechAuth);
    }),
  );

  it.live("change-terms replaces the hash and the link", () =>
    Effect.gen(function* () {
      const { tx, lines, base, after } = yield* accepted(
        "change-terms-tx.json",
        (b) =>
          Effect.provide(
            termsChangeProgram({
              ...input("change-terms-tx.json"),
              hash: b.scenario.terms.hash as never,
              url: b.scenario.terms.url,
            }),
            b.layer,
          ),
        (b) => addressOf(b, "termsForever"),
      );
      expect(lines).toContain(
        `Confirmed: Change Terms and Conditions Transaction - ${tx.getId()}`,
      );
      expect(
        yield* decodeTerms(
          yield* inlineDatum(after, "VersionedTermsAndConditions"),
        ),
      ).toEqual(termsOf(base));
    }),
  );

  it.live(
    "change-federated-ops installs the new candidates in the v1 datum",
    () =>
      Effect.gen(function* () {
        const { tx, lines, base, after } = yield* accepted(
          "change-federated-ops-tx.json",
          (b) =>
            Effect.provide(
              federatedOpsChangeProgram(input("change-federated-ops-tx.json")),
              b.layer,
            ),
          (b) => addressOf(b, "federatedOpsForever"),
        );
        expect(lines).toContain(
          `Confirmed: Change Federated Ops Transaction - ${tx.getId()}`,
        );
        const datum = Result.getOrThrow(
          decodeFederatedOps(yield* inlineDatum(after, "FederatedOps")),
        );
        expect(datum.message).toBeUndefined();
        expect(datum.candidates).toEqual(base.scenario.newCandidates);
      }),
  );

  it.live(
    "a signed file carries one witness from each authority key, over the same transaction",
    () =>
      Effect.gen(function* () {
        const base = yield* setup;
        const tx = yield* Effect.provide(
          multisigChangeProgram(
            "council",
            input("signed-council-tx.json", true),
          ),
          base.layer,
        );
        const [file] = yield* Effect.provide(
          readTransactionFile(join(tmp, "emulator", "signed-council-tx.json")),
          NodeServices.layer,
        );
        const signed = Transaction.fromCbor(TxCBOR(file.cborHex));
        expect(file.signed).toBe(true);
        expect(signed.getId()).toBe(tx.getId());
        expect(
          new Set(
            (signed.witnessSet().vkeys()?.values() ?? []).map((witness) =>
              Ed25519PublicKey.fromHex(witness.vkey()).hash().hex(),
            ),
          ),
        ).toEqual(
          new Set(
            [...base.scenario.council, ...base.scenario.techAuth].map(
              (member) => member.paymentHash,
            ),
          ),
        );
      }),
  );
});
