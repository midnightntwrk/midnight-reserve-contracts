export interface DemoBlock {
    type: 'markdown' | 'code';
    language?: string;
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
    consoleOutput?: string[];
}
/**
 * JavaScript Demo Executor - Main orchestrator for executing JavaScript-based demos
 * Handles scope persistence, operation detection, and progressive execution
 */
export declare class JavaScriptDemoExecutor {
    private executor;
    private demo;
    constructor(demo: JavaScriptDemo, baseUrl?: string);
    /**
     * Initialize the demo executor with the full demo scope
     */
    initialize(): Promise<void>;
    cleanup(): Promise<void>;
    /**
     * Execute the entire demo with scope persistence across all stanzas
     */
    executeDemo(): Promise<DemoExecutionResult[]>;
    /**
     * Execute a single stanza by index
     */
    executeStanza(stanzaIndex: number): Promise<DemoExecutionResult[]>;
    /**
     * Execute all watchers and return their results
     */
    executeWatchers(): Promise<Record<string, any>>;
    /**
     * Get watchers info from the runtime
     */
    getWatchersInfo(): Promise<any[]>;
    /**
     * Clear watcher changes
     */
    clearWatcherChanges(): Promise<void>;
    /**
     * Get current scope state
     */
    getScope(): Record<string, any>;
    /**
     * Reset scope for fresh execution
     */
    resetScope(): void;
}
/**
 * Convenience function to execute a JavaScript demo
 */
export declare function executeJavaScriptDemo(demo: JavaScriptDemo, baseUrl?: string): Promise<DemoExecutionResult[]>;
//# sourceMappingURL=JavaScriptDemoExecutor.d.ts.map