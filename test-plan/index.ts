#!/usr/bin/env bun

import { Sprinkle } from "@sundaeswap/sprinkles";
import { select } from "@inquirer/prompts";
import { SettingsSchema, type Settings, type TestContext } from "./lib/types";
import { StateManager } from "./lib/state-manager";
import { createProvider } from "./lib/provider";
import { formatConsoleReport, saveJsonReport } from "./utils/reporting";
import { testCategories } from "./tests";

async function main() {
  const app = await Sprinkle.New(SettingsSchema, "./test-plan/.config");

  // If non-interactive mode, skip menu and run all tests
  if (app.settings.nonInteractive) {
    console.log("🤖 Running in non-interactive mode...\n");
    await runAllTests(app.settings);
    process.exit(0);
  }

  const menu = {
    title: "Midnight Governance Test Suite",
    items: [
      {
        title: "Run Tests",
        items: [
          {
            title: "Run All Tests",
            action: async (sprinkle: Sprinkle<typeof SettingsSchema>) => {
              await runAllTests(sprinkle.settings);
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
            title: "Run Single Test",
            action: async (sprinkle: Sprinkle<typeof SettingsSchema>) => {
              await runSingleTest(sprinkle.settings);
            },
          },
        ],
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

async function runAllTests(settings: Settings) {
  console.log("\nRunning all tests...\n");

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

  const ctx: TestContext = { provider, state, settings };

  let categoryIndex = 0;
  for (const category of testCategories) {
    console.log(`\n=== ${category.name} ===\n`);

    // Reset emulator state between categories (each category = independent journey)
    if (categoryIndex > 0) {
      console.log("🔄 Resetting emulator state for next journey...\n");
      await provider.reset();
    }
    categoryIndex++;

    // Run journeys first
    if (category.journeys && category.journeys.length > 0) {
      const { JourneyRunner } = await import("./lib/journey-runner");
      const journeyRunner = new JourneyRunner(provider, state, settings);

      for (const journey of category.journeys) {
        try {
          await journeyRunner.executeJourney(journey);
          await stateManager.save();
        } catch (error) {
          console.error(`\n❌ Journey failed: ${error}`);
          if (!settings.autoProgress) {
            break;
          }
        }
      }
    }

    // Then run individual tests
    for (const test of category.tests) {
      if (test.prerequisites) {
        const allPassed = test.prerequisites.every((prereq) =>
          stateManager.hasTestPassed(prereq)
        );
        if (!allPassed) {
          console.log(`[SKIPPED] ${test.name} (prerequisites not met)`);
          continue;
        }
      }

      await stateManager.setCurrentTest(test.id);
      const result = await test.execute(ctx);
      await stateManager.recordTestResult(result);

      if (result.status === "failed" && !settings.autoProgress) {
        console.log("\nTest failed. Continue? (y/n)");
        break;
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

  const ctx: TestContext = { provider, state, settings };

  for (const test of category.tests) {
    await stateManager.setCurrentTest(test.id);
    const result = await test.execute(ctx);
    await stateManager.recordTestResult(result);

    if (result.status === "failed" && !settings.autoProgress) {
      break;
    }
  }

  await provider.cleanup();

  if (settings.outputFormat === "console" || settings.outputFormat === "both") {
    console.log("\n" + formatConsoleReport(state));
  }
}

async function runSingleTest(settings: Settings) {
  const allTests = testCategories.flatMap((c) => c.tests);

  const choices = allTests.map((test) => ({
    name: test.name,
    value: test,
  }));
  choices.push({ name: "← Back", value: null });

  const selectedTest = await select({
    message: "Select a test to run:",
    choices,
  });

  if (!selectedTest) {
    return;
  }

  console.log(`\nRunning test: ${selectedTest.name}\n`);

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

  const ctx: TestContext = { provider, state, settings };

  if (selectedTest.prerequisites) {
    const allPassed = selectedTest.prerequisites.every((prereq) =>
      stateManager.hasTestPassed(prereq)
    );
    if (!allPassed) {
      console.log(`[SKIPPED] ${selectedTest.name} (prerequisites not met)`);
      console.log(`Required: ${selectedTest.prerequisites.join(", ")}`);
      await provider.cleanup();
      return;
    }
  }

  await stateManager.setCurrentTest(selectedTest.id);
  const result = await selectedTest.execute(ctx);
  await stateManager.recordTestResult(result);

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
