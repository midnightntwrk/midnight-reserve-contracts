import type { Argv, CommandModule } from "yargs";
import { readFileSync } from "fs";
import {
  Address,
  AssetId,
  CredentialType,
  HexBlob,
  NativeScript,
  PlutusData,
  Transaction,
  TxCBOR,
} from "@blaze-cardano/core";
import type { GlobalOptions } from "../../lib/global-options";
import { enumerateContracts } from "../../lib/blueprint-diff";
import { loadContractModule } from "../../lib/contracts";
import { getAikenConfigSection } from "../../lib/network-mapping";
import {
  isSingleTransaction,
  isDeploymentTransactions,
} from "../../lib/transaction-json";
import { extractLogicRound, getDatumHandler } from "../../lib/datum-versions";
import type { DatumFamily } from "../../lib/datum-versions";
import { parseUpgradeState } from "../../lib/governance-provider";
import { formatLovelaceToAda } from "../../lib/output";

interface DescribeTxOptions extends GlobalOptions {
  file: string;
  "use-build": boolean;
}

export const command = "describe-tx";
export const describe =
  "Decode a transaction JSON and print an annotated summary of what is being signed";

export function builder(yargs: Argv<GlobalOptions>) {
  return yargs
    .option("file", {
      alias: "f",
      type: "string",
      demandOption: true,
      description:
        "Path to a transaction JSON file (single-tx or deployment-transactions format)",
    })
    .option("use-build", {
      type: "boolean",
      default: false,
      description:
        "Resolve script hashes against the build blueprint instead of deployed-scripts",
    })
    .epilogue(
      "Uses the CLI's own datum schemas and blueprint to annotate inputs, outputs, datums, metadata,\n" +
        "mint, required signers, and native multisig witness scripts. Does not submit or sign anything.",
    );
}

// --- Blueprint lookup ---

interface ScriptIndex {
  byHash: Map<string, string>; // hash -> className
}

function buildScriptIndex(network: string, useBuild: boolean): ScriptIndex {
  const env = getAikenConfigSection(network);
  // If deployed mode is requested for an env with no deployed blueprint,
  // fall back to build silently rather than crashing describe-tx.
  let module: Record<string, unknown>;
  try {
    module = loadContractModule(env, useBuild);
  } catch {
    module = loadContractModule(env, true);
  }
  const byHash = new Map<string, string>();
  for (const c of enumerateContracts(module)) {
    byHash.set(c.hash, c.className);
  }
  return { byHash };
}

