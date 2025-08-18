import { ErrorCode } from './codes';
export interface ErrorDetails {
    code: ErrorCode;
    message: string;
    details?: any;
}
export declare class BaseError extends Error {
    readonly code: ErrorCode;
    readonly details?: any;
    readonly timestamp: Date;
    constructor(code: ErrorCode, message: string, details?: any);
    toJSON(): ErrorDetails;
}
export declare class SessionError extends BaseError {
    constructor(code: ErrorCode, message: string, details?: any);
}
export declare class WalletError extends BaseError {
    constructor(code: ErrorCode, message: string, details?: any);
}
export declare class ContractError extends BaseError {
    constructor(code: ErrorCode, message: string, details?: any);
}
export declare class TransactionError extends BaseError {
    constructor(code: ErrorCode, message: string, details?: any);
}
export declare class EmulatorError extends BaseError {
    constructor(code: ErrorCode, message: string, details?: any);
}
//# sourceMappingURL=custom-errors.d.ts.map