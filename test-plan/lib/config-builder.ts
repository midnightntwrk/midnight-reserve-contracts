import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { select } from "@inquirer/prompts";
import type { Blaze } from "@blaze-cardano/sdk";
import type { TransactionUnspentOutput } from "@blaze-cardano/core";
import * as toml from "toml";

interface OneShotConfig {
  name: string;
  tomlKey: string;
  description: string;
}

const ONE_SHOT_CONFIGS: OneShotConfig[] = [
  {
    name: "Reserve",
    tomlKey: "reserve_one_shot",
    description: "One-shot UTxO for Reserve contract deployment",
  },
  {
    name: "Council",
    tomlKey: "council_one_shot",
    description: "One-shot UTxO for Council contract deployment",
  },
  {
    name: "ICS",
    tomlKey: "ics_one_shot",
    description: "One-shot UTxO for ICS contract deployment",
  },
  {
    name: "Technical Authority",
    tomlKey: "technical_authority_one_shot",
    description: "One-shot UTxO for Technical Authority contract deployment",
  },
  {
    name: "Federated Operators",
    tomlKey: "federated_operators_one_shot",
    description: "One-shot UTxO for Federated Operators contract deployment",
  },
  {
    name: "Main Gov",
    tomlKey: "main_gov_one_shot",
    description: "One-shot UTxO for Main Governance contract deployment",
  },
  {
    name: "Staging Gov",
    tomlKey: "staging_gov_one_shot",
    description: "One-shot UTxO for Staging Governance contract deployment",
  },
  {
    name: "Main Council Update",
    tomlKey: "main_council_update_one_shot",
    description: "One-shot UTxO for Main Council Update threshold",
  },
  {
    name: "Main Tech Auth Update",
    tomlKey: "main_tech_auth_update_one_shot",
    description: "One-shot UTxO for Main Tech Auth Update threshold",
  },
  {
    name: "Main Federated Ops Update",
    tomlKey: "main_federated_ops_update_one_shot",
    description: "One-shot UTxO for Main Federated Ops Update threshold",
  },
];

interface SelectedUtxo {
  hash: string;
  index: bigint;
}

export async function configureOneShotUtxos(
  blaze: Blaze,
  network: "preview" | "preprod" | "mainnet",
  testRunId?: string
): Promise<void> {
  const isTestRun = !!testRunId;

  console.log(`\n=== One-Shot UTxO Configuration${isTestRun ? ` (Test Run: ${testRunId})` : ""} ===`);
  console.log("You'll need to select UTxOs from your wallet to use as one-shot references.");
  console.log("These UTxOs will be consumed during contract deployment to mint NFTs.\n");

  // Get wallet address and UTxOs
  const address = await blaze.wallet.getChangeAddress();
  const utxos = await blaze.provider.getUnspentOutputs(address);

  if (utxos.length === 0) {
    throw new Error("No UTxOs found in wallet. Please fund the wallet first.");
  }

  console.log(`Found ${utxos.length} UTxOs in wallet\n`);

  // Collect selections
  const selections = new Map<string, SelectedUtxo>();
  const usedUtxos = new Set<string>();

  for (const config of ONE_SHOT_CONFIGS) {
    console.log(`\nSelecting ${config.name}:`);
    console.log(`  ${config.description}`);

    // Filter out already-used UTxOs
    const availableUtxos = utxos.filter((utxo) => {
      const txId = utxo.input().transactionId();
      const txIdStr = typeof txId === "string" ? txId : txId.toString();
      const index = utxo.input().index();
      const key = `${txIdStr}#${index}`;
      return !usedUtxos.has(key);
    });

    if (availableUtxos.length === 0) {
      throw new Error(
        `No available UTxOs remaining. Need ${ONE_SHOT_CONFIGS.length} UTxOs total.`
      );
    }

    const choices = availableUtxos.map((utxo) => {
      const txId = utxo.input().transactionId();
      const txIdStr = typeof txId === "string" ? txId : txId.toString();
      const index = utxo.input().index();
      const lovelace = utxo.output().amount().coin();

      return {
        name: `${txIdStr.slice(0, 16)}...${txIdStr.slice(-8)}#${index} (${lovelace} lovelace)`,
        value: utxo,
        description: `Full: ${txIdStr}#${index}`,
      };
    });

    const selected = await select({
      message: `Select UTxO for ${config.name}:`,
      choices,
    });

    const txId = selected.input().transactionId();
    const txIdStr = typeof txId === "string" ? txId : txId.toString();
    const index = selected.input().index();

    selections.set(config.tomlKey, {
      hash: txIdStr,
      index: index,
    });

    usedUtxos.add(`${txIdStr}#${index}`);
  }

  // Update aiken.toml
  console.log("\n\nUpdating aiken.toml configuration...");
  await updateAikenConfig(network, selections, testRunId);

  console.log("✓ Configuration updated successfully");
}

