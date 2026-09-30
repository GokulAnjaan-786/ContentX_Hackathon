import assert from 'assert';
import { sseBroker } from '../services/sseBrokerService.ts';
import { dbStore } from '../store/databaseStore.ts';
import { GenerationProgressEvent } from '../../types/contentx.ts';

export async function runPhase3SseTests() {
  console.log('============================================================');
  console.log('PHASE 3 STEP 3: SSE REAL-TIME PROGRESS TEST SUITE');
  console.log('============================================================');

  await dbStore.seedInitialData();

  // ------------------------------------------------------------
  // TEST 1: SSE Event Broker Unit Mechanics
  // ------------------------------------------------------------
  const testJobId = `job_test_sse_${Date.now()}`;
  const eventsReceived: GenerationProgressEvent[] = [];

  const unsubscribe = sseBroker.subscribe(testJobId, (evt) => {
    eventsReceived.push(evt);
  });

  const evt1 = sseBroker.publish(testJobId, {
    jobId: testJobId,
    status: 'queued',
    stage: 'queued',
    completedFormats: 0,
    totalFormats: 3,
    progressPercent: 0,
    message: 'Test queued',
  });

  const evt2 = sseBroker.publish(testJobId, {
    jobId: testJobId,
    status: 'running',
    stage: 'generating',
    format: 'linkedin',
    completedFormats: 1,
    totalFormats: 3,
    progressPercent: 33,
    message: 'Generated linkedin',
  });

  assert.strictEqual(eventsReceived.length, 2, 'Subscriber should receive exactly 2 events');
  assert.strictEqual(eventsReceived[0].stage, 'queued');
  assert.strictEqual(eventsReceived[1].format, 'linkedin');

  // Verify getLastEvent replay state
  const lastEvt = sseBroker.getLastEvent(testJobId);
  assert(lastEvt, 'getLastEvent should return latest event');
  assert.strictEqual(lastEvt.stage, 'generating');
  assert.strictEqual(lastEvt.progressPercent, 33);

  // Unsubscribe & Cleanup
  unsubscribe();
  sseBroker.publish(testJobId, {
    jobId: testJobId,
    status: 'completed',
    stage: 'completed',
    completedFormats: 3,
    totalFormats: 3,
    progressPercent: 100,
    message: 'Test completed',
  });

  assert.strictEqual(eventsReceived.length, 2, 'Subscriber should not receive events after unsubscribe');
  sseBroker.cleanup(testJobId);
  assert.strictEqual(sseBroker.getLastEvent(testJobId), null, 'Cleanup should wipe transient broker state');
  console.log('✓ [01/06] SSE Event Broker unit mechanics passed');

  // ------------------------------------------------------------
  // TEST 2: End-to-End Generation Job SSE Event Stream Lifecycle
  // ------------------------------------------------------------
  const sampleDoc = dbStore.documents.get('doc_demo_cyber_01') || Array.from(dbStore.documents.values())[0];
  assert(sampleDoc, 'Sample document should exist for SSE test');

  const lifecycleEvents: GenerationProgressEvent[] = [];
  const testJobId2 = `job_${sampleDoc.document_id}_${Date.now().toString(36)}`;

  // Subscribe before starting transformation
  const unsubLifecycle = sseBroker.subscribe(testJobId2, (evt) => {
    lifecycleEvents.push(evt);
  });

  const result = await dbStore.executeTransformationJob({
    documentId: sampleDoc.document_id,
    audience: 'Technical',
    selectedFormats: ['linkedin', 'twitter'],
    executionMode: 'sequential',
    issuerEmail: 'admin@contentx.io',
  });

  unsubLifecycle();

  assert(result.job, 'Transformation job should be created');
  assert(lifecycleEvents.length >= 6, 'Lifecycle should produce all stage progress events');

  const stagesSeen = lifecycleEvents.map((e) => e.stage);
  assert(stagesSeen.includes('queued'), 'Event stream must include queued stage');
  assert(stagesSeen.includes('preparing'), 'Event stream must include preparing stage');
  assert(stagesSeen.includes('understanding'), 'Event stream must include understanding stage');
  assert(stagesSeen.includes('context_building'), 'Event stream must include context_building stage');
  assert(stagesSeen.includes('generating'), 'Event stream must include generating stage');
  assert(stagesSeen.includes('validating'), 'Event stream must include validating stage');
  assert(stagesSeen.includes('provenance'), 'Event stream must include provenance stage');
  assert(stagesSeen.includes('completed'), 'Event stream must include completed stage');

  const finalEvent = lifecycleEvents[lifecycleEvents.length - 1];
  assert.strictEqual(finalEvent.status, 'completed');
  assert.strictEqual(finalEvent.progressPercent, 100);
  console.log('✓ [02/06] End-to-end generation event stream lifecycle passed');

  // ------------------------------------------------------------
  // TEST 3: Format Completion Counting Accuracy
  // ------------------------------------------------------------
  const genEvents = lifecycleEvents.filter((e) => e.stage === 'generating');
  assert.strictEqual(genEvents.length, 2, 'Exactly 2 format generating events should be emitted for 2 formats');
  assert.strictEqual(genEvents[0].format, 'linkedin');
  assert.strictEqual(genEvents[1].format, 'twitter');
  console.log('✓ [03/06] Format completion counting accuracy passed');

  // ------------------------------------------------------------
  // TEST 4: Client Disconnect Non-Cancellation
  // ------------------------------------------------------------
  const testJobId3 = `job_${sampleDoc.document_id}_${Date.now().toString(36)}`;
  let simulatedDisconnectHappened = false;

  const unsubSimulated = sseBroker.subscribe(testJobId3, (evt) => {
    if (evt.stage === 'generating' && !simulatedDisconnectHappened) {
      // Simulate client connection close midway through generation
      unsubSimulated();
      simulatedDisconnectHappened = true;
    }
  });

  const disconnectResult = await dbStore.executeTransformationJob({
    documentId: sampleDoc.document_id,
    audience: 'Executive',
    selectedFormats: ['executive_summary'],
    executionMode: 'sequential',
    issuerEmail: 'admin@contentx.io',
  });

  assert.strictEqual(simulatedDisconnectHappened, true, 'Simulated disconnect occurred');
  assert.strictEqual(disconnectResult.job.status, 'completed', 'Job must complete in dbStore/PostgreSQL even after SSE client disconnect');
  assert.strictEqual(disconnectResult.outputs.length, 1, 'Output must be generated despite client disconnect');
  console.log('✓ [04/06] Client disconnect non-cancellation passed');

  // ------------------------------------------------------------
  // TEST 5: Reconnection State Replay
  // ------------------------------------------------------------
  const lastState = sseBroker.getLastEvent(disconnectResult.job.job_id);
  assert(lastState, 'Last event must be recorded in broker');
  assert.strictEqual(lastState.status, 'completed');
  assert.strictEqual(lastState.progressPercent, 100);
  console.log('✓ [05/06] Reconnection state replay passed');

  // ------------------------------------------------------------
  // TEST 6: Security & Information Leakage Prevention
  // ------------------------------------------------------------
  for (const evt of lifecycleEvents) {
    const jsonStr = JSON.stringify(evt);
    assert(!jsonStr.includes('SELECT '), 'SSE events must NOT leak SQL queries');
    assert(!jsonStr.includes('jwtSecret'), 'SSE events must NOT leak JWT secrets');
    assert(!jsonStr.includes('password_hash'), 'SSE events must NOT leak passwords');
    assert(!jsonStr.includes('=== PAGE 1 ==='), 'SSE events must NOT leak raw document pages');
    assert(!jsonStr.includes('<fact_registry>'), 'SSE events must NOT leak raw prompt templates');
  }
  console.log('✓ [06/06] Security & information leakage prevention passed');

  console.log('============================================================');
  console.log('ALL PHASE 3 STEP 3 SSE TESTS PASSED (6/6)');
  console.log('============================================================');
}
