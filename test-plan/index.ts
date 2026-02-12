#!/usr/bin/env bun

import { Sprinkle } from "@sundaeswap/sprinkles";
import { SettingsSchema, type Settings, type JourneyState } from "./lib/types";
import { StateManager } from "./lib/state-manager";
import { createProvider } from "./lib/provider";
import { formatConsoleReport, saveJsonReport } from "./utils/reporting";
import { testCategories } from "./tests";

async function main() {
  const app = await Sprinkle.New(SettingsSchema, "./test-plan/.config");

  // If non-interactive mode, skip menu and run all tests
  if (app.settings.nonInteractive) {
    console.log("🤖 Running in non-interactive mode...\n");
    await runAllJourneys(app.settings);
    process.exit(0);
  }

  const menu = {
    title: "Midnight Governance Test Suite",
    items: [
      {
        title: "Run All Journeys",
        action: async (sprinkle: Sprinkle<typeof SettingsSchema>) => {
          await runAllJourneys(sprinkle.settings);
        },
      },
      {
        title: "Run By Category",
        items: testCategories.map((category) => ({
          title: category.name,
          action: async (sprinkle: Sprinkle<typeof SettingsSchema>) => {
            await runCategory(category.id, sprinkle.settings);
          },
        })),
      },
      {
        title: "Resume Previous Run",
        action: async (sprinkle: Sprinkle<typeof SettingsSchema>) => {
          console.log("[DEBUG] sprinkle.settings.additionalWallets:", JSON.stringify(sprinkle.settings.additionalWallets));
          await resumeRun(sprinkle.settings);
        },
      },
      {
        title: "View Results",
        items: [
          {
            title: "Show Current Run",
            action: async (sprinkle: Sprinkle<typeof SettingsSchema>) => {
              await showCurrentRun();
            },
          },
          {
            title: "List Past Runs",
            action: async () => {
              await listPastRuns();
            },
          },
        ],
      },
    ],
  };

  await app.showMenu(menu);
}

async function runAllJourneys(settings: Settings) {
  console.log("\nRunning all journeys...\n");

  const stateManager = await StateManager.Load("./test-plan/.config");
  const state = stateManager.getState();
  state.mode = settings.mode;

  // Create provider with test run ID for contract rebuilding
  const provider = createProvider(
    settings.mode,
    settings.wallet,
    settings.blockfrostApiKey,
    state.runId,
    settings
  );

  // Setup provider - this will rebuild contracts on testnet if needed
  await provider.setup();

  // Register well-known signer identities so suggestedSigners works
  // regardless of whether deployment steps run (e.g. on resume).
  // Council auth uses deployer's payment credential; TechAuth uses stake.
  provider.registerSigner("council-auth-0", "deployer", "payment");
  provider.registerSigner("tech-auth-0", "deployer", "stake");

  // Register additional wallets as council member signers
  if (settings.additionalWallets) {
    for (const walletId of Object.keys(settings.additionalWallets)) {
      provider.registerSigner(`council-member-${walletId}`, walletId, "payment");
    }
  }

  const { JourneyRunner } = await import("./lib/journey-runner");
  const journeyRunner = new JourneyRunner(
    provider, state, settings,
    () => stateManager.save(),
  );

  let categoryIndex = 0;
  for (const category of testCategories) {
    console.log(`\n=== ${category.name} ===\n`);

    // Reset state between categories (each category = independent journey)
    if (categoryIndex > 0) {
      console.log("🔄 Resetting state for next journey...\n");
      await provider.reset();
    }
    categoryIndex++;

    for (const journey of category.journeys) {
      try {
        await journeyRunner.executeJourney(journey);
        await stateManager.save();
      } catch (error) {
        console.error(`\n❌ Journey failed: ${error}`);
        await stateManager.save();
        if (!settings.autoProgress) {
          break;
        }
      }
    }
  }

  await provider.cleanup();

  if (settings.outputFormat === "console" || settings.outputFormat === "both") {
    console.log("\n" + formatConsoleReport(state));
  }

  if (settings.saveReports || settings.outputFormat === "json" || settings.outputFormat === "both") {
    await saveJsonReport(state, "./test-plan/.config/reports");
    console.log(`\nReport saved: ./test-plan/.config/reports/report-${state.runId}.json`);
  }
}

