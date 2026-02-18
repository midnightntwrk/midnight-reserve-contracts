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
  GenerateKeyOptions,
  SignAndSubmitOptions,
  CombineSignaturesOptions,
  MintTcnightOptions,
  ChangeTermsOptions,
} from "./lib/types";
import type { DeployStagingTrackOptions } from "./commands/deploy-staging-track";
import type { MintStagingStateOptions } from "./commands/mint-staging-state";
import { getDefaultProvider } from "./lib/types";
import {
  getDeployUtxoAmount,
  getTechAuthThreshold,
  getCouncilThreshold,
  getCouncilStagingThreshold,
  getTechAuthStagingThreshold,
  getSimpleTxCount,
  getSimpleTxAmount,
} from "./lib/config";
import {
  validateNetwork,
  validateProvider,
  validateTxHash,
  validateTxIndex,
  validateComponents,
  validateTwoStageValidator,
  validateScriptHash,
  validateHash32,
  validateTransactionName,
  parseThreshold,
  parseAmount,
  VALID_NETWORKS,
  VALID_PROVIDERS,
  VALID_COMPONENTS,
  VALID_TWO_STAGE_VALIDATORS,
  VALID_TRANSACTION_NAMES,
} from "./utils/validation";
import { printError } from "./utils/output";
import {
  deploy,
  deployStagingTrack,
  changeCouncil,
  changeTechAuth,
  changeFederatedOps,
  simpleTx,
  info,
  stageUpgrade,
  promoteUpgrade,
  registerGovAuth,
  generateKey,
  signAndSubmit,
  combineSignatures,
  mintTcnight,
  changeTerms,
  migrateFederatedOps,
  mintStagingState,
  verify,
} from "./commands";

function printUsage(): void {
  console.log(`
Midnight Reserve Contracts CLI

Usage: bun cli <command> [options]

Commands:
  deploy              Generate deployment transactions
  deploy-staging-track  Deploy staging track forever validators
  change-council      Update council multisig members
  change-tech-auth    Update tech auth multisig members
  change-federated-ops  Update federated ops members
  migrate-federated-ops  Migrate federated ops datum from v1 to v2
  stage-upgrade       Stage a new logic hash for a two-stage upgrade validator
  promote-upgrade     Promote staged logic to main for a two-stage upgrade validator
  register-gov-auth   Register main and staging gov auth scripts as stake credentials
  simple-tx           Create simple transactions for testing
  mint-staging-state  Mint StagingState NFT for a v2 logic contract
  mint-tcnight        Mint or burn TCnight tokens (preview/preprod only)
  change-terms        Change terms and conditions hash and URL
  info                Display contract information
  verify              Verify on-chain deployment against local artifacts
  generate-key        Generate a new signing key and Cardano address
  sign-and-submit     Sign and submit transactions from a JSON file
  combine-signatures  Combine wallet signatures and submit transactions

Run 'bun cli <command> --help' for more information on a command.
`);
}

function printGlobalOptions(): void {
  console.log(`
Global Options:
  -n, --network       Network: ${VALID_NETWORKS.join(", ")} (default: local)
  -o, --output        Output directory (default: ./deployments)
  -p, --provider      Provider: ${VALID_PROVIDERS.join(", ")} (default: emulator for local, blockfrost otherwise)
  --dry-run           Build transaction without signing
`);
}

function printDeployHelp(): void {
  console.log(`
Usage: bun cli deploy [options]

Generate deployment transactions for reserve contracts.

Options:
  --utxo-amount                Lovelace for input UTxO (default: 20000000)
  --tech-auth-threshold        Tech auth threshold e.g. "2/3" (default: 2/3)
  --council-threshold          Council threshold e.g. "2/3" (default: 2/3)
  --council-staging-threshold  Council staging threshold e.g. "0/1" (default: 0/1)
  --tech-auth-staging-threshold  Tech auth staging threshold e.g. "1/2" (default: 1/2)
  --components                 Components to deploy (comma-separated, default: all)
                               Options: ${VALID_COMPONENTS.join(", ")}
  --name                       Deploy a single transaction by name. If deployment file
                               exists, updates only that transaction; otherwise creates
                               new file with just that transaction.
                               Names: ${VALID_TRANSACTION_NAMES.slice(0, 4).join(", ")}...
                               (run with invalid name to see full list)
`);
  printGlobalOptions();
  console.log(`Examples:
  bun cli deploy -n local
  bun cli deploy -n preview --utxo-amount 50000000
  bun cli deploy -n preview --components tech-auth,council
  bun cli deploy -n preview --name council-deployment
`);
}

