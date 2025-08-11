import { ErrorCode } from './codes';

export interface ErrorDetails {
  code: ErrorCode;
  message: string;
  details?: any;
}

export class BaseError extends Error {
  public readonly code: ErrorCode;
  public readonly details?: any;
  public readonly timestamp: Date;

  constructor(code: ErrorCode, message: string, details?: any) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    this.timestamp = new Date();
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): ErrorDetails {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export class SessionError extends BaseError {
  constructor(code: ErrorCode, message: string, details?: any) {
    super(code, message, details);
  }
}

export class WalletError extends BaseError {
  constructor(code: ErrorCode, message: string, details?: any) {
    super(code, message, details);
  }
}

export class ContractError extends BaseError {
  constructor(code: ErrorCode, message: string, details?: any) {
    super(code, message, details);
  }
}

export class TransactionError extends BaseError {
  constructor(code: ErrorCode, message: string, details?: any) {
    super(code, message, details);
  }
}

export class EmulatorError extends BaseError {
  constructor(code: ErrorCode, message: string, details?: any) {
    super(code, message, details);
  }
}