// Human-friendly short name from blueprint class name
function friendlyName(className: string): string {
  // Convert CamelCase to "camel case" words, drop common suffix "Else"
  const stripped = className.replace(/Else$/, "");
  return stripped.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function resolveHash(
  index: ScriptIndex,
  hash: string | undefined,
): string | undefined {
  if (!hash) return undefined;
  const className = index.byHash.get(hash);
  if (!className) return undefined;
  return `${friendlyName(className)} [${className}]`;
}

// --- Datum family inference ---

/**
 * Look at which validator a script hash belongs to and infer its datum family.
 * Returns undefined if the hash is not a known forever-contract hash.
 */
function inferDatumFamily(
  className: string | undefined,
): DatumFamily | undefined {
  if (!className) return undefined;
  // Forever contract class names (per contracts.ts createInstances)
  if (className === "PermissionedCouncilForeverElse") return "council";
  if (className === "PermissionedTechAuthForeverElse") return "tech-auth";
  if (className === "PermissionedFederatedOpsForeverElse")
    return "federated-ops";
  if (className === "TermsAndConditionsTermsAndConditionsForeverElse")
    return "terms-and-conditions";
  return undefined;
}

/**
 * Check whether a class name is a two-stage upgrade validator.
 */
function isTwoStage(className: string | undefined): boolean {
  if (!className) return false;
  return /TwoStageUpgradeElse$/.test(className);
}

// --- Formatting helpers ---

function assetNameUtf8(hex: string): string {
  try {
    const s = Buffer.from(hex, "hex").toString("utf8");
    // Reject if not printable
    if (/^[\x20-\x7e]*$/.test(s)) return s;
  } catch {
    // fall through
  }
  return "";
}

function indent(s: string, pad = "  "): string {
  return s
    .split("\n")
    .map((line) => (line.length > 0 ? pad + line : line))
    .join("\n");
}

// --- CIP-20 metadata (label 674) extraction ---

function extractOperationLabel(tx: Transaction): string | undefined {
  const aux = tx.auxiliaryData();
  if (!aux) return undefined;
  // Use toCore() on the whole aux data — metadata becomes Map<bigint, Metadatum>
  // where Metadatum = bigint | Map<Metadatum,Metadatum> | string | Uint8Array | Metadatum[]
  const blob = aux.toCore().blob;
  if (!blob) return undefined;
  const label674 = blob.get(674n);
  if (!label674 || !(label674 instanceof Map)) return undefined;
  // Shape: { msg: [ "midnight-reserve:<op>", ... ] }
  for (const [k, v] of label674) {
    if (typeof k === "string" && k === "msg" && Array.isArray(v)) {
      const first = v[0];
      if (typeof first === "string") return first;
    }
  }
  return undefined;
}

// --- Datum decoding ---

function describeInlineDatum(
  datumCbor: string,
  className: string | undefined,
): string {
  // Try two-stage UpgradeState first
  if (isTwoStage(className)) {
    const us = parseUpgradeState(datumCbor);
    if (us) {
      return [
        `UpgradeState (two-stage):`,
        `  logicHash:           ${us.logicHash}`,
        `  mitigationLogicHash: ${us.mitigationLogicHash}`,
        `  authHash:            ${us.authHash}`,
        `  logicRound:          ${us.logicRound}`,
      ].join("\n");
    }
    return `UpgradeState: <could not parse> ${datumCbor.slice(0, 80)}...`;
  }

  // Try forever-contract datum via datum-versions registry
  const family = inferDatumFamily(className);
  if (!family) {
    return `Inline datum (raw CBOR, ${datumCbor.length / 2} bytes): ${datumCbor.slice(0, 80)}${datumCbor.length > 80 ? "..." : ""}`;
  }

  try {
    const pd = PlutusData.fromCbor(HexBlob(datumCbor));
    const round = extractLogicRound(pd);
    const handler = getDatumHandler(family, round);
    const decoded = handler.decode(pd) as unknown;

    if (family === "council" || family === "tech-auth") {
      const d = decoded as {
        totalSigners: bigint;
        signers: { paymentHash: string }[];
      };
      const lines = [
        `${family} Multisig (logic_round ${round}):`,
        `  totalSigners: ${d.totalSigners}`,
        `  signers (${d.signers.length}):`,
      ];
      for (const s of d.signers)
        lines.push(`    - paymentHash=${s.paymentHash}`);
      return lines.join("\n");
    }

    if (family === "federated-ops") {
      const d = decoded as {
        message?: string;
        candidates: {
          sidechain_pub_key: string;
          aura_pub_key: string;
          grandpa_pub_key: string;
          beefy_pub_key: string;
        }[];
      };
      const lines = [
        `federated-ops (logic_round ${round}):`,
        ...(d.message !== undefined
          ? [`  message (hex): ${d.message || "(empty)"}`]
          : []),
        `  candidates (${d.candidates.length}):`,
      ];
      for (const c of d.candidates) {
        lines.push(
          `    - sidechain=${c.sidechain_pub_key}`,
          `      aura=${c.aura_pub_key}`,
          `      grandpa=${c.grandpa_pub_key}`,
          `      beefy=${c.beefy_pub_key}`,
        );
      }
      return lines.join("\n");
    }

    if (family === "terms-and-conditions") {
      const d = decoded as { hash: string; link: string };
      const linkUtf8 = assetNameUtf8(d.link);
      return [
        `terms-and-conditions (logic_round ${round}):`,
        `  hash: ${d.hash}`,
        `  link: ${d.link}${linkUtf8 ? ` (utf8: "${linkUtf8}")` : ""}`,
      ].join("\n");
    }

    return `Decoded ${family} datum (round ${round}): ${JSON.stringify(decoded)}`;
  } catch (e) {
    return `Inline datum for ${family}: <decode failed: ${e instanceof Error ? e.message : e}>
Raw CBOR: ${datumCbor.slice(0, 80)}...`;
  }
}

// --- Native script decoding (multisig witness) ---

function describeNativeScript(ns: NativeScript): string {
  // Use toCore() for recursive structure
  const core = ns.toCore();
  return formatCoreNativeScript(core);
}

type CoreNativeScript =
  | { kind: 0; keyHash: string }
  | { kind: 1; scripts: CoreNativeScript[] }
  | { kind: 2; scripts: CoreNativeScript[] }
  | { kind: 3; required: number; scripts: CoreNativeScript[] }
  | { kind: 4; slot: bigint | number }
  | { kind: 5; slot: bigint | number };

function formatCoreNativeScript(script: unknown, depth = 0): string {
  const s = script as CoreNativeScript;
  const pad = "  ".repeat(depth);
  switch (s.kind) {
    case 0:
      return `${pad}RequireSignature: ${s.keyHash}`;
    case 1:
      return [
        `${pad}RequireAllOf (${s.scripts.length}):`,
        ...s.scripts.map((sub) => formatCoreNativeScript(sub, depth + 1)),
      ].join("\n");
    case 2:
      return [
        `${pad}RequireAnyOf (${s.scripts.length}):`,
        ...s.scripts.map((sub) => formatCoreNativeScript(sub, depth + 1)),
      ].join("\n");
    case 3:
      return [
        `${pad}RequireAtLeast ${s.required} of ${s.scripts.length}:`,
        ...s.scripts.map((sub) => formatCoreNativeScript(sub, depth + 1)),
      ].join("\n");
    case 4:
      return `${pad}RequireTimeAfter: slot ${s.slot}`;
    case 5:
      return `${pad}RequireTimeBefore: slot ${s.slot}`;
    default:
      return `${pad}UnknownNativeScript`;
  }
}

// --- Main describe ---

function describeTransaction(
  txName: string,
  cborHex: string,
  index: ScriptIndex,
): string {
  const tx = Transaction.fromCbor(TxCBOR(HexBlob(cborHex)));
  const body = tx.body();
  const lines: string[] = [];

  lines.push("=".repeat(70));
  lines.push(`TRANSACTION: ${txName}`);
  lines.push("=".repeat(70));

  // Header
  lines.push(`Body hash (what gets signed): ${tx.getId()}`);
  lines.push(`CBOR size:                   ${cborHex.length / 2} bytes`);
  const netId = body.networkId();
  if (netId !== undefined) lines.push(`Network id:                  ${netId}`);
  lines.push(
    `Fee:                         ${formatLovelaceToAda(body.fee())} ADA (${body.fee()} lovelace)`,
  );

  // Operation label
  const op = extractOperationLabel(tx);
  lines.push("");
  lines.push("--- Operation (CIP-20 label 674) ---");
  lines.push(op ? op : "(none)");

  // Inputs
  lines.push("");
  const inputs = Array.from(body.inputs().values());
  lines.push(`--- Inputs (${inputs.length}) ---`);
  for (const inp of inputs) {
    const c = inp.toCore();
    lines.push(`  ${c.txId}#${c.index}`);
  }

  // Reference inputs
  const refInputsSet = body.referenceInputs();
  if (refInputsSet) {
    const refs = Array.from(refInputsSet.values());
    lines.push("");
    lines.push(`--- Reference inputs (${refs.length}) ---`);
    for (const r of refs) {
      const c = r.toCore();
      lines.push(`  ${c.txId}#${c.index}`);
    }
  }

  // Required signers
  const reqSignersSet = body.requiredSigners();
  if (reqSignersSet) {
    const reqs = Array.from(reqSignersSet.values());
    lines.push("");
    lines.push(`--- Required signers (${reqs.length}) ---`);
    for (const r of reqs) lines.push(`  ${r}`);
  }

  // Outputs
  const outputs = body.outputs();
  lines.push("");
  lines.push(`--- Outputs (${outputs.length}) ---`);
  outputs.forEach((out, i) => {
    const addr = out.address();
    const bech32 = addr.toBech32();
    const props = Address.fromBech32(bech32).getProps();
    const payment = props.paymentPart;
    const paymentLine =
      payment?.type === CredentialType.ScriptHash
        ? `  Payment script hash: ${payment.hash}` +
          (resolveHash(index, payment.hash)
            ? `  [${resolveHash(index, payment.hash)}]`
            : "")
        : payment?.type === CredentialType.KeyHash
          ? `  Payment key hash:    ${payment.hash}`
          : "";

    const delegation = props.delegationPart;
    const delegationLine =
      delegation?.type === CredentialType.ScriptHash
        ? `  Stake script hash:   ${delegation.hash}` +
          (resolveHash(index, delegation.hash)
            ? `  [${resolveHash(index, delegation.hash)}]`
            : "")
        : delegation?.type === CredentialType.KeyHash
          ? `  Stake key hash:      ${delegation.hash}`
          : "";

    lines.push(`Output ${i}:`);
    lines.push(`  Address: ${bech32}`);
    if (paymentLine) lines.push(paymentLine);
    if (delegationLine) lines.push(delegationLine);

    // Value
    const value = out.amount().toCore();
    lines.push(`  Value:`);
    lines.push(
      `    lovelace: ${formatLovelaceToAda(value.coins)} ADA (${value.coins})`,
    );
    const tokens = value.assets;
    if (tokens) {
      for (const [assetId, qty] of tokens) {
        const policy = AssetId.getPolicyId(assetId);
        const name = AssetId.getAssetName(assetId);
        const utf8 = assetNameUtf8(name);
        const policyAnnot = resolveHash(index, policy);
        lines.push(
          `    ${policy}${name ? "." + name : ""}${utf8 ? ` (utf8: "${utf8}")` : ""}: ${qty}` +
            (policyAnnot ? `  [policy: ${policyAnnot}]` : ""),
        );
      }
    }

    // Datum
    const datum = out.datum();
    if (datum) {
      const dataHash = datum.asDataHash();
      const inlineData = datum.asInlineData();
      if (dataHash) {
        lines.push(`  Datum hash: ${dataHash}`);
      } else if (inlineData) {
        const datumCbor = inlineData.toCbor();
        const ownHash =
          payment?.type === CredentialType.ScriptHash
            ? payment.hash
            : undefined;
        const ownClass = ownHash ? index.byHash.get(ownHash) : undefined;
        lines.push(`  Inline datum (${datumCbor.length / 2} bytes):`);
        lines.push(indent(describeInlineDatum(datumCbor, ownClass), "    "));
      }
    }

    // Script reference
    const scriptRef = out.scriptRef();
    if (scriptRef) {
      const h = scriptRef.hash();
      const label = resolveHash(index, h);
      lines.push(`  Script reference: ${h}${label ? `  [${label}]` : ""}`);
    }
  });

  // Mint
  const mint = body.mint();
  if (mint && mint.size > 0) {
    lines.push("");
    lines.push(`--- Mint ---`);
    for (const [assetId, qty] of mint) {
      const policy = AssetId.getPolicyId(assetId);
      const name = AssetId.getAssetName(assetId);
      const utf8 = assetNameUtf8(name);
      const policyAnnot = resolveHash(index, policy);
      lines.push(
        `  ${policy}${name ? "." + name : ""}${utf8 ? ` (utf8: "${utf8}")` : ""}: ${qty > 0n ? "+" : ""}${qty}` +
          (policyAnnot ? `  [policy: ${policyAnnot}]` : ""),
      );
    }
  }

  // Certs
  const certsSet = body.certs();
  if (certsSet) {
    const certs = Array.from(certsSet.values());
    if (certs.length > 0) {
      lines.push("");
      lines.push(`--- Certificates (${certs.length}) ---`);
      for (const c of certs)
        lines.push(
          `  ${JSON.stringify(c.toCore(), (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`,
        );
    }
  }

  // Withdrawals
  const withdrawals = body.withdrawals();
  if (withdrawals && withdrawals.size > 0) {
    lines.push("");
    lines.push(`--- Withdrawals (${withdrawals.size}) ---`);
    for (const [rewardAccount, coin] of withdrawals) {
      lines.push(
        `  ${rewardAccount}: ${formatLovelaceToAda(coin)} ADA (${coin})`,
      );
    }
  }

  // Validity
  const ttl = body.ttl();
  const validityStart = body.validityStartInterval();
  if (ttl !== undefined || validityStart !== undefined) {
    lines.push("");
    lines.push(`--- Validity ---`);
    if (validityStart !== undefined)
      lines.push(`  Start slot: ${validityStart}`);
    if (ttl !== undefined) lines.push(`  TTL (end slot): ${ttl}`);
  }

  // Witness scripts (native multisig)
  const ws = tx.witnessSet();
  const natSet = ws.nativeScripts();
  if (natSet) {
    const natScripts = Array.from(natSet.values());
    if (natScripts.length > 0) {
      lines.push("");
      lines.push(`--- Witness scripts (native, ${natScripts.length}) ---`);
      for (const ns of natScripts) {
        lines.push(`  Hash: ${ns.hash()}`);
        lines.push(indent(describeNativeScript(ns), "    "));
      }
    }
  }

  // Signatures
  const vkeys = ws.vkeys();
  if (vkeys) {
    const vs = Array.from(vkeys.values());
    lines.push("");
    lines.push(`--- Signatures attached: ${vs.length} ---`);
    for (const v of vs) lines.push(`  vkey=${v.vkey()}`);
  }

  // Plutus redeemers
  const redeemers = ws.redeemers();
  if (redeemers) {
    const rs = redeemers.values();
    if (rs.length > 0) {
      lines.push("");
      lines.push(`--- Plutus redeemers (${rs.length}) ---`);
      for (const r of rs) {
        const c = r.toCore();
        lines.push(
          `  ${c.purpose} index=${c.index} exUnits={mem:${c.executionUnits.memory},cpu:${c.executionUnits.steps}}`,
        );
      }
    }
  }

  return lines.join("\n");
}

// --- Handler ---

export async function handler(argv: DescribeTxOptions) {
  const { file, network, "use-build": useBuild } = argv;

  const content = readFileSync(file, "utf-8");
  const parsed = JSON.parse(content);

  const index = buildScriptIndex(network, useBuild);

  if (isDeploymentTransactions(parsed)) {
    console.log(
      `Deployment transactions file: ${parsed.transactions.length} transaction(s)\n`,
    );
    for (const tx of parsed.transactions) {
      console.log(describeTransaction(tx.description, tx.cborHex, index));
      console.log("");
    }
    return;
  }

  if (isSingleTransaction(parsed)) {
    console.log(
      describeTransaction(parsed.description || file, parsed.cborHex, index),
    );
    return;
  }

  throw new Error(
    `Unrecognized JSON format in ${file}. Expected a single-tx TextEnvelope or a deployment-transactions.json file.`,
  );
}

const commandModule: CommandModule<GlobalOptions, DescribeTxOptions> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;
