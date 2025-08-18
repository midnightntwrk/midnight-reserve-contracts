export interface Config {
    port: number;
    nodeEnv: string;
    logLevel: string;
    logFormat: 'json' | 'simple';
    sessionTimeoutMs: number;
    maxSessions: number;
    maxMemoryPerSessionMb: number;
    contractsDir: string;
    debugMode: boolean;
}
export declare const config: Config;
export declare function validateConfig(): void;
//# sourceMappingURL=index.d.ts.map