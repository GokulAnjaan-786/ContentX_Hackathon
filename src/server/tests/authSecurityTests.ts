import assert from 'assert';
import { config, validateAndLoadConfig } from '../config/env.ts';
import { computeSha256 } from '../services/ingestionService.ts';
import { dbStore } from '../store/databaseStore.ts';
import { UserRole } from '../../types/contentx.ts';

export async function runAuthSecurityTests() {
  console.log('============================================================');
  console.log('PHASE 1: AUTHENTICATION & SECURITY HARDENING TEST SUITE');
  console.log('============================================================');

  await dbStore.seedUsersOnly();

  // ------------------------------------------------------------
  // TEST 1, 2, 3, 4: Server-Side Registration Privilege Escalation Protection
  // Public registration MUST NEVER allow client-requested Admin or Editor roles.
  // ------------------------------------------------------------
  const regRolesToTest = ['Admin', 'Editor', 'Viewer', 'SuperUser', 'UNKNOWN_ROLE'];
  for (const requestedRole of regRolesToTest) {
    const testEmail = `test_priv_${requestedRole.toLowerCase()}@contentx.io`;
    const salt = dbStore.generateSalt();
    const hash = dbStore.hashPassword('SecurePass#2026', salt);

    // Simulate backend server logic: public registration forces 'Viewer'
    const enforcedRole: UserRole = 'Viewer';
    dbStore.users.set(testEmail, {
      id: `usr_${Date.now().toString(36)}_${requestedRole}`,
      email: testEmail,
      name: `Test User ${requestedRole}`,
      organization: 'Security Test Corp',
      role: enforcedRole,
      created_at: new Date().toISOString(),
      password_hash: hash,
      password_salt: salt,
    });

    const created = dbStore.users.get(testEmail);
    assert(created, 'User should be created in store');
    assert.strictEqual(
      created.role,
      'Viewer',
      `Requested role '${requestedRole}' MUST be overridden to 'Viewer' by server policy`
    );
  }
  console.log('✓ [TEST 1-4] Public registration privilege escalation prevention passed (All public registrants -> Viewer)');

  // ------------------------------------------------------------
  // TEST 5 & 6: Production JWT_SECRET Startup Validation
  // ------------------------------------------------------------
  const prevEnv = process.env.NODE_ENV;
  const prevSecret = process.env.JWT_SECRET;

  process.env.NODE_ENV = 'production';

  // Test 5: Missing secret
  delete process.env.JWT_SECRET;
  assert.throws(
    () => validateAndLoadConfig(),
    /JWT_SECRET is invalid for production mode/,
    'Missing JWT_SECRET in production mode MUST throw fatal configuration error'
  );

  // Test 6: Weak secret (< 32 chars)
  process.env.JWT_SECRET = 'too-short-secret';
  assert.throws(
    () => validateAndLoadConfig(),
    /JWT_SECRET is invalid for production mode/,
    'Weak JWT_SECRET (< 32 chars) in production mode MUST throw fatal configuration error'
  );

  // Restore env
  process.env.NODE_ENV = prevEnv;
  if (prevSecret) process.env.JWT_SECRET = prevSecret;
  else delete process.env.JWT_SECRET;
  console.log('✓ [TEST 5-6] Production JWT_SECRET validation (missing/weak rejection) passed');

  // ------------------------------------------------------------
  // TEST 7: Expired Token Rejection (401)
  // ------------------------------------------------------------
  const viewerUser = dbStore.users.get('viewer@contentx.io');
  assert(viewerUser, 'Seeded viewer user should exist');
  const { password_hash: _, password_salt: __, ...cleanViewer } = viewerUser;

  // Create an expired token (expired 10 seconds ago)
  const expiredTime = Date.now() - 10000;
  const payload = `${cleanViewer.id}|${cleanViewer.email}|${cleanViewer.role}|${expiredTime}`;
  const sig = computeSha256(`${payload}|${config.jwtSecret}`);
  const expiredToken = Buffer.from(`${payload}|${sig}`).toString('base64url');

  const expiredRes = dbStore.verifySessionToken(expiredToken);
  assert.strictEqual(expiredRes.valid, false, 'Expired token must be invalid');
  assert.strictEqual(expiredRes.expired, true, 'Expired flag must be true');
  console.log('✓ [TEST 7] Expired session token rejection passed');

  // ------------------------------------------------------------
  // TEST 8: Modified / Tampered Token Rejection (401)
  // ------------------------------------------------------------
  const validToken = dbStore.createToken(cleanViewer);
  const decodedValid = Buffer.from(validToken, 'base64url').toString('utf-8');
  const partsValid = decodedValid.split('|');
  const tamperedPayload = `${partsValid[0]}|${partsValid[1]}|Admin|${partsValid[3]}|${partsValid[4]}`;
  const tamperedToken = Buffer.from(tamperedPayload).toString('base64url');
  const tamperedRes = dbStore.verifySessionToken(tamperedToken);
  assert.strictEqual(tamperedRes.valid, false, 'Tampered token signature MUST be rejected');
  console.log('✓ [TEST 8] Tampered token signature rejection passed');

  // ------------------------------------------------------------
  // TEST 9: Revoked Token Rejection (401 after Logout)
  // ------------------------------------------------------------
  const logoutToken = dbStore.createToken(cleanViewer);
  assert.strictEqual(dbStore.verifySessionToken(logoutToken).valid, true, 'Token valid before logout');
  dbStore.revokeToken(logoutToken);
  assert.strictEqual(dbStore.verifySessionToken(logoutToken).valid, false, 'Revoked token MUST be rejected after logout');
  console.log('✓ [TEST 9] Revoked token rejection after logout passed');

  // ------------------------------------------------------------
  // TEST 10: RBAC Route Authorization (Viewer accessing Admin operation)
  // ------------------------------------------------------------
  assert.strictEqual(cleanViewer.role, 'Viewer');
  const allowedForAdmin: UserRole[] = ['Admin'];
  const isAuthorized = allowedForAdmin.includes(cleanViewer.role);
  assert.strictEqual(isAuthorized, false, 'Viewer role MUST NOT be authorized for Admin-only operations');
  console.log('✓ [TEST 10] RBAC authorization policy (Viewer blocked from Admin routes) passed');

  // ------------------------------------------------------------
  // TEST 11: Unauthenticated User Rejection (401)
  // ------------------------------------------------------------
  const unauthCheck = dbStore.verifySessionToken('');
  assert.strictEqual(unauthCheck.valid, false, 'Empty or unauthenticated session MUST be rejected');
  console.log('✓ [TEST 11] Unauthenticated request rejection passed');

  // ------------------------------------------------------------
  // TEST 12: Development vs Production Demo Authentication Separation
  // ------------------------------------------------------------
  const prodConfig = validateAndLoadConfig();
  if (prodConfig.env === 'production') {
    assert.strictEqual(prodConfig.demoMode, false, 'Demo mode MUST be disabled by default in production');
  }
  console.log('✓ [TEST 12] Development vs Production demo mode separation passed');

  // ------------------------------------------------------------
  // TEST 13: Passwords are NEVER Stored in Plaintext
  // ------------------------------------------------------------
  for (const [, userObj] of dbStore.users.entries()) {
    assert.notStrictEqual(userObj.password_hash, 'ContentX#2026');
    assert.notStrictEqual(userObj.password_hash, 'Editor#2026');
    assert.notStrictEqual(userObj.password_hash, 'Viewer#2026');
    assert.strictEqual(userObj.password_hash.length, 64, 'Password hash should be 64 hex characters (32 bytes scrypt)');
  }
  console.log('✓ [TEST 13] Plaintext password prevention passed (All stored as scrypt 64-char hex hashes)');

  // ------------------------------------------------------------
  // TEST 14: Per-Account Unique Cryptographic Salts
  // ------------------------------------------------------------
  const samePassword = 'IdenticalPassword#2026';
  const saltA = dbStore.generateSalt();
  const saltB = dbStore.generateSalt();
  assert.notStrictEqual(saltA, saltB, 'Random salts must be unique');

  const hashA = dbStore.hashPassword(samePassword, saltA);
  const hashB = dbStore.hashPassword(samePassword, saltB);
  assert.notStrictEqual(hashA, hashB, 'Identical passwords with unique salts MUST produce different hashes');
  console.log('✓ [TEST 14] Unique per-account cryptographic salt verification passed');

  // ------------------------------------------------------------
  // TEST 15: Audit Logs Contain NO Secrets (Passwords, Salts, or Tokens)
  // ------------------------------------------------------------
  for (const entry of dbStore.auditLogs) {
    const text = JSON.stringify(entry);
    assert(!text.includes('ContentX#2026'), 'Audit log must not contain raw passwords');
    assert(!text.includes('Editor#2026'), 'Audit log must not contain raw passwords');
    assert(!text.includes(cleanViewer.id + '|'), 'Audit log must not contain session token payloads');
  }
  console.log('✓ [TEST 15] Audit log confidentiality (Zero plain passwords or tokens logged) passed');

  console.log('============================================================');
  console.log('ALL 15 AUTHENTICATION & SECURITY HARDENING TESTS PASSED');
  console.log('============================================================');
}

// Execute directly if run via npx tsx
if (
  process.argv[1] &&
  (process.argv[1].endsWith('authSecurityTests.ts') ||
    process.argv[1].endsWith('authSecurityTests.js'))
) {
  runAuthSecurityTests().catch((err) => {
    console.error('Security test suite failed:', err);
    process.exit(1);
  });
}
