const { DryRuntime } = require("../monadic/dry-runtime.js");
const { MonadicRuntime } = require("../monadic/runtime.js");
const { ScopeManager } = require("./ScopeManager.js");
const { createWallet, getBalance, transfer, deployContract, contractAction, getContractState, advanceTime, watchBalance, watchContractState, watchWalletUtxos, watchCustom, watch } = require("../monadic/functions.js");

export interface ExecutionResult {
  result: any;
  operationType: string;
  isPartial: boolean;
  consoleOutput?: string[];
  watchResults?: Record<string, any>;
}

// Reusable utility for executing demo scripts with scope persistence and operation detection
export class IntegratedDemoExecutor {
  private scopeManager: any;
  private dryRuntime: any;
  private realRuntime: any;
  private codeBlocks: string[] = []; // Store all code blocks for two-pass processing
  private rewrittenBlocks: string[] = []; // Store rewritten code blocks (computed once)

  constructor(baseUrl: string = 'http://localhost:3031') {
    // Initialize scope manager with monadic functions
    const monadicFunctions = {
      createWallet,
      getBalance,
      transfer,
      deployContract,
      contractAction,
      getContractState,
      advanceTime,
      watchBalance,
      watchContractState,
      watchWalletUtxos,
      watchCustom,
      watch
    };
    this.scopeManager = new ScopeManager(monadicFunctions);
    this.dryRuntime = new DryRuntime({ baseUrl });
    this.realRuntime = new MonadicRuntime({ baseUrl });
  }
  
  async initialize(): Promise<void> {
    await this.realRuntime.initialize();
  }
  
  // Set all code blocks upfront and do rewrite once
  setCodeBlocks(codeBlocks: string[]): void {
    this.codeBlocks = codeBlocks;
    // Do the rewrite (phases 1 and 2) exactly once
    this.rewrittenBlocks = this.scopeManager.processCodeBlocks(this.codeBlocks);
  }
  
  async cleanup(): Promise<void> {
    await this.realRuntime.cleanup();
  }
  
  // Execute a single code block without affecting the global code blocks array
  async executeSingleCodeBlock(codeContent: string): Promise<any> {
    // Set up global runtime for monadic functions
    (global as any).__demoRuntime = this.realRuntime;
    
    try {
      // Process this single code block
      const rewrittenCode = this.scopeManager.processCodeBlocks([codeContent])[0];
      
      // Execute the rewritten code with the scope
      const asyncFunction = new Function('scope', `
        return (async (scope) => {
          ${rewrittenCode}
        })(scope);
      `);
      
      const result = await asyncFunction(this.scopeManager.getScope());
      
      return { result, operationType: 'unknown', isPartial: false };
    } finally {
      delete (global as any).__demoRuntime;
    }
  }

  // Execute a code block with proper scope management
  async executeCodeBlock(blockIndex: number): Promise<any> {
    // Set up global runtime for monadic functions
    (global as any).__demoRuntime = this.realRuntime;
    
    // Capture console.log output
    const capturedOutput: string[] = [];
    const originalConsoleLog = console.log;
    console.log = (...args: any[]) => {
      capturedOutput.push(args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' '));
      originalConsoleLog(...args); // Still log to server console
    };
    
