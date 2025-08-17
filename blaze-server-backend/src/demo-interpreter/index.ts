/**
 * Demo Flow Interpreter - Main Entry Point
 * 
 * Provides a simple interface for loading and executing demo flows
 */

// JavaScript Demo Executor (with scope persistence)
export { JavaScriptDemoExecutor, executeJavaScriptDemo } from './core/JavaScriptDemoExecutor';
export type { JavaScriptDemo, JavaScriptDemoStanza, DemoExecutionResult } from './core/JavaScriptDemoExecutor';

// Integrated Demo Executor (core scope management)
export { IntegratedDemoExecutor } from './core/IntegratedDemoExecutor';