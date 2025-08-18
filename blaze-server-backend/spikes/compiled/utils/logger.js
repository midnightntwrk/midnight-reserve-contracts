"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
exports.createLogger = createLogger;
const winston_1 = __importDefault(require("winston"));
const config_1 = require("../config");
const { combine, timestamp, json, simple, colorize, printf } = winston_1.default.format;
// Custom format for simple output
const simpleFormat = printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} [${level}] ${message}`;
    if (Object.keys(metadata).length > 0) {
        msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
});
// Create the logger instance
exports.logger = winston_1.default.createLogger({
    level: config_1.config.logLevel,
    format: config_1.config.logFormat === 'json'
        ? combine(timestamp(), json())
        : combine(timestamp(), colorize(), simpleFormat),
    transports: [
        new winston_1.default.transports.Console({
            silent: process.env.NODE_ENV === 'test' && !config_1.config.debugMode,
        }),
    ],
});
// Add request ID to child loggers
function createLogger(requestId) {
    if (requestId) {
        return exports.logger.child({ requestId });
    }
    return exports.logger;
}
// Log unhandled errors
process.on('unhandledRejection', (reason, promise) => {
    exports.logger.error('Unhandled Rejection at:', { promise, reason });
});
process.on('uncaughtException', (error) => {
    exports.logger.error('Uncaught Exception:', error);
    process.exit(1);
});
