import assert from 'assert';
import { createApp } from '../../../server.ts';
import { sseBroker } from '../services/sseBrokerService.ts';
import { dbStore } from '../store/databaseStore.ts';

export async function runPhase4HealthAndSecurityTests() {
  console.log('============================================================');
  console.log('PHASE 4 STEP 3: HEALTH PROBES, SECURITY HEADERS & SSE TICKETS');
  console.log('============================================================');

  await dbStore.seedUsersOnly();
  dbStore.initialized = true;
  const app = await createApp();

  // Seed test admin user & session
  const admin = dbStore.users.get('admin@contentx.io');
  assert(admin, 'Admin user must exist');
  const token = dbStore.createToken(admin);

  // ------------------------------------------------------------
  // TEST 1: Lightweight Liveness Probe (GET /health)
  // ------------------------------------------------------------
  let livenessRes: any;
  let livenessStatus: number = 0;
  let livenessHeaders: Record<string, any> = {};

  const reqLiveness = {
    method: 'GET',
    url: '/health',
    headers: {},
  };

  await new Promise<void>((resolve) => {
    const mockRes: any = {
      setHeader: (k: string, v: string) => {
        livenessHeaders[k.toLowerCase()] = v;
      },
      status: (code: number) => {
        livenessStatus = code;
        return mockRes;
      },
      json: (data: any) => {
        livenessRes = data;
        livenessStatus = livenessStatus || 200;
        resolve();
      },
    };
    app(reqLiveness as any, mockRes as any);
  });

  assert.strictEqual(livenessStatus, 200);
  assert.strictEqual(livenessRes.status, 'ok');
  assert.strictEqual(livenessRes.service, 'contentx-platform');
  assert(livenessRes.timestamp);
  console.log('✓ [TEST 1] GET /health lightweight liveness probe passed');

  // ------------------------------------------------------------
  // TEST 2: Production Security Headers (CSP, Nosniff, Frame-Options, etc.)
  // ------------------------------------------------------------
  assert.strictEqual(livenessHeaders['x-content-type-options'], 'nosniff');
  assert.strictEqual(livenessHeaders['x-frame-options'], 'DENY');
  assert.strictEqual(livenessHeaders['referrer-policy'], 'strict-origin-when-cross-origin');
  assert(livenessHeaders['permissions-policy'].includes('camera=()'));
  assert(livenessHeaders['content-security-policy'].includes("default-src 'self'"));
  assert(livenessHeaders['content-security-policy'].includes("connect-src 'self'"));
  console.log('✓ [TEST 2] Production HTTP Security Headers (CSP, Nosniff, Frame Options) passed');

  // ------------------------------------------------------------
  // TEST 3: Readiness Probe (GET /readiness)
  // ------------------------------------------------------------
  let readyRes: any;
  let readyStatus: number = 0;

  await new Promise<void>((resolve) => {
    const mockRes: any = {
      setHeader: () => {},
      status: (code: number) => {
        readyStatus = code;
        return mockRes;
      },
      json: (data: any) => {
        readyRes = data;
        readyStatus = readyStatus || 200;
        resolve();
      },
    };
    app({ method: 'GET', url: '/readiness', headers: {} } as any, mockRes as any);
  });

  assert.strictEqual(readyStatus, 200);
  assert.strictEqual(readyRes.status, 'ready');
  assert(readyRes.checks.database === 'ok' || readyRes.checks.database === 'unavailable');
  console.log('✓ [TEST 3] GET /readiness deep health probe passed');

  // ------------------------------------------------------------
  // TEST 4: Single-Use Short-Lived SSE Ticket Issuance & Validation
  // ------------------------------------------------------------
  const testJobId = `job_test_tkt_${Date.now()}`;
  dbStore.jobs.set(testJobId, {
    job_id: testJobId,
    document_id: 'doc_demo_cyber_01',
    document_name: 'Advisory.pdf',
    audience: 'Technical',
    selected_formats: ['linkedin'],
    completed_formats: [],
    failed_formats: [],
    output_ids: [],
    status: 'running',
    created_at: new Date().toISOString(),
    issuer: admin.email,
    execution_mode: 'sequential',
  });

  // Issue SSE ticket
  const ticketObj = sseBroker.createTicket(testJobId, admin.email, admin.role, 30);
  assert(ticketObj.ticket.startsWith('tkt_'));
  assert.strictEqual(ticketObj.jobId, testJobId);
  assert.strictEqual(ticketObj.consumed, false);

  // Consume ticket 1st time -> valid
  const check1 = sseBroker.consumeTicket(ticketObj.ticket, testJobId);
  assert.strictEqual(check1.valid, true);
  assert.strictEqual(check1.ticket?.consumed, true);

  // Consume ticket 2nd time -> rejected (single-use enforcement)
  const check2 = sseBroker.consumeTicket(ticketObj.ticket, testJobId);
  assert.strictEqual(check2.valid, false);
  assert.strictEqual(check2.reason, 'SSE ticket has already been consumed.');

  // Consume for wrong job -> rejected
  const tkt2 = sseBroker.createTicket(testJobId, admin.email, admin.role, 30);
  const checkWrongJob = sseBroker.consumeTicket(tkt2.ticket, 'job_different_id');
  assert.strictEqual(checkWrongJob.valid, false);
  assert.strictEqual(checkWrongJob.reason, 'SSE ticket is bound to a different generation job.');

  console.log('✓ [TEST 4] Single-use short-lived SSE ticket issuance, consumption & job binding passed');

  // ------------------------------------------------------------
  // TEST 5: SSE Stream Connection via Ticket Authentication
  // ------------------------------------------------------------
  const tkt3 = sseBroker.createTicket(testJobId, admin.email, admin.role, 30);
  let sseStatus = 0;
  let sseWritten: string[] = [];

  await new Promise<void>((resolve) => {
    const mockRes: any = {
      setHeader: () => {},
      flushHeaders: () => {},
      status: (code: number) => {
        sseStatus = code;
        return mockRes;
      },
      json: (data: any) => {
        sseWritten.push(JSON.stringify(data));
        resolve();
      },
      write: (data: string) => {
        sseWritten.push(data);
        if (sseWritten.length >= 3) resolve();
      },
      on: () => {},
    };

    app(
      {
        method: 'GET',
        url: `/api/generation/${testJobId}/events?ticket=${tkt3.ticket}`,
        path: `/api/generation/${testJobId}/events`,
        headers: {},
        params: { job_id: testJobId },
        query: { ticket: tkt3.ticket },
        user: admin,
      } as any,
      mockRes as any
    );
  });

  assert(sseWritten.some((w) => w.includes(`evt_${testJobId}_init`)));
  sseBroker.cleanup(testJobId);
  console.log('✓ [TEST 5] SSE stream connection via single-use ticket passed');

  console.log('============================================================');
  console.log('ALL PHASE 4 STEP 3 HEALTH, SECURITY & SSE TESTS PASSED');
  console.log('============================================================');
}

// Execute if called directly via tsx
if (
  process.argv[1] &&
  (process.argv[1].endsWith('phase4HealthAndSecurityTests.ts') ||
    process.argv[1].endsWith('phase4HealthAndSecurityTests.js'))
) {
  runPhase4HealthAndSecurityTests().catch((err) => {
    console.error('Phase 4 Health & Security test suite failed:', err);
    process.exit(1);
  });
}
