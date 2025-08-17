import { IntegratedDemoExecutor } from './IntegratedDemoExecutor';

export interface DemoBlock {
  type: 'markdown' | 'code';
  language?: string; // Required for code blocks
  content: string[];
}

export interface JavaScriptDemoStanza {
  name: string;
  blocks: DemoBlock[];
}

export interface JavaScriptDemo {
  name: string;
  description?: string;
  stanzas: JavaScriptDemoStanza[];
}

export interface DemoExecutionResult {
  stanzaIndex: number;
  stanzaName: string;
  blockIndex: number;
  blockType: string;
  operationType: string;
  isPartial?: boolean;
  result: any;
  scope: Record<string, any>;
}

/**
 * JavaScript Demo Executor - Main orchestrator for executing JavaScript-based demos
 * Handles scope persistence, operation detection, and progressive execution
 */
export class JavaScriptDemoExecutor {
  private executor: IntegratedDemoExecutor;
  private demo: JavaScriptDemo;

  constructor(demo: JavaScriptDemo, baseUrl: string = 'http://localhost:3031') {
    this.demo = demo;
    this.executor = new IntegratedDemoExecutor(baseUrl);
  }

  async initialize(): Promise<void> {
    await this.executor.initialize();
  }

  async cleanup(): Promise<void> {
    await this.executor.cleanup();
  }

  /**
   * Execute the entire demo with scope persistence across all stanzas
   */
  async executeDemo(): Promise<DemoExecutionResult[]> {
    console.log(`\n=== JAVASCRIPT DEMO: ${this.demo.name} ===`);
    if (this.demo.description) {
      console.log(`Description: ${this.demo.description}`);
    }
    console.log(`Total stanzas: ${this.demo.stanzas.length}\n`);

    const results: DemoExecutionResult[] = [];
    let codeBlockIndex = 0;

    // Extract all code blocks for upfront processing
    const codeBlocks: string[] = [];
    for (const stanza of this.demo.stanzas) {
      for (const block of stanza.blocks) {
        if (block.type === 'code') {
          codeBlocks.push(block.content.join('\n'));
        }
      }
    }

    // Set all code blocks upfront for scope management
    this.executor.setCodeBlocks(codeBlocks);

    for (let stanzaIndex = 0; stanzaIndex < this.demo.stanzas.length; stanzaIndex++) {
      const stanza = this.demo.stanzas[stanzaIndex];
      console.log(`--- Stanza ${stanzaIndex + 1}: ${stanza.name} ---`);
      
      // Iterate through blocks within this stanza
      for (let blockIndex = 0; blockIndex < stanza.blocks.length; blockIndex++) {
        const block = stanza.blocks[blockIndex];
        
        if (block.type === 'markdown') {
          console.log('Markdown:');
          block.content.forEach(line => {
            if (line.trim()) console.log(`  ${line}`);
          });
          console.log('---\n');
          
          // Add markdown block to results
          const markdownResult: DemoExecutionResult = {
            stanzaIndex,
            stanzaName: stanza.name,
            blockIndex,
            blockType: block.type,
            operationType: 'markdown',
            result: null,
            scope: this.executor.getScope()
          };
          results.push(markdownResult);
          continue;
        }

        // Execute code block
        console.log('Code:');
        block.content.forEach(line => {
          if (line.trim()) console.log(`  ${line}`);
        });

        const { result, operationType, isPartial } = await this.executor.executeStanza(codeBlockIndex);
        
        console.log(`\nOperation Type: ${operationType}`);
        console.log(`Current Scope Variables: [${Object.keys(this.executor.getScope()).join(', ')}]`);
        console.log('---\n');

        const executionResult: DemoExecutionResult = {
          stanzaIndex,
          stanzaName: stanza.name,
          blockIndex,
          blockType: block.type,
          operationType,
          isPartial,
          result,
          scope: this.executor.getScope()
        };
        results.push(executionResult);
        codeBlockIndex++;
      }
    }

    console.log('✅ Demo completed successfully!');
    return results;
  }

  /**
   * Execute a single stanza by index
   */
  async executeStanza(stanzaIndex: number): Promise<DemoExecutionResult[]> {
    if (stanzaIndex < 0 || stanzaIndex >= this.demo.stanzas.length) {
      throw new Error(`Invalid stanza index: ${stanzaIndex}`);
    }

    const stanza = this.demo.stanzas[stanzaIndex];
    console.log(`\n=== Executing Stanza: ${stanza.name} ===`);
    
    const results: DemoExecutionResult[] = [];
    let codeBlockIndex = 0;

    // Iterate through blocks within this stanza
    for (let blockIndex = 0; blockIndex < stanza.blocks.length; blockIndex++) {
      const block = stanza.blocks[blockIndex];
      
      if (block.type === 'markdown') {
        console.log('Markdown:');
        block.content.forEach(line => {
          if (line.trim()) console.log(`  ${line}`);
        });
        console.log('---\n');
        
        const markdownResult: DemoExecutionResult = {
          stanzaIndex,
          stanzaName: stanza.name,
          blockIndex,
          blockType: block.type,
          operationType: 'markdown',
          result: null,
          scope: this.executor.getScope()
        };
        results.push(markdownResult);
        continue;
      }

      // Execute code block
      console.log('Code:');
      block.content.forEach(line => {
        if (line.trim()) console.log(`  ${line}`);
      });

      // Convert multi-line content to single string for execution
      const codeContent = block.content.join('\n');

      // Set the code block for execution
      this.executor.setCodeBlocks([codeContent]);

      const { result, operationType, isPartial } = await this.executor.executeStanza(codeBlockIndex);
      
      console.log(`\nOperation Type: ${operationType}`);
      console.log(`Current Scope Variables: [${Object.keys(this.executor.getScope()).join(', ')}]`);
      console.log('---\n');

      const executionResult: DemoExecutionResult = {
        stanzaIndex,
        stanzaName: stanza.name,
        blockIndex,
        blockType: block.type,
        operationType,
        isPartial,
        result,
        scope: this.executor.getScope()
      };
      results.push(executionResult);
      codeBlockIndex++;
    }

    return results;
  }

  /**
   * Get current scope state
   */
  getScope(): Record<string, any> {
    return this.executor.getScope();
  }

  /**
   * Reset scope for fresh execution
   */
  resetScope(): void {
    this.executor.resetScope();
  }
}

/**
 * Convenience function to execute a JavaScript demo
 */
export async function executeJavaScriptDemo(demo: JavaScriptDemo, baseUrl?: string): Promise<DemoExecutionResult[]> {
  const executor = new JavaScriptDemoExecutor(demo, baseUrl);
  
  try {
    await executor.initialize();
    return await executor.executeDemo();
  } finally {
    await executor.cleanup();
  }
}
