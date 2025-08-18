import { DemoFlow } from '../types/DemoFlow';
/**
 * YAML Demo Flow Parser with Implicit Session Handling
 * Parses and validates YAML demo flows
 */
export declare class DemoFlowParser {
    parseYaml(yamlContent: string): DemoFlow;
    private validateDemoFlow;
    private validateConfig;
    private validateSteps;
    private validateStep;
    private validateHttpRequest;
    private validateMonitor;
    private validateStateQuery;
    private validateString;
}
//# sourceMappingURL=DemoFlowParser.d.ts.map