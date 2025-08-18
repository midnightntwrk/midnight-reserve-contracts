export interface ExecutionResult {
    result: any;
    operationType: string;
    isPartial: boolean;
    consoleOutput?: string[];
    watchResults?: Record<string, any>;
}
export declare class IntegratedDemoExecutor {
    private scopeManager;
    private dryRuntime;
    private realRuntime;
    private codeBlocks;
    private rewrittenBlocks;
    constructor(config?: {
        baseUrl?: string;
        contracts?: Record<string, string>;
        debug?: boolean;
    });
    initialize(): Promise<void>;
    setCodeBlocks(codeBlocks: string[]): void;
    cleanup(): Promise<void>;
    executeSingleCodeBlock(codeContent: string): Promise<any>;
    executeCodeBlock(blockIndex: number): Promise<any>;
    executeStanza(blockIndex: number): Promise<ExecutionResult>;
    executeCodeBlockWithScope(blockIndex: number, scope: Record<string, any>): Promise<any>;
    executeAllWatchers(): Promise<void>;
    getWatchResults(): Record<string, any>;
    getWatchersInfo(): any[];
    clearWatcherChanges(): void;
    getScope(): Record<string, any>;
    resetScope(): void;
}
//# sourceMappingURL=IntegratedDemoExecutor.d.ts.map