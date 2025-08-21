const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { JavaScriptDemoExecutor } = require('../../../dist/demo-interpreter/core/JavaScriptDemoExecutor.js');

const app = express();
const port = process.env.PORT || 3042;

app.use(cors());
app.use(express.json());

// --- SIMPLIFICATION ---
// Replace the multi-session Map with a single session variable.
let currentSession = null;
const SINGLE_SESSION_ID = "single_session"; // Use a constant ID

// Helper function to clean up the previous session if it exists
async function cleanupPreviousSession() {
  if (currentSession && currentSession.executor) {
    console.log('[Demo Server] Cleaning up previous session...');
    await currentSession.executor.cleanup();
    currentSession = null;
  }
}

// Initialize a new demo session
app.post('/demo/init', async (req, res) => {
  try {
    await cleanupPreviousSession(); // Ensure only one session is active

    const { demo, baseUrl = 'http://localhost:3031' } = req.body;
    if (!demo || !demo.stanzas) {
      return res.status(400).json({ error: 'Invalid demo format' });
    }

    console.log(`[Demo Server] Creating new single session for demo: ${demo.name}`);
    
    const executor = new JavaScriptDemoExecutor(demo, baseUrl);
    await executor.initialize();
    
    // Assign unique IDs and numbers to all code blocks for the frontend
    let nextBlockId = 1;
    const demoWithBlockIds = {
      ...demo,
      stanzas: demo.stanzas.map(stanza => ({
        ...stanza,
        blocks: stanza.blocks.map(block => {
          if (block.type === 'code') {
            return { ...block, blockId: `block_${nextBlockId}`, blockNumber: nextBlockId++ };
          }
          return block;
        })
      }))
    };
    
    // --- SIMPLIFICATION ---
    // Store the new session in the single global variable
    currentSession = {
      executor,
      demo: demoWithBlockIds,
      executedBlockIds: new Set(),
      currentStanzaIndex: 0,
      results: []
    };

    console.log(`[Demo Server] Session created successfully.`);

    res.json({
      success: true,
      sessionId: SINGLE_SESSION_ID, // Return constant ID
      demoName: demo.name,
      totalStanzas: demo.stanzas.length
    });
  } catch (error) {
    console.error('Demo init error:', error);
    res.status(500).json({ error: 'Failed to initialize demo', message: error.message });
  }
});

// Middleware to check for an active session
const requireSession = (req, res, next) => {
  if (!currentSession) {
    return res.status(404).json({ error: 'No active session. Please initialize a demo first.' });
  }
  next();
};

// Execute a single block by ID
app.post('/demo/execute-block', requireSession, async (req, res) => {
  try {
    const { blockId } = req.body;
    console.log(`[Demo Server] Executing block ${blockId}`);

    const blockNumber = parseInt(blockId.split('_')[1]);
    const result = await currentSession.executor.executor.executeCodeBlock(blockNumber - 1);
    
    currentSession.executedBlockIds.add(blockId);
    console.log(`[Demo Server] Block execution completed. Operation type: ${result.operationType}`);

    res.json({
      success: true,
      result: {
        result: result.result,
        operationType: result.operationType,
        isPartial: result.isPartial,
        structuredOutput: result.structuredOutput || []
      },
      scope: currentSession.executor.getScope()
    });
  } catch (error) {
    console.error('Block execution error:', error);
    res.status(500).json({ error: 'Failed to execute block', message: error.message });
  }
});


// Execute watchers for the session
app.post('/demo/execute-watchers', requireSession, async (req, res) => {
  try {
    console.log(`[Demo Server] Executing watchers for the active session`);

    const watchResults = await currentSession.executor.executeWatchers();
    const watchersInfo = await currentSession.executor.getWatchersInfo();
    
    console.log(`[Demo Server] Watcher execution completed.`);

    res.json({
      success: true,
      watchResults,
      watchersInfo
    });

    // Clear changed state after response is sent
    await currentSession.executor.clearWatcherChanges();
  } catch (error) {
    console.error('Watcher execution error:', error);
    res.status(500).json({ error: 'Failed to execute watchers', message: error.message });
  }
});

// Reset session
app.post('/demo/reset/:sessionId', async (req, res) => {
  try {
    if (!currentSession) {
      return res.status(404).json({ error: 'No session to reset.' });
    }

    // Re-initialize the executor on the current session object
    const executor = new JavaScriptDemoExecutor(currentSession.demo, currentSession.executor.baseUrl);
    await executor.initialize();
    
    currentSession.executor = executor;
    currentSession.currentStanzaIndex = 0;
    currentSession.results = [];
    currentSession.executedBlockIds.clear();

    res.json({ success: true });
  } catch (error) {
    console.error('Reset error:', error);
    res.status(500).json({ error: 'Failed to reset session', message: error.message });
  }
});


// Clean up session
app.delete('/demo/session/:sessionId', async (req, res) => {
  try {
    await cleanupPreviousSession();
    res.json({ success: true });
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({ error: 'Failed to cleanup session', message: error.message });
  }
});


// Demo files endpoint
app.get('/api/demo-files', (req, res) => {
  try {
    const demoFlowsDir = path.join(process.cwd(), 'demo-flows');
    const files = fs.readdirSync(demoFlowsDir)
      .filter(file => path.extname(file).toLowerCase() === '.demonb')
      .sort();
    res.json(files);
  } catch (error) {
    console.error('Error reading demo files:', error);
    res.status(500).json({ success: false, error: "Failed to read demo files" });
  }
});

// Serve demo files with block IDs
app.get('/demo-flows/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(process.cwd(), 'demo-flows', filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Demo file not found' });
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    const demo = JSON.parse(content);
    
    let nextBlockId = 1;
    const demoWithBlockIds = {
      ...demo,
      stanzas: demo.stanzas.map(stanza => ({
        ...stanza,
        blocks: stanza.blocks.map(block => {
          if (block.type === 'code') {
            return { ...block, blockId: `block_${nextBlockId}`, blockNumber: nextBlockId++ };
          }
          return block;
        })
      }))
    };
    
    res.setHeader('Content-Type', 'application/json');
    res.json(demoWithBlockIds);
  } catch (error) {
    console.error('Error serving demo file:', error);
    res.status(500).json({ success: false, error: "Failed to serve demo file" });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    success: true, 
    activeSession: !!currentSession,
    timestamp: new Date().toISOString()
  });
});

app.listen(port, () => {
  console.log(`Demo server running on port ${port} in single-session mode.`);
});
