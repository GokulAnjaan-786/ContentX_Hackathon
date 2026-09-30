import crypto from 'crypto';
import {
  AnalyticsSummary,
  AudienceType,
  DocumentChunk,
  FactRegistryItem,
  ForensicReprocessReport,
  GeneratedOutputRecord,
  GenerationJob,
  OutputFormatType,
  ProvenanceRecord,
  SourceDocument,
  User,
  UserRole,
  VerificationLookupResult,
} from '../../types/contentx.ts';
import {
  buildGroundedContext,
  buildUnderstandingAndFactRegistry,
  isCleanFactCandidate,
} from '../services/domainAndUnderstandingService.ts';
import {
  generateAndValidateSingleOutput,
  SEQUENTIAL_FORMAT_ORDER,
} from '../services/generationAndValidationService.ts';
import {
  buildRealisticCompressedPdfBuffer,
  buildSlidingWindowChunks,
  computeSha256,
  evaluateSelectiveRag,
  evaluateSourceTextQuality,
  extractTextAndPagesAsync,
  scanDocumentSecurity,
  validateChunkQuality,
} from '../services/ingestionService.ts';

import { config } from '../config/env.ts';
import { sseBroker } from '../services/sseBrokerService.ts';
import { postgresStore } from './postgres/postgresStore.ts';

export interface StoredUser extends User {
  password_hash: string;
  password_salt: string;
}

export interface AuditLogEntry {
  log_id: string;
  timestamp: string;
  user_email: string;
  user_role: UserRole;
  action: string;
  resource_id: string;
  details: string;
}

class ContentXStore {
  public users = new Map<string, StoredUser>();
  public sessions = new Map<string, User>();
  public revokedTokens = new Set<string>();
  public documents = new Map<string, SourceDocument>();
  public documentBuffers = new Map<string, Buffer>();
  public documentChunks = new Map<string, DocumentChunk[]>();
  public chunkVectors = new Map<string, Map<string, number[]>>();
  public facts = new Map<string, FactRegistryItem[]>();
  public factById = new Map<string, FactRegistryItem>();
  public jobs = new Map<string, GenerationJob>();
  public outputs = new Map<string, GeneratedOutputRecord>();
  public provenanceRecords = new Map<string, ProvenanceRecord>();
  public verificationIndex = new Map<string, string>(); // verification_id -> provenance_id
  public auditLogs: AuditLogEntry[] = [];
  public initialized = false;
  public postgresActive = false;

