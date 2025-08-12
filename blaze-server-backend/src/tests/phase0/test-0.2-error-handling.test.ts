import { describe, test, expect } from 'bun:test';
import {
  ErrorCode,
  BaseError,
  SessionError,
  WalletError,
  ContractError,
  TransactionError,
  EmulatorError,
  formatError,
} from '../../errors';

describe('Phase 0.2: Error Handling Foundation', () => {
  test('should have all error codes defined', () => {
    expect(ErrorCode.SESSION_NOT_FOUND).toBeDefined();
    expect(ErrorCode.WALLET_NOT_FOUND).toBeDefined();
    expect(ErrorCode.CONTRACT_NOT_FOUND).toBeDefined();
    expect(ErrorCode.TRANSACTION_BUILD_FAILED).toBeDefined();
    expect(ErrorCode.EMULATOR_INIT_FAILED).toBeDefined();
    
    console.log('✓ Error codes enum defined with', Object.keys(ErrorCode).length, 'codes');
  });

  test('should create custom error instances correctly', () => {
    const sessionError = new SessionError(
      ErrorCode.SESSION_NOT_FOUND,
      'Session not found',
      { sessionId: 'test-123' }
    );
    
    expect(sessionError).toBeInstanceOf(SessionError);
    expect(sessionError).toBeInstanceOf(BaseError);
    expect(sessionError).toBeInstanceOf(Error);
    expect(sessionError.code).toBe(ErrorCode.SESSION_NOT_FOUND);
    expect(sessionError.message).toBe('Session not found');
    expect(sessionError.details).toEqual({ sessionId: 'test-123' });
    expect(sessionError.timestamp).toBeInstanceOf(Date);
    
    console.log('✓ Custom error classes work correctly');
  });

  test('should format errors consistently', () => {
    const error = new WalletError(
      ErrorCode.INSUFFICIENT_BALANCE,
      'Not enough ADA',
      { required: 1000000, available: 500000 }
    );
    
    const formatted = formatError(error);
    
    expect(formatted.success).toBe(false);
    expect(formatted.error.code).toBe(ErrorCode.INSUFFICIENT_BALANCE);
    expect(formatted.error.message).toBe('Not enough ADA');
    expect(formatted.error.details).toEqual({
      required: 1000000,
      available: 500000,
    });
    
    console.log('✓ Error formatter produces consistent format');
  });

  test('should handle standard errors', () => {
    const standardError = new Error('Something went wrong');
    const formatted = formatError(standardError);
    
    expect(formatted.success).toBe(false);
    expect(formatted.error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(formatted.error.message).toBe('Something went wrong');
    
    console.log('✓ Standard errors are handled gracefully');
  });

  test('should handle unknown errors', () => {
    const unknownError = 'This is not an error object';
    const formatted = formatError(unknownError);
    
    expect(formatted.success).toBe(false);
    expect(formatted.error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(formatted.error.message).toBe('An unknown error occurred');
    
    console.log('✓ Unknown errors are handled safely');
  });

  test('should serialize errors to JSON', () => {
    const error = new ContractError(
      ErrorCode.CONTRACT_COMPILATION_FAILED,
      'Aiken compilation failed',
      { contractName: 'hello_world', error: 'Syntax error on line 5' }
    );
    
    const json = error.toJSON();
    
    expect(json.code).toBe(ErrorCode.CONTRACT_COMPILATION_FAILED);
    expect(json.message).toBe('Aiken compilation failed');
    expect(json.details).toBeDefined();
    
    console.log('✓ Errors serialize to JSON correctly');
  });

  test('should capture stack traces', () => {
    const error = new TransactionError(
      ErrorCode.TRANSACTION_BUILD_FAILED,
      'Failed to build transaction'
    );
    
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('TransactionError');
    expect(error.stack).toContain('test-0.2-error-handling.test.ts');
    
    console.log('✓ Stack traces are captured');
  });
});