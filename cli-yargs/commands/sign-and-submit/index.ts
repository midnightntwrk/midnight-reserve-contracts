import type { Argv, CommandModule } from "yargs";
import { readFileSync } from "fs";
import {
  HexBlob,
  Transaction,
  TransactionId,
  TxCBOR,
} from "@blaze-cardano/core";
import type { Provider } from "@blaze-cardano/sdk";
import type { GlobalOptions } from "../../lib/global-options";
import { createProvider } from "../../lib/provider";
import { signTransaction, attachWitnesses } from "../../lib/transaction";
import { getEnvVar } from "../../lib/config";
import {
  printError,
  printSuccess,
  printProgress,
  printInfo,
} from "../../lib/output";
import {
  isSingleTransaction,
  isDeploymentTransactions,
} from "../../lib/transaction-json";
import {
  MAX_SUBMIT_RETRIES,
  INITIAL_RETRY_DELAY_MS,
  sleep,
  isNetworkError,
  isAlreadySubmittedError,
  awaitTxConfirmation,
} from "../../lib/submit";

interface SignAndSubmitOptions extends GlobalOptions {
  "json-file": string;
  "signing-key": string;
  "sign-deployer": boolean;
}

export const command = "sign-and-submit <json-file>";
export const describe = "Sign and submit transactions from a JSON file";

export function builder(yargs: Argv<GlobalOptions>) {
  return yargs
    .positional("json-file", {
      type: "string",
      demandOption: true,
      description: "Path to the JSON file containing transaction(s)",
    })
    .option("signing-key", {
      type: "string",
      default: "SIGNING_PRIVATE_KEY",
      description:
        "Environment variable name containing the signing key (default: SIGNING_PRIVATE_KEY)",
    })
    .option("sign-deployer", {
      type: "boolean",
      default: true,
      description: "Sign with deployer key (default: true)",
    });
}

export async function handler(argv: SignAndSubmitOptions) {
  const {
    network,
    "json-file": jsonFile,
    "signing-key": signingKeyEnvVar,
    "sign-deployer": signDeployer,
  } = argv;

  const privateKeyHex = signDeployer ? getEnvVar(signingKeyEnvVar) : null;
  const provider = await createProvider(network, argv.provider);

  if (signDeployer) {
    printProgress(`Signing with deployer key from ${signingKeyEnvVar}`);
  } else {
    printProgress(`Submitting without deployer signature (--no-sign-deployer)`);
  }

  const fileContent = readFileSync(jsonFile, "utf-8");
  const jsonData = JSON.parse(fileContent);

  const confirmedHashes: TransactionId[] = [];
  const errors: Array<{ name: string; error: string }> = [];

  if (isDeploymentTransactions(jsonData)) {
    printProgress(
      `Found ${jsonData.transactions.length} transactions to process`,
    );

    // Phase 1: Submit all transactions
    const submissions: Array<{ name: string; txId: TransactionId }> = [];
    const submitErrors: Array<{ name: string; error: string }> = [];

    for (const tx of jsonData.transactions) {
      try {
        const txId = await signAndSubmitTransaction(
          tx.cborHex,
          privateKeyHex,
          provider,
          tx.description,
        );
        submissions.push({ name: tx.description, txId });
        printSuccess(`Submitted: ${tx.description} - ${txId}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        submitErrors.push({ name: tx.description, error: errorMsg });
        printError(`Failed to submit ${tx.description}: ${errorMsg}`);
      }
    }

    if (submissions.length > 0) {
      printProgress(
        `\nSubmitted ${submissions.length}/${jsonData.transactions.length} transactions. Awaiting confirmations...`,
      );
    }

    // Phase 2: Await confirmations
    for (const { name, txId } of submissions) {
      try {
        await awaitTxConfirmation(txId, provider, name);
        confirmedHashes.push(txId);
        printSuccess(`Confirmed: ${name} - ${txId}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push({ name, error: errorMsg });
        printError(`Confirmation failed for ${name}: ${errorMsg}`);
      }
    }

    errors.push(...submitErrors);
  } else if (isSingleTransaction(jsonData)) {
    try {
      const txId = await signAndSubmitTransaction(
        jsonData.cborHex,
        privateKeyHex,
        provider,
        jsonData.description,
      );
      await awaitTxConfirmation(txId, provider, jsonData.description);
      confirmedHashes.push(txId);
      printSuccess(`Confirmed: ${txId}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push({ name: jsonData.description, error: errorMsg });
      printError(`Failed to submit transaction: ${errorMsg}`);
    }
  } else {
    throw new Error(
      "Unrecognized JSON format. Expected transaction file or deployment-transactions.json",
    );
  }

  console.log("\n--- Summary ---");
  if (confirmedHashes.length > 0) {
    console.log(
      `\nSuccessfully confirmed ${confirmedHashes.length} transaction(s):`,
    );
    for (const hash of confirmedHashes) {
      console.log(`  ${hash}`);
    }
  }

  if (errors.length > 0) {
    console.log(`\nFailed ${errors.length} transaction(s):`);
    for (const { name, error } of errors) {
      console.log(`  ${name}: ${error}`);
    }
    process.exit(1);
  }
}

async function signAndSubmitTransaction(
  cbor: string,
  privateKeyHex: string | null,
  provider: Provider,
  name: string,
): Promise<TransactionId> {
  const tx = Transaction.fromCbor(TxCBOR(HexBlob(cbor)));
  const txId = tx.getId();

  let signedTx: Transaction;
  if (privateKeyHex) {
    const signatures = signTransaction(txId, [privateKeyHex]);
    signedTx = attachWitnesses(tx.toCbor() as string, signatures);
  } else {
    signedTx = tx;
  }

  for (let attempt = 1; attempt <= MAX_SUBMIT_RETRIES; attempt++) {
    try {
      if (attempt > 1) {
        printProgress(
          `Submitting (attempt ${attempt}/${MAX_SUBMIT_RETRIES}): ${name}`,
        );
      } else {
        printProgress(`Submitting: ${name}`);
      }
      await provider.postTransactionToChain(signedTx);
      return txId;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      if (isAlreadySubmittedError(err)) {
        printInfo(`Transaction may already be submitted: ${name}`);
        return txId;
      }

      if (!isNetworkError(err) || attempt === MAX_SUBMIT_RETRIES) {
        throw err;
      }

      const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
      printInfo(`Network error, retrying in ${delay / 1000}s...`);
      await sleep(delay);
    }
  }

  throw new Error(`Failed to submit transaction ${name}`);
}

const commandModule: CommandModule<GlobalOptions, SignAndSubmitOptions> = {
  command,
  describe,
  builder,
  handler,
};

export default commandModule;
