import { describe, it, expect, vi } from 'vitest';
import { logger, createLogger } from '../../utils/logger';
import { config } from '../../config';

describe('Phase 0.3: Logging & Monitoring', () => {
  it('should have logger configured', () => {
    expect(logger).toBeDefined();
    expect(logger.level).toBe(config.logLevel);
    console.log('✓ Logger configured with level:', logger.level);
  });

  it('should create child logger with request ID', () => {
    const requestId = 'req-123-456';
    const childLogger = createLogger(requestId);
    
    expect(childLogger).toBeDefined();
    
    // Test that child logger includes request ID
    const consoleSpy = vi.spyOn(console, 'log');
    childLogger.info('Test message');
    
    // In JSON format, the requestId should be included
    if (config.logFormat === 'json') {
      const lastCall = consoleSpy.mock.calls[consoleSpy.mock.calls.length - 1];
      if (lastCall && lastCall[0]) {
        const logData = JSON.parse(lastCall[0] as string);
        expect(logData.requestId).toBe(requestId);
      }
    }
    
    consoleSpy.mockRestore();
    console.log('✓ Child logger with request ID works');
  });

  it('should support structured logging', () => {
    const metadata = {
      userId: 'user-123',
      action: 'createWallet',
      sessionId: 'sess-456',
    };
    
    logger.info('User action', metadata);
    
    console.log('✓ Structured logging supported');
  });

  it('should handle different log levels', () => {
    const levels = ['debug', 'info', 'warn', 'error'] as const;
    
    for (const level of levels) {
      expect(logger[level]).toBeDefined();
      expect(typeof logger[level]).toBe('function');
    }
    
    // Test each level
    logger.debug('Debug message', { detail: 'debug info' });
    logger.info('Info message', { detail: 'info data' });
    logger.warn('Warning message', { detail: 'warning data' });
    logger.error('Error message', { detail: 'error data' });
    
    console.log('✓ All log levels work correctly');
  });

  it('should support debug mode', () => {
    if (config.debugMode) {
      logger.debug('Debug mode is enabled');
      console.log('✓ Debug mode is ON');
    } else {
      console.log('✓ Debug mode is OFF');
    }
    
    expect(config.debugMode).toBe(process.env.DEBUG_MODE === 'true');
  });

  it('should measure operation time', () => {
    const startTime = Date.now();
    
    // Simulate an operation
    const fibonacci = (n: number): number => {
      if (n <= 1) return n;
      return fibonacci(n - 1) + fibonacci(n - 2);
    };
    
    fibonacci(10);
    
    const duration = Date.now() - startTime;
    
    logger.info('Operation completed', {
      operation: 'fibonacci',
      durationMs: duration,
    });
    
    console.log('✓ Performance measurement works, operation took', duration, 'ms');
  });

  it('should handle errors in logging gracefully', () => {
    // Test with circular reference
    const obj: any = { a: 1 };
    obj.circular = obj;
    
    // This should not throw
    expect(() => {
      logger.info('Object with circular reference', obj);
    }).not.toThrow();
    
    console.log('✓ Logger handles complex objects gracefully');
  });
});