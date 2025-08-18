import { DemoFlow, StepResult, DemoExecutionContext } from '../types/DemoFlow';
/**
 * Demo Flow Executor - Main orchestrator for executing demo flows
 * Handles setup, step execution, and state monitoring
 */
export declare class DemoFlowExecutor {
    private httpClient;
    private variableResolver;
    private stateMonitor;
    private displayRenderer;
    private context;
    constructor(demoFlow: DemoFlow);
    execute(demoFlow: DemoFlow): Promise<StepResult[]>;
    private executeSetupPhase;
    private executeSteps;
    private executeStep;
    private updateVariableContext;
    getContext(): DemoExecutionContext;
}
//# sourceMappingURL=DemoFlowExecutor.d.ts.map