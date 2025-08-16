import { describe, test, expect } from "bun:test";
import fs from "fs";
import path from "path";

// Import the demo interpreter components
import { NotebookExecutor, parseNotebook } from "../../demo-interpreter/monadic/executor.js";

describe("Phase 4.4: Demo Interpreter Integration Tests", () => {
  let executor: NotebookExecutor;

  test("should parse demo notebook file correctly", () => {
    const notebookPath = path.join(process.cwd(), "demo-flows", "simple-wallet-test.demonb");
    const notebookContent = fs.readFileSync(notebookPath, "utf-8");
    
    const notebook = parseNotebook(notebookContent);
    
    expect(notebook).toBeDefined();
    expect(notebook.stanzas).toBeInstanceOf(Array);
    expect(notebook.stanzas.length).toBeGreaterThan(0);
    
    // Check that we have both markdown and code stanzas
    const markdownStanzas = notebook.stanzas.filter(s => s.type === 'markdown');
    const codeStanzas = notebook.stanzas.filter(s => s.type === 'code');
    
    expect(markdownStanzas.length).toBeGreaterThan(0);
    expect(codeStanzas.length).toBeGreaterThan(0);
    
    console.log("✓ Demo notebook parsed successfully");
    console.log(`  - Total stanzas: ${notebook.stanzas.length}`);
    console.log(`  - Markdown stanzas: ${markdownStanzas.length}`);
    console.log(`  - Code stanzas: ${codeStanzas.length}`);
  });

  test("should create NotebookExecutor with real server connection", () => {
    const config = {
      baseUrl: "http://localhost:3031",
      debug: true
    };
    
    executor = new NotebookExecutor(config);
    
    expect(executor).toBeDefined();
    expect(executor.runtime).toBeDefined();
    
    console.log("✓ NotebookExecutor created with real server configuration");
    console.log(`  - Runtime initialized: ${!!executor.runtime}`);
    console.log(`  - Debug mode: ${config.debug}`);
  });

  test("should execute wallet creation stanza and make real HTTP calls", async () => {
    const notebookPath = path.join(process.cwd(), "demo-flows", "simple-wallet-test.demonb");
    const notebookContent = fs.readFileSync(notebookPath, "utf-8");
    const notebook = parseNotebook(notebookContent);
    
    // Find the wallet creation stanza
    const walletStanza = notebook.stanzas.find(s => 
      s.type === 'code' && s.content.some(line => line.includes('createWallet'))
    );
    
    expect(walletStanza).toBeDefined();
    
    // Execute the stanza
    const result = await executor.executeSingle(walletStanza!);
    
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    expect(result.output!.length).toBeGreaterThan(0);
    
    // Verify it made real HTTP calls (we can see the output)
    const outputText = result.output!.join('\n');
    expect(outputText).toContain("Jeff's wallet created!");
    expect(outputText).toContain("Wallet name: jeff");
    expect(outputText).toContain("Initial balance: 50000000 lovelace");
    
    console.log("✓ Wallet creation stanza executed successfully");
    console.log(`  - Output: ${result.output?.join('\n')}`);
    console.log(`  - Made real HTTP calls to blaze server`);
  });

  test("should execute balance query stanza and make real HTTP calls", async () => {
    const notebookPath = path.join(process.cwd(), "demo-flows", "simple-wallet-test.demonb");
    const notebookContent = fs.readFileSync(notebookPath, "utf-8");
    const notebook = parseNotebook(notebookContent);
    
    // Find the balance query stanza
    const balanceStanza = notebook.stanzas.find(s => 
      s.type === 'code' && s.content.some(line => line.includes('getBalance'))
    );
    
    expect(balanceStanza).toBeDefined();
    
    // Execute the stanza
    const result = await executor.executeSingle(balanceStanza!);
    
    expect(result.success).toBe(true);
    expect(result.output).toBeDefined();
    expect(result.output!.length).toBeGreaterThan(0);
    
    // Verify it made real HTTP calls
    const outputText = result.output!.join('\n');
    expect(outputText).toContain("Jeff's current balance:");
    expect(outputText).toContain("That's 50 ADA");
    
    console.log("✓ Balance query stanza executed successfully");
    console.log(`  - Output: ${result.output?.join('\n')}`);
    console.log(`  - Made real HTTP calls to blaze server`);
  });

  test("should execute complete notebook end-to-end with real HTTP calls", async () => {
    const notebookPath = path.join(process.cwd(), "demo-flows", "simple-wallet-test.demonb");
    const notebookContent = fs.readFileSync(notebookPath, "utf-8");
    const notebook = parseNotebook(notebookContent);
    
    // Create fresh executor for complete test
    const freshExecutor = new NotebookExecutor({
      baseUrl: "http://localhost:3031",
      debug: true
    });
    
    // Execute all stanzas using the execute method
    const results = await freshExecutor.execute(notebook);
    
    expect(results).toBeDefined();
    expect(results.success).toBe(true);
    expect(results.outputs).toBeDefined();
    expect(results.outputs.length).toBeGreaterThan(0);
    
    // Check that all code stanzas executed successfully
    const codeStanzas = notebook.stanzas.filter(s => s.type === 'code');
    const successfulExecutions = results.outputs.filter((r: any) => r.success);
    
    expect(successfulExecutions.length).toBe(codeStanzas.length);
    
    // Verify real HTTP operations were performed
    const allOutputs = results.outputs
      .filter((r: any) => r.output)
      .map((r: any) => r.output.join('\n'))
      .join('\n');
    
    expect(allOutputs).toContain("Jeff's wallet created!");
    expect(allOutputs).toContain("Nancy's wallet created!");
    expect(allOutputs).toContain("Jeff's current balance:");
    expect(allOutputs).toContain("Nancy's current balance:");
    expect(allOutputs).toContain("Demo completed successfully!");
    
    console.log("✓ Complete notebook execution successful");
    console.log(`  - Total stanzas executed: ${results.outputs.length}`);
    console.log(`  - Successful executions: ${successfulExecutions.length}`);
    console.log(`  - Real HTTP calls verified`);
  });

  test("should handle errors gracefully in demo execution", async () => {
    const errorStanza = {
      type: 'code' as const,
      name: 'Error Test',
      content: ['invalidFunctionCall()']
    };
    
    const result = await executor.executeSingle(errorStanza);
    
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('invalidFunctionCall');
    
    console.log("✓ Error handling works correctly");
    console.log(`  - Error message: ${result.error}`);
  });

  test("should maintain execution context across multiple stanzas", async () => {
    const notebookPath = path.join(process.cwd(), "demo-flows", "simple-wallet-test.demonb");
    const notebookContent = fs.readFileSync(notebookPath, "utf-8");
    const notebook = parseNotebook(notebookContent);
    
    const freshExecutor = new NotebookExecutor({
      baseUrl: "http://localhost:3031",
      debug: true
    });
    
    // Execute first few stanzas and track outputs
    const codeStanzas = notebook.stanzas.filter(s => s.type === 'code');
    const outputs: string[] = [];
    
    for (let i = 0; i < Math.min(3, codeStanzas.length); i++) {
      const result = await freshExecutor.executeSingle(codeStanzas[i]);
      if (result.output) {
        outputs.push(result.output.join('\n'));
      }
    }
    
    // Verify that outputs show progression (wallet creation, then balance checks)
    expect(outputs.length).toBeGreaterThan(1);
    expect(outputs.some(output => output.includes("wallet created"))).toBe(true);
    expect(outputs.some(output => output.includes("current balance"))).toBe(true);
    
    console.log("✓ Execution context maintained across multiple stanzas");
    console.log(`  - Executed ${outputs.length} stanzas`);
    console.log(`  - Outputs show progression: ${outputs.length > 0 ? 'Yes' : 'No'}`);
  });
});
