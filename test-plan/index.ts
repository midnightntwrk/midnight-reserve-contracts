#!/usr/bin/env bun

import { Sprinkle } from "@sundaeswap/sprinkles";
import { SettingsSchema, type Settings, type TestContext } from "./lib/types";
import { StateManager } from "./lib/state-manager";
import { createProvider } from "./lib/provider";
import { formatConsoleReport, saveJsonReport } from "./utils/reporting";
import { testCategories } from "./tests";

async function main() {
  const app = await Sprinkle.New(SettingsSchema, "./test-plan/.config");

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
              console.log("\nAvailable tests:");
              const allTests = testCategories.flatMap((c) => c.tests);
              allTests.forEach((test, idx) => {
                console.log(`  ${idx + 1}. ${test.name}`);
              });
              console.log("\nUse the menu to select a category instead");
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
      {
        title: "Settings",
        action: async (sprinkle: Sprinkle<typeof SettingsSchema>) => {
          const newSettings = await sprinkle.EditStruct(
            SettingsSchema,
            sprinkle.settings
          );
          sprinkle.settings = newSettings;
          sprinkle.saveSettings();
          console.log("\nSettings updated");
        },
      },
    ],
  };

  await app.showMenu(menu);
}

async function runAllTests(settings: Settings) {
  console.log("\nRunning all tests...\n");

  const provider = createProvider(settings.mode);
  await provider.setup();

  const stateManager = await StateManager.Load("./test-plan/.config");
  const state = stateManager.getState();
  state.mode = settings.mode;

  const ctx: TestContext = { provider, state };

  for (const category of testCategories) {
    console.log(`\n=== ${category.name} ===\n`);

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

  const provider = createProvider(settings.mode);
  await provider.setup();

  const stateManager = await StateManager.Load("./test-plan/.config");
  const state = stateManager.getState();
  state.mode = settings.mode;

  const ctx: TestContext = { provider, state };

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

async function showCurrentRun() {
  const stateManager = await StateManager.Load("./test-plan/.config");
  const state = stateManager.getState();
  console.log("\n" + formatConsoleReport(state));
}

async function listPastRuns() {
  const runs = await StateManager.listRuns("./test-plan/.config");
  console.log("\nPast test runs:");
  runs.forEach((run) => {
    console.log(`  ${run}`);
  });
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