function printDeployStagingTrackHelp(): void {
  console.log(`
Usage: bun cli deploy-staging-track [options]

Deploy staging track forever validators. These validators delegate to MAIN
forever contracts by reading from the "staging" NFT on the main two-stage.

Staging track validators enable testing upgrades before promoting to main.

Options:
  --utxo-amount                Lovelace for input UTxO (default: 20000000)
  --components                 Components to deploy (comma-separated, default: all)
                               Options: council, tech-auth, federated-ops, reserve, ics, terms-and-conditions
  --name                       Deploy a single transaction by name
                               Names: council-staging-forever-deployment,
                                      tech-auth-staging-forever-deployment,
                                      federated-ops-staging-forever-deployment,
                                      reserve-staging-forever-deployment,
                                      ics-staging-forever-deployment,
                                      terms-and-conditions-staging-forever-deployment
  --use-build                  Use freshly built blueprint instead of deployed scripts
`);
  printGlobalOptions();
  console.log(`Examples:
  bun cli deploy-staging-track -n preview
  bun cli deploy-staging-track -n preview --components council,tech-auth
`);
}

function printChangeCouncilHelp(): void {
  console.log(`
Usage: bun cli change-council [options] <tx_hash> <tx_index>

Update council multisig members.

Arguments:
  <tx_hash>           Transaction hash of input UTxO
  <tx_index>          Output index of input UTxO

Options:
  --utxo-amount       Override input UTxO amount
  --sign              Sign transaction (default: true)
  --no-sign           Do not sign transaction
  --output-file       Output file name (default: change-council-tx.json)
  --use-build         Use freshly built blueprint instead of deployed scripts
`);
  printGlobalOptions();
  console.log(`Examples:
  bun cli change-council -n preview abc123...def 5
  bun cli change-council -n preview abc123...def 5 --no-sign
`);
}

function printChangeTechAuthHelp(): void {
  console.log(`
Usage: bun cli change-tech-auth [options] <tx_hash> <tx_index>

Update tech auth multisig members.

Arguments:
  <tx_hash>           Transaction hash of input UTxO
  <tx_index>          Output index of input UTxO

Options:
  --utxo-amount       Override input UTxO amount
  --sign              Sign transaction (default: true)
  --no-sign           Do not sign transaction
  --output-file       Output file name (default: change-tech-auth-tx.json)
  --use-build         Use freshly built blueprint instead of deployed scripts
`);
  printGlobalOptions();
  console.log(`Examples:
  bun cli change-tech-auth -n preview abc123...def 5
  bun cli change-tech-auth -n preview abc123...def 5 --no-sign
`);
}

function printChangeFederatedOpsHelp(): void {
  console.log(`
Usage: bun cli change-federated-ops [options] <tx_hash> <tx_index>

Update federated ops members. Requires both council and tech auth authorization.

Arguments:
  <tx_hash>           Transaction hash of input UTxO
  <tx_index>          Output index of input UTxO

Options:
  --utxo-amount       Override input UTxO amount
  --sign              Sign transaction (default: true)
  --no-sign           Do not sign transaction
  --output-file       Output file name (default: change-federated-ops-tx.json)
  --use-build         Use freshly built blueprint instead of deployed scripts

Environment variables:
  PERMISSIONED_CANDIDATES   New federated ops member candidates (required)
`);
  printGlobalOptions();
  console.log(`Examples:
  bun cli change-federated-ops -n preview abc123...def 5
  bun cli change-federated-ops -n preview abc123...def 5 --no-sign
`);
}

