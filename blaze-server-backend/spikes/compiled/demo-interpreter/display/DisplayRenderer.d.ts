import { StateSnapshot, StepResult } from '../types/DemoFlow';
/**
 * Display Renderer for before/after state visualization
 * Creates structured console output with boxes and comparisons
 */
export declare class DisplayRenderer {
    renderStepHeader(stepIndex: number, stepName: string, description?: string): void;
    renderStateComparison(beforeState: StateSnapshot, afterState: StateSnapshot): void;
    private renderStateQuery;
    private renderValue;
    private isUtxo;
    private renderUtxo;
    renderRequestExecution(method: string, endpoint: string, body?: any): void;
    renderResponse(statusCode: number, data: any): void;
    renderStepSummary(result: StepResult): void;
    renderExecutionSummary(results: StepResult[]): void;
}
//# sourceMappingURL=DisplayRenderer.d.ts.map