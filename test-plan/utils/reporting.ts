import type { TestResult, TestRunState } from "../lib/types";
import { writeFile } from "fs/promises";
import { join } from "path";

export function formatConsoleReport(state: TestRunState): string {
  const lines: string[] = [];

  lines.push("=".repeat(60));
  lines.push(`Test Run: ${state.runId}`);
  lines.push(`Mode: ${state.mode}`);
  lines.push(`Started: ${state.startTime.toISOString()}`);
  lines.push("=".repeat(60));
  lines.push("");

  // Count individual tests
  const testTotal = state.testResults.length;
  const testPassed = state.testResults.filter((r) => r.status === "passed").length;
  const testFailed = state.testResults.filter((r) => r.status === "failed").length;
  const testRunning = state.testResults.filter((r) => r.status === "running").length;
  const testPending = state.testResults.filter((r) => r.status === "pending").length;

  // Count journeys
  const journeys = Object.values(state.journeys);
  const journeyTotal = journeys.length;
  const journeyPassed = journeys.filter((j) => j.completedAt !== undefined).length;
  const journeyFailed = journeys.filter((j) =>
    j.testResults.some((r) => r.status === "failed")
  ).length;

  lines.push("Summary:");
  lines.push(`  Journeys: ${journeyPassed}/${journeyTotal} completed`);
  lines.push(`  Tests: ${testPassed}/${testTotal} passed, ${testFailed} failed`);
  lines.push("");

  // Show journey results
  if (journeys.length > 0) {
    lines.push("Journey Results:");
    lines.push("");

    for (const journey of journeys) {
      const status = journey.completedAt ? "✓ COMPLETED" : "○ IN PROGRESS";
      const duration = journey.completedAt && journey.startedAt
        ? `${journey.completedAt.getTime() - journey.startedAt.getTime()}ms`
        : "";

      lines.push(`  [${status}] ${journey.name}`);
      if (duration) {
        lines.push(`    Duration: ${duration}`);
      }
      lines.push(`    Steps: ${journey.testResults.length}/${journey.currentStep + 1}`);

      const passed = journey.testResults.filter(r => r.status === "passed").length;
      const failed = journey.testResults.filter(r => r.status === "failed").length;
      const todo = journey.testResults.filter(r => r.status === "todo").length;
      const skipped = journey.testResults.filter(r => r.status === "skipped").length;

      lines.push(`    Passed: ${passed}, Failed: ${failed}, TODO: ${todo}, Skipped: ${skipped}`);
      lines.push("");
    }
  }

  if (state.testResults.length > 0) {
    lines.push("Test Results:");
    lines.push("");

    for (const result of state.testResults) {
      lines.push(`  [${result.status.toUpperCase()}] ${result.name}`);

      if (result.txHash) {
        lines.push(`    Tx: ${result.txHash}`);
      }

      if (result.error) {
        lines.push(`    Error: ${result.error}`);
      }

      if (result.startTime && result.endTime) {
        const duration = result.endTime.getTime() - result.startTime.getTime();
        lines.push(`    Duration: ${duration}ms`);
      }

      if (result.notes) {
        lines.push(`    Notes: ${result.notes}`);
      }

      lines.push("");
    }
  }

  const deploymentCount = Object.keys(state.deployments).length;
  if (deploymentCount > 0) {
    lines.push("Deployments:");
    lines.push("");

    for (const [name, deployment] of Object.entries(state.deployments)) {
      lines.push(`  ${name}`);
      lines.push(`    Tx: ${deployment.txHash}#${deployment.outputIndex}`);
      if (deployment.scriptHash) {
        lines.push(`    Script: ${deployment.scriptHash}`);
      }
      if (deployment.policyId) {
        lines.push(`    Policy: ${deployment.policyId}`);
      }
      lines.push("");
    }
  }

  lines.push("=".repeat(60));

  return lines.join("\n");
}

export async function saveJsonReport(
  state: TestRunState,
  outputPath: string
): Promise<void> {
  const { mkdir } = await import("fs/promises");
  const { existsSync } = await import("fs");

  if (!existsSync(outputPath)) {
    await mkdir(outputPath, { recursive: true });
  }

  const reportPath = join(outputPath, `report-${state.runId}.json`);

  // Custom replacer to handle BigInt values
  const replacer = (_key: string, value: any) => {
    if (typeof value === "bigint") {
      return value.toString() + "n"; // Add 'n' suffix to indicate it was a BigInt
    }
    return value;
  };

  await writeFile(reportPath, JSON.stringify(state, replacer, 2));
}

export function printTestResult(result: TestResult): void {
  const statusEmoji = result.status === "passed" ? "✓" : result.status === "failed" ? "✗" : "○";
  console.log(`${statusEmoji} ${result.name}`);

  if (result.error) {
    console.error(`  Error: ${result.error}`);
  }

  if (result.notes && result.status === "passed") {
    console.log(`  ${result.notes}`);
  }
}

export function printTestHeader(testName: string): void {
  console.log("\n" + "-".repeat(60));
  console.log(testName);
  console.log("-".repeat(60));
}