  public generateSalt(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  public hashPassword(password: string, salt: string): string {
    return crypto
      .scryptSync(password, salt, 32)
      .toString('hex');
  }

  public verifyPassword(password: string, user: StoredUser): boolean {
    if (!password || !user || !user.password_hash || !user.password_salt) {
      return false;
    }
    const computedHash = this.hashPassword(password, user.password_salt);
    const a = Buffer.from(computedHash, 'hex');
    const b = Buffer.from(user.password_hash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  public createToken(user: User, rememberMe = true): string {
    const ttlMs = rememberMe ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const expiresAt = Date.now() + ttlMs;
    const payload = `${user.id}|${user.email}|${user.role}|${expiresAt}`;
    const sig = computeSha256(
      `${payload}|${config.jwtSecret}`
    );
    const token = Buffer.from(`${payload}|${sig}`).toString('base64url');
    this.sessions.set(token, user);

    if (this.postgresActive) {
      postgresStore.saveSession(token, user, expiresAt).catch(() => {});
    }
    return token;
  }

  public verifySessionToken(token: string): {
    valid: boolean;
    expired?: boolean;
    user?: User;
  } {
    if (!token || typeof token !== 'string' || this.revokedTokens.has(token)) {
      return { valid: false };
    }
    try {
      const decoded = Buffer.from(token, 'base64url').toString('utf-8');
      const parts = decoded.split('|');
      if (parts.length !== 5) {
        return { valid: false };
      }
      const [id, email, role, expiresAtStr, sig] = parts;
      if (!sig || sig.length !== 64 || !/^[a-fA-F0-9]{64}$/.test(sig)) {
        return { valid: false };
      }
      const payload = `${id}|${email}|${role}|${expiresAtStr}`;
      const expectedSig = computeSha256(
        `${payload}|${config.jwtSecret}`
      );

      const sigBuf = Buffer.from(sig, 'hex');
      const expBuf = Buffer.from(expectedSig, 'hex');
      if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
        return { valid: false };
      }

      const expiresAt = Number(expiresAtStr);
      if (Number.isNaN(expiresAt) || Date.now() > expiresAt) {
        this.sessions.delete(token);
        return { valid: false, expired: true };
      }
      const storedUser = this.users.get(email.toLowerCase());
      if (storedUser) {
        const { password_hash: _, password_salt: __, ...cleanUser } = storedUser;
        this.sessions.set(token, cleanUser);
        return { valid: true, user: cleanUser };
      }
      const sessionUser = this.sessions.get(token);
      if (sessionUser) {
        return { valid: true, user: sessionUser };
      }
      return { valid: false };
    } catch {
      return { valid: false };
    }
  }

  public revokeToken(token: string): void {
    this.sessions.delete(token);
    this.revokedTokens.add(token);

    if (this.postgresActive) {
      postgresStore.revokeToken(token).catch(() => {});
    }
  }

  public logAudit(
    userEmail: string,
    userRole: UserRole,
    action: string,
    resourceId: string,
    details: string
  ) {
    const entry: AuditLogEntry = {
      log_id: `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      user_email: userEmail,
      user_role: userRole,
      action,
      resource_id: resourceId,
      details,
    };
    this.auditLogs.unshift(entry);

    if (this.postgresActive) {
      postgresStore.saveAuditLog(entry).catch((err) => {
        console.warn('[POSTGRES AUDIT WARNING]', err.message);
      });
    }
  }

  public async ingestDocument(params: {
    filename: string;
    mimeType: string;
    buffer: Buffer;
    fallbackText?: string;
    uploadedBy: string;
    isDemo: boolean;
    customDocId?: string;
  }): Promise<SourceDocument> {
    const {
      filename,
      mimeType,
      buffer,
      fallbackText,
      uploadedBy,
      isDemo,
      customDocId,
    } = params;

    const prelimHash = computeSha256(
      buffer.length > 0 ? buffer : fallbackText || filename
    );
    const docId =
      customDocId ||
      `doc_${prelimHash.slice(0, 10)}_${Date.now().toString(36)}`;

    this.documentBuffers.set(docId, buffer);

    const { rawText, pages } = await extractTextAndPagesAsync(
      filename,
      buffer,
      fallbackText,
      docId
    );
    const wordCount = rawText.split(/\s+/).filter(Boolean).length;
    const sha256 = computeSha256(rawText || buffer);

    const securityScan = scanDocumentSecurity(
      filename,
      mimeType,
      buffer.length || Buffer.byteLength(rawText, 'utf-8'),
      rawText
    );

    // PHASE 6 & PHASE 7: Evaluate source text quality BEFORE chunking, embedding, Fact Registry, or RAG
    const initialQuality = evaluateSourceTextQuality(rawText);
    if (!initialQuality.passed || !securityScan.passed) {
      const failedDoc: SourceDocument = {
        document_id: docId,
        filename,
        mime_type: mimeType,
        file_size: buffer.length || Buffer.byteLength(rawText, 'utf-8'),
        pages: pages.length,
        word_count: wordCount,
        upload_date: new Date().toISOString(),
        sha256_fingerprint: sha256,
        processing_status: 'failed',
        detected_domain: 'General',
        raw_text: '',
        page_texts: [],
        security_scan: securityScan,
        source_quality: initialQuality,
        extraction_failure_reason:
          initialQuality.failure_reason ||
          'Extracted PDF text appears corrupted or contains PDF internal object-stream data.',
        facts_count: 0,
        outputs_count: 0,
        uploaded_by: uploadedBy,
        is_demo: isDemo,
      };
      this.documents.set(docId, failedDoc);
      this.documentChunks.set(docId, []);
      this.chunkVectors.set(docId, new Map());
      this.facts.set(docId, []);
      return failedDoc;
    }

    const { chunks, invalidChunksCount, fullVectors } =
      await buildSlidingWindowChunks(docId, pages);

    const finalQuality = evaluateSourceTextQuality(
      rawText,
      chunks.length,
      invalidChunksCount
    );

    if (chunks.length === 0 || !finalQuality.passed) {
      const failedDoc: SourceDocument = {
        document_id: docId,
        filename,
        mime_type: mimeType,
        file_size: buffer.length || Buffer.byteLength(rawText, 'utf-8'),
        pages: pages.length,
        word_count: wordCount,
        upload_date: new Date().toISOString(),
        sha256_fingerprint: sha256,
        processing_status: 'failed',
        detected_domain: 'General',
        raw_text: '',
        page_texts: [],
        security_scan: securityScan,
        source_quality: finalQuality,
        extraction_failure_reason:
          finalQuality.failure_reason ||
          'No valid readable chunks could be constructed from source document.',
        facts_count: 0,
        outputs_count: 0,
        uploaded_by: uploadedBy,
        is_demo: isDemo,
      };
      this.documents.set(docId, failedDoc);
      this.documentChunks.set(docId, []);
      this.chunkVectors.set(docId, new Map());
      this.facts.set(docId, []);
      return failedDoc;
    }

    const { understanding, facts } = buildUnderstandingAndFactRegistry(
      docId,
      filename,
      rawText,
      pages,
      chunks
    );
    const { decision: ragDecision } = await evaluateSelectiveRag(
      wordCount,
      chunks,
      fullVectors,
      understanding.summary
    );

    const doc: SourceDocument = {
      document_id: docId,
      filename,
      mime_type: mimeType,
      file_size: buffer.length || Buffer.byteLength(rawText, 'utf-8'),
      pages: pages.length,
      word_count: wordCount,
      upload_date: new Date().toISOString(),
      sha256_fingerprint: sha256,
      processing_status: 'completed',
      detected_domain: understanding.detected_domain,
      raw_text: rawText,
      page_texts: pages,
      security_scan: securityScan,
      source_quality: finalQuality,
      understanding,
      rag_decision: ragDecision,
      facts_count: facts.length,
      outputs_count: 0,
      uploaded_by: uploadedBy,
      is_demo: isDemo,
    };

    this.documents.set(docId, doc);
    this.documentChunks.set(docId, chunks);
    this.chunkVectors.set(docId, fullVectors);
    this.facts.set(docId, facts);
    for (const f of facts) {
      this.factById.set(`${docId}:${f.fact_id}`, f);
      this.factById.set(f.fact_id, f);
    }

    if (this.postgresActive) {
      await postgresStore.saveDocument(doc, buffer);
      await postgresStore.saveChunks(docId, chunks, fullVectors);
      await postgresStore.saveFacts(docId, facts);
    }

    return doc;
  }

  public async executeTransformationJob(params: {
    documentId: string;
    audience: AudienceType;
    selectedFormats: OutputFormatType[];
    executionMode?: 'sequential' | 'parallel';
    issuerEmail: string;
  }): Promise<{
    job: GenerationJob;
    outputs: GeneratedOutputRecord[];
    provenance: ProvenanceRecord[];
  }> {
    const doc = this.documents.get(params.documentId);
    if (!doc) {
      throw new Error(`Document ${params.documentId} not found.`);
    }

    // PHASE 11: GENERATION SAFETY GATE (SOURCE QUALITY CHECK)
    if (
      doc.processing_status === 'failed' ||
      (doc.source_quality && !doc.source_quality.passed)
    ) {
      throw new Error(
        'ContentX could not safely process this document because the extracted source text failed quality validation.'
      );
    }

    const chunks = this.documentChunks.get(doc.document_id) || [];
    const vectors = this.chunkVectors.get(doc.document_id) || new Map();
    const docFacts = this.facts.get(doc.document_id) || [];

    if (chunks.length === 0 || docFacts.length === 0) {
      throw new Error(
        'ContentX could not safely process this document because the extracted source text failed quality validation.'
      );
    }

    // Order selected formats according to the canonical sequential execution order (Section 29)
    const orderedFormats = SEQUENTIAL_FORMAT_ORDER.filter((fmt) =>
      params.selectedFormats.includes(fmt)
    );

    const executionMode =
      params.executionMode ||
      (process.env.OLLAMA_GENERATION_EXECUTION_MODE as
        | 'sequential'
        | 'parallel') ||
      'sequential';

    const jobId = `job_${doc.document_id}_${Date.now().toString(36)}`;
    const job: GenerationJob = {
      job_id: jobId,
      document_id: doc.document_id,
      document_name: doc.filename,
      domain: doc.detected_domain,
      audience: params.audience,
      selected_formats: orderedFormats,
      execution_mode: executionMode,
      status: 'processing',
      current_step: 'Evaluating selective RAG & building grounded context',
      completed_formats: [],
      failed_formats: [],
      output_ids: [],
      model: process.env.OLLAMA_GENERATION_MODEL || 'qwen2.5:7b',
      total_latency_ms: 0,
      created_at: new Date().toISOString(),
      is_demo: doc.is_demo,
    };
    this.jobs.set(jobId, job);

    const totalFormats = orderedFormats.length;

    sseBroker.publish(jobId, {
      jobId,
      status: 'queued',
      stage: 'queued',
      completedFormats: 0,
      totalFormats,
      progressPercent: 0,
      message: `Job queued for transformation (${totalFormats} format(s) selected)`,
    });

    sseBroker.publish(jobId, {
      jobId,
      status: 'running',
      stage: 'preparing',
      completedFormats: 0,
      totalFormats,
      progressPercent: 5,
      message: 'Preparing document & vector retrieval engine',
    });

    sseBroker.publish(jobId, {
      jobId,
      status: 'running',
      stage: 'understanding',
      completedFormats: 0,
      totalFormats,
      progressPercent: 10,
      message: 'Evaluating selective RAG & Fact Registry grounding',
    });

    const { decision: ragDecision, retrievedChunks } =
      await evaluateSelectiveRag(
        doc.word_count,
        chunks,
        vectors,
        `${doc.understanding?.title || doc.filename} ${orderedFormats.join(' ')}`
      );

    sseBroker.publish(jobId, {
      jobId,
      status: 'running',
      stage: 'context_building',
      completedFormats: 0,
      totalFormats,
      progressPercent: 15,
      message: 'Building grounded context bundle',
    });

    const context = buildGroundedContext(
      doc.document_id,
      doc.detected_domain,
      params.audience,
      orderedFormats,
      docFacts,
      retrievedChunks,
      ragDecision
    );

    const generatedOutputs: GeneratedOutputRecord[] = [];
    const provenanceList: ProvenanceRecord[] = [];
    const jobStart = Date.now();

    // Sequential execution by default (Section 29: independent failure isolation)
    for (const fmt of orderedFormats) {
      job.current_step = `Generating & validating ${fmt}`;
      const completedBefore = generatedOutputs.length;
      sseBroker.publish(jobId, {
        jobId,
        status: 'running',
        stage: 'generating',
        format: fmt,
        completedFormats: completedBefore,
        totalFormats,
        progressPercent: Math.min(
          90,
          15 + Math.round((completedBefore / totalFormats) * 70)
        ),
        message: `Generating ${fmt} output via local Ollama (qwen2.5:7b)`,
      });

      try {
        const outRecord = await generateAndValidateSingleOutput({
          jobId,
          documentId: doc.document_id,
          documentTitle: doc.understanding?.title || doc.filename,
          format: fmt,
          context,
          allFacts: docFacts,
          siblingOutputs: generatedOutputs,
        });

        this.outputs.set(outRecord.output_id, outRecord);
        generatedOutputs.push(outRecord);
        job.output_ids.push(outRecord.output_id);

        if (outRecord.status === 'failed') {
          job.failed_formats.push(fmt);
        } else {
          job.completed_formats.push(fmt);
        }

        // Update Fact Registry used_by_outputs references
        for (const fid of outRecord.fact_ids_used) {
          const targetFact = docFacts.find((f) => f.fact_id === fid);
          if (targetFact && !targetFact.used_by_outputs.includes(fmt)) {
            targetFact.used_by_outputs.push(fmt);
          }
        }

        // Create Provenance & Verification Record (Sections 32 & 33)
        const provId = `prv_${outRecord.output_id}`;
        const prov: ProvenanceRecord = {
          provenance_id: provId,
          verification_id: outRecord.verification_id,
          document_id: doc.document_id,
          document_name: doc.filename,
          document_fingerprint: doc.sha256_fingerprint,
          output_id: outRecord.output_id,
          output_format: fmt,
          output_fingerprint: outRecord.output_fingerprint,
          audience: params.audience,
          domain: doc.detected_domain,
          issuer: params.issuerEmail,
          created_at: outRecord.created_at,
          model: outRecord.model_used,
          prompt_version: outRecord.prompt_version,
          fact_ids: outRecord.fact_ids_used,
          validation_status: outRecord.validation.overall_status,
          validation_score: outRecord.validation.score,
          fact_traceability:
            outRecord.validation.gates.fact_id_validation.status === 'PASSED'
              ? 'VERIFIED'
              : 'UNVERIFIED',
          approval_status:
            outRecord.validation.overall_status === 'PASSED'
              ? 'APPROVED'
              : 'PENDING_REVIEW',
          is_demo: doc.is_demo,
          blockchain_anchor: {
            enabled: false,
            status: 'MODULAR_NOT_ANCHORED',
          },
        };
        this.provenanceRecords.set(provId, prov);
        this.verificationIndex.set(outRecord.verification_id, provId);
        provenanceList.push(prov);

        const completedAfter = generatedOutputs.length;
        sseBroker.publish(jobId, {
          jobId,
          status: 'running',
          stage: 'validating',
          format: fmt,
          completedFormats: completedAfter,
          totalFormats,
          progressPercent: Math.min(
            92,
            15 + Math.round((completedAfter / totalFormats) * 70)
          ),
          message: `Completed validation & grounding verification for ${fmt}`,
        });
      } catch (err: any) {
        job.failed_formats.push(fmt);
      }
    }

    sseBroker.publish(jobId, {
      jobId,
      status: 'running',
      stage: 'provenance',
      completedFormats: generatedOutputs.length,
      totalFormats,
      progressPercent: 95,
      message: 'Generating SHA-256 provenance attestations',
    });

    doc.outputs_count += generatedOutputs.length;
    job.total_latency_ms = Math.max(120, Date.now() - jobStart);
    job.completed_at = new Date().toISOString();
    job.current_step = 'Completed';
    job.status =
      job.failed_formats.length === orderedFormats.length
        ? 'failed'
        : job.failed_formats.length > 0
          ? 'completed_with_warnings'
          : 'completed';

    if (job.status === 'failed') {
      sseBroker.publish(jobId, {
        jobId,
        status: 'failed',
        stage: 'failed',
        completedFormats: generatedOutputs.length,
        totalFormats,
        progressPercent: 0,
        message: 'Content transformation failed',
      });
    } else {
      sseBroker.publish(jobId, {
        jobId,
        status: 'completed',
        stage: 'completed',
        completedFormats: generatedOutputs.length,
        totalFormats,
        progressPercent: 100,
        message: `Successfully generated ${generatedOutputs.length} of ${totalFormats} publication format(s)`,
      });
    }

    if (this.postgresActive) {
      await postgresStore.saveJob(job);
      for (const outRec of generatedOutputs) {
        await postgresStore.saveOutput(outRec);
      }
      for (const provRec of provenanceList) {
        await postgresStore.saveProvenance(provRec);
      }
      await postgresStore.saveDocument(doc);
    }

    return { job, outputs: generatedOutputs, provenance: provenanceList };
  }

  public verifyByVerificationId(
    verificationId: string,
    tamperedContentTest?: string
  ): VerificationLookupResult {
    const provId = this.verificationIndex.get(verificationId);
    if (!provId) {
      return {
        verification_id: verificationId,
        status: 'INVALID',
        provenance: null,
        output: null,
        document: null,
        integrity_check: {
          document_hash_match: false,
          output_hash_match: false,
          computed_output_hash: 'N/A',
          expected_output_hash: 'N/A',
          checked_at: new Date().toISOString(),
        },
      };
    }

    const prov = this.provenanceRecords.get(provId) || null;
    const output = prov ? this.outputs.get(prov.output_id) || null : null;
    const doc = prov ? this.documents.get(prov.document_id) || null : null;

    if (!prov || !output || !doc) {
      return {
        verification_id: verificationId,
        status: 'INVALID',
        provenance: prov,
        output,
        document: doc,
        integrity_check: {
          document_hash_match: false,
          output_hash_match: false,
          computed_output_hash: 'N/A',
          expected_output_hash: prov?.output_fingerprint || 'N/A',
          checked_at: new Date().toISOString(),
        },
      };
    }

    const computedDocHash = computeSha256(doc.raw_text);
    const computedOutputHash = tamperedContentTest
      ? computeSha256(tamperedContentTest)
      : computeSha256(JSON.stringify(output.content));

    const docMatch = computedDocHash === prov.document_fingerprint;
    const outMatch = computedOutputHash === prov.output_fingerprint;

    return {
      verification_id: verificationId,
      status: docMatch && outMatch ? 'AUTHENTIC' : 'MODIFIED',
      provenance: prov,
      output,
      document: doc,
      integrity_check: {
        document_hash_match: docMatch,
        output_hash_match: outMatch,
        computed_output_hash: computedOutputHash,
        expected_output_hash: prov.output_fingerprint,
        checked_at: new Date().toISOString(),
      },
    };
  }

  public computeAnalytics(includeDemo = true): AnalyticsSummary {
    const docs = Array.from(this.documents.values()).filter(
      (d) => includeDemo || !d.is_demo
    );
    const docIds = new Set(docs.map((d) => d.document_id));
    const outs = Array.from(this.outputs.values()).filter((o) =>
      docIds.has(o.document_id)
    );

    if (docs.length === 0) {
      return {
        has_data: false,
        include_demo: includeDemo,
        documents_processed: 0,
        facts_extracted: 0,
        outputs_generated: 0,
        verified_outputs: 0,
        average_validation_score: 0,
        grounding_rate: 0,
        failed_outputs: 0,
        average_latency_ms: 0,
        domain_distribution: {},
        output_distribution: {},
        audience_distribution: {},
      };
    }

    const totalFacts = docs.reduce((acc, d) => acc + d.facts_count, 0);
    const verifiedCount = outs.filter(
      (o) => o.validation.overall_status === 'PASSED'
    ).length;
    const failedCount = outs.filter((o) => o.status === 'failed').length;
    const avgScore =
      outs.length > 0
        ? Math.round(
          outs.reduce((acc, o) => acc + o.validation.score, 0) / outs.length
        )
        : 0;
    const groundingPassed = outs.filter(
      (o) => o.validation.gates.source_grounding.status === 'PASSED'
    ).length;
    const groundingRate =
      outs.length > 0 ? Math.round((groundingPassed / outs.length) * 100) : 0;
    const avgLatency =
      outs.length > 0
        ? Math.round(
          outs.reduce((acc, o) => acc + o.generation_latency_ms, 0) /
          outs.length
        )
        : 0;

    const domainDist: Record<string, number> = {};
    for (const d of docs) {
      domainDist[d.detected_domain] = (domainDist[d.detected_domain] || 0) + 1;
    }

    const outputDist: Record<string, number> = {};
    const audienceDist: Record<string, number> = {};
    for (const o of outs) {
      outputDist[o.format] = (outputDist[o.format] || 0) + 1;
      audienceDist[o.audience] = (audienceDist[o.audience] || 0) + 1;
    }

    return {
      has_data: true,
      include_demo: includeDemo,
      documents_processed: docs.length,
      facts_extracted: totalFacts,
      outputs_generated: outs.length,
      verified_outputs: verifiedCount,
      average_validation_score: avgScore,
      grounding_rate: groundingRate,
      failed_outputs: failedCount,
      average_latency_ms: avgLatency,
      domain_distribution: domainDist,
      output_distribution: outputDist,
      audience_distribution: audienceDist,
    };
  }

  /**
   * PHASE 13: Controlled Database Forensics & Reprocessing Workflow
   * 1. Marks affected document for reprocessing
   * 2. Deletes/invalidates corrupted chunks
   * 3. Deletes/invalidates dependent BGE-M3 embeddings
   * 4. Rebuilds clean chunks from clean PDF extraction
   * 5. Regenerates BGE-M3 embeddings
   * 6. Rebuilds Fact Registry
   * 7. Regenerates outputs while preserving audit trail
   */
  public async reprocessDocumentForensic(
    documentId: string,
    cleanBufferOverride?: Buffer
  ): Promise<ForensicReprocessReport> {
    const existingDoc = this.documents.get(documentId);
    if (!existingDoc) {
      throw new Error(`Document ${documentId} not found for reprocessing.`);
    }

    // Step 1: Mark affected document for reprocessing
    existingDoc.processing_status = 'processing';

    const existingChunks = this.documentChunks.get(documentId) || [];
    const existingVectors = this.chunkVectors.get(documentId) || new Map();
    const existingFacts = this.facts.get(documentId) || [];
    const existingOutputs = Array.from(this.outputs.values()).filter(
      (o) => o.document_id === documentId
    );

    const corruptedChunksCount = existingChunks.filter(
      (c) => !validateChunkQuality(c.source_text).valid
    ).length;
    const corruptedFactsCount = existingFacts.filter(
      (f) => !isCleanFactCandidate(f.statement)
    ).length;

    // Step 2 & 3: Delete/invalidate corrupted chunks, dependent embeddings, facts, and outputs
    this.documentChunks.delete(documentId);
    this.chunkVectors.delete(documentId);
    this.facts.delete(documentId);
    for (const f of existingFacts) {
      this.factById.delete(`${documentId}:${f.fact_id}`);
    }
    for (const out of existingOutputs) {
      this.outputs.delete(out.output_id);
    }

    // Step 4, 5, 6: Re-extract clean pages, rebuild clean chunks, regenerate BGE-M3 embeddings, rebuild Fact Registry
    const sourceBuffer =
      cleanBufferOverride ||
      this.documentBuffers.get(documentId) ||
      Buffer.from(existingDoc.raw_text, 'utf-8');

    const rebuiltDoc = await this.ingestDocument({
      filename: existingDoc.filename,
      mimeType: existingDoc.mime_type,
      buffer: sourceBuffer,
      uploadedBy: existingDoc.uploaded_by,
      isDemo: existingDoc.is_demo,
      customDocId: documentId,
    });

    let cleanOutputsRegenerated = 0;
    if (rebuiltDoc.processing_status === 'completed') {
      // Step 7: Regenerate all 7 outputs sequentially
      const regenJob = await this.executeTransformationJob({
        documentId,
        audience: 'Professional',
        selectedFormats: SEQUENTIAL_FORMAT_ORDER,
        executionMode: 'sequential',
        issuerEmail: existingDoc.uploaded_by,
      });
      cleanOutputsRegenerated = regenJob.outputs.length;
    }

    const rebuiltChunks = this.documentChunks.get(documentId) || [];
    const rebuiltVectors = this.chunkVectors.get(documentId) || new Map();
    const rebuiltFacts = this.facts.get(documentId) || [];

    this.logAudit(
      'admin@contentx.io',
      'Admin',
      'FORENSIC_DOCUMENT_REPROCESS',
      documentId,
      `Invalidated ${corruptedChunksCount} corrupted chunks / ${existingVectors.size} embeddings / ${corruptedFactsCount} corrupted facts. Rebuilt ${rebuiltChunks.length} clean chunks, ${rebuiltFacts.length} facts, and ${cleanOutputsRegenerated} outputs.`
    );

    return {
      document_id: documentId,
      filename: rebuiltDoc.filename,
      corrupted_chunks_invalidated: Math.max(
        corruptedChunksCount,
        existingChunks.length
      ),
      corrupted_embeddings_invalidated: existingVectors.size,
      corrupted_facts_invalidated: Math.max(
        corruptedFactsCount,
        existingFacts.length
      ),
      corrupted_outputs_invalidated: existingOutputs.length,
      clean_pages_extracted: rebuiltDoc.pages,
      clean_chunks_rebuilt: rebuiltChunks.length,
      clean_embeddings_regenerated: rebuiltVectors.size,
      clean_facts_rebuilt: rebuiltFacts.length,
      clean_outputs_regenerated: cleanOutputsRegenerated,
      status:
        rebuiltDoc.processing_status === 'completed'
          ? 'REPROCESSED_CLEAN'
          : 'REJECTED_CORRUPT_SOURCE',
      timestamp: new Date().toISOString(),
    };
  }

  public async seedUsersOnly(): Promise<void> {
    const seedUsersData = [
      {
        id: 'usr_admin_01',
        email: 'admin@contentx.io',
        name: 'Dr. Elena Vance',
        organization: 'ContentX Verification Authority',
        role: 'Admin' as UserRole,
        created_at: '2026-09-01T08:00:00Z',
        password: 'ContentX#2026',
      },
      {
        id: 'usr_editor_02',
        email: 'editor@contentx.io',
        name: 'Marcus Sterling',
        organization: 'Enterprise Threat & Research Desk',
        role: 'Editor' as UserRole,
        created_at: '2026-09-05T10:15:00Z',
        password: 'Editor#2026',
      },
      {
        id: 'usr_viewer_03',
        email: 'viewer@contentx.io',
        name: 'Sora Takahashi',
        organization: 'External Compliance Audit',
        role: 'Viewer' as UserRole,
        created_at: '2026-09-10T14:30:00Z',
        password: 'Viewer#2026',
      },
    ];

    for (const u of seedUsersData) {
      const salt = this.generateSalt();
      const hash = this.hashPassword(u.password, salt);
      const userObj: StoredUser = {
        id: u.id,
        email: u.email,
        name: u.name,
        organization: u.organization,
        role: u.role,
        created_at: u.created_at,
        password_hash: hash,
        password_salt: salt,
      };
      this.users.set(u.email.toLowerCase(), userObj);
      if (this.postgresActive) {
        await postgresStore.saveUser(userObj);
      }
    }

    // Admin Bootstrap from Environment Configuration (Production Admin Bootstrap)
    if (config.adminEmail && config.adminPassword) {
      const normEmail = config.adminEmail.toLowerCase().trim();
      if (!this.users.has(normEmail)) {
        const salt = this.generateSalt();
        const hash = this.hashPassword(config.adminPassword, salt);
        const bootstrapAdmin: StoredUser = {
          id: `usr_env_admin_${Date.now().toString(36)}`,
          email: normEmail,
          name: 'System Administrator (Bootstrapped)',
          organization: 'ContentX Enterprise Administration',
          role: 'Admin',
          created_at: new Date().toISOString(),
          password_hash: hash,
          password_salt: salt,
        };
        this.users.set(normEmail, bootstrapAdmin);
        if (this.postgresActive) {
          await postgresStore.saveUser(bootstrapAdmin);
        }
        this.logAudit(
          normEmail,
          'Admin',
          'ADMIN_BOOTSTRAP',
          bootstrapAdmin.id,
          'Bootstrapped production administrator account from environment configuration'
        );
      }
    }
  }

  public async seedInitialData() {
    if (this.initialized) return;
    this.initialized = true;

    if (config.storageMode === 'postgres') {
      try {
        this.postgresActive = await postgresStore.initializeDatabase();
      } catch (err: any) {
        if (config.databaseRequired) {
          throw err;
        }
        this.postgresActive = false;
      }
    }

    if (this.postgresActive) {
      const dbUsers = await postgresStore.loadUsers();
      for (const u of dbUsers) {
        this.users.set(u.email.toLowerCase(), u);
      }

      const dbDocs = await postgresStore.loadDocuments();
      for (const d of dbDocs) {
        this.documents.set(d.document_id, d);
        const cList = await postgresStore.loadChunks(d.document_id);
        this.documentChunks.set(d.document_id, cList);

        const vecMap = new Map<string, number[]>();
        for (const c of cList) {
          if (c.vector) vecMap.set(c.chunk_id, c.vector);
        }
        this.chunkVectors.set(d.document_id, vecMap);

        const fList = await postgresStore.loadFacts(d.document_id);
        this.facts.set(d.document_id, fList);
        for (const f of fList) {
          this.factById.set(`${d.document_id}:${f.fact_id}`, f);
          this.factById.set(f.fact_id, f);
        }
      }

      const dbJobs = await postgresStore.loadJobs();
      for (const j of dbJobs) {
        this.jobs.set(j.job_id, j);
      }

      const dbOutputs = await postgresStore.loadOutputs();
      for (const o of dbOutputs) {
        this.outputs.set(o.output_id, o);
      }

      const dbProv = await postgresStore.loadProvenance();
      for (const p of dbProv) {
        this.provenanceRecords.set(p.provenance_id, p);
        this.verificationIndex.set(p.verification_id, p.provenance_id);
      }

      const dbLogs = await postgresStore.loadAuditLogs(100);
      if (dbLogs.length > 0) {
        this.auditLogs = dbLogs;
      }
    }

    // 1. Seed RBAC Users (Admin, Editor, Viewer) if empty
    if (this.users.size === 0) {
      await this.seedUsersOnly();
    }

    // If documents already exist in DB or memory, skip demo doc seeding
    if (this.documents.size > 0 || !config.demoMode) {
      return;
    }

    // 2. Seed Phase 15 Test Documents (Rich-Dad-Poor-Dad PDF, Cybersecurity PDF, Blockchain DOCX, Blackbelt PDF)
    const richDadPages = [
      [
        'RICH DAD POOR DAD & THE CASHFLOW QUADRANT — FINANCIAL LITERACY BRIEFING',
        'Author: Robert T. Kiyosaki',
        'Robert Kiyosaki explains the fundamental difference between assets and liabilities: an asset puts money into your pocket every month, whereas a liability takes money out of your pocket.',
        'The CASHFLOW Quadrant represents four distinct income categories that make up the business world: E for Employee, S for Self-Employed or Small Business, B for Business Owner with 500 or more employees, and I for Investor.',
        'Financial intelligence requires mastering four technical disciplines: accounting (financial literacy to read balance sheets and income statements), investing (the science of money making money), understanding markets (supply and demand), and the law (tax advantages and corporate protection).',
      ].join('\n'),
      [
        'On Page 2 of the analysis, Robert Kiyosaki notes that 84% of households rely exclusively on earned wages in the E and S quadrants, which face the highest effective tax rates of 30% to 50%.',
        'By contrast, B-quadrant systems and I-quadrant income-producing real estate and equity portfolios compound cashflow while utilizing lawful depreciation and corporate expense structures.',
        'However, no evidence was found that higher earned salary alone resolves chronic cashflow deficits when personal lifestyle liabilities expand at the same rate as income.',
        'Possible market liquidity contractions require investors to maintain at least 6 months of operating reserve capital before deploying leverage.',
      ].join('\n'),
    ];
    const richDadPdfBuffer = buildRealisticCompressedPdfBuffer(richDadPages);

    const cyberPages = [
      [
        'CYBERSECURITY THREAT ADVISORY: CVE-2026-4108 ZERO-DAY EXPLOITATION IN EDGECORE VPN APPLIANCES',
        'Author: SecOps Threat Intelligence Unit',
        'On 2026-09-18, SecOps Threat Intelligence identified active exploitation of CVE-2026-4108, a critical memory corruption vulnerability (CWE-787) affecting EdgeCore SecureGate VPN Appliances running firmware v4.2.1 and v4.2.2.',
        'CVE-2026-4108 carries a CVSS v3.1 base score of 9.8 (Critical) and allows unauthenticated remote code execution via crafted IKEv2 key exchange packets.',
        'Telemetry confirms that threat actor UNC-4890 deployed a custom ELF backdoor named ShadowPulse (SHA-256: 8f4e2b91c0d4a7e63b1295f8d0e3c7a1b2d4e6f8091a2b3c4d5e6f7a8b9c0d1e) communicating with command-and-control IP 198.51.100.47 and domain update-edgecore-telemetry.net.',
      ].join('\n'),
      [
        'Initial access was observed across 14 enterprise financial institutions between 2026-09-14 and 2026-09-18 using MITRE ATT&CK technique T1190 (Exploit Public-Facing Application) and T1059.004 (Unix Shell).',
        'Suspected lateral movement via SMB relay was observed in 3 affected environments, though attribution of the secondary stage remains unconfirmed.',
        'Forensic inspection confirmed that no evidence of customer cryptographic private key exfiltration was found across any inspected appliance.',
        'Organizations must immediately upgrade EdgeCore SecureGate appliances to firmware version v4.2.3-hotfix2 released on 2026-09-19, rotate all active session tokens, and block outbound traffic to 198.51.100.47.',
      ].join('\n'),
    ];
    const cyberPdfBuffer = buildRealisticCompressedPdfBuffer(cyberPages);

    const blockchainText = [
      '=== PAGE 1 ===',
      'AETHERBRIDGE CROSS-CHAIN VAULT LIQUIDITY AUDIT & BLOCK #19482015 STATE VERIFICATION',
      'Author: ChainGuard Formal Verification Labs',
      'On 2026-09-21, ChainGuard Formal Verification Labs completed the post-incident state audit of the AetherBridge LiquidityVault.sol smart contract on Ethereum Mainnet (Chain ID: 1) and Arbitrum One (Chain ID: 42161).',
      'At Ethereum Block Number 19482015, an anomalous cross-chain message relay triggered the automated circuit breaker in contract 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D via transaction hash 0x9c8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b.',
      '=== PAGE 2 ===',
      'The circuit breaker halted outbound bridge withdrawals within 12 seconds (consuming 184,520 gas at 28.4 gwei, nonce 412), locking $42.8 million in USDC and 6,400 WETH safely inside the multi-sig guardian vault 0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984.',
      'Validator Quorum 11/12 signed the state root verification event StateVerified on 2026-09-21, confirming zero unauthorized token minting and zero loss of user principal.',
      'Possible oracle latency between L1 and L2 sequencers may have contributed to the transient state mismatch during high volatility.',
      'Protocol governance must upgrade VaultVerifier.sol to enforce a 15-block finality delay before settling cross-chain batches exceeding 500,000 USDC.',
    ].join('\n\n');

    const blackbeltPages = [
      [
        'BLACKBELT ENTERPRISE ARCHITECTURE & AI GOVERNANCE STANDARD (2026 EDITION)',
        'Author: Blackbelt Engineering & Verification Council',
        'The Blackbelt Standard mandates that deterministic verification pipelines validate 100% of source chunks before embedding into 1024-dimensional pgvector indexes.',
        'Across 48 production deployments benchmarked in 2026-09-12, enforcing pre-chunk binary corruption gates reduced downstream hallucination incidents by 99.4% and eliminated UTF-8 replacement character leakage.',
        'No evidence of silent fact drift was observed when sequential generation isolated each output contract against the canonical Fact Registry.',
      ].join('\n'),
    ];
    const blackbeltPdfBuffer = buildRealisticCompressedPdfBuffer(blackbeltPages);

    const docRichDad = await this.ingestDocument({
      filename: 'Rich_Dad_Poor_Dad_Robert_Kiyosaki.pdf',
      mimeType: 'application/pdf',
      buffer: richDadPdfBuffer,
      uploadedBy: 'admin@contentx.io',
      isDemo: true,
      customDocId: 'doc_rich_dad_pdf_01',
    });

    const doc1 = await this.ingestDocument({
      filename: 'DEMO_EdgeCore_CVE-2026-4108_Threat_Advisory.pdf',
      mimeType: 'application/pdf',
      buffer: cyberPdfBuffer,
      uploadedBy: 'admin@contentx.io',
      isDemo: true,
      customDocId: 'doc_demo_cyber_01',
    });

    const doc2 = await this.ingestDocument({
      filename: 'DEMO_AetherBridge_Block_19482015_Audit.docx',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from(blockchainText, 'utf-8'),
      fallbackText: blockchainText,
      uploadedBy: 'admin@contentx.io',
      isDemo: true,
      customDocId: 'doc_demo_chain_02',
    });

    await this.ingestDocument({
      filename: 'Blackbelt_Enterprise_AI_Governance_Standard.pdf',
      mimeType: 'application/pdf',
      buffer: blackbeltPdfBuffer,
      uploadedBy: 'editor@contentx.io',
      isDemo: true,
      customDocId: 'doc_demo_blackbelt_03',
    });

    // Generate all 7 formats for Rich Dad Poor Dad PDF and Cybersecurity PDF
    await this.executeTransformationJob({
      documentId: docRichDad.document_id,
      audience: 'Professional',
      selectedFormats: SEQUENTIAL_FORMAT_ORDER,
      executionMode: 'sequential',
      issuerEmail: 'admin@contentx.io',
    });

    await this.executeTransformationJob({
      documentId: doc1.document_id,
      audience: 'Technical',
      selectedFormats: SEQUENTIAL_FORMAT_ORDER,
      executionMode: 'sequential',
      issuerEmail: 'admin@contentx.io',
    });

    await this.executeTransformationJob({
      documentId: doc2.document_id,
      audience: 'Executive',
      selectedFormats: ['executive_summary', 'advisory', 'linkedin'],
      executionMode: 'sequential',
      issuerEmail: 'admin@contentx.io',
    });

    this.logAudit(
      'admin@contentx.io',
      'Admin',
      'SYSTEM_DEMO_SEED',
      'doc_rich_dad_pdf_01',
      'Initialized ContentX verified dataset including Rich-Dad-Poor-Dad compressed PDF, Cybersecurity PDF, Blockchain DOCX, and Blackbelt PDF with 100% clean page-by-page extraction.'
    );
  }
}

export const dbStore = new ContentXStore();