function printMigrateFederatedOpsHelp(): void {
  console.log(`
Usage: bun cli migrate-federated-ops [options] <tx_hash> <tx_index>

Migrate federated ops datum from FederatedOps (v1) to FederatedOpsV2.
Preserves existing data and appendix, adds empty message field, sets logic_round to 2.
Requires both council and tech auth authorization.

Arguments:
  <tx_hash>           Transaction hash of input UTxO
  <tx_index>          Output index of input UTxO

Options:
  --utxo-amount       Override input UTxO amount
  --sign              Sign transaction (default: true)
  --no-sign           Do not sign transaction
  --output-file       Output file name (default: migrate-federated-ops-tx.json)
  --use-build         Use freshly built blueprint instead of deployed scripts
`);
  printGlobalOptions();
  console.log(`Examples:
  bun cli migrate-federated-ops -n preview abc123...def 5
  bun cli migrate-federated-ops -n preview abc123...def 5 --no-sign
`);
}

function printMintStagingStateHelp(): void {
  console.log(`
Usage: bun cli mint-staging-state [options]

Mint the StagingState NFT for a v2 logic contract.
Required before promote-upgrade can work with v2 logic.

Options:
  --validator         Two-stage validator name (required)
                      Options: ${VALID_TWO_STAGE_VALIDATORS.join(", ")}
  --sign              Sign transaction (default: true)
  --no-sign           Do not sign transaction
  --output-file       Output file name (default: mint-staging-state-tx.json)
  --use-build         Use freshly built blueprint instead of deployed scripts (required)
`);
  printGlobalOptions();
  console.log(`Examples:
  bun cli mint-staging-state -n node-dev-2 --validator federated-ops --use-build
`);
}

function printStageUpgradeHelp(): void {
  console.log(`
Usage: bun cli stage-upgrade [options] <tx_hash> <tx_index>

Stage a new logic hash for a two-stage upgrade validator.

Arguments:
  <tx_hash>           Transaction hash of input UTxO
  <tx_index>          Output index of input UTxO

Options:
  --validator         Two-stage validator name (required)
                      Options: ${VALID_TWO_STAGE_VALIDATORS.join(", ")}
  --new-logic-hash    New logic script hash to stage (required, 56 hex chars)
  --utxo-amount       Override input UTxO amount
  --sign              Sign transaction (default: true)
  --no-sign           Do not sign transaction
  --output-file       Output file name (default: stage-upgrade-tx.json)
  --use-build         Use freshly built blueprint instead of deployed scripts
`);
  printGlobalOptions();
  console.log(`Examples:
  bun cli stage-upgrade -n preview --validator tech-auth --new-logic-hash abc123...def abc123...def 0
`);
}

function printPromoteUpgradeHelp(): void {
  console.log(`
Usage: bun cli promote-upgrade [options] <tx_hash> <tx_index>

Promote staged logic to main for a two-stage upgrade validator.

Arguments:
  <tx_hash>           Transaction hash of input UTxO
  <tx_index>          Output index of input UTxO

Options:
  --validator         Two-stage validator name (required)
                      Options: ${VALID_TWO_STAGE_VALIDATORS.join(", ")}
  --utxo-amount       Override input UTxO amount
  --sign              Sign transaction (default: true)
  --no-sign           Do not sign transaction
  --output-file       Output file name (default: promote-upgrade-tx.json)
  --use-build         Use freshly built blueprint instead of deployed scripts
`);
  printGlobalOptions();
  console.log(`Examples:
  bun cli promote-upgrade -n preview --validator tech-auth abc123...def 0
`);
}

function printRegisterGovAuthHelp(): void {
  console.log(`
Usage: bun cli register-gov-auth [options]

Register main and staging gov auth scripts as stake credentials.

Options:
  --output-file       Output file name (default: register-gov-auth-tx.json)
  --use-build         Use freshly built blueprint instead of deployed scripts
`);
  printGlobalOptions();
  console.log(`Examples:
  bun cli register-gov-auth -n preview
`);
}

