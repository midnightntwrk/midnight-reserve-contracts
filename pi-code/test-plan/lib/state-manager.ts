import { writeFile, readFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import type { TestRunState, TestResult, DeploymentInfo } from "./types";

/**
 * Manages test run state persistence
 */
export class StateManager {
  private statePath: string;
  private state: TestRunState;

  constructor(storagePath: string, state: TestRunState) {
    this.statePath = join(storagePath, "test-runs");
    this.state = state;
  }

  /**
   * Load or create a new test run state
   */
  static async Load(storagePath: string, runId?: string): Promise<StateManager> {
    const statePath = join(storagePath, "test-runs");

    // Ensure directory exists
    if (!existsSync(statePath)) {
      await mkdir(statePath, { recursive: true });
    }

    if (runId) {
      // Load existing run
      const filePath = join(statePath, `${runId}.json`);
      if (existsSync(filePath)) {
        const content = await readFile(filePath, "utf-8");
        const state = JSON.parse(content, (key, value) => {
          // Revive Date objects
          if (key === "startTime" || key === "endTime" || key === "startedAt" || key === "completedAt") {
            return value ? new Date(value) : undefined;
          }
          return value;
        });
        return new StateManager(storagePath, state);
      }
    }

    // Create new run with human-readable timestamp
    const now = new Date();
    const timestamp = now.toISOString()
      .replace(/T/, '_')
      .replace(/:/g, '-')
      .replace(/\..+/, '');

    const newState: TestRunState = {
      runId: runId || timestamp,
      mode: "emulator",
      startTime: now,
      journeys: {},
      deployments: {},
      testResults: [],
      metadata: {},
    };

    return new StateManager(storagePath, newState);
  }

  /**
   * Save current state to disk
   */
  async save(): Promise<void> {
    const filePath = join(this.statePath, `${this.state.runId}.json`);

    // Custom replacer to handle BigInt values
    const replacer = (_key: string, value: any) => {
      if (typeof value === "bigint") {
        return value.toString() + "n"; // Add 'n' suffix to indicate it was a BigInt
      }
      return value;
    };

    await writeFile(filePath, JSON.stringify(this.state, replacer, 2));
  }

  /**
   * Get the current state
   */
  getState(): TestRunState {
    return this.state;
  }

  /**
   * Update deployment info
   */
  async updateDeployment(name: string, info: DeploymentInfo): Promise<void> {
    this.state.deployments[name] = info;
    await this.save();
  }

  /**
   * Record test result
   */
  async recordTestResult(result: TestResult): Promise<void> {
    // Remove existing result for this test if any
    this.state.testResults = this.state.testResults.filter(
      (r) => r.testId !== result.testId
    );
    this.state.testResults.push(result);
    await this.save();
  }

  /**
   * Set current test
   */
  async setCurrentTest(testId: string): Promise<void> {
    this.state.currentTest = testId;
    await this.save();
  }

  /**
   * Get deployment by name
   */
  getDeployment(name: string): DeploymentInfo | undefined {
    return this.state.deployments[name];
  }

  /**
   * Get test result by ID
   */
  getTestResult(testId: string): TestResult | undefined {
    return this.state.testResults.find((r) => r.testId === testId);
  }

  /**
   * Check if test has passed
   */
  hasTestPassed(testId: string): boolean {
    const result = this.getTestResult(testId);
    return result?.status === "passed";
  }

  /**
   * List all test runs sorted by date (newest first)
   */
  static async listRuns(storagePath: string): Promise<string[]> {
    const statePath = join(storagePath, "test-runs");
    if (!existsSync(statePath)) {
      return [];
    }

    const { readdir } = await import("fs/promises");
    const files = await readdir(statePath);
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(".json", ""))
      .sort((a, b) => b.localeCompare(a)); // Sort descending (newest first)
  }
}
