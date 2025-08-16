const { DryRuntime } = require("../monadic/dry-runtime.js");
const { MonadicRuntime } = require("../monadic/runtime.js");
const { ScopeManager } = require("./ScopeManager.js");
const { createWallet, getBalance, transfer, deployContract, contractAction, getContractState, advanceTime } = require("../monadic/functions.js");

// Reusable utility for executing demo scripts with scope persistence and operation detection
class IntegratedDemoExecutor {
  constructor(baseUrl = 'http://localhost:3031') {
    // Initialize scope manager with monadic functions
    const monadicFunctions = {
      createWallet,
      getBalance,
      transfer,
      deployContract,
      contractAction,
      getContractState,
      advanceTime
    };
    this.scopeManager = new ScopeManager(monadicFunctions);
    this.dryRuntime = new DryRuntime({ baseUrl });
    this.realRuntime = new MonadicRuntime({ baseUrl });
    this.codeBlocks = []; // Store all code blocks for two-pass processing
    this.rewrittenBlocks = []; // Store rewritten code blocks (computed once)
  }
  
  async initialize() {
    await this.realRuntime.initialize();
  }
  
  // Set all code blocks upfront and do rewrite once
  setCodeBlocks(codeBlocks) {
    this.codeBlocks = codeBlocks;
    // Do the rewrite (phases 1 and 2) exactly once
    this.rewrittenBlocks = this.scopeManager.processCodeBlocks(this.codeBlocks);
  }
  
  async cleanup() {
    await this.realRuntime.cleanup();
  }
  
  // Execute a code block with proper scope management
  async executeCodeBlock(blockIndex) {
    // Get the pre-rewritten code for this block
    const rewrittenCode = this.rewrittenBlocks[blockIndex];
    
    // Execute the rewritten code with the scope
    const asyncFunction = new Function('scope', `
      return (async (scope) => {
        ${rewrittenCode}
      })(scope);
    `);
    
    const result = await asyncFunction(this.scopeManager.getScope());
    
    return result;
  }
  
  // Execute a stanza and maintain scope
  async executeStanza(blockIndex) {
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
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (url, options) => dryRuntime.fetch(url, options);
    
    // Save original console methods and suppress output during dry run
    const originalConsole = { ...console };
    console.log = () => {};
    console.error = () => {};
    console.warn = () => {};
    console.info = () => {};
    console.debug = () => {};
    
    // Set up global runtime for monadic functions
    global.__demoRuntime = dryRuntime;
    
    let operationType = 'unknown';
    try {
      // Execute in the cloned scope for analysis
      await this.executeCodeBlockWithScope(blockIndex, clonedScope);
      
      // Get operation type from dry runtime
      operationType = dryRuntime.getOperationType();
    } catch (error) {
      // Record the error in the dry runtime
      dryRuntime.recordError(error);
      
      // Still get the operation type based on what we recorded before the error
      operationType = dryRuntime.getOperationType();
      
      console.log(`⚠️  Dry run encountered error: ${error.message}`);
      console.log(`   Operation type detected before error: ${operationType}`);
    } finally {
      // Restore original fetch and console methods
      globalThis.fetch = originalFetch;
      Object.assign(console, originalConsole);
      delete global.__demoRuntime;
      await dryRuntime.cleanup();
    }
    
    // STEP 2: Real Execution (with persistent scope)
    // Use the real runtime for actual execution against the test server
    global.__demoRuntime = this.realRuntime;
    
    try {
      // Execute in the real persistent scope
      const result = await this.executeCodeBlock(blockIndex);
      
      return { result, operationType, isPartial: dryRuntime.hasPartialExecution() };
    } finally {
      delete global.__demoRuntime;
    }
  }
  
  // Helper method to execute with a specific scope (for dry run)
  async executeCodeBlockWithScope(blockIndex, scope) {
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
  
  // Get current scope for inspection
  getScope() {
    return { ...this.scopeManager.getScope() };
  }
  
  // Reset scope for testing
  resetScope() {
    this.executionScope = {};
    this.dryRuntime = new DryRuntime({ baseUrl: this.dryRuntime.baseUrl });
  }
}

module.exports = { IntegratedDemoExecutor };
