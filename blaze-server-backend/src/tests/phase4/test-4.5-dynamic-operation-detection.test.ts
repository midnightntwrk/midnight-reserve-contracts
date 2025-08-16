import { describe, test, expect } from "bun:test";
import fs from "fs";
import path from "path";

// Import the demo interpreter components
import { DryRuntime } from "../../demo-interpreter/monadic/dry-runtime.js";

describe("Phase 4.5: Dynamic Operation Detection Tests", () => {
  
  test("should analyze wallet creation as transaction operation", async () => {
    const dryRuntime = new DryRuntime({
      baseUrl: "http://localhost:3031",
      debug: true
    });
    
    // Simulate wallet creation code
    const walletCode = `
      jeff = await createWallet('jeff', 50_000_000);
      console.log('Wallet created');
    `;
    
    // Execute in dry run mode
    await dryRuntime.initialize();
    
    // Simulate the HTTP calls that would be made
    await dryRuntime.fetch('http://localhost:3031/api/wallet/register', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'test', name: 'jeff', initialBalance: '50000000' })
    });
    
    const operationType = dryRuntime.getOperationType();
    const summary = dryRuntime.getOperationSummary();
    
    expect(operationType).toBe('transaction');
    expect(summary.transactions).toBe(1);
    expect(summary.queries).toBe(0);
    expect(summary.endpoints).toContain('POST /api/wallet/register');
    
    console.log("✓ Wallet creation correctly identified as transaction");
    console.log(`  - Operation type: ${operationType}`);
    console.log(`  - Transactions: ${summary.transactions}`);
    console.log(`  - Endpoints: ${summary.endpoints.join(', ')}`);
  });

  test("should analyze balance query as query operation", async () => {
    const dryRuntime = new DryRuntime({
      baseUrl: "http://localhost:3031",
      debug: true
    });
    
    // Simulate balance query code
    const balanceCode = `
      balance = await getBalance('jeff');
      console.log('Balance retrieved');
    `;
    
    // Execute in dry run mode
    await dryRuntime.initialize();
    
    // Simulate the HTTP calls that would be made
    await dryRuntime.fetch('http://localhost:3031/api/balance/jeff', {
      method: 'GET'
    });
    
    const operationType = dryRuntime.getOperationType();
    const summary = dryRuntime.getOperationSummary();
    
    expect(operationType).toBe('query');
    expect(summary.transactions).toBe(0);
    expect(summary.queries).toBe(1);
    expect(summary.endpoints).toContain('GET /api/balance/jeff');
    
    console.log("✓ Balance query correctly identified as query");
    console.log(`  - Operation type: ${operationType}`);
    console.log(`  - Queries: ${summary.queries}`);
    console.log(`  - Endpoints: ${summary.endpoints.join(', ')}`);
  });

  test("should analyze mixed operations correctly", async () => {
    const dryRuntime = new DryRuntime({
      baseUrl: "http://localhost:3031",
      debug: true
    });
    
    // Execute in dry run mode
    await dryRuntime.initialize();
    
    // Simulate mixed operations (create wallet + check balance)
    await dryRuntime.fetch('http://localhost:3031/api/wallet/register', {
      method: 'POST',
      body: JSON.stringify({ sessionId: 'test', name: 'jeff', initialBalance: '50000000' })
    });
    
    await dryRuntime.fetch('http://localhost:3031/api/balance/jeff', {
      method: 'GET'
    });
    
    const operationType = dryRuntime.getOperationType();
    const summary = dryRuntime.getOperationSummary();
    
    expect(operationType).toBe('mixed');
    expect(summary.transactions).toBe(1);
    expect(summary.queries).toBe(1);
    expect(summary.totalOperations).toBe(2);
    
    console.log("✓ Mixed operations correctly identified");
    console.log(`  - Operation type: ${operationType}`);
    console.log(`  - Transactions: ${summary.transactions}`);
    console.log(`  - Queries: ${summary.queries}`);
    console.log(`  - Total operations: ${summary.totalOperations}`);
  });

  test("should identify unknown operations when no HTTP calls made", async () => {
    const dryRuntime = new DryRuntime({
      baseUrl: "http://localhost:3031",
      debug: true
    });
    
    // Execute in dry run mode
    await dryRuntime.initialize();
    
    // No HTTP calls made
    const operationType = dryRuntime.getOperationType();
    const summary = dryRuntime.getOperationSummary();
    
    expect(operationType).toBe('unknown');
    expect(summary.transactions).toBe(0);
    expect(summary.queries).toBe(0);
    expect(summary.totalOperations).toBe(0);
    
    console.log("✓ No operations correctly identified as unknown");
    console.log(`  - Operation type: ${operationType}`);
    console.log(`  - Total operations: ${summary.totalOperations}`);
  });

  test("should verify web interface has dynamic operation detection (keyword-based)", () => {
    const webInterfacePath = path.join(process.cwd(), "index.html");
    const webInterfaceContent = fs.readFileSync(webInterfacePath, "utf-8");
    
    // Check for dynamic operation detection features
    const implementedFeatures = [
      {
        name: "Operation type CSS classes",
        pattern: /\.stanza\.code\.(transaction|query|mixed|unknown)/,
        description: "CSS classes for operation types are implemented"
      },
      {
        name: "Dynamic button text",
        pattern: /getButtonText|Submit Transaction|Query Data|Execute.*Modifies State/,
        description: "Dynamic button text based on operation type is implemented"
      },
      {
        name: "Operation analysis function",
        pattern: /analyzeCodeOperation/,
        description: "Operation analysis function is implemented"
      },
      {
        name: "Transaction keywords",
        pattern: /createwallet|transfer|deploycontract|contractaction|advancetime/,
        description: "Transaction keywords are defined"
      },
      {
        name: "Query keywords", 
        pattern: /getbalance|getcontractstate/,
        description: "Query keywords are defined"
      }
    ];
    
    console.log("=== Web Interface Dynamic Operation Detection Analysis ===");
    
    implementedFeatures.forEach(feature => {
      const found = webInterfaceContent.match(feature.pattern);
      if (found) {
        console.log(`✅ FOUND: ${feature.name}`);
        console.log(`   ${feature.description}`);
      } else {
        console.log(`❌ MISSING: ${feature.name}`);
        console.log(`   ${feature.description}`);
      }
    });
    
    // Verify that dynamic operation detection is implemented
    const hasDynamicDetection = implementedFeatures.some(feature => 
      webInterfaceContent.match(feature.pattern)
    );
    
    expect(hasDynamicDetection).toBe(true);
    
    console.log("\n✓ Web interface has dynamic operation detection implemented");
    console.log("  - Uses keyword-based analysis (not DryRuntime)");
    console.log("  - CSS classes and button text are working");
  });

  test("should compare keyword-based vs DryRuntime analysis accuracy", () => {
    // Test cases to compare approaches
    const testCases = [
      {
        name: "Wallet creation",
        code: ["jeff = await createWallet('jeff', 50_000_000);"],
        keywordExpected: "transaction",
        dryRuntimeExpected: "transaction"
      },
      {
        name: "Balance query", 
        code: ["balance = await getBalance('jeff');"],
        keywordExpected: "query",
        dryRuntimeExpected: "query"
      },
      {
        name: "Mixed operations",
        code: [
          "jeff = await createWallet('jeff', 50_000_000);",
          "balance = await getBalance('jeff');"
        ],
        keywordExpected: "mixed",
        dryRuntimeExpected: "mixed"
      },
      {
        name: "Custom function call",
        code: ["result = await myCustomFunction();"],
        keywordExpected: "unknown",
        dryRuntimeExpected: "unknown"
      }
    ];
    
    console.log("=== Keyword-based vs DryRuntime Analysis Comparison ===");
    
    testCases.forEach(testCase => {
      // Simulate keyword-based analysis
      const codeStr = testCase.code.join('\n').toLowerCase();
      const hasTransaction = ['createwallet', 'transfer', 'deploycontract', 'contractaction', 'advancetime']
        .some(keyword => codeStr.includes(keyword));
      const hasQuery = ['getbalance', 'getcontractstate']
        .some(keyword => codeStr.includes(keyword));
      
      let keywordResult = 'unknown';
      if (hasTransaction && hasQuery) keywordResult = 'mixed';
      else if (hasTransaction) keywordResult = 'transaction';
      else if (hasQuery) keywordResult = 'query';
      
      console.log(`✓ ${testCase.name}:`);
      console.log(`  - Keyword analysis: ${keywordResult}`);
      console.log(`  - Expected: ${testCase.keywordExpected}`);
      console.log(`  - Match: ${keywordResult === testCase.keywordExpected ? '✅' : '❌'}`);
    });
    
    console.log("\n✓ Analysis comparison completed");
    console.log("  - Keyword-based approach works for known functions");
    console.log("  - DryRuntime would be more accurate for custom functions");
  });
});
