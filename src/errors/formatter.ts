import { Response } from 'express';
import { BaseError } from './custom-errors';
import { ErrorCode } from './codes';

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
}

export function formatError(error: unknown): ErrorResponse {
  if (error instanceof BaseError) {
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
        code: ErrorCode.INTERNAL_ERROR,
        message: error.message,
      },
    };
  }

  // Handle unknown errors
  return {
    success: false,
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'An unknown error occurred',
    },
  };
}

export function sendErrorResponse(res: Response, error: unknown, statusCode: number = 500): void {
  const errorResponse = formatError(error);
  res.status(statusCode).json(errorResponse);
}