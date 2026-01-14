import { Type, Static } from "@sinclair/typebox";
import type { TransactionUnspentOutput } from "@blaze-cardano/core";
import type { TestProvider } from "./provider";

export const TestModeSchema = Type.Union([
  Type.Literal("emulator"),
  Type.Literal("testnet"),
  Type.Literal("mainnet"),
]);
export type TestMode = Static<typeof TestModeSchema>;

export type TestStatus = "pending" | "running" | "passed" | "failed" | "skipped" | "todo";

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
  metadata?: Record<string, any>;
}

export interface JourneyState {
  journeyId: string;
  name: string;
  startedAt: Date;
  completedAt?: Date;
  currentStep: number;
  deployments: Record<string, DeploymentInfo>;
  testResults: TestResult[];
  metadata: Record<string, any>;
}

export interface TestRunState {
  runId: string;
  mode: TestMode;
  startTime: Date;
  currentTest?: string;
  currentJourney?: string;
  journeys: Record<string, JourneyState>;
  // Legacy - for backward compatibility
  deployments: Record<string, DeploymentInfo>;
  testResults: TestResult[];
  metadata: Record<string, any>;
}

export const WalletConfigSchema = Type.Union([
  Type.Object({
    type: Type.Literal("seed"),
    seedPhrase: Type.String({ title: "Seed phrase (24 words)" }),
  }),
  Type.Object({
    type: Type.Literal("address"),
    address: Type.String({ title: "Wallet address (bech32)" }),
  }),
], { title: "Wallet configuration" });

export type WalletConfig = Static<typeof WalletConfigSchema>;

export const SettingsSchema = Type.Object({
  mode: TestModeSchema,
  wallet: Type.Optional(WalletConfigSchema),
  blockfrostApiKey: Type.Optional(Type.String({ title: "Blockfrost API key" })),
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
  nonInteractive: Type.Boolean({
    title: "Run in non-interactive mode (skip confirmations)",
    default: false,
  }),
  answersFile: Type.Optional(Type.String({
    title: "Path to JSON file with pre-recorded answers for non-interactive mode",
  })),
  recordAnswers: Type.Boolean({
    title: "Record answers to file for later replay",
    default: false,
  }),
});
export type Settings = Static<typeof SettingsSchema>;

export interface TestContext {
  provider: TestProvider;
  state: TestRunState;
  settings: Settings;
}

export interface JourneyContext {
  provider: TestProvider;
  state: TestRunState;
  journeyState: JourneyState;
  settings: Settings;
}

export interface TestDefinition {
  id: string;
  name: string;
  description: string;
  prerequisites?: string[];
  execute: (ctx: TestContext) => Promise<TestResult>;
}

export interface JourneyStep {
  id: string;
  name: string;
  description: string;
  execute: (ctx: JourneyContext) => Promise<TestResult>;
}

export interface JourneyDefinition {
  id: string;
  name: string;
  description: string;
  steps: JourneyStep[];
  // If true, compile contracts once at journey start and reuse for all steps
  reuseContracts?: boolean;
}

export interface TestCategory {
  id: string;
  name: string;
  description: string;
  tests: TestDefinition[];
  journeys?: JourneyDefinition[];
}
