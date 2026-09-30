import { config } from '../config/env.ts';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogContext {
  event?: string;
  requestId?: string;
  correlationId?: string;
  jobId?: string;
  documentId?: string;
  generationId?: string;
  outputId?: string;
  durationMs?: number;
  [key: string]: any;
}

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'password_salt',
  'token',
  'authtoken',
  'authorization',
  'ticket',
  'secret',
  'jwt',
  'api_key',
  'apikey',
  'cookie',
  'contentbase64',
  'rawtext',
  'buffer',
  'source_text',
  'prompt',
]);

/**
 * Recursively sanitize data to redact secrets, tokens, and raw uploaded text.
 * Handles circular references, Date objects, and Buffer objects safely.
 */
export function sanitizeLogData(data: any, seen = new WeakSet()): any {
  if (data === null || data === undefined) return data;

  if (typeof data === 'string') {
    // Redact Bearer tokens
    if (data.toLowerCase().startsWith('bearer ')) {
      return '[REDACTED_AUTHORIZATION_HEADER]';
    }
    // Redact JWT and session tokens
    if (
      data.startsWith('ey') ||
      (data.startsWith('usr_') && data.includes('|') && data.length > 50)
    ) {
      return '[REDACTED_TOKEN]';
    }
    // Redact SSE tickets
    if (data.startsWith('tkt_')) {
      return '[REDACTED_SSE_TICKET]';
    }
    return data;
  }

  if (typeof data === 'number' || typeof data === 'boolean' || typeof data === 'symbol' || typeof data === 'bigint') {
    return data;
  }

  if (data instanceof Date) {
    return data.toISOString();
  }

  if (typeof Buffer !== 'undefined' && Buffer.isBuffer && Buffer.isBuffer(data)) {
    return `[BUFFER_${data.length}_BYTES]`;
  }

  if (typeof data === 'object') {
    if (seen.has(data)) {
      return '[CIRCULAR_REF]';
    }
    seen.add(data);

    if (Array.isArray(data)) {
      return data.map((item) => sanitizeLogData(item, seen));
    }

    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_KEYS.has(lowerKey)) {
        sanitized[key] = `[REDACTED_${key.toUpperCase()}]`;
      } else {
        sanitized[key] = sanitizeLogData(value, seen);
      }
    }
    return sanitized;
  }

  return String(data);
}

class StructuredLogger {
  private formatLog(level: LogLevel, message: string, context?: LogContext): string {
    const entry: Record<string, any> = {
      timestamp: new Date().toISOString(),
      level,
      service: 'contentx',
      environment: config.env || 'development',
      message,
    };

    if (context) {
      const sanitizedCtx = sanitizeLogData(context);
      if (typeof sanitizedCtx === 'object' && sanitizedCtx !== null && !Array.isArray(sanitizedCtx)) {
        for (const [k, v] of Object.entries(sanitizedCtx)) {
          if (v !== undefined) {
            entry[k] = v;
          }
        }
      }
    }

    return JSON.stringify(entry);
  }

  public info(message: string, context?: LogContext): void {
    console.log(this.formatLog('info', message, context));
  }

  public warn(message: string, context?: LogContext): void {
    console.warn(this.formatLog('warn', message, context));
  }

  public error(message: string, context?: LogContext): void {
    console.error(this.formatLog('error', message, context));
  }

  public debug(message: string, context?: LogContext): void {
    if (config.env !== 'production') {
      console.log(this.formatLog('debug', message, context));
    }
  }
}

export const logger = new StructuredLogger();