function printSimpleTxHelp(): void {
  console.log(`
Usage: bun cli simple-tx [options]

Create simple transactions for testing.

Options:
  --count             Number of outputs (default: 15)
  --amount            Lovelace per output (default: 20000000)
  --to                Recipient address (default: deployer address)
  --output-file       Output file name (default: simple-tx.json)
`);
  printGlobalOptions();
  console.log(`Examples:
  bun cli simple-tx -n local --count 5 --amount 50000000
`);
}

function printInfoHelp(): void {
  console.log(`
Usage: bun cli info [options]

Display contract information.

Options:
  --format            Output format: json, table (default: table)
  --component         Filter by component (default: all)
  --fetch             Fetch current on-chain state
  --save              Save JSON and markdown report to release/<network>/
  --release-dir       Output directory for --save (default: ./release)
  --use-build         Use freshly built blueprint instead of deployed scripts
`);
  printGlobalOptions();
  console.log(`Examples:
  bun cli info -n preview --format json
  bun cli info -n mainnet --save
  bun cli info -n mainnet --save --release-dir ./my-release
`);
}

function printVerifyHelp(): void {
  console.log(`
Usage: bun cli verify [options]

Verify on-chain deployment against local artifacts.
Checks script hash embedding, on-chain reference scripts, and UpgradeState datums.

Options:
  -n, --network       Network to verify (required, e.g. mainnet, preview)
`);
  console.log(`Examples:
  bun cli verify -n mainnet
  bun cli verify -n preview
`);
}

function printGenerateKeyHelp(): void {
  console.log(`
Usage: bun cli generate-key [options]

Generate a new Ed25519 signing key and Cardano address.
Outputs values suitable for adding to your .env file.

Options:
  -n, --network       Network: ${VALID_NETWORKS.join(", ")} (default: preview)

Examples:
  bun cli generate-key -n preview
  bun cli generate-key -n mainnet
`);
}

function printSignAndSubmitHelp(): void {
  console.log(`
Usage: bun cli sign-and-submit [options] <json_file>

Sign and submit transactions from a JSON file.
Supports both single transaction files and deployment-transactions.json format.

Arguments:
  <json_file>         Path to the JSON file containing transaction(s)

Options:
  --signing-key       Environment variable name containing the signing key
                      (default: SIGNING_PRIVATE_KEY)
  --sign-deployer     Sign with deployer key (default: true)
  --no-sign-deployer  Submit without deployer signature
`);
  printGlobalOptions();
  console.log(`Examples:
  bun cli sign-and-submit -n preview ./deployments/preview/simple-tx.json
  bun cli sign-and-submit -n preview --signing-key MY_KEY ./tx.json
  bun cli sign-and-submit -n preview --no-sign-deployer ./already-signed.json
`);
}

