#!/usr/bin/env bun

import { resolve } from "path";
import type {
  DeployOptions,
  ChangeAuthOptions,
  SimpleTxOptions,
  InfoOptions,
  StageUpgradeOptions,
  PromoteUpgradeOptions,
  RegisterGovAuthOptions,
} from "./lib/types";
import { getDefaultProvider } from "./lib/types";
import {
  validateNetwork,
  validateProvider,
  validateTxHash,
  validateTxIndex,
  validateComponents,
  validateTwoStageValidator,
  validateScriptHash,
  parseThreshold,
  parseAmount,
  VALID_NETWORKS,
  VALID_PROVIDERS,
  VALID_COMPONENTS,
  VALID_TWO_STAGE_VALIDATORS,
} from "./utils/validation";
import { printError } from "./utils/output";
import {
  deploy,
  changeCouncil,
  changeTechAuth,
  simpleTx,
  info,
  stageUpgrade,
  promoteUpgrade,
  registerGovAuth,
} from "./commands";

function printUsage(): void {
  console.log(`
Midnight Reserve Contracts CLI

Usage: bun cli <command> [options]

Commands:
  deploy              Generate deployment transactions
  change-council      Update council multisig members
  change-tech-auth    Update tech auth multisig members
  stage-upgrade       Stage a new logic hash for a two-stage upgrade validator
  promote-upgrade     Promote staged logic to main for a two-stage upgrade validator
  register-gov-auth   Register main and staging gov auth scripts as stake credentials
  simple-tx           Create simple transactions for testing
  info                Display contract information

Global Options:
  -n, --network       Network: ${VALID_NETWORKS.join(", ")} (default: local)
  -o, --output        Output directory (default: ./deployments/{network})
  -p, --provider      Provider: ${VALID_PROVIDERS.join(", ")} (default: emulator for local, blockfrost otherwise)
  --dry-run           Build transaction without signing

Deploy Options:
  --utxo-amount       Lovelace for input UTxO (default: 100000000)
  --output-amount     Lovelace for contract outputs (default: 1000000)
  --threshold-output-amount  Lovelace for threshold outputs (default: 2000000)
  --tech-auth-threshold      Tech auth threshold e.g. "2/3" (default: 2/3)
  --council-threshold        Council threshold e.g. "2/3" (default: 2/3)
  --council-staging-threshold      Council staging threshold e.g. "0/1" (default: 0/1)
  --tech-auth-staging-threshold    Tech auth staging threshold e.g. "1/2" (default: 1/2)
  --components               Components to deploy (comma-separated, default: all)
                             Options: ${VALID_COMPONENTS.join(", ")}

Change Auth Options:
  <tx_hash>           Transaction hash of input UTxO
  <tx_index>          Output index of input UTxO
  --utxo-amount       Override input UTxO amount
  --sign              Sign transaction (default: true)
  --no-sign           Do not sign transaction
  --output-file       Output file name (default: cli-tx-signed.cbor)

Stage Upgrade Options:
  --validator         Two-stage validator name (required)
                      Options: ${VALID_TWO_STAGE_VALIDATORS.join(", ")}
  --new-logic-hash    New logic script hash to stage (required, 56 hex chars)
  <tx_hash>           Transaction hash of input UTxO
  <tx_index>          Output index of input UTxO
  --sign              Sign transaction (default: true)
  --no-sign           Do not sign transaction
  --output-file       Output file name (default: stage-upgrade-tx.cbor)

Promote Upgrade Options:
  --validator         Two-stage validator name (required)
                      Options: ${VALID_TWO_STAGE_VALIDATORS.join(", ")}
  <tx_hash>           Transaction hash of input UTxO
  <tx_index>          Output index of input UTxO
  --sign              Sign transaction (default: true)
  --no-sign           Do not sign transaction
  --output-file       Output file name (default: promote-upgrade-tx.cbor)

Register Gov Auth Options:
  --output-file       Output file name (default: register-gov-auth-tx.cbor)

Simple TX Options:
  --count             Number of outputs (default: 15)
  --amount            Lovelace per output (default: 100000000)
  --to                Recipient address (default: deployer address)

Info Options:
  --format            Output format: json, table (default: table)
  --component         Filter by component (default: all)
  --fetch             Fetch current on-chain state

Examples:
  bun cli deploy -n local
  bun cli deploy -n preview --utxo-amount 50000000
  bun cli deploy -n preview --components tech-auth,council
  bun cli change-council -n preview abc123...def 5
  bun cli change-tech-auth -n preview abc123...def 5 --no-sign
  bun cli stage-upgrade -n preview --validator tech-auth --new-logic-hash abc123...def abc123...def 0
  bun cli promote-upgrade -n preview --validator tech-auth abc123...def 0
  bun cli register-gov-auth -n preview
  bun cli simple-tx -n local --count 5 --amount 50000000
  bun cli info -n preview --format json
`);
}

