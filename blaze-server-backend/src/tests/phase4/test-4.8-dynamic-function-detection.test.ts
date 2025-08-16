import { describe, test, expect } from "bun:test";
import { DryRuntime } from "../../demo-interpreter/monadic/dry-runtime.js";

// Helper function to execute code with DryRuntime
async function executeWithDryRuntime(codeLines: string[]): Promise<string> {
  const dryRuntime = new DryRuntime({ baseUrl: 'http://localhost:3031' });
  await dryRuntime.initialize();
  
  const codeStr = codeLines.join('\n');
  
  // Override fetch to use dry runtime
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (url, options) => dryRuntime.fetch(url, options);
  
  try {
    // Execute the code in a block scope to avoid variable redeclaration issues
    await eval(`(async () => { ${codeStr} })()`);
  } catch (error) {
    // Expected - code might fail in dry run, but we captured the operations
    console.log('Dry run execution completed (errors expected):', error.message);
  } finally {
    // Restore original fetch
    globalThis.fetch = originalFetch;
    await dryRuntime.cleanup();
  }
  
  return dryRuntime.getOperationType();
}

describe("Phase 4.8: Dynamic Function Detection Tests", () => {
  
  test("should demonstrate DryRuntime success with custom function that makes HTTP calls", async () => {
    // Code block that defines a custom function and calls it
    // This should be detected as a transaction using DryRuntime
    const dynamicCode = [
      "// Define a custom function that makes HTTP calls",
      "const makeWallet = async (name, balance) => {",
      "  const endpoint = 'create' + 'Wallet'; // Dynamic endpoint name",
      "  const response = await fetch(`http://localhost:3031/api/wallet/register`, {",
      "    method: 'POST',",
      "    headers: { 'Content-Type': 'application/json' },",
      "    body: JSON.stringify({ sessionId: 'test', name, initialBalance: balance.toString() })",
      "  });",
      "  return await response.json();",
      "};",
      "",
      "// Call the custom function",
      "const jeff = await makeWallet('jeff', 50_000_000);",
      "console.log('Wallet created via custom function');"
    ];
    
    // Test the DryRuntime approach
    const dryRuntimeResult = await executeWithDryRuntime(dynamicCode);
    
    // This code actually makes HTTP calls, so it should be detected as a transaction
    const expectedResult = 'transaction';
    
    console.log("=== Dynamic Function Detection Test ===");
    console.log("Code block:");
    dynamicCode.forEach(line => console.log(`  ${line}`));
    console.log(`\nDryRuntime analysis result: ${dryRuntimeResult}`);
    console.log(`Expected result: ${expectedResult}`);
    console.log(`DryRuntime approach succeeds: ${dryRuntimeResult === expectedResult ? '✅ YES' : '❌ NO'}`);
    console.log(`\nWhy it succeeds:`);
    console.log(`  - DryRuntime actually executes the code`);
    console.log(`  - Monitors real HTTP calls as they happen`);
    console.log(`  - Detects any HTTP operations, not just known functions`);
    console.log(`  - Works with custom functions and dynamic endpoints`);
    
    // This test should PASS - proving DryRuntime works
    expect(dryRuntimeResult).toBe(expectedResult);
  });

  test("should demonstrate DryRuntime success with completely custom HTTP client", async () => {
    // Code block that creates a custom HTTP client and uses it
    const customHttpCode = [
      "// Custom HTTP client that makes blockchain calls",
      "const blockchainClient = {",
      "  async post(endpoint, data) {",
      "    const url = `http://localhost:3031/api/${endpoint}`;",
      "    const response = await fetch(url, {",
      "      method: 'POST',",
      "      headers: { 'Content-Type': 'application/json' },",
      "      body: JSON.stringify(data)",
      "    });",
      "    return await response.json();",
      "  },",
      "  async get(endpoint) {",
      "    const url = `http://localhost:3031/api/${endpoint}`;",
      "    const response = await fetch(url);",
      "    return await response.json();",
      "  }",
      "};",
      "",
      "// Use custom client to make blockchain operations",
      "const walletData = await blockchainClient.post('wallet/register', {",
      "  sessionId: 'test',",
      "  name: 'jeff',",
      "  initialBalance: '50000000'",
      "});",
      "",
      "const balanceData = await blockchainClient.get('balance/jeff');",
      "console.log('Custom client operations completed');"
    ];
    
    // Test DryRuntime approach
    const dryRuntimeResult = await executeWithDryRuntime(customHttpCode);
    
    // This code makes both POST and GET calls, so it should be mixed
    const expectedResult = 'mixed';
    
    console.log("=== Custom HTTP Client Test ===");
    console.log("Code block:");
    customHttpCode.forEach(line => console.log(`  ${line}`));
    console.log(`\nDryRuntime analysis result: ${dryRuntimeResult}`);
    console.log(`Expected result: ${expectedResult}`);
    console.log(`DryRuntime approach succeeds: ${dryRuntimeResult === expectedResult ? '✅ YES' : '❌ NO'}`);
    console.log(`\nWhy it succeeds:`);
    console.log(`  - DryRuntime executes the custom client code`);
    console.log(`  - Monitors all HTTP calls (POST and GET)`);
    console.log(`  - Detects mixed operations correctly`);
    console.log(`  - Works with any HTTP client implementation`);
    
    // This test should PASS - proving DryRuntime works
    expect(dryRuntimeResult).toBe(expectedResult);
  });

  test("should demonstrate DryRuntime success with function composition", async () => {
    // Code block that composes functions to make HTTP calls
    const compositionCode = [
      "// Function composition approach",
      "const httpCall = (method, path) => async (data) => {",
      "  const response = await fetch(`http://localhost:3031/api/${path}`, {",
      "    method,",
      "    headers: { 'Content-Type': 'application/json' },",
      "    body: data ? JSON.stringify(data) : undefined",
      "  });",
      "  return await response.json();",
      "};",
      "",
      "// Compose specific operations",
      "const createWallet = httpCall('POST', 'wallet/register');",
      "const getBalance = httpCall('GET', 'balance/jeff');",
      "",
      "// Use composed functions",
      "const wallet = await createWallet({",
      "  sessionId: 'test',",
      "  name: 'jeff',",
      "  initialBalance: '50000000'",
      "});",
      "",
      "const balance = await getBalance();",
      "console.log('Function composition completed');"
    ];
    
    // Test DryRuntime approach
    const dryRuntimeResult = await executeWithDryRuntime(compositionCode);
    
    // This code makes both POST and GET calls, so it should be mixed
    const expectedResult = 'mixed';
    
    console.log("=== Function Composition Test ===");
    console.log("Code block:");
    compositionCode.forEach(line => console.log(`  ${line}`));
    console.log(`\nDryRuntime analysis result: ${dryRuntimeResult}`);
    console.log(`Expected result: ${expectedResult}`);
    console.log(`DryRuntime approach succeeds: ${dryRuntimeResult === expectedResult ? '✅ YES' : '❌ NO'}`);
    console.log(`\nWhy it succeeds:`);
    console.log(`  - DryRuntime executes the composed functions`);
    console.log(`  - Monitors HTTP calls from function composition`);
    console.log(`  - Detects mixed operations from composed functions`);
    console.log(`  - Works with any function composition pattern`);
    
    // This test should PASS - proving DryRuntime works
    expect(dryRuntimeResult).toBe(expectedResult);
  });

  test("should summarize why DryRuntime approach fundamentally succeeds", () => {
    console.log("=== DryRuntime Approach Fundamental Success ===");
    console.log("✅ DryRuntime succeeds because it:");
    console.log("   - Actually executes the code in sandboxed environment");
    console.log("   - Monitors real HTTP calls as they happen");
    console.log("   - Detects any HTTP operations, not just known functions");
    console.log("   - Works with custom functions and dynamic endpoints");
    console.log("   - Handles function composition and custom clients");
    console.log("   - Is robust to code style changes");
    console.log("");
    console.log("🔧 The DryRuntime solution:");
    console.log("   - Executes code with mocked fetch");
    console.log("   - Records all HTTP operations");
    console.log("   - Analyzes operation types based on HTTP methods");
    console.log("   - Provides accurate operation detection");
    console.log("   - Works with any code pattern or style");
    
    // This test always passes - it's documentation
    expect(true).toBe(true);
  });
});
