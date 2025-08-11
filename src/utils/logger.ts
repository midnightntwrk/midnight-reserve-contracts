import winston from 'winston';
import { config } from '../config';

const { combine, timestamp, json, simple, colorize, printf } = winston.format;

// Custom format for simple output
const simpleFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}] ${message}`;
  if (Object.keys(metadata).length > 0) {
    msg += ` ${JSON.stringify(metadata)}`;
  }
  return msg;
});

// Create the logger instance
export const logger = winston.createLogger({
  level: config.logLevel,
  format: config.logFormat === 'json'
    ? combine(
        timestamp(),
        json()
      )
    : combine(
        timestamp(),
        colorize(),
        simpleFormat
      ),
  transports: [
    new winston.transports.Console({
      silent: process.env.NODE_ENV === 'test' && !config.debugMode,
    }),
  ],
});

// Add request ID to child loggers
export function createLogger(requestId?: string) {
  if (requestId) {
    return logger.child({ requestId });
  }
  return logger;
}

// Log unhandled errors
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', { promise, reason });
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});