async function runCategory(categoryId: string, settings: Settings) {
  const category = testCategories.find((c) => c.id === categoryId);
  if (!category) {
    console.log(`Category not found: ${categoryId}`);
    return;
  }

  console.log(`\nRunning ${category.name}...\n`);

  const stateManager = await StateManager.Load("./test-plan/.config");
  const state = stateManager.getState();
  state.mode = settings.mode;

  const provider = createProvider(
    settings.mode,
    settings.wallet,
    settings.blockfrostApiKey,
    state.runId,
    settings
  );
  await provider.setup();

  provider.registerSigner("council-auth-0", "deployer", "payment");
  provider.registerSigner("tech-auth-0", "deployer", "stake");

  // Register additional wallets as council member signers
  if (settings.additionalWallets) {
    for (const walletId of Object.keys(settings.additionalWallets)) {
      provider.registerSigner(`council-member-${walletId}`, walletId, "payment");
    }
  }

  const { JourneyRunner } = await import("./lib/journey-runner");
  const journeyRunner = new JourneyRunner(
    provider, state, settings,
    () => stateManager.save(),
  );

  for (const journey of category.journeys) {
    try {
      await journeyRunner.executeJourney(journey);
      await stateManager.save();
    } catch (error) {
      console.error(`\n❌ Journey failed: ${error}`);
      await stateManager.save();
      if (!settings.autoProgress) {
        break;
      }
    }
  }

  await provider.cleanup();

  if (settings.outputFormat === "console" || settings.outputFormat === "both") {
    console.log("\n" + formatConsoleReport(state));
  }
}

