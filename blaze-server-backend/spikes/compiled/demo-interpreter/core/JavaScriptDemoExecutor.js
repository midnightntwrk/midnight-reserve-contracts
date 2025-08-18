"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JavaScriptDemoExecutor = void 0;
exports.executeJavaScriptDemo = executeJavaScriptDemo;
const IntegratedDemoExecutor_1 = require("./IntegratedDemoExecutor");
/**
 * JavaScript Demo Executor - Main orchestrator for executing JavaScript-based demos
 * Handles scope persistence, operation detection, and progressive execution
 */
class JavaScriptDemoExecutor {
    constructor(demo, baseUrl = 'http://localhost:3031') {
        console.log(`[JavaScriptDemoExecutor] Constructor called with demo: ${demo.name}`);
        console.log(`[JavaScriptDemoExecutor] Demo has ${demo.stanzas.length} stanzas`);
        console.log(`[JavaScriptDemoExecutor] First stanza: ${demo.stanzas[0]?.name}`);
        this.demo = demo;
        // Pass contract configuration from demo config to the executor
        const config = {
            baseUrl,
            contracts: demo.config?.contracts || {},
            debug: false
        };
        this.executor = new IntegratedDemoExecutor_1.IntegratedDemoExecutor(config);
    }
    /**
     * Initialize the demo executor with the full demo scope
     */
    async initialize() {
        console.log(`\n🚀 Initializing Demo: ${this.demo.name}`);
        // Initialize the integrated executor
        await this.executor.initialize();
        // Extract all code blocks from all stanzas for full scope analysis
        const allCodeBlocks = [];
        this.demo.stanzas.forEach(stanza => {
            stanza.blocks.forEach(block => {
                if (block.type === 'code') {
                    allCodeBlocks.push(block.content.join('\n'));
                }
            });
        });
        // Set up the full demo scope with all code blocks for analysis
        this.executor.setCodeBlocks(allCodeBlocks);
        console.log(`📊 Total code blocks for analysis: ${allCodeBlocks.length}`);
        console.log('✅ Demo initialized successfully!\n');
    }
    async cleanup() {
        await this.executor.cleanup();
    }
    /**
     * Execute the entire demo with scope persistence across all stanzas
     */
    async executeDemo() {
        console.log(`\n=== JAVASCRIPT DEMO: ${this.demo.name} ===`);
        if (this.demo.description) {
            console.log(`Description: ${this.demo.description}`);
        }
        console.log(`Total stanzas: ${this.demo.stanzas.length}\n`);
        const results = [];
        let codeBlockIndex = 0;
        // Extract all code blocks for upfront processing
        const codeBlocks = [];
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
                        if (line.trim())
                            console.log(`  ${line}`);
                    });
                    console.log('---\n');
                    // Add markdown block to results
                    const markdownResult = {
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
                    if (line.trim())
                        console.log(`  ${line}`);
                });
                // Convert multi-line content to single string for execution
                const codeContent = block.content.join('\n');
                // Set the code block for execution
                this.executor.setCodeBlocks([codeContent]);
                const { result, operationType, isPartial } = await this.executor.executeStanza(0);
                console.log(`\nOperation Type: ${operationType}`);
                console.log(`Current Scope Variables: [${Object.keys(this.executor.getScope()).join(', ')}]`);
                console.log('---\n');
                const executionResult = {
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
    async executeStanza(stanzaIndex) {
        if (stanzaIndex < 0 || stanzaIndex >= this.demo.stanzas.length) {
            throw new Error(`Invalid stanza index: ${stanzaIndex}`);
        }
        const stanza = this.demo.stanzas[stanzaIndex];
        console.log(`\n=== Executing Stanza: ${stanza.name} ===`);
        const results = [];
        let codeBlockIndex = 0;
        // Find the starting block index for this stanza in the full demo scope
        let stanzaStartBlockIndex = 0;
        for (let i = 0; i < stanzaIndex; i++) {
            const prevStanza = this.demo.stanzas[i];
            prevStanza.blocks.forEach(block => {
                if (block.type === 'code') {
                    stanzaStartBlockIndex++;
                }
            });
        }
        // Iterate through blocks within this stanza
        for (let blockIndex = 0; blockIndex < stanza.blocks.length; blockIndex++) {
            const block = stanza.blocks[blockIndex];
            if (block.type === 'markdown') {
                console.log('Markdown:');
                block.content.forEach(line => {
                    if (line.trim())
                        console.log(`  ${line}`);
                });
                console.log('---\n');
                // Skip markdown blocks - no output needed
                continue;
            }
            // Execute code block
            console.log('Code:');
            block.content.forEach(line => {
                if (line.trim())
                    console.log(`  ${line}`);
            });
            // Execute the code block using its index in the full demo scope
            const { result, operationType, isPartial, consoleOutput } = await this.executor.executeStanza(stanzaStartBlockIndex + codeBlockIndex);
            console.log(`\nOperation Type: ${operationType}`);
            console.log(`Current Scope Variables: [${Object.keys(this.executor.getScope()).join(', ')}]`);
            console.log('---\n');
            const executionResult = {
                stanzaIndex,
                stanzaName: stanza.name,
                blockIndex,
                blockType: block.type,
                operationType,
                isPartial,
                result,
                scope: this.executor.getScope(),
                consoleOutput: consoleOutput || result.consoleOutput || []
            };
            results.push(executionResult);
            codeBlockIndex++;
        }
        return results;
    }
    /**
     * Execute all watchers and return their results
     */
    async executeWatchers() {
        console.log('[JavaScriptDemoExecutor] Executing all watchers');
        await this.executor.executeAllWatchers();
        const watchResults = this.executor.getWatchResults();
        console.log('[JavaScriptDemoExecutor] Watch results:', watchResults);
        return watchResults;
    }
    /**
     * Get watchers info from the runtime
     */
    async getWatchersInfo() {
        return this.executor.getWatchersInfo();
    }
    /**
     * Clear watcher changes
     */
    async clearWatcherChanges() {
        this.executor.clearWatcherChanges();
    }
    /**
     * Get current scope state
     */
    getScope() {
        return this.executor.getScope();
    }
    /**
     * Reset scope for fresh execution
     */
    resetScope() {
        this.executor.resetScope();
    }
}
exports.JavaScriptDemoExecutor = JavaScriptDemoExecutor;
/**
 * Convenience function to execute a JavaScript demo
 */
async function executeJavaScriptDemo(demo, baseUrl) {
    const executor = new JavaScriptDemoExecutor(demo, baseUrl);
    try {
        await executor.initialize();
        return await executor.executeDemo();
    }
    finally {
        await executor.cleanup();
    }
}
