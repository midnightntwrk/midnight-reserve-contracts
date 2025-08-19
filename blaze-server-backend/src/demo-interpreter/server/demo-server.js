const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { IntegratedDemoExecutor } = require('../../../dist/demo-interpreter/core/IntegratedDemoExecutor.js');
const { JavaScriptDemoExecutor } = require('../../../dist/demo-interpreter/core/JavaScriptDemoExecutor.js');

const app = express();
const port = process.env.PORT || 3042;

app.use(cors());
app.use(express.json());

// Store active demo sessions
const sessions = new Map();

// Initialize a new demo session
app.post('/demo/init', async (req, res) => {
  try {
    const { demo, baseUrl = 'http://localhost:3031' } = req.body;
    
    if (!demo || !demo.stanzas) {
      return res.status(400).json({ error: 'Invalid demo format' });
    }

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`[Demo Server] Creating new session ${sessionId} for demo: ${demo.name}`);
    console.log(`[Demo Server] Demo has ${demo.stanzas.length} stanzas`);
    console.log(`[Demo Server] First stanza name: ${demo.stanzas[0]?.name}`);
    console.log(`[Demo Server] Demo stanzas: ${demo.stanzas.map(s => s.name).join(', ')}`);
    
    // Create the full executor with all the core functionality
    const executor = new JavaScriptDemoExecutor(demo, baseUrl);
    await executor.initialize();
    
    // Assign unique IDs to all code blocks
    const blockIdMap = new Map();
    let nextBlockId = 1;
    const demoWithBlockIds = {
      ...demo,
      stanzas: demo.stanzas.map(stanza => ({
        ...stanza,
        blocks: stanza.blocks.map(block => {
          if (block.type === 'code') {
            const blockId = `block_${nextBlockId++}`;
            blockIdMap.set(blockId, block);
            return {
              ...block,
              blockId: blockId
            };
          }
          return block;
        })
      }))
    };
    
    sessions.set(sessionId, {
      executor,
      demo: demoWithBlockIds,
      blockIdMap,
      executedBlockIds: new Set(),
      currentStanzaIndex: 0,
      results: []
    });

    console.log(`[Demo Server] Session ${sessionId} created successfully`);
    console.log(`[Demo Server] Active sessions: ${sessions.size}`);

    res.json({
      success: true,
      sessionId,
      demoName: demo.name,
      totalStanzas: demo.stanzas.length
    });
  } catch (error) {
    console.error('Demo init error:', error);
    res.status(500).json({ 
      error: 'Failed to initialize demo', 
      message: error.message 
    });
  }
});

// Execute a single stanza
app.post('/demo/execute-stanza', async (req, res) => {
  try {
    const { sessionId, stanzaIndex } = req.body;
    
    console.log(`[Demo Server] Executing stanza ${stanzaIndex} for session ${sessionId}`);
    
    const session = sessions.get(sessionId);
    if (!session) {
      console.log(`[Demo Server] Session ${sessionId} not found. Available sessions: ${Array.from(sessions.keys()).join(', ')}`);
      return res.status(404).json({ error: 'Session not found' });
    }

    console.log(`[Demo Server] Session demo name: ${session.demo.name}`);
    console.log(`[Demo Server] Executing stanza: ${session.demo.stanzas[stanzaIndex]?.name}`);

    if (stanzaIndex < 0 || stanzaIndex >= session.demo.stanzas.length) {
      return res.status(400).json({ error: 'Invalid stanza index' });
    }

    // Execute the stanza using the full TypeScript executor
    const results = await session.executor.executeStanza(stanzaIndex);
    
    // Store results
    session.results.push(...results);
    session.currentStanzaIndex = stanzaIndex + 1;

    console.log(`[Demo Server] Stanza execution completed. Results: ${results.length}`);
    console.log(`[Demo Server] Results structure:`, JSON.stringify(results, null, 2));

    res.json({
      success: true,
      results,
      currentStanzaIndex: session.currentStanzaIndex,
      totalStanzas: session.demo.stanzas.length,
      scope: session.executor.getScope()
    });
  } catch (error) {
    console.error('Stanza execution error:', error);
    res.status(500).json({ 
      error: 'Failed to execute stanza', 
      message: error.message 
    });
  }
});

// Execute a single block by ID
app.post('/demo/execute-block', async (req, res) => {
  try {
    const { sessionId, blockId } = req.body;
    
    console.log(`[Demo Server] Executing block ${blockId} for session ${sessionId}`);
    
    const session = sessions.get(sessionId);
    if (!session) {
      console.log(`[Demo Server] Session ${sessionId} not found. Available sessions: ${Array.from(sessions.keys()).join(', ')}`);
      return res.status(404).json({ error: 'Session not found' });
    }

    // Get the block from the map
    const block = session.blockIdMap.get(blockId);
    if (!block) {
      return res.status(404).json({ error: `Block ${blockId} not found` });
    }

    // Check execution order (optional validation)
    const blockNumber = parseInt(blockId.split('_')[1]);
    const expectedNextBlock = session.executedBlockIds.size + 1;
    if (blockNumber !== expectedNextBlock) {
      console.warn(`[Demo Server] Warning: Block ${blockId} executed out of order. Expected block_${expectedNextBlock}`);
    }

    // Execute the block using the integrated executor
    
    const result = await session.executor.executor.executeCodeBlock(blockNumber - 1); // Convert to 0-based index
    
    // Mark block as executed
    session.executedBlockIds.add(blockId);
    
    console.log(`[Demo Server] Block execution completed. Operation type: ${result.operationType}`);

    res.json({
      success: true,
      result: {
        result: result.result,
        operationType: result.operationType,
        isPartial: result.isPartial,
        structuredOutput: result.structuredOutput || []
      },
      scope: session.executor.getScope()
    });
  } catch (error) {
    console.error('Block execution error:', error);
    res.status(500).json({ 
      error: 'Failed to execute block', 
      message: error.message 
    });
  }
});

