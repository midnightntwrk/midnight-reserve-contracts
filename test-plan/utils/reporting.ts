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

  const total = state.testResults.length;
  const passed = state.testResults.filter((r) => r.status === "passed").length;
  const failed = state.testResults.filter((r) => r.status === "failed").length;
  const running = state.testResults.filter((r) => r.status === "running").length;
  const pending = state.testResults.filter((r) => r.status === "pending").length;

  lines.push("Summary:");
  lines.push(`  Total: ${total}`);
  lines.push(`  Passed: ${passed}`);
  lines.push(`  Failed: ${failed}`);
  lines.push(`  Running: ${running}`);
  lines.push(`  Pending: ${pending}`);
  lines.push("");

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
  await writeFile(reportPath, JSON.stringify(state, null, 2));
}

export function printTestResult(result: TestResult): void {
  console.log(`\n[${result.status.toUpperCase()}] ${result.name}`);

  if (result.txHash) {
    console.log(`  Tx: ${result.txHash}`);
  }

  if (result.error) {
    console.error(`  Error: ${result.error}`);
  }

  if (result.notes) {
    console.log(`  ${result.notes}`);
  }
}

export function printTestHeader(testName: string): void {
  console.log("\n" + "-".repeat(60));
  console.log(testName);
  console.log("-".repeat(60));
}
