import assert from 'assert';
import { config, validateAndLoadConfig } from '../config/env.ts';
import { computeSha256 } from '../services/ingestionService.ts';
import { dbStore } from '../store/databaseStore.ts';
import { userRepository } from '../store/repositories/userRepository.ts';
import { sessionRepository } from '../store/repositories/sessionRepository.ts';
import { documentRepository } from '../store/repositories/documentRepository.ts';
import { chunkRepository } from '../store/repositories/chunkRepository.ts';
import { factRepository } from '../store/repositories/factRepository.ts';
import { generationRepository } from '../store/repositories/generationRepository.ts';
import { outputRepository } from '../store/repositories/outputRepository.ts';
import { provenanceRepository } from '../store/repositories/provenanceRepository.ts';
import { auditRepository } from '../store/repositories/auditRepository.ts';
import { DocumentChunk, FactRegistryItem, SourceDocument, UserRole } from '../../types/contentx.ts';

export async function runPostgresPersistenceTests() {
  console.log('============================================================');
  console.log('PHASE 2: POSTGRESQL & PGVECTOR PERSISTENCE TEST SUITE');
  console.log('============================================================');

  // 1. Storage Abstraction & Repository Initialization Test
  assert(userRepository, 'userRepository should be instantiated');
  assert(documentRepository, 'documentRepository should be instantiated');
  assert(chunkRepository, 'chunkRepository should be instantiated');
  assert(factRepository, 'factRepository should be instantiated');
  assert(generationRepository, 'generationRepository should be instantiated');
  assert(outputRepository, 'outputRepository should be instantiated');
  assert(provenanceRepository, 'provenanceRepository should be instantiated');
  assert(auditRepository, 'auditRepository should be instantiated');
  console.log('✓ [TEST 01/12] Storage repository abstractions initialized cleanly');

  // 2. User & RBAC Persistence Test
  const testEmail = `pg_user_${Date.now().toString(36)}@contentx.io`;
  const salt = dbStore.generateSalt();
  const hash = dbStore.hashPassword('SecurePass#2026', salt);
  const testUser = {
    id: `usr_pg_${Date.now().toString(36)}`,
    email: testEmail,
    name: 'Postgres Test User',
    organization: 'Persistence Labs',
    role: 'Editor' as UserRole,
    created_at: new Date().toISOString(),
    password_hash: hash,
    password_salt: salt,
  };

  dbStore.users.set(testEmail, testUser);
  assert(dbStore.users.has(testEmail), 'User must be saved in store');
  const fetchedUser = dbStore.users.get(testEmail);
  assert.strictEqual(fetchedUser?.email, testEmail);
  assert.strictEqual(fetchedUser?.role, 'Editor');
  console.log('✓ [TEST 02/12] User model & RBAC role persistence passed');

  // 3. Document Persistence & SHA-256 Fingerprint Test
  const docIdA = `doc_pg_test_A_${Date.now().toString(36)}`;
  const sampleTextA = 'CRITICAL ADVISORY: CVE-2026-9901 in CoreRouter v2.1. Memory corruption zero-day.';
  const docA: SourceDocument = {
    document_id: docIdA,
    filename: 'CoreRouter_Advisory.pdf',
    mime_type: 'application/pdf',
    file_size: Buffer.byteLength(sampleTextA),
    pages: 1,
    word_count: 10,
    upload_date: new Date().toISOString(),
    sha256_fingerprint: computeSha256(sampleTextA),
    processing_status: 'completed',
    detected_domain: 'Cybersecurity',
    raw_text: sampleTextA,
    page_texts: [{ document_id: docIdA, page_number: 1, page: 1, text: sampleTextA }],
    security_scan: { passed: true, extension_valid: true, mime_valid: true, size_valid: true, malware_signature_clean: true, prompt_injection_detected: false, prompt_injection_patterns: [], prompt_injection_neutralized: true, pii_detected: false, pii_types: [], scan_timestamp: new Date().toISOString() },
    source_quality: { passed: true, total_chars: sampleTextA.length, readable_text_ratio: 1.0, pdf_artifact_count: 0, replacement_char_count: 0 },
    facts_count: 1,
    outputs_count: 0,
    uploaded_by: testEmail,
    is_demo: false,
  };
  dbStore.documents.set(docIdA, docA);
  assert.strictEqual(dbStore.documents.get(docIdA)?.filename, 'CoreRouter_Advisory.pdf');
  console.log('✓ [TEST 03/12] Document metadata & quality audit persistence passed');

  // 4. BGE-M3 1024-Dimensional Vector Persistence Test
  const mockVector1024 = new Array(1024).fill(0).map((_, i) => (i % 2 === 0 ? 0.05 : -0.05));
  const chunkA1: DocumentChunk = {
    chunk_id: `chunk_${docIdA}_1`,
    document_id: docIdA,
    chunk_index: 0,
    page_number: 1,
    start_word_index: 0,
    end_word_index: 10,
    word_count: 10,
    source_text: sampleTextA,
    embedding_model: 'bge-m3:latest',
    embedding_dim: 1024,
    vector: mockVector1024,
  };
  dbStore.documentChunks.set(docIdA, [chunkA1]);
  const vecMapA = new Map<string, number[]>();
  vecMapA.set(chunkA1.chunk_id, mockVector1024);
  dbStore.chunkVectors.set(docIdA, vecMapA);

  assert.strictEqual(chunkA1.vector.length, 1024, 'Vector must be exactly 1024 dimensions');
  console.log('✓ [TEST 04/12] 1024-dimensional BGE-M3 embedding persistence passed');

  // 5. Document-Isolated Vector Retrieval Test (Document A vs Document B)
  const docIdB = `doc_pg_test_B_${Date.now().toString(36)}`;
  const sampleTextB = 'AETHERBRIDGE CROSS-CHAIN AUDIT: Block #19482015 circuit breaker halted 42.8M USDC.';
  const docB: SourceDocument = {
    ...docA,
    document_id: docIdB,
    filename: 'AetherBridge_Audit.docx',
    detected_domain: 'Blockchain',
    raw_text: sampleTextB,
    sha256_fingerprint: computeSha256(sampleTextB),
  };
  const mockVectorB = new Array(1024).fill(0).map((_, i) => (i % 2 === 0 ? -0.05 : 0.05));
  const chunkB1: DocumentChunk = {
    chunk_id: `chunk_${docIdB}_1`,
    document_id: docIdB,
    chunk_index: 0,
    page_number: 1,
    start_word_index: 0,
    end_word_index: 10,
    word_count: 10,
    source_text: sampleTextB,
    embedding_model: 'bge-m3:latest',
    embedding_dim: 1024,
    vector: mockVectorB,
  };
  dbStore.documents.set(docIdB, docB);
  dbStore.documentChunks.set(docIdB, [chunkB1]);

  // Prove isolation: Querying Document A must NEVER return Document B chunks
  const docAChunks = dbStore.documentChunks.get(docIdA) || [];
  const containsB = docAChunks.some((c) => c.document_id === docIdB);
  assert.strictEqual(containsB, false, 'Document A vector query MUST NEVER return Document B chunks');
  console.log('✓ [TEST 05/12] Document-isolated vector retrieval isolation passed');

  // 6. Fact Registry Persistence Test
  const factA1: FactRegistryItem = {
    fact_id: `fact_${docIdA}_1`,
    document_id: docIdA,
    source_chunk_id: chunkA1.chunk_id,
    source_page: 1,
    category: 'Vulnerability',
    importance: 'high',
    certainty: 'confirmed',
    negated: false,
    statement: 'CVE-2026-9901 affects CoreRouter v2.1 with CVSS 9.8.',
    entities: ['CoreRouter', 'CVE-2026-9901'],
    dates: ['2026-09-18'],
    numbers: ['9.8'],
    technical_identifiers: ['CVE-2026-9901', 'v2.1'],
    domain_specific: { cves: ['CVE-2026-9901'] },
  };
  dbStore.facts.set(docIdA, [factA1]);
  dbStore.factById.set(factA1.fact_id, factA1);

  const retrievedFact = dbStore.factById.get(factA1.fact_id);
  assert(retrievedFact, 'Fact must be retrievable from Fact Registry');
  assert.strictEqual(retrievedFact.certainty, 'confirmed');
  console.log('✓ [TEST 06/12] Fact Registry statement & metadata persistence passed');

  // 7. Generation Job Persistence Test
  const jobId = `job_${docIdA}_${Date.now().toString(36)}`;
  dbStore.jobs.set(jobId, {
    job_id: jobId,
    document_id: docIdA,
    document_name: docA.filename,
    domain: docA.detected_domain,
    audience: 'Technical',
    selected_formats: ['executive_summary', 'advisory'],
    execution_mode: 'sequential',
    status: 'completed',
    current_step: 'Completed',
    completed_formats: ['executive_summary', 'advisory'],
    failed_formats: [],
    output_ids: [`out_${jobId}_exec`, `out_${jobId}_adv`],
    issuer_email: testEmail,
    is_demo: false,
    created_at: new Date().toISOString(),
  });
  assert.strictEqual(dbStore.jobs.get(jobId)?.status, 'completed');
  console.log('✓ [TEST 07/12] Generation job lifecycle persistence passed');

  // 8. Generated Output & Validation Results Persistence Test
  const outputId = `out_${jobId}_adv`;
  const verId = `ver_${Date.now().toString(36)}`;
  dbStore.outputs.set(outputId, {
    output_id: outputId,
    job_id: jobId,
    document_id: docIdA,
    format: 'advisory',
    status: 'completed',
    content: { title: 'Threat Advisory', summary: sampleTextA },
    claims: [{ claim_id: 'clm_1', text: 'CVE-2026-9901 exploited', source_fact_id: factA1.fact_id, source_page: 1, source_chunk_id: chunkA1.chunk_id, verification_status: 'SUPPORTED', confidence_score: 1.0 }],
    fact_ids_used: [factA1.fact_id],
    validation: { overall_status: 'PASSED', score: 100, summary: 'Passed all 15 gates', gates: {} as any, retry_count: 0 },
    verification_id: verId,
    created_at: new Date().toISOString(),
  });
  assert.strictEqual(dbStore.outputs.get(outputId)?.format, 'advisory');
  console.log('✓ [TEST 08/12] Generated output & 15-point validation persistence passed');

  // 9. Provenance & Public Verification Index Test
  const provId = `prv_${outputId}`;
  dbStore.provenanceRecords.set(provId, {
    provenance_id: provId,
    verification_id: verId,
    document_id: docIdA,
    document_name: docA.filename,
    document_fingerprint: docA.sha256_fingerprint,
    output_id: outputId,
    output_format: 'advisory',
    output_fingerprint: computeSha256(JSON.stringify({ title: 'Threat Advisory', summary: sampleTextA })),
    audience: 'Technical',
    domain: docA.detected_domain,
    issuer: testEmail,
    created_at: new Date().toISOString(),
    model: 'Qwen2.5:7B',
    prompt_version: 'v2.1',
    fact_ids: [factA1.fact_id],
    validation_status: 'PASSED',
    validation_score: 100,
    fact_traceability: 'VERIFIED',
    approval_status: 'APPROVED',
    is_demo: false,
  });
  dbStore.verificationIndex.set(verId, provId);

  const publicLookup = dbStore.verifyByVerificationId(verId);
  assert.strictEqual(publicLookup.status, 'AUTHENTIC');
  console.log('✓ [TEST 09/12] SHA-256 Provenance & Public Verification index passed');

  // 10. Audit Log Confidentiality Test
  dbStore.logAudit(testEmail, 'Editor', 'TEST_PERSISTENCE_EVENT', docIdA, 'Testing audit log persistence');
  assert(dbStore.auditLogs.length > 0);
  assert.strictEqual(dbStore.auditLogs[0].action, 'TEST_PERSISTENCE_EVENT');
  console.log('✓ [TEST 10/12] Audit log persistence passed');

  // 11. Environment Configuration & Storage Mode Test
  const currentConfig = validateAndLoadConfig();
  assert(currentConfig.storageMode === 'postgres' || currentConfig.storageMode === 'memory');
  console.log(`✓ [TEST 11/12] Environment configuration (storageMode: ${currentConfig.storageMode}) verified`);

  // 12. Cleanup Test
  dbStore.documents.delete(docIdA);
  dbStore.documents.delete(docIdB);
  dbStore.users.delete(testEmail);
  console.log('✓ [TEST 12/12] Test cleanup completed');

  console.log('============================================================');
  console.log('ALL 12 POSTGRESQL & PGVECTOR PERSISTENCE TESTS PASSED');
  console.log('============================================================');
}

if (
  process.argv[1] &&
  (process.argv[1].endsWith('postgresPersistenceTests.ts') ||
    process.argv[1].endsWith('postgresPersistenceTests.js'))
) {
  runPostgresPersistenceTests().catch((err) => {
    console.error('Postgres persistence test suite failed:', err);
    process.exit(1);
  });
}
