"use strict";
/**
 * Demo Flow Interpreter - Main Entry Point
 *
 * Provides a simple interface for loading and executing demo flows
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntegratedDemoExecutor = exports.executeJavaScriptDemo = exports.JavaScriptDemoExecutor = void 0;
// JavaScript Demo Executor (with scope persistence)
var JavaScriptDemoExecutor_1 = require("./core/JavaScriptDemoExecutor");
Object.defineProperty(exports, "JavaScriptDemoExecutor", { enumerable: true, get: function () { return JavaScriptDemoExecutor_1.JavaScriptDemoExecutor; } });
Object.defineProperty(exports, "executeJavaScriptDemo", { enumerable: true, get: function () { return JavaScriptDemoExecutor_1.executeJavaScriptDemo; } });
// Integrated Demo Executor (core scope management)
var IntegratedDemoExecutor_1 = require("./core/IntegratedDemoExecutor");
Object.defineProperty(exports, "IntegratedDemoExecutor", { enumerable: true, get: function () { return IntegratedDemoExecutor_1.IntegratedDemoExecutor; } });
