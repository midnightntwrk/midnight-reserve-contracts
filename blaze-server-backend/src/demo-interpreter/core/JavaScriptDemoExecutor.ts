import { IntegratedDemoExecutor } from './IntegratedDemoExecutor';

export interface JavaScriptDemoStanza {
  name: string;
  type: 'markdown' | 'code';
  content: string;
}

export interface JavaScriptDemo {
  name: string;
  description?: string;
  stanzas: JavaScriptDemoStanza[];
}

export interface DemoExecutionResult {
  stanzaIndex: number;
  stanzaType: string;
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

    try {
      // Extract all code blocks for upfront processing
      const codeBlocks = this.demo.stanzas
        .filter(stanza => stanza.type === 'code')
        .map(stanza => stanza.content);

      // Set all code blocks upfront for scope management
      this.executor.setCodeBlocks(codeBlocks);

      let codeBlockIndex = 0;

      // Execute each stanza
      for (let i = 0; i < this.demo.stanzas.length; i++) {
        const stanza = this.demo.stanzas[i];
        
        console.log(`--- Stanza ${i + 1}: ${stanza.name} (${stanza.type.toUpperCase()}) ---`);
        if (stanza.type === 'markdown') {
          console.log(stanza.content);
          console.log('---\n');
          
          // Add markdown stanza to results
          const markdownResult: DemoExecutionResult = {
            stanzaIndex: i,
            stanzaType: stanza.type,
            operationType: 'markdown',
            result: null,
            scope: this.executor.getScope()
          };
          results.push(markdownResult);
          continue;
        }

        // Execute code stanza
        console.log('Code:');
        // Handle multi-line content by splitting and joining
        const codeLines = stanza.content.split('\n');
        codeLines.forEach(line => {
          if (line.trim()) console.log(`  ${line}`);
        });

        // Convert multi-line content to single string for execution
        const codeContent = codeLines.join('\n');

        const { result, operationType, isPartial } = await this.executor.executeStanza(codeBlockIndex);
        
        const scope = this.executor.getScope();
        const executionResult: DemoExecutionResult = {
          stanzaIndex: i,
          stanzaType: stanza.type,
          operationType,
          isPartial,
          result,
          scope: { ...scope }
        };

        results.push(executionResult);

        console.log(`\nOperation Type: ${operationType}`);
        console.log('Current Scope Variables:', Object.keys(scope));
        console.log('---\n');

        codeBlockIndex++;
      }

      console.log('✅ Demo completed successfully!');
      return results;

    } catch (error) {
      console.error('\n=== DEMO FAILED ===');
      console.error(`Error: ${(error as Error).message}\n`);
      throw error;
    }
  }

  /**
   * Execute a single stanza by index
   */
  async executeStanza(stanzaIndex: number): Promise<DemoExecutionResult> {
    if (stanzaIndex >= this.demo.stanzas.length) {
      throw new Error(`Stanza index ${stanzaIndex} out of range`);
    }

    const stanza = this.demo.stanzas[stanzaIndex];
    
    if (stanza.type === 'markdown') {
      return {
        stanzaIndex,
        stanzaType: stanza.type,
        operationType: 'markdown',
        result: null,
        scope: this.executor.getScope()
      };
    }

    // Find the code block index for this stanza
    const codeBlockIndex = this.demo.stanzas
      .slice(0, stanzaIndex + 1)
      .filter(s => s.type === 'code')
      .length - 1;

    const { result, operationType, isPartial } = await this.executor.executeStanza(codeBlockIndex);
    
    return {
      stanzaIndex,
      stanzaType: stanza.type,
      operationType,
      isPartial,
      result,
      scope: this.executor.getScope()
    };
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
