"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DemoFlowExecutor = void 0;
const HttpClient_1 = require("./HttpClient");
const VariableResolver_1 = require("./VariableResolver");
const StateMonitor_1 = require("./StateMonitor");
const DisplayRenderer_1 = require("../display/DisplayRenderer");
/**
 * Demo Flow Executor - Main orchestrator for executing demo flows
 * Handles setup, step execution, and state monitoring
 */
class DemoFlowExecutor {
    constructor(demoFlow) {
        this.httpClient = new HttpClient_1.HttpClient(demoFlow.config.baseUrl);
        this.stateMonitor = new StateMonitor_1.StateMonitor(this.httpClient);
        this.displayRenderer = new DisplayRenderer_1.DisplayRenderer();
        this.context = {
            sessionId: null,
            stepResults: [],
            config: demoFlow.config,
            variables: {}
        };
        const variableContext = {
            r: [],
            config: demoFlow.config
        };
        this.variableResolver = new VariableResolver_1.VariableResolver(variableContext);
    }
    async execute(demoFlow) {
        console.log(`\n=== DEMO FLOW: ${demoFlow.name} ===`);
        console.log(`Description: ${demoFlow.description}`);
        console.log(`Version: ${demoFlow.version}\n`);
        try {
            // Execute setup phase
            await this.executeSetupPhase(demoFlow.setup);
            // Execute main steps
            await this.executeSteps(demoFlow.steps);
            this.displayRenderer.renderExecutionSummary(this.context.stepResults);
            return this.context.stepResults;
        }
        catch (error) {
            console.error('\n=== DEMO FAILED ===');
            console.error(`Error: ${error.message}\n`);
            throw error;
        }
    }
    async executeSetupPhase(setupSteps) {
        console.log('--- SETUP PHASE ---');
        // Create session automatically
        if (setupSteps.length > 0) {
            console.log('Creating new session...');
            this.context.sessionId = await this.httpClient.createSession();
            console.log(`Session created: ${this.context.sessionId}\n`);
        }
        // Execute setup steps
        for (let i = 0; i < setupSteps.length; i++) {
            const step = setupSteps[i];
            console.log(`Setup ${i}: ${step.name}`);
            if (step.description) {
                console.log(`  ${step.description}`);
            }
            const result = await this.executeStep(step, i);
            this.context.stepResults.push(result);
            this.updateVariableContext();
            console.log(`  ✓ Completed\n`);
        }
    }
    async executeSteps(steps) {
        console.log('--- DEMO STEPS ---');
        for (let i = 0; i < steps.length; i++) {
            const step = steps[i];
            const stepIndex = this.context.stepResults.length;
            this.displayRenderer.renderStepHeader(stepIndex, step.name, step.description);
            const result = await this.executeStep(step, stepIndex);
            this.context.stepResults.push(result);
            this.updateVariableContext();
            this.displayRenderer.renderStepSummary(result);
            this.displayRenderer.renderStateComparison(result.beforeState, result.afterState);
        }
    }
    async executeStep(step, stepIndex) {
        const startTime = Date.now();
        // Capture before state if monitoring is enabled and session exists
        let beforeState = { timestamp: startTime, data: {} };
        if (step.monitor && this.context.sessionId) {
            console.log('Capturing before state...');
            this.stateMonitor.setSessionId(this.context.sessionId);
            const resolvedMonitor = this.variableResolver.resolve(step.monitor);
            beforeState = await this.stateMonitor.queryState(resolvedMonitor);
        }
        // Resolve variables in the request
        const resolvedRequest = this.variableResolver.resolve(step.request);
        this.displayRenderer.renderRequestExecution(resolvedRequest.method, resolvedRequest.endpoint, resolvedRequest.body);
        // Execute the request
        const response = await this.httpClient.request(resolvedRequest);
        this.displayRenderer.renderResponse(response.statusCode, response.data);
        // Capture after state if monitoring is enabled and session exists
        let afterState = { timestamp: Date.now(), data: {} };
        if (step.monitor && this.context.sessionId) {
            console.log('Capturing after state...');
            this.stateMonitor.setSessionId(this.context.sessionId);
            const resolvedMonitor = this.variableResolver.resolve(step.monitor);
            afterState = await this.stateMonitor.queryState(resolvedMonitor);
        }
        const executionTime = Date.now() - startTime;
        return {
            stepName: step.name,
            response: response.data,
            statusCode: response.statusCode,
            beforeState,
            afterState,
            executionTime
        };
    }
    updateVariableContext() {
        const variableContext = {
            r: this.context.stepResults.map(result => result.response),
            config: this.context.config
        };
        this.variableResolver.updateContext(variableContext);
    }
    getContext() {
        return { ...this.context };
    }
}
exports.DemoFlowExecutor = DemoFlowExecutor;
