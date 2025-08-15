/**
 * Notebook Executor
 * 
 * Parses and executes demo notebook files with alternating markdown/code stanzas.
 * Maintains execution context across stanzas and captures outputs.
 */

// Disable strict mode to allow 'with' statements
/* eslint-disable */

const { MonadicRuntime } = require('./runtime.js');
const demoFunctions = require('./functions.js');

class NotebookExecutor {
  constructor(config = {}) {
    this.runtime = new MonadicRuntime(config);
    this.context = {};
    this.outputs = [];
    this.isRunning = false;
    this.executionScope = {}; // Shared scope for all stanzas
  }

  /**
   * Execute a complete notebook
   * @param {object} notebook - Parsed notebook object with stanzas array
   * @returns {Promise<object>} Execution results
   */
  async execute(notebook) {
    if (this.isRunning) {
      throw new Error('Executor is already running');
    }

    this.isRunning = true;
    this.outputs = [];

    try {
      // Initialize runtime (creates session)
      await this.runtime.initialize();

      // Set up flat execution environment with monadic functions
      this.setupExecutionScope();

      // Execute each stanza
      for (let i = 0; i < notebook.stanzas.length; i++) {
        const stanza = notebook.stanzas[i];
        const result = await this.executeStanza(stanza, i);
        this.outputs.push(result);
      }

      return {
        success: true,
        outputs: this.outputs,
        context: this.context
      };

    } catch (error) {
      return {
        success: false,
        error: error.message,
        outputs: this.outputs,
        context: this.context
      };
    } finally {
      this.isRunning = false;
      await this.runtime.cleanup();
    }
  }

  /**
   * Set up flat execution environment with monadic functions
   */
  setupExecutionScope() {
    // Clear and populate execution scope with monadic functions
    this.executionScope = { ...demoFunctions };
    
    // Ensure global runtime is available
    global.__demoRuntime = this.runtime;
  }

  /**
   * Scoped eval that persists variables across calls
   */
  scopedEval(code) {
    return new Function('scope', `
      with (scope) {
        return eval(arguments[1]);
      }
    `)(this.executionScope, code);
  }

  /**
   * Execute a single stanza
   * @param {object} stanza - Stanza to execute
   * @param {number} index - Stanza index
   * @returns {Promise<object>} Stanza execution result
   */
  async executeStanza(stanza, index) {
    const result = {
      index,
      name: stanza.name || `stanza_${index}`,
      type: stanza.type,
      content: stanza.content
    };

    if (stanza.type === 'markdown') {
      // Markdown stanzas are just displayed, not executed
      result.rendered = stanza.content.join('\n');
      return result;
    }

    if (stanza.type === 'code') {
      // Set current step for error messages
      this.runtime.setCurrentStep(result.name);

      try {
        // Capture console output
        const originalLog = console.log;
        const consoleOutput = [];
        
        console.log = (...args) => {
          const message = args.map(arg => 
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
          ).join(' ');
          consoleOutput.push(message);
          originalLog(...args);
        };

        // Execute in shared scope using scoped eval
        const code = stanza.content.join('\n');
        
        // Wrap in async function for await support
        const asyncCode = `(async () => { ${code} })()`;
        
        // Execute using scoped eval
        const returnValue = await this.scopedEval(asyncCode);

        // Restore console
        console.log = originalLog;

        result.success = true;
        result.output = consoleOutput;
        result.returnValue = returnValue;

      } catch (error) {
        result.success = false;
        result.error = error.message;
        result.stack = error.stack;
      }
    }

    return result;
  }


  /**
   * Execute a single stanza (for interactive use)
   * @param {object} stanza - Stanza to execute
   * @returns {Promise<object>} Execution result
   */
  async executeSingle(stanza) {
    if (!this.runtime.sessionId) {
      await this.runtime.initialize();
      this.setupExecutionScope();
    }

    const index = this.outputs.length;
    const result = await this.executeStanza(stanza, index);
    this.outputs.push(result);
    return result;
  }

  /**
   * Get current execution context
   * @returns {object} Current context
   */
  getContext() {
    // Return the actual execution scope where variables are stored
    return { ...this.executionScope };
  }

  /**
   * Reset executor state
   */
  async reset() {
    this.context = {};
    this.outputs = [];
    this.executionScope = {};
    await this.runtime.cleanup();
  }
}

/**
 * Parse a notebook from JSON string or object
 * @param {string|object} input - Notebook JSON or object
 * @returns {object} Parsed notebook
 */
function parseNotebook(input) {
  const notebook = typeof input === 'string' ? JSON.parse(input) : input;
  
  if (!notebook.stanzas || !Array.isArray(notebook.stanzas)) {
    throw new Error('Invalid notebook format: missing stanzas array');
  }

  // Validate stanzas
  notebook.stanzas.forEach((stanza, i) => {
    if (!stanza.type) {
      throw new Error(`Stanza ${i} missing type`);
    }
    if (!['markdown', 'code'].includes(stanza.type)) {
      throw new Error(`Stanza ${i} has invalid type: ${stanza.type}`);
    }
    if (!stanza.content || !Array.isArray(stanza.content)) {
      throw new Error(`Stanza ${i} missing content array`);
    }
  });

  return notebook;
}

module.exports = { NotebookExecutor, parseNotebook };