function printCombineSignaturesHelp(): void {
  console.log(`
Usage: bun cli combine-signatures [options] --tx <tx_file> --signatures <file1> [file2] [file3] ...

Combine signatures from multiple witness files and submit transactions.
Unlike sign-and-submit (which signs with env var keys), this command takes
witness files from offline signers (cardano-cli) or browser wallets (CIP-30)
and merges them into transactions.

Options:
  --tx                Path to transaction file (required)
  --signatures        Path(s) to witness files (required, variadic)
                      Supports multiple formats:
                      - cardano-cli TextEnvelope format (*.witness.json)
                      - CIP-30 wallet TransactionWitnessSet (raw CBOR hex)
  --signing-key       Environment variable name containing the deployer key
                      (default: SIGNING_PRIVATE_KEY)
  --sign-deployer     Also sign with deployer key after merging (default: true)
  --no-sign-deployer  Only merge witness signatures, don't add deployer signature

Witness File Formats:

  1. cardano-cli TextEnvelope (recommended for offline signing):
     {
       "type": "TxWitness ConwayEra",
       "description": "Key Witness ShelleyEra",
       "cborHex": "82008258207672757a...58409ac7228f..."
     }

  2. CIP-30 wallet (TransactionWitnessSet CBOR hex):
     a10081825820<vkey>5840<sig>

     Or legacy JSON format (deprecated):
     {
       "alice": "a10081825820...",
       "bob": "a10081825820..."
     }

Key Features:
  - Accepts multiple independent witness files
  - Automatically detects witness format
  - Preserves any existing signatures in the transaction
  - Validates no conflicting signatures for the same key
`);
  printGlobalOptions();
  console.log(`Examples:

  # Single cardano-cli witness file
  bun cli combine-signatures -n preview \\
    --tx ./tx.json \\
    --signatures ./witness1.json

  # Multiple witness files (variadic syntax)
  bun cli combine-signatures -n preview \\
    --tx ./tx.json \\
    --signatures ./alice-witness.json ./bob-witness.json ./carol-witness.json

  # Mixed formats (cardano-cli + wallet)
  bun cli combine-signatures -n preview \\
    --tx ./tx.json \\
    --signatures ./cardano-cli-witness.json ./wallet-witness.cbor

  # Without deployer signature
  bun cli combine-signatures -n preview \\
    --tx ./tx.json \\
    --signatures ./witness1.json ./witness2.json \\
    --no-sign-deployer

  # Add signatures to a partially signed transaction
  bun cli combine-signatures -n preview \\
    --tx ./partially-signed-tx.json \\
    --signatures ./additional-witness.json
`);
}

function printMintTcnightHelp(): void {
  console.log(`
Usage: bun cli mint-tcnight [options] <amount>

Mint or burn TCnight tokens on preview/preprod networks.

Arguments:
  <amount>            Amount of NIGHT tokens to mint or burn

Options:
  -u, --user-address  User address (required) - wallet for signing and burn source
  -d, --destination   Destination address for minted tokens (default: user address)
  -b, --burn          Burn tokens instead of minting
  --output-file       Output file name (default: mint-tcnight-tx.json)
  --use-build         Use freshly built blueprint instead of deployed scripts
`);
  printGlobalOptions();
  console.log(`Examples:
  bun cli mint-tcnight -n preview -u addr_test1... 1000
  bun cli mint-tcnight -n preview -u addr_test1... -d addr_test1... 500
  bun cli mint-tcnight -n preprod -u addr_test1... -b 100
`);
}

function printChangeTermsHelp(): void {
  console.log(`
Usage: bun cli change-terms [options] <tx_hash> <tx_index>

Change terms and conditions hash and URL. Requires both council and tech auth authorization.

Arguments:
  <tx_hash>           Transaction hash of input UTxO
  <tx_index>          Output index of input UTxO

Options:
  --hash              New terms and conditions hash (required, 64 hex chars / 32 bytes)
  --url               New terms and conditions URL (required)
  --utxo-amount       Override input UTxO amount
  --sign              Sign transaction (default: true)
  --no-sign           Do not sign transaction
  --output-file       Output file name (default: change-terms-tx.json)
  --use-build         Use freshly built blueprint instead of deployed scripts
`);
  printGlobalOptions();
  console.log(`Examples:
  bun cli change-terms -n preview --hash abc123...def --url https://example.com/terms abc123...def 5
  bun cli change-terms -n preview --hash abc123...def --url https://example.com/terms abc123...def 5 --no-sign
`);
}

