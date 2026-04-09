import type { Argv, CommandModule } from "yargs";
import { resolve } from "path";
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import type { GlobalOptions } from "../../lib/global-options";
import { isSingleTransaction } from "../../lib/transaction-json";
import { getCardanoNetwork } from "../../lib/network-mapping";
import { getBlockfrostBaseUrl } from "../../lib/blockfrost";
import { resolveInputs } from "../../lib/tx-summary/resolve-inputs";
import type { ResolvedInput } from "../../lib/tx-summary/resolve-inputs";
import {
  detectCommandType,
  generateSemanticDiff,
} from "../../lib/tx-summary/semantic";
import type { SemanticDiff } from "../../lib/tx-summary/semantic";
import { renderMarkdown } from "../../lib/tx-summary/markdown";

interface TxSummaryOptions extends GlobalOptions {
  "tx-file": string;
  "output-file": string | undefined;
}

export const command = "tx-summary";
export const describe = "Generate a human-readable transaction summary";

export function builder(yargs: Argv<GlobalOptions>) {
  return yargs
    .option("tx-file", {
      type: "string",
      demandOption: true,
      description: "Path to transaction JSON file",
    })
    .option("output-file", {
      type: "string",
      description: "Write markdown to file instead of stdout",
    });
}

export async function handler(argv: TxSummaryOptions) {
  const { network, "tx-file": txFile, "output-file": outputFile } = argv;
  const txPath = resolve(txFile);

  // Validate the tx file
  const txData = JSON.parse(readFileSync(txPath, "utf8"));
  if (!isSingleTransaction(txData)) {
    throw new Error(`${txPath} is not a single-transaction JSON file`);
  }

  // Structural: cardano-cli debug transaction view
  let structuralJson: unknown;
  try {
    const raw = execSync(
      `cardano-cli debug transaction view --tx-file "${txPath}"`,
      { encoding: "utf8", timeout: 30_000 },
    );
    structuralJson = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `cardano-cli debug transaction view failed: ${err instanceof Error ? err.message : err}`,
    );
  }

  // Input resolution + semantic diff via Blockfrost
  const cardanoNetwork = getCardanoNetwork(network);
  let resolvedInputs: ResolvedInput[] = [];
  let semanticDiff: SemanticDiff | null = null;

  if (cardanoNetwork && cardanoNetwork !== "local") {
    const apiKeyVar = `BLOCKFROST_${cardanoNetwork.toUpperCase()}_API_KEY`;
    const apiKey = process.env[apiKeyVar];
    if (apiKey) {
      const baseUrl = getBlockfrostBaseUrl(cardanoNetwork);
      try {
        resolvedInputs = await resolveInputs(txData, baseUrl, apiKey);

        const commandType = detectCommandType(structuralJson);
        if (commandType) {
          semanticDiff = await generateSemanticDiff(
            commandType,
            txData,
            resolvedInputs,
          );
        }
      } catch (err) {
        console.warn(
          `Warning: Blockfrost enrichment failed, producing structural-only summary: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  // Render
  const markdown = renderMarkdown(
    txData,
    structuralJson,
    resolvedInputs,
    semanticDiff,
  );

  if (outputFile) {
    writeFileSync(resolve(outputFile), markdown, "utf8");
    console.log(`Summary written to ${resolve(outputFile)}`);
  } else {
    console.log(markdown);
  }
}

const commandModule: CommandModule<GlobalOptions, TxSummaryOptions> = {
  command,
  describe,
  builder,
  handler,
};
export default commandModule;
