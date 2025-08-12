import { describe, test, expect } from 'bun:test';
import { execSync } from 'child_process';
import { config, validateConfig } from '../../config';
import { logger } from '../../utils/logger';

describe('Phase 0.1: Prerequisites', () => {
  test('should have Node.js version >= 18.0.0', () => {
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.split('.')[0].substring(1));
    
    expect(majorVersion).toBeGreaterThanOrEqual(18);
    console.log('✓ Node.js version:', nodeVersion);
  });

  test('should have Aiken CLI installed', () => {
    try {
      // Try the user's aiken installation first
      const aikenPath = 'aiken';
      const aikenVersion = execSync(`${aikenPath} --version`, { encoding: 'utf-8' }).trim();

      expect(aikenVersion).toMatch(/aiken v?\d+\.\d+\.\d+/);

      console.log('✓ Aiken CLI version:', aikenVersion);
      console.log('  Using Aiken from:', aikenPath);
    } catch (error) {
      console.error('Error executing Aiken:', error);

      throw new Error('Aiken CLI not found. Please install it from https://aiken-lang.org');
    }
  });

  test('should load configuration from environment', () => {
    expect(config).toBeDefined();
    expect(config.port).toBeDefined();
    expect(config.logLevel).toBeDefined();
    expect(config.sessionTimeoutMs).toBeDefined();
    
    // Validate configuration
    expect(() => validateConfig()).not.toThrow();
    console.log('✓ Configuration loaded successfully');
    console.log('  - Port:', config.port);
    console.log('  - Log level:', config.logLevel);
    console.log('  - Max sessions:', config.maxSessions);
  });

  test('should initialize logger', () => {
    expect(logger).toBeDefined();
    
    // Test logging at different levels
    logger.debug('Debug message test');
    logger.info('Info message test');
    logger.warn('Warning message test');
    
    console.log('✓ Logger initialized with level:', config.logLevel);
  });

  test('should have correct project structure', () => {
    const fs = require('fs');
    const path = require('path');
    
    const requiredDirs = [
      'src/errors',
      'src/config',
      'src/utils',
      'src/tests',
    ];
    
    for (const dir of requiredDirs) {
      const dirPath = path.join(process.cwd(), dir);
      expect(fs.existsSync(dirPath)).toBe(true);
    }
    
    console.log('✓ Project structure verified');
  });
});
