import type { Blaze } from "@blaze-cardano/sdk";
import { configureOneShotUtxos, rebuildContracts } from "./config-builder";

/**
 * Prepares contracts for a test run on preview/preprod by:
 * 1. Selecting one-shot UTxOs from the user's wallet
 * 2. Appending a test-run-specific config to aiken.toml
 * 3. Rebuilding contracts and regenerating blueprint (via 'just build')
 *
 * This should be called BEFORE importing contract instances.
 */
export async function prepareTestRunContracts(
  blaze: Blaze,
  network: "preview" | "preprod",
  testRunId: string
): Promise<void> {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║  Test Run Contract Preparation                            ║");
  console.log("╚════════════════════════════════════════════════════════════╝");

  // Step 1: Configure one-shot UTxOs
  await configureOneShotUtxos(blaze, network, testRunId);

  // Step 2: Rebuild contracts (includes blueprint regeneration)
  await rebuildContracts(network, testRunId);

  console.log("\n✓ Test run contracts prepared successfully");
  console.log("  You can now import and use the contract instances.\n");
}