function parseArgs(args: string[]): {
  command: string;
  options: Record<string, string | boolean>;
  positional: string[];
} {
  const command = args[0] || "";
  const options: Record<string, string | boolean> = {};
  const positional: string[] = [];

  let i = 1;
  while (i < args.length) {
    const arg = args[i];

    if (arg.startsWith("--")) {
      const key = arg.slice(2);

      // Handle --no-* flags
      if (key.startsWith("no-")) {
        options[key.slice(3)] = false;
        i++;
        continue;
      }

      // Check if next arg is a value or another flag
      if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        options[key] = args[i + 1];
        i += 2;
      } else {
        options[key] = true;
        i++;
      }
    } else if (arg.startsWith("-")) {
      const key = arg.slice(1);
      const keyMap: Record<string, string> = {
        n: "network",
        o: "output",
        p: "provider",
      };
      const fullKey = keyMap[key] || key;

      if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
        options[fullKey] = args[i + 1];
        i += 2;
      } else {
        options[fullKey] = true;
        i++;
      }
    } else {
      positional.push(arg);
      i++;
    }
  }

  return { command, options, positional };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (
    args.length === 0 ||
    args[0] === "help" ||
    args[0] === "--help" ||
    args[0] === "-h"
  ) {
    printUsage();
    process.exit(0);
  }

  const { command, options, positional } = parseArgs(args);

  // Parse global options
  const network = validateNetwork((options.network as string) || "local");
  const provider = options.provider
    ? validateProvider(options.provider as string)
    : getDefaultProvider(network);
  const output = (options.output as string) || resolve("./deployments");
  const dryRun = options["dry-run"] === true;

  try {
    switch (command) {
      case "deploy": {
        const deployOptions: DeployOptions = {
          network,
          output,
          provider,
          dryRun,
          utxoAmount: options["utxo-amount"]
            ? parseAmount(options["utxo-amount"] as string)
            : 100_000_000n,
          outputAmount: options["output-amount"]
            ? parseAmount(options["output-amount"] as string)
            : 1_000_000n,
          thresholdOutputAmount: options["threshold-output-amount"]
            ? parseAmount(options["threshold-output-amount"] as string)
            : 2_000_000n,
          techAuthThreshold: options["tech-auth-threshold"]
            ? parseThreshold(options["tech-auth-threshold"] as string)
            : { numerator: 2n, denominator: 3n },
          councilThreshold: options["council-threshold"]
            ? parseThreshold(options["council-threshold"] as string)
            : { numerator: 2n, denominator: 3n },
          councilStagingThreshold: options["council-staging-threshold"]
            ? parseThreshold(options["council-staging-threshold"] as string)
            : { numerator: 0n, denominator: 1n },
          techAuthStagingThreshold: options["tech-auth-staging-threshold"]
            ? parseThreshold(options["tech-auth-staging-threshold"] as string)
            : { numerator: 1n, denominator: 2n },
          components: options.components
            ? validateComponents((options.components as string).split(","))
            : [],
        };

        await deploy(deployOptions);
        break;
      }

      case "change-council": {
        if (positional.length < 2) {
          printError("Missing required arguments: <tx_hash> <tx_index>");
          console.log(
            "Usage: bun cli change-council [options] <tx_hash> <tx_index>",
          );
          process.exit(1);
        }

        const txHash = positional[0];
        const txIndex = parseInt(positional[1], 10);

        validateTxHash(txHash);
        validateTxIndex(txIndex);

        const changeOptions: ChangeAuthOptions = {
          network,
          output,
          provider,
          dryRun,
          txHash,
          txIndex,
          utxoAmount: options["utxo-amount"]
            ? parseAmount(options["utxo-amount"] as string)
            : undefined,
          sign: options.sign !== false,
          outputFile:
            (options["output-file"] as string) || "cli-tx-signed.cbor",
        };

        await changeCouncil(changeOptions);
        break;
      }

      case "change-tech-auth": {
        if (positional.length < 2) {
          printError("Missing required arguments: <tx_hash> <tx_index>");
          console.log(
            "Usage: bun cli change-tech-auth [options] <tx_hash> <tx_index>",
          );
          process.exit(1);
        }

        const txHash = positional[0];
        const txIndex = parseInt(positional[1], 10);

        validateTxHash(txHash);
        validateTxIndex(txIndex);

        const changeOptions: ChangeAuthOptions = {
          network,
          output,
          provider,
          dryRun,
          txHash,
          txIndex,
          utxoAmount: options["utxo-amount"]
            ? parseAmount(options["utxo-amount"] as string)
            : undefined,
          sign: options.sign !== false,
          outputFile:
            (options["output-file"] as string) || "cli-tx-signed.cbor",
        };

        await changeTechAuth(changeOptions);
        break;
      }

      case "simple-tx": {
        const simpleTxOptions: SimpleTxOptions = {
          network,
          output,
          provider,
          dryRun,
          count: options.count ? parseInt(options.count as string, 10) : 15,
          amount: options.amount
            ? parseAmount(options.amount as string)
            : 100_000_000n,
          to: options.to as string | undefined,
        };

        await simpleTx(simpleTxOptions);
        break;
      }

      case "info": {
        const infoOptions: InfoOptions = {
          network,
          output,
          provider,
          dryRun,
          format: ((options.format as string) || "table") as "json" | "table",
          component: (options.component as string) || "all",
          fetch: options.fetch === true,
        };

        await info(infoOptions);
        break;
      }

      case "stage-upgrade": {
        const validator = options.validator as string | undefined;
        if (!validator) {
          printError("Missing required option: --validator");
          console.log(`Valid validators: ${VALID_TWO_STAGE_VALIDATORS.join(", ")}`);
          process.exit(1);
        }

        const newLogicHash = options["new-logic-hash"] as string | undefined;
        if (!newLogicHash) {
          printError("Missing required option: --new-logic-hash");
          process.exit(1);
        }

        if (positional.length < 2) {
          printError("Missing required arguments: <tx_hash> <tx_index>");
          console.log(
            "Usage: bun cli stage-upgrade [options] --validator <name> --new-logic-hash <hash> <tx_hash> <tx_index>",
          );
          process.exit(1);
        }

        const txHash = positional[0];
        const txIndex = parseInt(positional[1], 10);

        validateTwoStageValidator(validator);
        validateScriptHash(newLogicHash);
        validateTxHash(txHash);
        validateTxIndex(txIndex);

        const stageOptions: StageUpgradeOptions = {
          network,
          output,
          provider,
          dryRun,
          validator,
          newLogicHash,
          txHash,
          txIndex,
          utxoAmount: options["utxo-amount"]
            ? parseAmount(options["utxo-amount"] as string)
            : undefined,
          sign: options.sign !== false,
          outputFile:
            (options["output-file"] as string) || "stage-upgrade-tx.cbor",
        };

        await stageUpgrade(stageOptions);
        break;
      }

      case "promote-upgrade": {
        const validator = options.validator as string | undefined;
        if (!validator) {
          printError("Missing required option: --validator");
          console.log(`Valid validators: ${VALID_TWO_STAGE_VALIDATORS.join(", ")}`);
          process.exit(1);
        }

        if (positional.length < 2) {
          printError("Missing required arguments: <tx_hash> <tx_index>");
          console.log(
            "Usage: bun cli promote-upgrade [options] --validator <name> <tx_hash> <tx_index>",
          );
          process.exit(1);
        }

        const txHash = positional[0];
        const txIndex = parseInt(positional[1], 10);

        validateTwoStageValidator(validator);
        validateTxHash(txHash);
        validateTxIndex(txIndex);

        const promoteOptions: PromoteUpgradeOptions = {
          network,
          output,
          provider,
          dryRun,
          validator,
          txHash,
          txIndex,
          utxoAmount: options["utxo-amount"]
            ? parseAmount(options["utxo-amount"] as string)
            : undefined,
          sign: options.sign !== false,
          outputFile:
            (options["output-file"] as string) || "promote-upgrade-tx.cbor",
        };

        await promoteUpgrade(promoteOptions);
        break;
      }

      case "register-gov-auth": {
        const registerOptions: RegisterGovAuthOptions = {
          network,
          output,
          provider,
          dryRun,
          outputFile:
            (options["output-file"] as string) || "register-gov-auth-tx.cbor",
        };

        await registerGovAuth(registerOptions);
        break;
      }

      default:
        printError(`Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (error) {
    printError(
      `Command failed: ${error instanceof Error ? error.message : error}`,
    );
    if (error instanceof Error && error.stack) {
      console.error("\nStack trace:", error.stack);
    }
    process.exit(1);
  }
}

main();