async function updateAikenConfig(
  network: string,
  selections: Map<string, SelectedUtxo>,
  testRunId?: string
): Promise<void> {
  const aikenTomlPath = resolve(process.cwd(), "../aiken.toml");
  let tomlContent = readFileSync(aikenTomlPath, "utf-8");

  if (testRunId) {
    // Create a new config section by copying the base network config and updating one-shots
    const configSection = `${network}_test_${testRunId}`;

    // Parse the base network config to copy it
    const parsedToml = toml.parse(tomlContent);
    const baseConfig = parsedToml.config[network];

    if (!baseConfig) {
      throw new Error(`Base config for network '${network}' not found in aiken.toml`);
    }

    // Build the new config section by copying the base and updating one-shots
    let newConfigContent = `\n[config.${configSection}]\n`;

    // Add all indices from base config, updating the one-shot ones
    for (const key in baseConfig) {
      if (key.endsWith('_index')) {
        const baseKey = key.replace('_index', '');
        const selection = selections.get(baseKey);
        if (selection) {
          newConfigContent += `${key} = ${selection.index}\n`;
        } else {
          newConfigContent += `${key} = ${baseConfig[key]}\n`;
        }
      }
    }

    newConfigContent += "\n";

    // Add all hash configurations from base, updating the one-shot ones
    for (const key in baseConfig) {
      if (typeof baseConfig[key] === 'object' && baseConfig[key].bytes) {
        newConfigContent += `[config.${configSection}.${key}]\n`;

        const baseKey = key.replace('_hash', '');
        const selection = selections.get(baseKey);
        if (selection) {
          newConfigContent += `bytes = "${selection.hash}"\n`;
        } else {
          newConfigContent += `bytes = "${baseConfig[key].bytes}"\n`;
        }
        newConfigContent += `encoding = "${baseConfig[key].encoding || 'hex'}"\n\n`;
      }
    }

    // Append the new test run config to the end of the file
    tomlContent += newConfigContent;
  } else {
    // Update existing network section (original behavior for non-test runs)
    for (const [tomlKey, utxo] of selections.entries()) {
      // Update hash
      const hashPattern = new RegExp(
        `\\[config\\.${network}\\.${tomlKey}_hash\\][\\s\\S]*?(?=\\[|$)`,
        "m"
      );

      const hashReplacement = `[config.${network}.${tomlKey}_hash]
bytes = "${utxo.hash}"
encoding = "hex"

`;

      if (tomlContent.match(hashPattern)) {
        tomlContent = tomlContent.replace(hashPattern, hashReplacement);
      } else {
        const sectionPattern = new RegExp(`(\\[config\\.${network}\\][\\s\\S]*?)(?=\\[config\\.|$)`);
        tomlContent = tomlContent.replace(sectionPattern, `$1\n${hashReplacement}`);
      }

      // Update index
      const indexPattern = new RegExp(
        `(${tomlKey}_index\\s*=\\s*)\\d+`,
        "m"
      );

      if (tomlContent.match(indexPattern)) {
        tomlContent = tomlContent.replace(indexPattern, `$1${utxo.index}`);
      } else {
        const sectionPattern = new RegExp(`(\\[config\\.${network}\\])`, "m");
        tomlContent = tomlContent.replace(
          sectionPattern,
          `$1\n${tomlKey}_index = ${utxo.index}`
        );
      }
    }
  }

  writeFileSync(aikenTomlPath, tomlContent, "utf-8");
}

export async function rebuildContracts(network: string, testRunId?: string): Promise<void> {
  const configName = testRunId ? `${network}_test_${testRunId}` : network;

  console.log(`\n\n=== Rebuilding contracts for ${configName} ===`);
  console.log("This may take a minute...\n");

  const { $ } = await import("bun");

  try {
    // Run the build script from the project root
    // The 'just build' command handles both contract building and blueprint generation
    const projectRoot = resolve(process.cwd(), "..");

    // Find just executable - check common locations
    const { existsSync } = await import("fs");
    const justPaths = [
      `${process.env.HOME}/.cargo/bin/just`,
      '/usr/local/bin/just',
      '/usr/bin/just',
    ];

    const justPath = justPaths.find(p => existsSync(p)) || 'just';

    // Run just build which does: build_contracts.sh + bunx @blaze-cardano/blueprint
    await $`${justPath} build ${configName}`.cwd(projectRoot);
    console.log("\n✓ Contracts rebuilt and blueprint regenerated successfully");
  } catch (error) {
    console.error("\n❌ Failed to rebuild contracts");
    console.error(error);
    throw new Error("Contract build failed. Please check the error above.");
  }
}
