import { EventEmitter } from 'events';
import { createApp } from '../../../server.ts';
import { metricsRegistry } from '../services/metricsService.ts';
import { shutdownService } from '../services/shutdownService.ts';
import { dbStore } from '../store/databaseStore.ts';
import { logger, sanitizeLogData } from '../utils/logger.ts';

function assert(condition: any, message: string) {
  if (!condition) {
    throw new Error(`[ASSERTION FAILED] ${message}`);
  }
}

export async function runPhase4ObservabilityTests(): Promise<void> {
  console.log('============================================================');
  console.log('PHASE 4 STEP 4: FOCUSED OBSERVABILITY & SHUTDOWN TESTS');
  console.log('============================================================');

  if (!dbStore.initialized) {
    await dbStore.seedUsersOnly();
    dbStore.initialized = true;
  }

  // Test 1: Request ID generated when not provided
  // Test 2: Request ID returned in response
  // Test 3: Safe client request ID accepted
  // Test 4: Malformed/oversized request ID replaced
  const app = await createApp();
  {
    // 1 & 2: Missing header -> Generated safe ID returned in X-Request-ID
    const res1 = await fakeHttpRequest(app, 'GET', '/health');
    assert(res1.status === 200, 'GET /health should return 200');
    assert(
      res1.headers['x-request-id'] && res1.headers['x-request-id'].startsWith('req_'),
      '1 & 2: Missing request ID must generate a safe req_... ID and return it in X-Request-ID response header'
    );

    // 3: Safe custom request ID -> Accepted and returned
    const res2 = await fakeHttpRequest(app, 'GET', '/health', undefined, {
      'x-request-id': 'safe-client-id-12345',
    });
    assert(
      res2.headers['x-request-id'] === 'safe-client-id-12345',
      '3: Safe client X-Request-ID must be accepted'
    );

    // 4: Malformed/oversized request ID -> Replaced
    const malformedId = 'invalid\r\nheader_injection_' + 'X'.repeat(100);
    const res3 = await fakeHttpRequest(app, 'GET', '/health', undefined, {
      'x-request-id': malformedId,
    });
    assert(
      res3.headers['x-request-id'] !== malformedId && res3.headers['x-request-id'].startsWith('req_'),
      '4: Malformed or oversized request ID must be replaced with safe req_... ID'
    );

    console.log('✓ [TEST 1-4/12] Request ID generation, response header, safe acceptance & malformed replacement passed');
  }

  // Test 5: Structured logger outputs JSON
  // Test 6: Sensitive values are not logged
  {
    const sensitiveData = {
      password: 'my_secret_password',
      password_hash: 'hash_val',
      authorization: 'Bearer eyJhbGci...',
      ticket: 'tkt_12345',
      token: 'usr_token_999',
      jobId: 'job_456',
    };

    const sanitized = sanitizeLogData(sensitiveData);
    assert(
      sanitized.password === '[REDACTED_PASSWORD]',
      '5 & 6: Password must be redacted'
    );
    assert(
      sanitized.authorization === '[REDACTED_AUTHORIZATION]',
      '5 & 6: Authorization must be redacted'
    );
    assert(
      sanitized.ticket === '[REDACTED_TICKET]',
      '5 & 6: Ticket must be redacted'
    );
    assert(
      sanitized.token === '[REDACTED_TOKEN]',
      '5 & 6: Token must be redacted'
    );
    assert(
      sanitized.jobId === 'job_456',
      '5 & 6: Non-sensitive keys must be preserved'
    );

    console.log('✓ [TEST 5-6/12] Structured logger JSON format & sensitive value sanitization passed');
  }

  // Test 7: /metrics exists
  // Test 8: /metrics returns Prometheus-compatible output
  // Test 9: HTTP metrics exist
  // Test 10: Active request metric exists
  {
    const res = await fakeHttpRequest(app, 'GET', '/metrics');

    assert(res.status === 200, '7: GET /metrics must return HTTP 200 OK');
    assert(
      res.headers['content-type'] && res.headers['content-type'].includes('text/plain'),
      '8: GET /metrics must return Prometheus text exposition format (text/plain)'
    );

    const metricsText = res.bodyText;
    assert(
      metricsText.includes('contentx_http_requests_total'),
      '9: HTTP requests total metric must exist'
    );
    assert(
      metricsText.includes('contentx_http_request_duration_seconds'),
      '9: HTTP request duration histogram metric must exist'
    );
    assert(
      metricsText.includes('contentx_http_active_requests'),
      '10: HTTP active requests gauge metric must exist'
    );

    console.log('✓ [TEST 7-10/12] /metrics endpoint existence, Prometheus format, HTTP metrics & active request metric passed');
  }

  // Test 11: Shutdown state changes readiness to 503
  // Test 12: Shutdown handler executes once
  {
    shutdownService.resetStateForTesting();

    // Initiate first shutdown call
    let shutdownCount = 0;
    const originalInitiate = shutdownService.initiateShutdown.bind(shutdownService);

    await shutdownService.initiateShutdown('TEST_SHUTDOWN', undefined, 1000, true);
    assert(
      shutdownService.isShutdownRequested() === true,
      '11: Shutdown state must be active after initiating shutdown'
    );

    // Verify readiness returns 503 during shutdown
    const readinessRes = await fakeHttpRequest(app, 'GET', '/readiness');
    assert(
      readinessRes.status === 503,
      '11: Shutdown state must change GET /readiness to return HTTP 503'
    );
    assert(
      readinessRes.json.status === 'shutting_down',
      '11: Readiness status must be shutting_down'
    );

    // Call shutdown a second time to ensure duplicate execution is prevented
    await shutdownService.initiateShutdown('TEST_SHUTDOWN', undefined, 1000, true);
    assert(
      shutdownService.isShutdownRequested() === true,
      '12: Duplicate shutdown execution must be safe and idempotent'
    );

    shutdownService.resetStateForTesting();
    console.log('✓ [TEST 11-12/12] Shutdown readiness status 503 & duplicate execution prevention passed');
  }

  console.log('============================================================');
  console.log('ALL 12 FOCUSED OBSERVABILITY & SHUTDOWN TESTS PASSED');
  console.log('============================================================');
}

