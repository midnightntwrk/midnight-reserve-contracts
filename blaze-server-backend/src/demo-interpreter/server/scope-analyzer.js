const express = require('express');
const cors = require('cors');
const { ScopeManager } = require('../core/ScopeManager.js');
const { createWallet, getBalance, transfer, deployContract, contractAction, getContractState, advanceTime } = require('../monadic/functions.js');
const { MonadicRuntime } = require('../monadic/runtime.js');
const { DryRuntime } = require('../monadic/dry-runtime.js');

const app = express();
const port = 3032; // Different port from main server

app.use(cors());
app.use(express.json());

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

const scopeManager = new ScopeManager(monadicFunctions);

// Store runtime instances
let realRuntime = null;
let dryRuntime = null;

// Endpoint to analyze and rewrite code blocks
app.post('/analyze-scope', (req, res) => {
  try {
    const { codeBlocks } = req.body;
    
    if (!Array.isArray(codeBlocks)) {
      return res.status(400).json({ error: 'codeBlocks must be an array' });
    }

    // Use the existing ScopeManager to process code blocks
    const rewrittenBlocks = scopeManager.processCodeBlocks(codeBlocks);
    
    res.json({
      success: true,
      rewrittenBlocks,
      scope: scopeManager.getScope()
    });
  } catch (error) {
    console.error('Scope analysis error:', error);
    res.status(500).json({ 
      error: 'Scope analysis failed', 
      message: error.message 
    });
  }
});

// Endpoint to get current scope
app.get('/scope', (req, res) => {
  res.json({
    success: true,
    scope: scopeManager.getScope()
  });
});

// Endpoint to reset scope
app.post('/reset-scope', (req, res) => {
  scopeManager.resetScope();
  res.json({ success: true });
});

// Endpoint to initialize runtime
app.post('/initialize-runtime', async (req, res) => {
  try {
    const { baseUrl } = req.body;
    
    // Initialize real runtime
    realRuntime = new MonadicRuntime({ baseUrl });
    await realRuntime.initialize();
    
    // Initialize dry runtime
    dryRuntime = new DryRuntime({ baseUrl });
    await dryRuntime.initialize();
    
    res.json({ success: true });
  } catch (error) {
    console.error('Runtime initialization error:', error);
    res.status(500).json({ 
      error: 'Runtime initialization failed', 
      message: error.message 
    });
  }
});

// Endpoint to cleanup runtime
app.post('/cleanup-runtime', async (req, res) => {
  try {
    if (realRuntime) {
      await realRuntime.cleanup();
      realRuntime = null;
    }
    if (dryRuntime) {
      await dryRuntime.cleanup();
      dryRuntime = null;
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Runtime cleanup error:', error);
    res.status(500).json({ 
      error: 'Runtime cleanup failed', 
      message: error.message 
    });
  }
});

// Endpoint to execute code block with dry runtime analysis
app.post('/execute-with-analysis', async (req, res) => {
  try {
    const { codeBlock, blockIndex } = req.body;
    
    if (!dryRuntime || !realRuntime) {
      return res.status(400).json({ error: 'Runtime not initialized' });
    }

    // Set up global runtime for dry run
    global.__demoRuntime = dryRuntime;
    
    // Execute with dry runtime for analysis
    const dryResult = await executeCodeBlock(codeBlock, scopeManager.getScope());
    const operationType = dryRuntime.getOperationType();
    const isPartial = dryRuntime.hasPartialExecution();
    
    // Clean up dry runtime
    global.__demoRuntime = null;
    
    // Execute with real runtime
    global.__demoRuntime = realRuntime;
    const realResult = await executeCodeBlock(codeBlock, scopeManager.getScope());
    
    // Clean up
    global.__demoRuntime = null;
    
    res.json({
      success: true,
      result: realResult,
      operationType,
      isPartial,
      scope: scopeManager.getScope()
    });
  } catch (error) {
    console.error('Execution error:', error);
    res.status(500).json({ 
      error: 'Execution failed', 
      message: error.message 
    });
  }
});

// Helper function to execute code block
async function executeCodeBlock(code, scope) {
  const asyncFunction = new Function('scope', `
    return (async (scope) => {
      ${code}
    })(scope);
  `);
  
  return await asyncFunction(scope);
}

app.listen(port, () => {
  console.log(`Scope analyzer server running on port ${port}`);
});
