/**
 * Web Adapter for Demo Interpreter
 * 
 * Minimal adapter that bridges the web interface to our existing core infrastructure.
 * Uses JavaScriptDemoExecutor without duplicating any core logic.
 */

// Import our existing core components
import { JavaScriptDemoExecutor } from '../core/JavaScriptDemoExecutor.js';

/**
 * Web-compatible wrapper around our existing JavaScriptDemoExecutor
 * Maintains the same interface the web app expects
 */
class WebDemoExecutor {
  constructor(config = {}) {
    this.config = config;
    this.executor = null;
    this.currentDemo = null;
  }

  /**
   * Initialize the executor with a demo
   */
  async initialize(demo) {
    this.currentDemo = demo;
    this.executor = new JavaScriptDemoExecutor(
      demo,
      this.config.baseUrl || 'http://localhost:3031'
    );
    await this.executor.initialize();
  }

  /**
   * Execute a single stanza (block) - uses our existing core
   */
  async executeSingle(stanza) {
    if (!this.executor || !this.currentDemo) {
      throw new Error('Executor not initialized');
    }

    // Find the stanza index in our demo
    const stanzaIndex = this.currentDemo.stanzas.findIndex(s => s.name === stanza.name);
    if (stanzaIndex === -1) {
      throw new Error(`Stanza ${stanza.name} not found`);
    }

    // Execute just this stanza using our existing core
    const results = await this.executor.executeStanza(stanzaIndex);
    
    // Convert our result format to what the web interface expects
    return {
      success: true,
      output: results.map(r => r.result?.toString() || '').filter(Boolean),
      operationType: results[0]?.operationType || 'unknown'
    };
  }

  /**
   * Execute the entire demo - uses our existing core
   */
  async execute() {
    if (!this.executor || !this.currentDemo) {
      throw new Error('Executor not initialized');
    }

    const results = await this.executor.executeDemo();
    
    return {
      success: true,
      outputs: results.map(r => ({
        success: true,
        output: r.result?.toString() || '',
        operationType: r.operationType
      }))
    };
  }

  /**
   * Reset the executor
   */
  async reset() {
    if (this.executor) {
      await this.executor.cleanup();
    }
    this.executor = null;
    this.currentDemo = null;
  }
}

/**
 * Parse notebook content into our demo format
 * Now expects the new format directly
 */
function parseNotebook(content) {
  try {
    const data = JSON.parse(content);
    
    // Validate the new format
    if (!data.stanzas || !Array.isArray(data.stanzas)) {
      throw new Error('Invalid notebook format: missing stanzas array');
    }
    
    // Validate each stanza has blocks
    data.stanzas.forEach((stanza, index) => {
      if (!stanza.blocks || !Array.isArray(stanza.blocks)) {
        throw new Error(`Invalid stanza ${index}: missing blocks array`);
      }
    });

    return data;
  } catch (error) {
    throw new Error(`Failed to parse notebook: ${error.message}`);
  }
}

// Export for use in web interface
if (typeof window !== 'undefined') {
  window.WebDemoExecutor = WebDemoExecutor;
  window.parseNotebook = parseNotebook;
}

// Export for Node.js/ES modules
export { WebDemoExecutor, parseNotebook };
