import { DemoFlow, DemoStep, StepResult, DemoExecutionContext, StateSnapshot, VariableContext } from '../types/DemoFlow';
import { HttpClient } from './HttpClient';
import { VariableResolver } from './VariableResolver';
import { StateMonitor } from './StateMonitor';
import { DisplayRenderer } from '../display/DisplayRenderer';

/**
 * Demo Flow Executor - Main orchestrator for executing demo flows
 * Handles setup, step execution, and state monitoring
 */
export class DemoFlowExecutor {
  private httpClient: HttpClient;
  private variableResolver: VariableResolver;
  private stateMonitor: StateMonitor;
  private displayRenderer: DisplayRenderer;
  private context: DemoExecutionContext;

  constructor(demoFlow: DemoFlow) {
    this.httpClient = new HttpClient(demoFlow.config.baseUrl);
    this.stateMonitor = new StateMonitor(this.httpClient);
    this.displayRenderer = new DisplayRenderer();
    
    this.context = {
      sessionId: null,
      stepResults: [],
      config: demoFlow.config,
      variables: {}
    };

    const variableContext: VariableContext = {
      r: [],
      config: demoFlow.config
    };
    this.variableResolver = new VariableResolver(variableContext);
  }

  async execute(demoFlow: DemoFlow): Promise<StepResult[]> {
    console.log(`\n=== DEMO FLOW: ${demoFlow.name} ===`);
    console.log(`Description: ${demoFlow.description}`);
    console.log(`Version: ${demoFlow.version}\n`);

    try {
      // Execute setup phase
      await this.executeSetupPhase(demoFlow.setup);

      // Execute main steps
      await this.executeSteps(demoFlow.steps);

      this.displayRenderer.renderExecutionSummary(this.context.stepResults);
      return this.context.stepResults;

    } catch (error) {
      console.error('\n=== DEMO FAILED ===');
      console.error(`Error: ${(error as Error).message}\n`);
      throw error;
    }
  }

  private async executeSetupPhase(setupSteps: DemoStep[]): Promise<void> {
    console.log('--- SETUP PHASE ---');

    // Create session automatically
    if (setupSteps.length > 0) {
      console.log('Creating new session...');
      this.context.sessionId = await this.httpClient.createSession();
      console.log(`Session created: ${this.context.sessionId}\n`);
    }

    // Execute setup steps
    for (let i = 0; i < setupSteps.length; i++) {
      const step = setupSteps[i];
      console.log(`Setup ${i}: ${step.name}`);
      if (step.description) {
        console.log(`  ${step.description}`);
      }

      const result = await this.executeStep(step, i);
      this.context.stepResults.push(result);
      this.updateVariableContext();

      console.log(`  ✓ Completed\n`);
    }
  }

  private async executeSteps(steps: DemoStep[]): Promise<void> {
    console.log('--- DEMO STEPS ---');

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const stepIndex = this.context.stepResults.length;
      
      this.displayRenderer.renderStepHeader(stepIndex, step.name, step.description);

      const result = await this.executeStep(step, stepIndex);
      this.context.stepResults.push(result);
      this.updateVariableContext();

      this.displayRenderer.renderStepSummary(result);
      this.displayRenderer.renderStateComparison(result.beforeState, result.afterState);
    }
  }

  private async executeStep(step: DemoStep, stepIndex: number): Promise<StepResult> {
    const startTime = Date.now();
    
    // Capture before state if monitoring is enabled and session exists
    let beforeState: StateSnapshot = { timestamp: startTime, data: {} };
    if (step.monitor && this.context.sessionId) {
      console.log('Capturing before state...');
      this.stateMonitor.setSessionId(this.context.sessionId);
      const resolvedMonitor = this.variableResolver.resolve(step.monitor);
      beforeState = await this.stateMonitor.queryState(resolvedMonitor);
    }

    // Resolve variables in the request
    const resolvedRequest = this.variableResolver.resolve(step.request);
    
    this.displayRenderer.renderRequestExecution(
      resolvedRequest.method,
      resolvedRequest.endpoint,
      resolvedRequest.body
    );

    // Execute the request
    const response = await this.httpClient.request(resolvedRequest);
    this.displayRenderer.renderResponse(response.statusCode, response.data);

    // Capture after state if monitoring is enabled and session exists
    let afterState: StateSnapshot = { timestamp: Date.now(), data: {} };
    if (step.monitor && this.context.sessionId) {
      console.log('Capturing after state...');
      this.stateMonitor.setSessionId(this.context.sessionId);
      const resolvedMonitor = this.variableResolver.resolve(step.monitor);
      afterState = await this.stateMonitor.queryState(resolvedMonitor);
    }

    const executionTime = Date.now() - startTime;

    return {
      stepName: step.name,
      response: response.data,
      statusCode: response.statusCode,
      beforeState,
      afterState,
      executionTime
    };
  }

  private updateVariableContext(): void {
    const variableContext: VariableContext = {
      r: this.context.stepResults.map(result => result.response),
      config: this.context.config
    };
    this.variableResolver.updateContext(variableContext);
  }


  getContext(): DemoExecutionContext {
    return { ...this.context };
  }
}