async function resumeRun(settings: Settings) {
  const { select } = await import("@inquirer/prompts");

  // Find runs that have incomplete/failed journeys
  const runs = await StateManager.listRuns("./test-plan/.config");
  if (runs.length === 0) {
    console.log("\nNo previous runs found.");
    return;
  }

  const resumableRuns: { name: string; value: string | null }[] = [];

  for (const runId of runs) {
    try {
      const sm = await StateManager.Load("./test-plan/.config", runId);
      const state = sm.getState();
      const journeys = Object.values(state.journeys);

      // A run is resumable if it has at least one journey that either:
      // - has a failed step, or
      // - was never completed (no completedAt)
      const hasIncomplete = journeys.some((j) => !j.completedAt);
      const hasFailed = journeys.some((j) =>
        j.testResults.some((r) => r.status === "failed")
      );
      // Also resumable if not all categories have been started
      const allCategoriesStarted = testCategories.every((cat) =>
        cat.journeys.every((j) => state.journeys[j.id])
      );

      if (hasIncomplete || hasFailed || !allCategoriesStarted) {
        const passed = journeys.reduce(
          (sum, j) => sum + j.testResults.filter((r) => r.status === "passed").length, 0
        );
        const failed = journeys.reduce(
          (sum, j) => sum + j.testResults.filter((r) => r.status === "failed").length, 0
        );
        const stepsRun = journeys.reduce((sum, j) => sum + j.testResults.length, 0);

        let status = "";
        if (hasFailed) status = "FAILED";
        else if (hasIncomplete) status = "INCOMPLETE";
        else status = "PARTIAL";

        resumableRuns.push({
          name: `${runId} (${state.mode}) [${status}] - ${passed} passed, ${failed} failed, ${stepsRun} steps run`,
          value: runId,
        });
      }
    } catch {
      // Skip runs that can't be loaded
    }
  }

  if (resumableRuns.length === 0) {
    console.log("\nNo resumable runs found. All previous runs completed successfully.");
    return;
  }

  resumableRuns.push({ name: "← Back", value: null });

  const selectedRunId = await select({
    message: "Select a run to resume:",
    choices: resumableRuns,
  });

  if (!selectedRunId) return;

  console.log(`\nResuming run: ${selectedRunId}\n`);

  // Load the previous state
  const stateManager = await StateManager.Load("./test-plan/.config", selectedRunId);
  const state = stateManager.getState();

  // Create provider in resume mode — skips contract rebuild, reuses existing blueprint
  const provider = createProvider(
    settings.mode,
    settings.wallet,
    settings.blockfrostApiKey,
    state.runId,
    settings,
    true, // resume
  );
  await provider.setup();

  // Register well-known signer identities (deployment steps are skipped on
  // resume, so these must be registered eagerly).
  provider.registerSigner("council-auth-0", "deployer", "payment");
  provider.registerSigner("tech-auth-0", "deployer", "stake");

  // Register additional wallets as council member signers
  if (settings.additionalWallets) {
    for (const walletId of Object.keys(settings.additionalWallets)) {
      provider.registerSigner(`council-member-${walletId}`, walletId, "payment");
    }
  }

  const { JourneyRunner } = await import("./lib/journey-runner");
  const journeyRunner = new JourneyRunner(
    provider, state, settings,
    () => stateManager.save(),
  );

  // Walk through all categories/journeys and resume from where we left off.
  // Only resume journeys that had progress (some passed steps); skip journeys
  // that failed on their first step (e.g. one-shot UTxOs already consumed).
  let aborted = false;
  for (const category of testCategories) {
    if (aborted) break;

    for (const journey of category.journeys) {
      if (aborted) break;

      const journeyState: JourneyState | undefined = state.journeys[journey.id];

      if (journeyState?.completedAt) {
        console.log(`\n⏭  Skipping completed journey: ${journey.name}`);
        continue;
      }

      // Count how many steps passed in the previous attempt
      const passedSteps = journeyState
        ? journeyState.testResults.filter(
            (r) => r.status === "passed" || r.status === "todo" || r.status === "skipped"
          ).length
        : 0;

      // Skip journeys that never made progress (failed at step 0) —
      // they likely need fresh one-shot UTxOs and a new build
      if (journeyState && passedSteps === 0) {
        console.log(`\n⏭  Skipping journey with no progress: ${journey.name}`);
        continue;
      }

      // Skip journeys that were never started in the previous run
      if (!journeyState) {
        console.log(`\n⏭  Skipping unstarted journey: ${journey.name}`);
        continue;
      }

      console.log(`\n=== ${category.name} ===`);
      console.log(`  Resuming from step ${passedSteps + 1}/${journey.steps.length}`);

      try {
        await journeyRunner.executeJourney(journey, passedSteps);
        await stateManager.save();
      } catch (error) {
        console.error(`\n❌ Journey failed: ${error}`);
        await stateManager.save();
        aborted = true;
      }
    }
  }

  await provider.cleanup();

  if (settings.outputFormat === "console" || settings.outputFormat === "both") {
    console.log("\n" + formatConsoleReport(state));
  }

  if (settings.saveReports || settings.outputFormat === "json" || settings.outputFormat === "both") {
    await saveJsonReport(state, "./test-plan/.config/reports");
    console.log(`\nReport saved: ./test-plan/.config/reports/report-${state.runId}.json`);
  }
}

async function showCurrentRun() {
  const stateManager = await StateManager.Load("./test-plan/.config");
  const state = stateManager.getState();
  console.log("\n" + formatConsoleReport(state));
}

async function listPastRuns() {
  const { select } = await import("@inquirer/prompts");
  const runs = await StateManager.listRuns("./test-plan/.config");

  if (runs.length === 0) {
    console.log("\nNo past test runs found.");
    return;
  }

  const choices = await Promise.all(
    runs.map(async (run) => {
      try {
        const stateManager = await StateManager.Load("./test-plan/.config", run);
        const state = stateManager.getState();
        const passed = state.testResults.filter((r) => r.status === "passed").length;
        const failed = state.testResults.filter((r) => r.status === "failed").length;
        const total = state.testResults.length;

        return {
          name: `${run} (${state.mode}) - ${passed}/${total} passed, ${failed} failed`,
          value: run,
        };
      } catch {
        return {
          name: `${run} (error loading)`,
          value: run,
        };
      }
    })
  );

  choices.push({ name: "← Back", value: null });

  const selected = await select({
    message: "Select a test run to view:",
    choices,
  });

  if (selected) {
    const stateManager = await StateManager.Load("./test-plan/.config", selected);
    const state = stateManager.getState();
    console.log("\n" + formatConsoleReport(state));
  }
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
