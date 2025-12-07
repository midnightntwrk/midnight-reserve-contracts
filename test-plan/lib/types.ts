import { Type, Static } from "@sinclair/typebox";
import type { TransactionUnspentOutput } from "@blaze-cardano/core";
import type { TestProvider } from "./provider";

export const TestModeSchema = Type.Union([
  Type.Literal("emulator"),
  Type.Literal("testnet"),
  Type.Literal("mainnet"),
]);
export type TestMode = Static<typeof TestModeSchema>;

export type TestStatus = "pending" | "running" | "passed" | "failed" | "skipped";

export interface TestResult {
  testId: string;
  name: string;
  status: TestStatus;
  startTime?: Date;
  endTime?: Date;
  error?: string;
  txHash?: string;
  notes?: string;
}

export interface DeploymentInfo {
  componentName: string;
  txHash: string;
  outputIndex: number;
  utxo?: TransactionUnspentOutput;
  scriptHash?: string;
  policyId?: string;
  assetName?: string;
  datum?: string;
}

export interface TestRunState {
  runId: string;
  mode: TestMode;
  startTime: Date;
  currentTest?: string;
  deployments: Record<string, DeploymentInfo>;
  testResults: TestResult[];
  metadata: Record<string, any>;
}

export const SettingsSchema = Type.Object({
  mode: TestModeSchema,
  autoProgress: Type.Boolean({
    title: "Auto-progress through tests",
    default: false,
  }),
  outputFormat: Type.Union([
    Type.Literal("console"),
    Type.Literal("json"),
    Type.Literal("both"),
  ], { title: "Output format", default: "console" }),
  saveReports: Type.Boolean({
    title: "Save test reports",
    default: true,
  }),
});
export type Settings = Static<typeof SettingsSchema>;

export interface TestContext {
  provider: TestProvider;
  state: TestRunState;
}

export interface TestDefinition {
  id: string;
  name: string;
  description: string;
  prerequisites?: string[];
  execute: (ctx: TestContext) => Promise<TestResult>;
}

export interface TestCategory {
  id: string;
  name: string;
  description: string;
  tests: TestDefinition[];
}
