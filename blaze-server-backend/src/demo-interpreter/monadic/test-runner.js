#!/usr/bin/env node

/**
 * Test runner for monadic demo notebooks
 * 
 * Usage: node test-runner.js <notebook-file>
 */

const { NotebookExecutor, parseNotebook } = require('./executor.js');
const { readFileSync } = require('fs');
const { resolve } = require('path');
const readline = require('readline');

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Usage: node test-runner.js <notebook-file>');
    console.log('Example: node test-runner.js demo-flows/simple-wallet-test.demonb');
    process.exit(1);
  }

  const notebookPath = resolve(args[0]);
  
  try {
    // Read notebook file
    console.log(`Loading notebook: ${notebookPath}\n`);
    const notebookContent = readFileSync(notebookPath, 'utf-8');
    const notebook = parseNotebook(notebookContent);
    
    console.log(`Notebook: ${notebook.name || 'Untitled'}`);
    console.log(`Description: ${notebook.description || 'No description'}`);
    console.log(`Version: ${notebook.version || '1.0'}`);
    console.log(`Stanzas: ${notebook.stanzas.length}`);
    console.log('---\n');

    // Create executor with config from notebook
    const config = {
      baseUrl: notebook.config?.baseUrl || 'http://localhost:3031',
      contracts: notebook.config?.contracts || {},
      debug: false,
      interactive: true
    };
    
    const executor = new NotebookExecutor(config);
    
    // Execute notebook
    console.log('Starting execution...\n');
    
    const result = await executor.execute(notebook);
    
    if (result.success) {
      console.log('\n✅ Notebook executed successfully!');
      
      // Show summary of code outputs
      console.log('\n=== Execution Summary ===');
      result.outputs.forEach((output, index) => {
        if (output.type === 'code') {
          console.log(`\nStanza ${index}: ${output.name}`);
          if (output.success) {
            if (output.output && output.output.length > 0) {
              console.log('Output:');
              output.output.forEach(line => console.log(`  ${line}`));
            }
          } else {
            console.log(`  ❌ Error: ${output.error}`);
          }
        }
      });
      
      // Show final context (filter out circular references)
      console.log('\n=== Final Context ===');
      const context = executor.getContext();
      Object.entries(context).forEach(([key, value]) => {
        try {
          // Only show user variables (not internal ones)
          if (!key.startsWith('_') && typeof value !== 'function') {
            console.log(`${key}: ${JSON.stringify(value, null, 2)}`);
          }
        } catch (error) {
          console.log(`${key}: [Circular reference or non-serializable]`);
        }
      });
      
    } else {
      console.error('\n❌ Notebook execution failed!');
      console.error(`Error: ${result.error}`);
      
      // Show which stanza failed
      const failedStanza = result.outputs.find(o => o.type === 'code' && !o.success);
      if (failedStanza) {
        console.error(`\nFailed at stanza: ${failedStanza.name}`);
        console.error(`Error details: ${failedStanza.error}`);
      }
      
      process.exit(1);
    }
    
  } catch (error) {
    console.error('Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

/**
 * Wait for user to press Enter
 */
function waitForEnter() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question('Press Enter to continue...', () => {
      rl.close();
      resolve();
    });
  });
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}