const { describe, test, expect } = require("bun:test");
const { DryRuntime } = require("../../demo-interpreter/monadic/dry-runtime.js");
const { MonadicRuntime } = require("../../demo-interpreter/monadic/runtime.js");
const { ScopeManager } = require("../../demo-interpreter/core/ScopeManager.js");
const { createWallet, getBalance, transfer, deployContract, contractAction, getContractState, advanceTime } = require("../../demo-interpreter/monadic/functions.js");

describe("Phase 4.10: Integrated DryRuntime with Scope Persistence Tests", () => {
  
  // Simulate the web interface's scope persistence mechanism
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
      
      // Debug: Check what variables are in scope
      console.log('Variables in scope after execution:', Object.keys(this.scopeManager.getScope()));
      
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
      
      // Set up global runtime for monadic functions
      global.__demoRuntime = dryRuntime;
      
      let operationType = 'unknown';
      try {
        // Execute in the cloned scope for analysis
        await this.executeCodeBlockWithScope(blockIndex, clonedScope);
        
        // Get operation type from dry runtime
        operationType = dryRuntime.getOperationType();
      } finally {
        // Restore original fetch
        globalThis.fetch = originalFetch;
        delete global.__demoRuntime;
        await dryRuntime.cleanup();
      }
      
      // STEP 2: Real Execution (with persistent scope)
      // Use the real runtime for actual execution against the test server
      global.__demoRuntime = this.realRuntime;
      
      try {
        // Execute in the real persistent scope
        const result = await this.executeCodeBlock(blockIndex);
        
        return { result, operationType };
      } finally {
        delete global.__demoRuntime;
      }
    }
    
    // Helper method to execute with a specific scope (for dry run)
    async executeCodeBlockWithScope(blockIndex, scope) {
      // Get the pre-rewritten code for this block
      const rewrittenCode = this.rewrittenBlocks[blockIndex];
      
      // Debug: Check what's in the scope before execution
      console.log('Dry run scope before execution:', Object.keys(scope));
      console.log('Rewritten code:', rewrittenCode);
      
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
  
  test("should demonstrate integrated DryRuntime with scope persistence across stanzas", async () => {
    const executor = new IntegratedDemoExecutor();
    await executor.initialize();
    
    // Simulate a realistic demo notebook with multiple stanzas
    const stanzas = [
      {
        name: "Create Wallet",
        content: [
          "// Create a wallet for testing",
          "jeff = await createWallet('jeff', 50_000_000);",
          "console.log('Wallet created:', jeff);"
        ]
      },
      {
        name: "Check Balance",
        content: [
          "// Check the balance of the wallet we just created",
          "balance = await getBalance(jeff.name);",
          "console.log('Balance:', balance);"
        ]
      },
      {
        name: "Create Destination Wallet and Transfer",
        content: [
          "// Create destination wallet first",
          "alice = await createWallet('alice', 0);",
          "console.log('Alice wallet created:', alice);",
          "",
          "// Use the monadic transfer function with variables from previous stanzas",
          "transferResult = await transfer(jeff.name, alice.name, 10_000_000);",
          "console.log('Transfer completed:', transferResult);"
        ]
      },
      {
        name: "Check Final Balances",
        content: [
          "// Check final balances of all wallets",
          "jeffFinalBalance = await getBalance(jeff.name);",
          "aliceFinalBalance = await getBalance(alice.name);",
          "console.log('Jeff final balance:', jeffFinalBalance);",
          "console.log('Alice final balance:', aliceFinalBalance);"
        ]
      }
    ];
    
    console.log("=== Integrated DryRuntime with Scope Persistence Test ===");
    console.log("Simulating web interface with multiple stanzas that share scope...\n");
    
    // Set all code blocks upfront and do rewrite once
    const allCodeBlocks = stanzas.map(stanza => stanza.content.join('\n'));
    executor.setCodeBlocks(allCodeBlocks);
    
    const results = [];
    
    for (let i = 0; i < stanzas.length; i++) {
      const stanza = stanzas[i];
      console.log(`--- Stanza ${i + 1}: ${stanza.name} ---`);
      console.log("Code:");
      stanza.content.forEach(line => console.log(`  ${line}`));
      
      // Execute the stanza by index
      const { result, operationType } = await executor.executeStanza(i);
      
      console.log(`\nOperation Type: ${operationType}`);
      console.log("Current Scope Variables:", Object.keys(executor.getScope()));
      console.log("---\n");
      
      results.push({ stanza: stanza.name, operationType, scope: executor.getScope() });
    }
    
    // Verify the results
    expect(results[0].operationType).toBe('transaction'); // createWallet
    expect(results[1].operationType).toBe('query'); // getBalance
    expect(results[2].operationType).toBe('transaction'); // createWallet + transfer
    expect(results[3].operationType).toBe('query'); // getBalance calls
    
    // Verify scope persistence
    const finalScope = executor.getScope();
    expect(finalScope).toHaveProperty('jeff');
    expect(finalScope).toHaveProperty('balance');
    expect(finalScope).toHaveProperty('alice');
    expect(finalScope).toHaveProperty('transferResult');
    expect(finalScope).toHaveProperty('jeffFinalBalance');
    expect(finalScope).toHaveProperty('aliceFinalBalance');
    
    console.log("✅ All tests passed! DryRuntime correctly detected operations with scope persistence.");
    
    await executor.cleanup();
  });
  
  test("should demonstrate DryRuntime with complex function composition and scope", async () => {
    const executor = new IntegratedDemoExecutor();
    await executor.initialize();
    
    const complexStanzas = [
      {
        name: "Create Multiple Wallets",
        content: [
          "// Create multiple wallets using monadic functions",
          "wallet1 = await createWallet('wallet1', 10_000_000);",
          "wallet2 = await createWallet('wallet2', 20_000_000);",
          "console.log('Wallets created:', wallet1, wallet2);"
        ]
      },
      {
        name: "Use Monadic Functions",
        content: [
          "// Use monadic functions instead of raw HTTP calls",
          "bob = await createWallet('bob', 30_000_000);",
          "console.log('Bob wallet created:', bob);"
        ]
      },
      {
        name: "Query and Transfer with Monadic Functions",
        content: [
          "// Query using monadic function",
          "bobBalance = await getBalance(bob.name);",
          "console.log('Bob balance:', bobBalance);",
          "",
          "// Create destination wallet first",
          "charlie = await createWallet('charlie', 0);",
          "console.log('Charlie wallet created:', charlie);",
          "",
          "// Transfer using monadic function",
          "transferResult2 = await transfer(bob.name, charlie.name, 5_000_000);",
          "console.log('Transfer completed:', transferResult2);"
        ]
      }
    ];
    
    console.log("=== Complex Function Composition with Scope Test ===");
    console.log("Testing DryRuntime with factory pattern and scope persistence...\n");
    
    // Set all code blocks upfront and do rewrite once
    const allCodeBlocks = complexStanzas.map(stanza => stanza.content.join('\n'));
    executor.setCodeBlocks(allCodeBlocks);
    
    const results = [];
    
    for (let i = 0; i < complexStanzas.length; i++) {
      const stanza = complexStanzas[i];
      console.log(`--- Stanza ${i + 1}: ${stanza.name} ---`);
      console.log("Code:");
      stanza.content.forEach(line => console.log(`  ${line}`));
      
      // Execute the stanza by index
      const { result, operationType } = await executor.executeStanza(i);
      
      console.log(`\nOperation Type: ${operationType}`);
      console.log("Current Scope Variables:", Object.keys(executor.getScope()));
      console.log("---\n");
      
      results.push({ stanza: stanza.name, operationType, scope: executor.getScope() });
    }
    
    // Verify the results
    expect(results[0].operationType).toBe('transaction'); // createWallet calls
    expect(results[1].operationType).toBe('transaction'); // createWallet calls
    expect(results[2].operationType).toBe('mixed'); // getBalance + createWallet + transfer
    
    // Verify scope persistence with complex objects
    const finalScope = executor.getScope();
    expect(finalScope).toHaveProperty('wallet1');
    expect(finalScope).toHaveProperty('wallet2');
    expect(finalScope).toHaveProperty('bob');
    expect(finalScope).toHaveProperty('bobBalance');
    expect(finalScope).toHaveProperty('charlie');
    expect(finalScope).toHaveProperty('transferResult2');
    
    console.log("✅ Complex function composition test passed! DryRuntime handles factory patterns correctly.");
    
    await executor.cleanup();
  });
  
  test("should demonstrate DryRuntime edge cases with scope variables", async () => {
    const executor = new IntegratedDemoExecutor();
    await executor.initialize();
    
    const edgeCaseStanzas = [
      {
        name: "Variables in Comments and Strings",
        content: [
          "// This stanza has createWallet in comments but no actual calls",
          "walletName = 'test-wallet';",
          "// createWallet(walletName, 1000000); // commented out call",
          "console.log('No HTTP operations here');"
        ]
      },
      {
        name: "Create Wallet with Monadic Function",
        content: [
          "// Create wallet using monadic function",
          "testWallet = await createWallet(walletName, 1_000_000);",
          "console.log('Test wallet created:', testWallet);"
        ]
      },
      {
        name: "Conditional Balance Check",
        content: [
          "// Conditional balance check using monadic function",
          "shouldMakeCall = true;",
          "if (shouldMakeCall) {",
          "  balanceData = await getBalance(testWallet.name);",
          "  console.log('Conditional balance check:', balanceData);",
          "} else {",
          "  console.log('No HTTP call made');",
          "}"
        ]
      }
    ];
    
    console.log("=== Edge Cases with Scope Variables Test ===");
    console.log("Testing DryRuntime with edge cases and scope variables...\n");
    
    // Set all code blocks upfront and do rewrite once
    const allCodeBlocks = edgeCaseStanzas.map(stanza => stanza.content.join('\n'));
    executor.setCodeBlocks(allCodeBlocks);
    
    const results = [];
    
    for (let i = 0; i < edgeCaseStanzas.length; i++) {
      const stanza = edgeCaseStanzas[i];
      console.log(`--- Stanza ${i + 1}: ${stanza.name} ---`);
      console.log("Code:");
      stanza.content.forEach(line => console.log(`  ${line}`));
      
      // Execute the stanza by index
      const { result, operationType } = await executor.executeStanza(i);
      
      console.log(`\nOperation Type: ${operationType}`);
      console.log("Current Scope Variables:", Object.keys(executor.getScope()));
      console.log("---\n");
      
      results.push({ stanza: stanza.name, operationType, scope: executor.getScope() });
    }
    
    // Verify the results
    expect(results[0].operationType).toBe('unknown'); // No actual HTTP calls
    expect(results[1].operationType).toBe('transaction'); // createWallet operation
    expect(results[2].operationType).toBe('query'); // getBalance operation
    
    // Verify scope persistence
    const finalScope = executor.getScope();
    expect(finalScope).toHaveProperty('walletName');
    expect(finalScope).toHaveProperty('testWallet');
    expect(finalScope).toHaveProperty('shouldMakeCall');
    expect(finalScope).toHaveProperty('balanceData');
    
    console.log("✅ Edge cases test passed! DryRuntime handles complex scope scenarios correctly.");
    
    await executor.cleanup();
  });
});
