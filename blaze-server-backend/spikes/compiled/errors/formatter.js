"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatError = formatError;
exports.sendErrorResponse = sendErrorResponse;
const custom_errors_1 = require("./custom-errors");
const codes_1 = require("./codes");
function formatError(error) {
    if (error instanceof custom_errors_1.BaseError) {
        return {
            success: false,
            error: {
                code: error.code,
                message: error.message,
                details: error.details,
            },
        };
    }
    // Handle standard errors
    if (error instanceof Error) {
        return {
            success: false,
            error: {
                code: codes_1.ErrorCode.INTERNAL_ERROR,
                message: error.message,
            },
        };
    }
    // Handle unknown errors
    return {
        success: false,
        error: {
            code: codes_1.ErrorCode.INTERNAL_ERROR,
            message: 'An unknown error occurred',
        },
    };
}
function sendErrorResponse(res, error, statusCode = 500) {
    const errorResponse = formatError(error);
    res.status(statusCode).json(errorResponse);
}