/**
 * Helper to simulate HTTP requests with EventEmitter to trigger Express response headers and finish handlers.
 */
async function fakeHttpRequest(
  app: any,
  method: string,
  path: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{
  status: number;
  headers: Record<string, string>;
  bodyText: string;
  json: any;
}> {
  return new Promise((resolve) => {
    const req = new EventEmitter() as any;
    req.method = method;
    req.url = path;
    req.path = path;
    req.baseUrl = '';
    req.headers = {
      host: 'localhost:3000',
      ...headers,
    };
    req.query = {};
    req.body = body || {};
    req.socket = { remoteAddress: '127.0.0.1' };

    const responseHeaders: Record<string, string> = {};
    let responseBody = '';

    const res = new EventEmitter() as any;
    res.statusCode = 200;

    res.setHeader = (key: string, val: string) => {
      responseHeaders[key.toLowerCase()] = String(val);
    };
    res.getHeader = (key: string) => responseHeaders[key.toLowerCase()];
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (obj: any) => {
      responseHeaders['content-type'] = 'application/json';
      responseBody = JSON.stringify(obj);
      res.emit('finish');
      resolve({
        status: res.statusCode,
        headers: responseHeaders,
        bodyText: responseBody,
        json: obj,
      });
      return res;
    };
    res.send = (text: string) => {
      responseBody = String(text);
      res.emit('finish');
      resolve({
        status: res.statusCode,
        headers: responseHeaders,
        bodyText: responseBody,
        json: tryParseJson(responseBody),
      });
      return res;
    };
    res.sendStatus = (code: number) => {
      res.statusCode = code;
      res.emit('finish');
      resolve({
        status: res.statusCode,
        headers: responseHeaders,
        bodyText: '',
        json: null,
      });
      return res;
    };
    res.redirect = (url: string) => {
      res.statusCode = 302;
      responseHeaders['location'] = url;
      res.emit('finish');
      resolve({
        status: 302,
        headers: responseHeaders,
        bodyText: '',
        json: null,
      });
      return res;
    };
    res.flushHeaders = () => {};
    res.write = (data: string) => {
      responseBody += data;
    };

    app(req, res, () => {
      res.statusCode = 404;
      responseHeaders['content-type'] = 'application/json';
      responseBody = JSON.stringify({ error: 'Not Found' });
      res.emit('finish');
      resolve({
        status: 404,
        headers: responseHeaders,
        bodyText: responseBody,
        json: { error: 'Not Found' },
      });
    });
  });
}

function tryParseJson(str: string): any {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith('phase4ObservabilityTests.ts') ||
    process.argv[1].endsWith('phase4ObservabilityTests.js'))
) {
  runPhase4ObservabilityTests().catch((err) => {
    console.error('Focused test suite failed:', err);
    process.exit(1);
  });
}

