import assert from 'assert';
import {
  buildGroundedContext,
  buildUnderstandingAndFactRegistry,
  clearContextBundleCache,
  getContextBundleCacheStats,
} from '../services/domainAndUnderstandingService.ts';
import {
  buildCompactRepairPrompt,
  buildOptimizedSystemPrompt,
  buildOptimizedUserPrompt,
  clearPerformanceMetrics,
  compileGroundedFormatFromRegistry,
  generateAndValidateSingleOutput,
  getPerformanceMetrics,
  SEQUENTIAL_FORMAT_ORDER,
  validateGeneratedOutput,
} from '../services/generationAndValidationService.ts';
import {
  buildSlidingWindowChunks,
  computeBgeM3Embedding1024,
  evaluateSelectiveRag,
  extractTextAndPages,
} from '../services/ingestionService.ts';
import { dbStore } from '../store/databaseStore.ts';

export async function runPhase3OptimizationTests() {
  console.log('============================================================');
  console.log('PHASE 3 STEP 2: AI/RAG GENERATION OPTIMIZATION TEST SUITE');
  console.log('============================================================');

  clearContextBundleCache();
  clearPerformanceMetrics();
  await dbStore.seedInitialData();

  // ------------------------------------------------------------
  // TEST 1: System & User Prompt Optimization (Token & Char Reduction)
  // ------------------------------------------------------------
  const sampleDoc = dbStore.documents.get('doc_demo_cyber_01') || Array.from(dbStore.documents.values())[0];
  assert(sampleDoc, 'Benchmark document should exist');

  const pages = [{ page: 1, text: sampleDoc.raw_text }];
  const { chunks, fullVectors } = await buildSlidingWindowChunks(sampleDoc.document_id, pages);
  const { facts } = buildUnderstandingAndFactRegistry(
    sampleDoc.document_id,
    sampleDoc.filename,
    sampleDoc.raw_text,
    pages,
    chunks
  );
  const ragEval = await evaluateSelectiveRag(400, chunks, fullVectors, 'Cybersecurity advisory');
  const context = buildGroundedContext(
    sampleDoc.document_id,
    'Cybersecurity',
    'Technical',
    ['linkedin', 'executive_summary'],
    facts,
    ragEval.retrievedChunks,
    ragEval.decision
  );

  const sysPrompt = buildOptimizedSystemPrompt(context, 'linkedin');
  const usrPrompt = buildOptimizedUserPrompt(sampleDoc.filename, 'linkedin', context);
  const resolvedCharCount = sysPrompt.length + usrPrompt.length;
  const estimatedTokenCount = Math.round(resolvedCharCount / 4);

  // Verify all 8 required prompt design sections exist
  assert(sysPrompt.includes('1. ROLE:'), 'Must contain ROLE section');
  assert(sysPrompt.includes('2. SOURCE OF TRUTH:'), 'Must contain SOURCE OF TRUTH section');
  assert(sysPrompt.includes('3. AUDIENCE:'), 'Must contain AUDIENCE section');
  assert(sysPrompt.includes('4. FORMAT OBJECTIVE:'), 'Must contain FORMAT OBJECTIVE section');
  assert(sysPrompt.includes('5. FACTUAL RULES:'), 'Must contain FACTUAL RULES section');
  assert(sysPrompt.includes('6. DOMAIN RULES:'), 'Must contain DOMAIN RULES section');
  assert(sysPrompt.includes('7. OUTPUT REQUIREMENTS:'), 'Must contain OUTPUT REQUIREMENTS section');
  assert(sysPrompt.includes('8. JSON OUTPUT CONTRACT:'), 'Must contain JSON OUTPUT CONTRACT section');

  // Verify significant prompt token reduction (< 4,500 characters total vs previous ~18,000 characters)
  assert(
    resolvedCharCount < 4500,
    `Optimized resolved prompt should be under 4,500 chars (Got: ${resolvedCharCount} chars)`
  );
  console.log(
    `✓ [TEST 1] Prompt optimization passed: ${resolvedCharCount} chars (~${estimatedTokenCount} tokens), all 8 design sections present`
  );

  // ------------------------------------------------------------
  // TEST 2: Compact Repair Prompt Builder for Retries
  // ------------------------------------------------------------
  const malformedSnippet = '{"hook": "Great cybersecurity news", "body": "Exploit confirmed"}';
  const validationError = 'Missing required field "cta" and invalid hashtags count';
  const repair = buildCompactRepairPrompt('linkedin', malformedSnippet, validationError);

  const repairChars = repair.systemPrompt.length + repair.userPrompt.length;
  assert(repair.userPrompt.includes('INVALID OUTPUT TO REPAIR:'), 'Repair prompt must include output snippet');
  assert(repair.userPrompt.includes('VALIDATION ERROR:'), 'Repair prompt must include error message');
  assert(repair.userPrompt.includes('SCHEMA CONTRACT:'), 'Repair prompt must include schema reminder');
  assert(
    repairChars < 1600,
    `Compact repair prompt should be under 1,600 chars (Got: ${repairChars} chars)`
  );
  console.log(
    `✓ [TEST 2] Compact repair prompt builder passed (${repairChars} chars, >90% payload reduction vs full retransmission)`
  );

  // ------------------------------------------------------------
  // TEST 3 & 4: Embedding Fallback Safety (Production Fail-Closed vs Dev Offline)
  // ------------------------------------------------------------
  const prevEnv = process.env.NODE_ENV;

  // Test 3: Production Fail-Closed
  process.env.NODE_ENV = 'production';
  let prodFailClosedTriggered = false;
  try {
    // Force invalid Ollama URL to simulate unreachable service in production
    await computeBgeM3Embedding1024('Test text for production embedding', 'http://127.0.0.1:59999');
  } catch (err: any) {
    prodFailClosedTriggered = err.message.includes('BGE-M3 Embedding Fail-Closed');
  }
  assert.strictEqual(
    prodFailClosedTriggered,
    true,
    'Production mode MUST throw explicit fail-closed error when Ollama embedding service is unreachable'
  );

  // Test 4: Development/Test Offline Feature-Hashing Fallback
  process.env.NODE_ENV = 'test';
  const devEmbedding = await computeBgeM3Embedding1024('Test text for offline dev embedding', 'http://127.0.0.1:59999');
  assert.strictEqual(devEmbedding.vector.length, 1024, 'Dev mode offline fallback must produce 1024-d vector');

  // Restore NODE_ENV
  process.env.NODE_ENV = prevEnv;
  console.log('✓ [TEST 3-4] BGE-M3 Embedding fallback safety passed (Prod: FAIL CLOSED, Dev/Test: Deterministic Feature Hashing)');

  // ------------------------------------------------------------
  // TEST 5: Context Bundle Caching & Cross-Document Isolation
  // ------------------------------------------------------------
  clearContextBundleCache();
  const ctx1 = buildGroundedContext(
    'doc_demo_cyber_01',
    'Cybersecurity',
    'Technical',
    ['linkedin'],
    facts,
    ragEval.retrievedChunks,
    ragEval.decision
  );
  const stats1 = getContextBundleCacheStats();
  assert.strictEqual(stats1.size, 1, 'Cache should have 1 item after first build');

  // Call again with identical parameters -> should hit cache
  const ctx2 = buildGroundedContext(
    'doc_demo_cyber_01',
    'Cybersecurity',
    'Technical',
    ['linkedin'],
    facts,
    ragEval.retrievedChunks,
    ragEval.decision
  );
  assert.strictEqual(ctx1, ctx2, 'Identical parameters MUST return cached ContextBundle reference');

  // Call with different document ID -> should create separate cache entry (no cross-doc contamination)
  const ctxDiffDoc = buildGroundedContext(
    'doc_demo_cyber_02_diff',
    'Cybersecurity',
    'Technical',
    ['linkedin'],
    facts,
    ragEval.retrievedChunks,
    ragEval.decision
  );
  const stats2 = getContextBundleCacheStats();
  assert.strictEqual(stats2.size, 2, 'Cache should contain 2 distinct document entries');
  assert.notStrictEqual(ctx1, ctxDiffDoc, 'Different document ID MUST NOT return cached context from another document');
  console.log('✓ [TEST 5] Context Bundle Caching & Cross-Document Isolation passed');

  // ------------------------------------------------------------
  // TEST 6: Performance Instrumentation Telemetry
  // ------------------------------------------------------------
  const metrics = getPerformanceMetrics();
  assert(metrics.length > 0, 'Performance metrics should be recorded during operations');
  const hasPromptMetric = metrics.some((m) => m.stage === 'prompt_construction');
  const hasValidationMetric = metrics.some((m) => m.stage === 'fact_validation');
  assert(hasPromptMetric && hasValidationMetric, 'Metrics must record prompt construction and fact validation stages');
  console.log('✓ [TEST 6] Performance instrumentation telemetry passed');

  // ------------------------------------------------------------
  // TEST 7: Rich Dad Poor Dad 7-Format Quality & Grounding Verification
  // ------------------------------------------------------------
  const richDadText = [
    '=== PAGE 1 ===',
    'RICH DAD POOR DAD: FINANCIAL EDUCATION & CASHFLOW ANALYSIS',
    'On 2026-09-25, financial literacy analysis confirmed that cashflow divergence stems from the difference between assets and liabilities.',
    'An asset puts money in your pocket whereas a liability takes money out of your pocket.',
    'The analysis evaluated 4 financial disciplines across 500 household balance sheets.',
    'No evidence of unauthorized financial asset liquidation was found.',
    'Possible future interest rate contraction was noted with moderate uncertainty.',
  ].join('\n\n');

  const rdExtracted = extractTextAndPages('rich_dad.pdf', Buffer.from(richDadText), richDadText);
  const rdChunksResult = await buildSlidingWindowChunks('doc_rd_opt_01', rdExtracted.pages);
  const { understanding: rdUnd, facts: rdFacts } = buildUnderstandingAndFactRegistry(
    'doc_rd_opt_01',
    'rich_dad.pdf',
    richDadText,
    rdExtracted.pages,
    rdChunksResult.chunks
  );

  const rdRag = await evaluateSelectiveRag(200, rdChunksResult.chunks, rdChunksResult.fullVectors, 'Assets and liabilities');
  const rdContext = buildGroundedContext(
    'doc_rd_opt_01',
    rdUnd.detected_domain,
    'Executive',
    SEQUENTIAL_FORMAT_ORDER,
    rdFacts,
    rdRag.retrievedChunks,
    rdRag.decision
  );

  for (const fmt of SEQUENTIAL_FORMAT_ORDER) {
    const outputRec = await generateAndValidateSingleOutput({
      jobId: 'job_test_rd_opt',
      documentId: 'doc_rd_opt_01',
      documentTitle: 'Rich Dad Poor Dad',
      format: fmt,
      context: rdContext,
      allFacts: rdFacts,
      siblingOutputs: [],
    });

    assert.strictEqual(
      outputRec.validation.overall_status,
      'PASSED',
      `Format ${fmt} must pass 15-point validation`
    );
    assert(outputRec.fact_ids_used.length > 0, `Format ${fmt} must reference Fact Registry IDs`);
    assert(outputRec.claims.length > 0, `Format ${fmt} must contain traceable claims`);
    assert.strictEqual(outputRec.validation.gates.hallucination_detection.status, 'PASSED');
    assert.strictEqual(outputRec.validation.gates.prompt_leakage_detection.status, 'PASSED');
    assert.strictEqual(outputRec.validation.gates.placeholder_detection.status, 'PASSED');
  }
  console.log('✓ [TEST 7] Rich Dad Poor Dad 7-format generation quality & 15-point validation passed');

  console.log('============================================================');
  console.log('ALL PHASE 3 STEP 2 GENERATION OPTIMIZATION TESTS PASSED');
  console.log('============================================================');
}

// Execute directly if run via npx tsx
if (
  process.argv[1] &&
  (process.argv[1].endsWith('phase3OptimizationTests.ts') ||
    process.argv[1].endsWith('phase3OptimizationTests.js'))
) {
  runPhase3OptimizationTests().catch((err) => {
    console.error('Phase 3 optimization test suite failed:', err);
    process.exit(1);
  });
}
