"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmulatorError = exports.TransactionError = exports.ContractError = exports.WalletError = exports.SessionError = exports.BaseError = void 0;
class BaseError extends Error {
    constructor(code, message, details) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.details = details;
        this.timestamp = new Date();
        Error.captureStackTrace(this, this.constructor);
    }
    toJSON() {
        return {
            code: this.code,
            message: this.message,
            details: this.details,
        };
    }
}
exports.BaseError = BaseError;
class SessionError extends BaseError {
    constructor(code, message, details) {
        super(code, message, details);
    }
}
exports.SessionError = SessionError;
class WalletError extends BaseError {
    constructor(code, message, details) {
        super(code, message, details);
    }
}
exports.WalletError = WalletError;
class ContractError extends BaseError {
    constructor(code, message, details) {
        super(code, message, details);
    }
}
exports.ContractError = ContractError;
class TransactionError extends BaseError {
    constructor(code, message, details) {
        super(code, message, details);
    }
}
exports.TransactionError = TransactionError;
class EmulatorError extends BaseError {
    constructor(code, message, details) {
        super(code, message, details);
    }
}
exports.EmulatorError = EmulatorError;
