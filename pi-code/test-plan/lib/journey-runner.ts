import type {
  JourneyDefinition,
  JourneyContext,
  JourneyState,
  TestRunState,
  TestResult,
  Settings,
} from "./types";
import type { TestProvider } from "./provider";

export class JourneyRunner {
  private onSave?: () => Promise<void>;

  constructor(
    private provider: TestProvider,
    private state: TestRunState,
    private settings: Settings,
    onSave?: () => Promise<void>,
  ) {
    this.onSave = onSave;
  }

  /**
   * Execute a journey, optionally resuming from a saved checkpoint
   */
  async executeJourney(
    journey: JourneyDefinition,
    resumeFrom?: number
  ): Promise<void> {
    // Initialize or resume journey state
    let journeyState: JourneyState;

    if (this.state.journeys[journey.id] && resumeFrom !== undefined) {
      journeyState = this.state.journeys[journey.id];
      console.log(`\n📍 Resuming journey '${journey.name}' from step ${resumeFrom}`);
    } else {
      journeyState = {
        journeyId: journey.id,
        name: journey.name,
        startedAt: new Date(),
        currentStep: 0,
        deployments: {},
        testResults: [],
        metadata: {},
      };
      this.state.journeys[journey.id] = journeyState;
      console.log(`\n🚀 Starting journey: ${journey.name}`);
      console.log(`   ${journey.description}\n`);
    }

    this.state.currentJourney = journey.id;
    const startStep = resumeFrom ?? 0;

    // Execute each step
    for (let i = startStep; i < journey.steps.length; i++) {
      const step = journey.steps[i];
      journeyState.currentStep = i;

      console.log(`\n[${ i + 1}/${journey.steps.length}] ${step.name}`);
      console.log(`   ${step.description}\n`);

      const ctx: JourneyContext = {
        provider: this.provider,
        state: this.state,
        journeyState,
        settings: this.settings,
      };

      try {
        const result = await step.execute(ctx);
        journeyState.testResults.push(result);

        // Handle TODO status - skip validation
        if (result.status === "todo") {
          console.log(`📝 TODO: ${result.notes || "Not yet implemented"}\n`);
        }
        // Handle skipped status - show as warning
        else if (result.status === "skipped") {
          console.log(`⚠️  SKIPPED: ${result.notes || "Test skipped"}\n`);
        }
        // Validate result - test should pass (whether testing positive or negative behavior)
        else if (result.status === "failed") {
          console.error(`❌ Test failed!`);
          if (result.error) {
            console.error(`   Error: ${result.error}`);
          }
          throw new Error(`Journey step '${step.name}' failed`);
        }
        else if (result.status === "passed") {
          console.log(`✅ Passed\n`);
        }

      } catch (error) {
        console.error(`\n❌ Journey step '${step.name}' threw an exception`);
        console.error(`Error details:`, error);
        if (error instanceof Error && error.stack) {
          console.error(`Stack trace:`, error.stack);
        }
        await this.saveState();
        throw error;
      }

      // Save state after each step for resumability
      await this.saveState();
    }

    journeyState.completedAt = new Date();
    console.log(`\n✅ Journey '${journey.name}' completed successfully!\n`);
  }

  /**
   * Save current state to disk
   */
  private async saveState(): Promise<void> {
    if (this.onSave) {
      await this.onSave();
    }
  }

  /**
   * Helper to get a deployment from the current journey or fallback to run state
   */
  getDeployment(journeyState: JourneyState, name: string) {
    return journeyState.deployments[name] ?? this.state.deployments[name];
  }

  /**
   * Helper to store a deployment in the journey state
   */
  storeDeployment(
    journeyState: JourneyState,
    name: string,
    deployment: any
  ): void {
    journeyState.deployments[name] = deployment;
  }
}
