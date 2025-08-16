import { describe, test, expect } from "bun:test";

describe("Phase 4.7: Improved Regex Analysis Tests", () => {
  
  // Helper function to analyze code with improved regex
  function analyzeCodeWithImprovedRegex(codeLines: string[]) {
    const codeStr = codeLines.join('\n');
    
    // Remove comments and strings to avoid false positives
    let cleanCode = codeStr;
    
    // Remove single-line comments
    cleanCode = cleanCode.replace(/\/\/.*$/gm, '');
    
    // Remove multi-line comments
    cleanCode = cleanCode.replace(/\/\*[\s\S]*?\*\//g, '');
    
    // Remove string literals (both single and double quotes)
    cleanCode = cleanCode.replace(/"[^"\\]*(\\.[^"\\]*)*"/g, '""'); // Double quotes
    cleanCode = cleanCode.replace(/'[^'\\]*(\\.[^'\\]*)*'/g, "''"); // Single quotes
    cleanCode = cleanCode.replace(/`[^`\\]*(\\.[^`\\]*)*`/g, '``'); // Template literals
    
    // Now check for actual function calls in the cleaned code
    const transactionCallPatterns = [
      /\bawait\s+createWallet\s*\(/,           // await createWallet(
      /\bawait\s+transfer\s*\(/,               // await transfer(
      /\bawait\s+deployContract\s*\(/,         // await deployContract(
      /\bawait\s+contractAction\s*\(/,         // await contractAction(
      /\bawait\s+advanceTime\s*\(/             // await advanceTime(
    ];
    
    const queryCallPatterns = [
      /\bawait\s+getBalance\s*\(/,             // await getBalance(
      /\bawait\s+getContractState\s*\(/        // await getContractState(
    ];
    
    let hasTransaction = false;
    let hasQuery = false;
    
    transactionCallPatterns.forEach(pattern => {
      if (pattern.test(cleanCode)) hasTransaction = true;
    });
    
    queryCallPatterns.forEach(pattern => {
      if (pattern.test(cleanCode)) hasQuery = true;
    });
    
    if (hasTransaction && hasQuery) return 'mixed';
    if (hasTransaction) return 'transaction';
    if (hasQuery) return 'query';
    return 'unknown';
  }
  
  test("should demonstrate improved regex that detects actual function calls", () => {
    // Test cases with various code patterns
    const testCases = [
      {
        name: "Actual function call",
        code: ["await createWallet('jeff', 50_000_000);"],
        expected: "transaction",
        description: "Real function call should be detected"
      },
      {
        name: "Function call in comment",
        code: ["// TODO: call createWallet('jeff', 50_000_000) in next stanza"],
        expected: "unknown",
        description: "Function call in comment should NOT be detected"
      },
      {
        name: "Function name in string",
        code: ["const message = 'To create a wallet, call createWallet(name, balance)';"],
        expected: "unknown",
        description: "Function name in string should NOT be detected"
      },
      {
        name: "Function name in variable",
        code: ["const createWalletButton = document.getElementById('create-wallet-btn');"],
        expected: "unknown",
        description: "Function name in variable should NOT be detected"
      },
      {
        name: "Multiple function calls",
        code: [
          "const wallet = await createWallet('jeff', 50_000_000);",
          "const balance = await getBalance('jeff');"
        ],
        expected: "mixed",
        description: "Multiple actual function calls should be detected"
      },
      {
        name: "Function call with different spacing",
        code: ["await createWallet ( 'jeff' , 50_000_000 ) ;"],
        expected: "transaction",
        description: "Function call with extra spacing should be detected"
      },
      {
        name: "Function call in template literal",
        code: ["const result = await createWallet(`${name}`, balance);"],
        expected: "transaction",
        description: "Function call in template literal should be detected"
      }
    ];
    
    console.log("=== Improved Regex Analysis Test ===");
    
    testCases.forEach(testCase => {
      const operationType = analyzeCodeWithImprovedRegex(testCase.code);
      const success = operationType === testCase.expected;
      
      console.log(`\n${testCase.name}:`);
      console.log(`  Code: ${testCase.code.join(' ')}`);
      console.log(`  Expected: ${testCase.expected}`);
      console.log(`  Detected: ${operationType}`);
      console.log(`  Result: ${success ? '✅ PASS' : '❌ FAIL'}`);
      console.log(`  Description: ${testCase.description}`);
      
      // This test should pass for the improved regex
      expect(operationType).toBe(testCase.expected);
    });
  });

  test("should demonstrate regex edge cases and limitations", () => {
    const edgeCases = [
      {
        name: "Function call without await",
        code: ["createWallet('jeff', 50_000_000);"],
        expected: "unknown", // Our regex requires 'await'
        description: "Function call without await should NOT be detected"
      },
      {
        name: "Function call in string",
        code: ["const code = 'await createWallet(\\'jeff\\', 50_000_000);';"],
        expected: "unknown",
        description: "Function call in escaped string should NOT be detected"
      },
      {
        name: "Function call in comment block",
        code: [
          "/*",
          " * await createWallet('jeff', 50_000_000);",
          " */"
        ],
        expected: "unknown",
        description: "Function call in comment block should NOT be detected"
      },
      {
        name: "Function call in line comment",
        code: ["// await createWallet('jeff', 50_000_000);"],
        expected: "unknown",
        description: "Function call in line comment should NOT be detected"
      },
      {
        name: "Function call in template literal string",
        code: ["const message = `await createWallet('jeff', 50_000_000);`;"],
        expected: "unknown",
        description: "Function call in template literal string should NOT be detected"
      }
    ];
    
    console.log("\n=== Regex Edge Cases Test ===");
    
    edgeCases.forEach(testCase => {
      const operationType = analyzeCodeWithImprovedRegex(testCase.code);
      const success = operationType === testCase.expected;
      
      console.log(`\n${testCase.name}:`);
      console.log(`  Code: ${testCase.code.join(' ')}`);
      console.log(`  Expected: ${testCase.expected}`);
      console.log(`  Detected: ${operationType}`);
      console.log(`  Result: ${success ? '✅ PASS' : '❌ FAIL'}`);
      console.log(`  Description: ${testCase.description}`);
      
      expect(operationType).toBe(testCase.expected);
    });
  });

  test("should compare improved regex vs simple string search", () => {
    const comparisonCases = [
      {
        name: "Function call in comment",
        code: ["// TODO: call createWallet('jeff', 50_000_000)"],
        simpleSearch: "transaction", // ❌ False positive
        improvedRegex: "unknown",    // ✅ Correct
        description: "Simple search gives false positive, regex is correct"
      },
      {
        name: "Function name in string",
        code: ["const message = 'createWallet function is available';"],
        simpleSearch: "transaction", // ❌ False positive  
        improvedRegex: "unknown",    // ✅ Correct
        description: "Simple search gives false positive, regex is correct"
      },
      {
        name: "Actual function call",
        code: ["await createWallet('jeff', 50_000_000);"],
        simpleSearch: "transaction", // ✅ Correct
        improvedRegex: "transaction", // ✅ Correct
        description: "Both approaches work for actual calls"
      }
    ];
    
    console.log("\n=== Comparison: Simple Search vs Improved Regex ===");
    
    comparisonCases.forEach(testCase => {
      const codeStr = testCase.code.join('\n');
      
      // Simple string search (current approach)
      const simpleSearch = codeStr.toLowerCase().includes('createwallet') ? 'transaction' : 'unknown';
      
      // Improved regex approach
      const improvedRegex = analyzeCodeWithImprovedRegex(testCase.code);
      
      console.log(`\n${testCase.name}:`);
      console.log(`  Code: ${testCase.code.join(' ')}`);
      console.log(`  Simple search: ${simpleSearch}`);
      console.log(`  Improved regex: ${improvedRegex}`);
      console.log(`  Description: ${testCase.description}`);
      
      // Verify the comparison
      expect(simpleSearch).toBe(testCase.simpleSearch);
      expect(improvedRegex).toBe(testCase.improvedRegex);
    });
  });
});