function parseArgs(args: string[]): {
  command: string;
  options: Record<string, string | boolean | string[]>;
  positional: string[];
} {
  const command = args[0] || "";
  const options: Record<string, string | boolean | string[]> = {};
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

      // Special handling for --signatures to collect multiple values
      if (key === "signatures") {
        const values: string[] = [];
        i++;
        while (i < args.length && !args[i].startsWith("-")) {
          values.push(args[i]);
          i++;
        }
        options[key] =
          values.length > 0 ? (values.length === 1 ? values[0] : values) : true;
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
        u: "user-address",
        d: "destination",
        b: "burn",
        v: "validator",
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
        if (options.help) {
          printDeployHelp();
          process.exit(0);
        }

        const deployOptions: DeployOptions = {
          network,
          output,
          provider,
          dryRun,
          utxoAmount: options["utxo-amount"]
            ? parseAmount(options["utxo-amount"] as string)
            : getDeployUtxoAmount(),
          techAuthThreshold: options["tech-auth-threshold"]
            ? parseThreshold(options["tech-auth-threshold"] as string)
            : getTechAuthThreshold(),
          councilThreshold: options["council-threshold"]
            ? parseThreshold(options["council-threshold"] as string)
            : getCouncilThreshold(),
          councilStagingThreshold: options["council-staging-threshold"]
            ? parseThreshold(options["council-staging-threshold"] as string)
            : getCouncilStagingThreshold(),
          techAuthStagingThreshold: options["tech-auth-staging-threshold"]
            ? parseThreshold(options["tech-auth-staging-threshold"] as string)
            : getTechAuthStagingThreshold(),
          components: options.components
            ? validateComponents((options.components as string).split(","))
            : [],
          name: options.name
            ? validateTransactionName(options.name as string)
            : undefined,
        };

        await deploy(deployOptions);
        break;
      }

      case "deploy-staging-track": {
        if (options.help) {
          printDeployStagingTrackHelp();
          process.exit(0);
        }

        const deployStagingTrackOptions: DeployStagingTrackOptions = {
          network,
          output,
          provider,
          dryRun,
          utxoAmount: options["utxo-amount"]
            ? parseAmount(options["utxo-amount"] as string)
            : getDeployUtxoAmount(),
          components: options.components
            ? (options.components as string).split(",")
            : [],
          name: options.name as string | undefined,
          useBuild: options["use-build"] === true,
        };

        await deployStagingTrack(deployStagingTrackOptions);
        break;
      }

      case "change-council": {
        if (options.help) {
          printChangeCouncilHelp();
          process.exit(0);
        }

        if (positional.length < 2) {
          printError("Missing required arguments: <tx_hash> <tx_index>");
          printChangeCouncilHelp();
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
            (options["output-file"] as string) || "change-council-tx.json",
          useBuild: options["use-build"] === true,
        };

        await changeCouncil(changeOptions);
        break;
      }

      case "change-tech-auth": {
        if (options.help) {
          printChangeTechAuthHelp();
          process.exit(0);
        }

        if (positional.length < 2) {
          printError("Missing required arguments: <tx_hash> <tx_index>");
          printChangeTechAuthHelp();
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
            (options["output-file"] as string) || "change-tech-auth-tx.json",
          useBuild: options["use-build"] === true,
        };

        await changeTechAuth(changeOptions);
        break;
      }

      case "change-federated-ops": {
        if (options.help) {
          printChangeFederatedOpsHelp();
          process.exit(0);
        }

        if (positional.length < 2) {
          printError("Missing required arguments: <tx_hash> <tx_index>");
          printChangeFederatedOpsHelp();
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
            (options["output-file"] as string) ||
            "change-federated-ops-tx.json",
          useBuild: options["use-build"] === true,
        };

        await changeFederatedOps(changeOptions);
        break;
      }

      case "migrate-federated-ops": {
        if (options.help) {
          printMigrateFederatedOpsHelp();
          process.exit(0);
        }

        if (positional.length < 2) {
          printError("Missing required arguments: <tx_hash> <tx_index>");
          printMigrateFederatedOpsHelp();
          process.exit(1);
        }

        const txHash = positional[0];
        const txIndex = parseInt(positional[1], 10);

        validateTxHash(txHash);
        validateTxIndex(txIndex);

        const migrateOptions: ChangeAuthOptions = {
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
            (options["output-file"] as string) ||
            "migrate-federated-ops-tx.json",
          useBuild: options["use-build"] === true,
        };

        await migrateFederatedOps(migrateOptions);
        break;
      }

      case "mint-staging-state": {
        if (options.help) {
          printMintStagingStateHelp();
          process.exit(0);
        }

        const validator = options.validator as string | undefined;
        if (!validator) {
          printError("Missing required option: --validator");
          printMintStagingStateHelp();
          process.exit(1);
        }

        validateTwoStageValidator(validator);

        const mintStagingStateOptions: MintStagingStateOptions = {
          network,
          output,
          provider,
          dryRun,
          validator,
          sign: options.sign !== false,
          outputFile:
            (options["output-file"] as string) || "mint-staging-state-tx.json",
          useBuild: options["use-build"] === true,
        };

        await mintStagingState(mintStagingStateOptions);
        break;
      }

      case "simple-tx": {
        if (options.help) {
          printSimpleTxHelp();
          process.exit(0);
        }

        const simpleTxOptions: SimpleTxOptions = {
          network,
          output,
          provider,
          dryRun,
          count: options.count
            ? parseInt(options.count as string, 10)
            : getSimpleTxCount(),
          amount: options.amount
            ? parseAmount(options.amount as string)
            : getSimpleTxAmount(),
          to: options.to as string | undefined,
          outputFile: (options["output-file"] as string) || "simple-tx.json",
        };

        await simpleTx(simpleTxOptions);
        break;
      }

      case "info": {
        if (options.help) {
          printInfoHelp();
          process.exit(0);
        }

        const infoOptions: InfoOptions = {
          network,
          output,
          provider,
          dryRun,
          format: ((options.format as string) || "table") as "json" | "table",
          component: (options.component as string) || "all",
          fetch: options.fetch === true,
          useBuild: options["use-build"] === true,
          save: options.save === true,
          releaseDir: (options["release-dir"] as string) || undefined,
        };

        await info(infoOptions);
        break;
      }

      case "verify": {
        if (options.help) {
          printVerifyHelp();
          process.exit(0);
        }

        await verify({ network });
        break;
      }

      case "stage-upgrade": {
        if (options.help) {
          printStageUpgradeHelp();
          process.exit(0);
        }

        const validator = options.validator as string | undefined;
        if (!validator) {
          printError("Missing required option: --validator");
          printStageUpgradeHelp();
          process.exit(1);
        }

        const newLogicHash = options["new-logic-hash"] as string | undefined;
        if (!newLogicHash) {
          printError("Missing required option: --new-logic-hash");
          printStageUpgradeHelp();
          process.exit(1);
        }

        if (positional.length < 2) {
          printError("Missing required arguments: <tx_hash> <tx_index>");
          printStageUpgradeHelp();
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
            (options["output-file"] as string) || "stage-upgrade-tx.json",
          useBuild: options["use-build"] === true,
        };

        await stageUpgrade(stageOptions);
        break;
      }

      case "promote-upgrade": {
        if (options.help) {
          printPromoteUpgradeHelp();
          process.exit(0);
        }

        const validator = options.validator as string | undefined;
        if (!validator) {
          printError("Missing required option: --validator");
          printPromoteUpgradeHelp();
          process.exit(1);
        }

        if (positional.length < 2) {
          printError("Missing required arguments: <tx_hash> <tx_index>");
          printPromoteUpgradeHelp();
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
            (options["output-file"] as string) || "promote-upgrade-tx.json",
          useBuild: options["use-build"] === true,
        };

        await promoteUpgrade(promoteOptions);
        break;
      }

      case "register-gov-auth": {
        if (options.help) {
          printRegisterGovAuthHelp();
          process.exit(0);
        }

        const registerOptions: RegisterGovAuthOptions = {
          network,
          output,
          provider,
          dryRun,
          outputFile:
            (options["output-file"] as string) || "register-gov-auth-tx.json",
          useBuild: options["use-build"] === true,
        };

        await registerGovAuth(registerOptions);
        break;
      }

      case "generate-key": {
        if (options.help) {
          printGenerateKeyHelp();
          process.exit(0);
        }

        const generateKeyOptions: GenerateKeyOptions = {
          network,
        };

        await generateKey(generateKeyOptions);
        break;
      }

      case "sign-and-submit": {
        if (options.help) {
          printSignAndSubmitHelp();
          process.exit(0);
        }

        if (positional.length < 1) {
          printError("Missing required argument: <json_file>");
          printSignAndSubmitHelp();
          process.exit(1);
        }

        const jsonFile = positional[0];

        const signAndSubmitOptions: SignAndSubmitOptions = {
          network,
          provider,
          jsonFile,
          signingKeyEnvVar:
            (options["signing-key"] as string) || "SIGNING_PRIVATE_KEY",
          signDeployer: options["sign-deployer"] !== false,
        };

        await signAndSubmit(signAndSubmitOptions);
        break;
      }

      case "combine-signatures": {
        if (options.help) {
          printCombineSignaturesHelp();
          process.exit(0);
        }

        const txFile = options.tx as string | undefined;
        if (!txFile) {
          printError("Missing required option: --tx");
          printCombineSignaturesHelp();
          process.exit(1);
        }

        const signaturesArg = options.signatures;
        let witnessFiles: string[] = [];

        if (typeof signaturesArg === "string") {
          witnessFiles = [signaturesArg];
        } else if (Array.isArray(signaturesArg)) {
          witnessFiles = signaturesArg;
        } else {
          printError("Missing required option: --signatures");
          printCombineSignaturesHelp();
          process.exit(1);
        }

        const combineSignaturesOptions: CombineSignaturesOptions = {
          network,
          provider,
          txFile,
          witnessFiles,
          signDeployer: options["sign-deployer"] !== false,
          signingKeyEnvVar:
            (options["signing-key"] as string) || "SIGNING_PRIVATE_KEY",
        };

        await combineSignatures(combineSignaturesOptions);
        break;
      }

      case "mint-tcnight": {
        if (options.help) {
          printMintTcnightHelp();
          process.exit(0);
        }

        const userAddress = options["user-address"] as string | undefined;
        if (!userAddress) {
          printError("Missing required option: -u, --user-address");
          printMintTcnightHelp();
          process.exit(1);
        }

        if (positional.length < 1) {
          printError("Missing required argument: <amount>");
          printMintTcnightHelp();
          process.exit(1);
        }

        const mintTcnightOptions: MintTcnightOptions = {
          network,
          output,
          provider,
          dryRun,
          userAddress,
          destinationAddress: options.destination as string | undefined,
          amount: parseAmount(positional[0]),
          burn: options.burn === true,
          outputFile:
            (options["output-file"] as string) || "mint-tcnight-tx.json",
          useBuild: options["use-build"] === true,
        };

        await mintTcnight(mintTcnightOptions);
        break;
      }

      case "change-terms": {
        if (options.help) {
          printChangeTermsHelp();
          process.exit(0);
        }

        const termsHash = options.hash as string | undefined;
        if (!termsHash) {
          printError("Missing required option: --hash");
          printChangeTermsHelp();
          process.exit(1);
        }

        const termsUrl = options.url as string | undefined;
        if (!termsUrl) {
          printError("Missing required option: --url");
          printChangeTermsHelp();
          process.exit(1);
        }

        if (positional.length < 2) {
          printError("Missing required arguments: <tx_hash> <tx_index>");
          printChangeTermsHelp();
          process.exit(1);
        }

        const txHash = positional[0];
        const txIndex = parseInt(positional[1], 10);

        validateHash32(termsHash);
        validateTxHash(txHash);
        validateTxIndex(txIndex);

        const changeTermsOptions: ChangeTermsOptions = {
          network,
          output,
          provider,
          dryRun,
          txHash,
          txIndex,
          hash: termsHash,
          url: termsUrl,
          utxoAmount: options["utxo-amount"]
            ? parseAmount(options["utxo-amount"] as string)
            : undefined,
          sign: options.sign !== false,
          outputFile:
            (options["output-file"] as string) || "change-terms-tx.json",
          useBuild: options["use-build"] === true,
        };

        await changeTerms(changeTermsOptions);
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

  // Exit successfully after command completion
  process.exit(0);
}

main();
