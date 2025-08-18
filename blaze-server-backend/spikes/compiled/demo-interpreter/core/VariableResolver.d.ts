import { VariableContext } from '../types/DemoFlow';
/**
 * Variable Resolver for r[i] references and built-in functions
 * Handles template string resolution with {{...}} syntax
 */
export declare class VariableResolver {
    private context;
    constructor(context: VariableContext);
    updateContext(context: VariableContext): void;
    /**
     * Resolve template strings with {{...}} syntax
     */
    resolve(template: any): any;
    private resolveString;
    private evaluateExpression;
    private resolvePath;
    private isFunctionCall;
    private callBuiltInFunction;
    private parseArguments;
    private parseArgument;
}
//# sourceMappingURL=VariableResolver.d.ts.map