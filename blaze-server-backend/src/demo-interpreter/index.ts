/**
 * Demo Flow Interpreter - Main Entry Point
 * 
 * Provides a simple interface for loading and executing demo flows
 */

export { DemoFlowParser } from './core/DemoFlowParser';
export { DemoFlowExecutor } from './core/DemoFlowExecutor';
export { VariableResolver } from './core/VariableResolver';
export { StateMonitor } from './core/StateMonitor';
export { HttpClient } from './core/HttpClient';

// JavaScript Demo Executor (with scope persistence)
export { JavaScriptDemoExecutor, executeJavaScriptDemo } from './core/JavaScriptDemoExecutor';
export type { JavaScriptDemo, JavaScriptDemoStanza, DemoExecutionResult } from './core/JavaScriptDemoExecutor';

// Integrated Demo Executor (core scope management)
export { IntegratedDemoExecutor } from './core/IntegratedDemoExecutor';

// Export types
export * from './types/DemoFlow';

import { DemoFlowParser } from './core/DemoFlowParser';
import { DemoFlowExecutor } from './core/DemoFlowExecutor';
import { DemoFlow, StepResult } from './types/DemoFlow';

/**
 * Convenience function to execute a demo flow from JSON string
 */
export async function executeDemo(jsonContent: string): Promise<StepResult[]> {
  const parser = new DemoFlowParser();
  const demoFlow = parser.parseYaml(jsonContent); // Using JSON for now
  
  const executor = new DemoFlowExecutor(demoFlow);
  return executor.execute(demoFlow);
}

/**
 * Convenience function to execute a demo flow from parsed object
 */
export async function executeDemoFlow(demoFlow: DemoFlow): Promise<StepResult[]> {
  const executor = new DemoFlowExecutor(demoFlow);
  return executor.execute(demoFlow);
}