// Execute all remaining stanzas
app.post('/demo/execute-all', async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    const session = sessions.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const allResults = [];
    
    // Execute from current position to end
    for (let i = session.currentStanzaIndex; i < session.demo.stanzas.length; i++) {
      const results = await session.executor.executeStanza(i);
      allResults.push(...results);
      session.currentStanzaIndex = i + 1;
    }

    session.results.push(...allResults);

    res.json({
      success: true,
      results: allResults,
      currentStanzaIndex: session.currentStanzaIndex,
      totalStanzas: session.demo.stanzas.length,
      scope: session.executor.getScope()
    });
  } catch (error) {
    console.error('Execute all error:', error);
    res.status(500).json({ 
      error: 'Failed to execute all stanzas', 
      message: error.message 
    });
  }
});

// Get current session state
app.get('/demo/session/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json({
    success: true,
    demoName: session.demo.name,
    currentStanzaIndex: session.currentStanzaIndex,
    totalStanzas: session.demo.stanzas.length,
    results: session.results,
    scope: session.executor.getScope()
  });
});

// Reset session
app.post('/demo/reset/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Clean up old executor
    await session.executor.cleanup();
    
    // Create new executor
    const executor = new JavaScriptDemoExecutor(session.demo, session.executor.baseUrl);
    await executor.initialize();
    
    // Reset session state
    session.executor = executor;
    session.currentStanzaIndex = 0;
    session.results = [];

    res.json({ success: true });
  } catch (error) {
    console.error('Reset error:', error);
    res.status(500).json({ 
      error: 'Failed to reset session', 
      message: error.message 
    });
  }
});

// Execute watchers for a session
app.post('/demo/execute-watchers', async (req, res) => {
  try {
    const { sessionId } = req.body;
    
    console.log(`[Demo Server] Executing watchers for session ${sessionId}`);
    
    const session = sessions.get(sessionId);
    if (!session) {
      console.log(`[Demo Server] Session ${sessionId} not found. Available sessions: ${Array.from(sessions.keys()).join(', ')}`);
      return res.status(404).json({ error: 'Session not found' });
    }

    // Execute all watchers and get results
    const watchResults = await session.executor.executeWatchers();
    const watchersInfo = await session.executor.getWatchersInfo();
    
    console.log(`[Demo Server] Watcher execution completed. Results:`, watchResults);
    console.log(`[Demo Server] Watchers info:`, watchersInfo);

    res.json({
      success: true,
      watchResults,
      watchersInfo
    });

    // Clear changed state after response is sent
    await session.executor.clearWatcherChanges();
  } catch (error) {
    console.error('Watcher execution error:', error);
    res.status(500).json({ 
      error: 'Failed to execute watchers', 
      message: error.message 
    });
  }
});

// Clean up session
app.delete('/demo/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = sessions.get(sessionId);
    
    if (session) {
      await session.executor.cleanup();
      sessions.delete(sessionId);
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Cleanup error:', error);
    res.status(500).json({ 
      error: 'Failed to cleanup session', 
      message: error.message 
    });
  }
});

// Demo files endpoint
app.get('/api/demo-files', (req, res) => {
  try {
    const demoFlowsDir = path.join(process.cwd(), 'demo-flows');
    const files = fs.readdirSync(demoFlowsDir)
      .filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.demonb', '.js', '.yaml', '.json'].includes(ext);
      })
      .sort();
    
    res.json(files);
  } catch (error) {
    console.error('Error reading demo files:', error);
    res.status(500).json({
      success: false,
      error: "Failed to read demo files"
    });
  }
});

// Serve demo files with block IDs
app.get('/demo-flows/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(process.cwd(), 'demo-flows', filename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Demo file not found' });
    }
    
    // Read the demo file
    const content = fs.readFileSync(filePath, 'utf8');
    const demo = JSON.parse(content);
    
    // Add block IDs to the demo
    let nextBlockId = 1;
    const demoWithBlockIds = {
      ...demo,
      stanzas: demo.stanzas.map(stanza => ({
        ...stanza,
        blocks: stanza.blocks.map(block => {
          if (block.type === 'code') {
            return {
              ...block,
              blockId: `block_${nextBlockId++}`
            };
          }
          return block;
        })
      }))
    };
    
    res.setHeader('Content-Type', 'application/json');
    res.json(demoWithBlockIds);
  } catch (error) {
    console.error('Error serving demo file:', error);
    res.status(500).json({
      success: false,
      error: "Failed to serve demo file"
    });
  }
});



// Health check
app.get('/health', (req, res) => {
  res.json({ 
    success: true, 
    activeSessions: sessions.size,
    timestamp: new Date().toISOString()
  });
});

app.listen(port, () => {
  console.log(`Demo server running on port ${port}`);
  console.log(`Active sessions: ${sessions.size}`);
});