    try {
      // Get the pre-rewritten code for this block
      const rewrittenCode = this.rewrittenBlocks[blockIndex];
      
      // Execute the rewritten code with the scope
      const asyncFunction = new Function('scope', `
        return (async (scope) => {
          ${rewrittenCode}
        })(scope);
      `);
      
      const result = await asyncFunction(this.scopeManager.getScope());
      
      return { 
        result, 
        operationType: 'unknown', 
        isPartial: false,
        consoleOutput: capturedOutput
      };
    } finally {
      // Restore original console.log
      console.log = originalConsoleLog;
      delete (global as any).__demoRuntime;
    }
  }
  
  // Execute a stanza and maintain scope
  async executeStanza(blockIndex: number): Promise<ExecutionResult> {
    // STEP 1: Dry Runtime Analysis (with cloned scope)
    const dryRuntime = new DryRuntime({ baseUrl: this.dryRuntime.baseUrl });
    await dryRuntime.initialize();
    
    // Get a fresh clone of the current main scope for dry run
    const currentScope = this.scopeManager.getScope();
    const clonedScope = { ...currentScope };
    // Deep clone the values while preserving functions
    for (const [key, value] of Object.entries(currentScope)) {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        clonedScope[key] = { ...value };
      } else if (Array.isArray(value)) {
        clonedScope[key] = [...value];
      } else {
        clonedScope[key] = value;
      }
    }
    
    // Debug: Check what's in the current scope before cloning
    console.log('Current scope before dry run:', Object.keys(currentScope));
    console.log('Current scope values:', Object.entries(currentScope).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`));
    console.log('Cloned scope for dry run:', Object.keys(clonedScope));
    console.log('Cloned scope values:', Object.entries(clonedScope).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`));
    
    // Override fetch to use dry runtime for operation detection
    const originalFetch = (globalThis as any).fetch;
    (globalThis as any).fetch = (url: string, options?: any) => dryRuntime.fetch(url, options);
    
    // Save original console methods and suppress output during dry run
    const originalConsole = { ...console };
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};
    console.info = () => {};
    console.debug = () => {};
    
    // Set up global runtime for monadic functions
    (global as any).__demoRuntime = dryRuntime;
    
    let operationType = 'unknown';
    try {
      // Execute in the cloned scope for analysis
      await this.executeCodeBlockWithScope(blockIndex, clonedScope);
      
      // Get operation type from dry runtime
      operationType = dryRuntime.getOperationType();
    } catch (error) {
      // Record the error in the dry runtime
      dryRuntime.recordError(error as Error);
      
      // Still get the operation type based on what we recorded before the error
      operationType = dryRuntime.getOperationType();
      
      console.log(`⚠️  Dry run encountered error: ${(error as Error).message}`);
      console.log(`   Operation type detected before error: ${operationType}`);
    } finally {
      // Restore original fetch and console methods
      (globalThis as any).fetch = originalFetch;
      Object.assign(console, originalConsole);
      delete (global as any).__demoRuntime;
      await dryRuntime.cleanup();
    }
    
    // STEP 2: Real Execution (with persistent scope)
    // Use the real runtime for actual execution against the test server
    (global as any).__demoRuntime = this.realRuntime;
    
    try {
      // Execute in the real persistent scope
      const result = await this.executeCodeBlock(blockIndex);
      
      // Execute all active watchers after successful code execution
      console.log('[IntegratedDemoExecutor] About to execute watchers after code block');
      try {
        console.log('[IntegratedDemoExecutor] Calling executeAllWatchers()');
        await this.realRuntime.executeAllWatchers();
        console.log('[IntegratedDemoExecutor] Getting watch results');
        const watchResults = this.realRuntime.getWatchResults();
        console.log('[IntegratedDemoExecutor] Watch results:', watchResults);
        
        return { 
          result, 
          operationType, 
          isPartial: dryRuntime.hasPartialExecution(),
          watchResults: watchResults && Object.keys(watchResults).length > 0 ? watchResults : undefined
        };
      } catch (watchError) {
        console.error('[IntegratedDemoExecutor] Watcher execution failed:', watchError);
        result.watchError = (watchError as Error).message;
      }
      
      return { result, operationType, isPartial: dryRuntime.hasPartialExecution() };
    } finally {
      delete (global as any).__demoRuntime;
    }
  }
  
  // Helper method to execute with a specific scope (for dry run)
  async executeCodeBlockWithScope(blockIndex: number, scope: Record<string, any>): Promise<any> {
    // Get the pre-rewritten code for this block
    const rewrittenCode = this.rewrittenBlocks[blockIndex];
    
    // Execute the rewritten code with the provided scope
    const asyncFunction = new Function('scope', `
      return (async (scope) => {
        ${rewrittenCode}
      })(scope);
    `);
    
    return await asyncFunction(scope);
  }
  
  // Execute all watchers and return their results
  async executeAllWatchers(): Promise<void> {
    await this.realRuntime.executeAllWatchers();
  }

  // Get watch results from the runtime
  getWatchResults(): Record<string, any> {
    return this.realRuntime.getWatchResults();
  }

  // Get current scope for inspection
  getScope(): Record<string, any> {
    return { ...this.scopeManager.getScope() };
  }
  
  // Reset scope for testing
  resetScope(): void {
    this.scopeManager.resetScope();
    this.dryRuntime = new DryRuntime({ baseUrl: this.dryRuntime.baseUrl });
  }
}
