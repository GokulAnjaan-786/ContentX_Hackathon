import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { metricsRegistry } from '../services/metricsService.ts';
import { logger } from '../utils/logger.ts';

export interface CorrelatedRequest extends Request {
  requestId?: string;
  correlationId?: string;
  startTimeMs?: number;
}

const SAFE_ID_REGEX = /^[a-zA-Z0-9_\-]{1,64}$/;

/**
 * Validate incoming request / correlation ID to prevent log injection or header corruption.
 */
export function sanitizeRequestId(incoming?: string | string[]): string | null {
  if (!incoming) return null;
  const str = Array.isArray(incoming) ? incoming[0] : incoming;
  if (typeof str !== 'string') return null;
  const trimmed = str.trim();
  if (SAFE_ID_REGEX.test(trimmed)) {
    return trimmed;
  }
  return null;
}

/**
 * Express Middleware for Request & Correlation ID Tracking, Metrics, and Structured Logging.
 */
export function correlationMiddleware(
  req: CorrelatedRequest,
  res: Response,
  next: NextFunction
): void {
  const incomingReqId =
    req.headers['x-request-id'] || req.headers['x-correlation-id'];
  const validId = sanitizeRequestId(incomingReqId);

  const requestId = validId || `req_${crypto.randomBytes(12).toString('hex')}`;
  req.requestId = requestId;
  req.correlationId = requestId;
  req.startTimeMs = Date.now();

  res.setHeader('X-Request-ID', requestId);

  // Increment active request metrics gauge
  metricsRegistry.httpActiveRequests.inc();

  // Normalize route path for low-cardinality Prometheus labels
  res.on('finish', () => {
    const durationMs = Date.now() - (req.startTimeMs || Date.now());
    const durationSec = durationMs / 1000;
    const statusCode = String(res.statusCode);
    const method = req.method;

    // Standard low-cardinality route extraction
    const routePath = normalizeRoutePath(req.baseUrl || req.path);

    // Update Prometheus Metrics
    metricsRegistry.httpActiveRequests.dec();
    metricsRegistry.httpRequestsTotal.inc({
      method,
      route: routePath,
      status_code: statusCode,
    });
    metricsRegistry.httpRequestDuration.observe(durationSec, {
      method,
      route: routePath,
      status_code: statusCode,
    });

    // Structured Log (excluding health checks unless warning/error to keep logs clean)
    if (routePath !== '/health' && routePath !== '/readiness' && routePath !== '/metrics') {
      logger.info(`HTTP ${method} ${routePath} ${statusCode}`, {
        event: 'http_request',
        requestId,
        correlationId: requestId,
        method,
        path: routePath,
        statusCode: res.statusCode,
        durationMs,
      });
    }
  });

  next();
}

/**
 * Map raw request URLs to low-cardinality route templates for metrics.
 */
function normalizeRoutePath(path: string): string {
  if (!path) return '/';
  if (path === '/health' || path === '/readiness' || path === '/metrics') return path;
  if (path.startsWith('/api/auth/')) return '/api/auth/:action';
  if (path.startsWith('/api/documents/upload')) return '/api/documents/upload';
  if (path.startsWith('/api/documents/') && path.endsWith('/reprocess')) return '/api/documents/:id/reprocess';
  if (path.startsWith('/api/documents/') && path.endsWith('/forensic-trace')) return '/api/documents/:id/forensic-trace';
  if (path.startsWith('/api/documents/') && path.endsWith('/analyze')) return '/api/documents/:id/analyze';
  if (path.startsWith('/api/documents/') && path.endsWith('/understanding')) return '/api/documents/:id/understanding';
  if (path.startsWith('/api/documents/') && path.endsWith('/facts')) return '/api/documents/:id/facts';
  if (path.startsWith('/api/documents/') && path.split('/').length === 4) return '/api/documents/:id';
  if (path === '/api/documents') return '/api/documents';
  if (path === '/api/facts') return '/api/facts';
  if (path.startsWith('/api/facts/')) return '/api/facts/:id';
  if (path === '/api/transform' || path === '/api/generate') return '/api/transform';
  if (path.startsWith('/api/generation/') && path.endsWith('/events/ticket')) return '/api/generation/:job_id/events/ticket';
  if (path.startsWith('/api/generation/') && path.endsWith('/events')) return '/api/generation/:job_id/events';
  if (path.startsWith('/api/generation/')) return '/api/generation/:job_id';
  if (path === '/api/outputs') return '/api/outputs';
  if (path.startsWith('/api/outputs/') && path.endsWith('/validate')) return '/api/outputs/:id/validate';
  if (path.startsWith('/api/outputs/') && path.endsWith('/claims')) return '/api/outputs/:id/claims';
  if (path.startsWith('/api/outputs/')) return '/api/outputs/:id';
  if (path.startsWith('/api/verification/')) return '/api/verification/:id';
  if (path === '/api/provenance') return '/api/provenance';
  if (path === '/api/history') return '/api/history';
  if (path === '/api/analytics') return '/api/analytics';
  if (path === '/api/domains') return '/api/domains';
  if (path === '/api/provider-status') return '/api/provider-status';
  if (path === '/api/settings/provider') return '/api/settings/provider';
  
  return path.startsWith('/api/') ? '/api/other' : 'static';
}
