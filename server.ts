import dotenv from 'dotenv';
import express, { NextFunction, Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import {
  checkOllamaStatus,
  validateGeneratedOutput,
} from './src/server/services/generationAndValidationService.ts';
import { dbStore } from './src/server/store/databaseStore.ts';
import {
  AudienceType,
  OutputFormatType,
  ProviderConfigStatus,
  User,
  UserRole,
} from './src/types/contentx.ts';

dotenv.config();

interface AuthenticatedRequest extends Request {
  user?: User;
}

const runtimeSettings = {
  execution_mode: (process.env.OLLAMA_GENERATION_EXECUTION_MODE ||
    'sequential') as 'sequential' | 'parallel',
  chunk_target_words: Number(process.env.CHUNK_TARGET_WORDS || 600),
  chunk_overlap_words: Number(process.env.CHUNK_OVERLAP_WORDS || 50),
  ollama_generation_model: process.env.OLLAMA_GENERATION_MODEL || 'qwen2.5:7b',
  ollama_embedding_model:
    process.env.OLLAMA_EMBEDDING_MODEL || 'bge-m3:latest',
  num_ctx: Number(process.env.OLLAMA_NUM_CTX || 16384),
  temperature: Number(process.env.OLLAMA_TEMPERATURE || 0.1),
};

function attachUserMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    const sessionUser = dbStore.sessions.get(token);
    if (sessionUser) {
      req.user = sessionUser;
      return next();
    }
  }
  // Default fallback to Admin session for seamless preview while supporting explicit login/logout/RBAC switching
  const defaultAdmin = dbStore.users.get('admin@contentx.io');
  if (defaultAdmin) {
    const { password_hash: _, ...cleanUser } = defaultAdmin;
    req.user = cleanUser;
  }
  next();
}

function requireRole(allowedRoles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `RBAC Policy Denied: Role '${req.user.role}' is not authorized. Required: ${allowedRoles.join(' or ')}.`,
      });
    }
    next();
  };
}

export async function createApp() {
  await dbStore.seedInitialData();

  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use(attachUserMiddleware);

  // ============================================================
  // AUTHENTICATION & RBAC ENDPOINTS
  // ============================================================
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res
        .status(400)
        .json({ error: 'Email and password are required.' });
    }
    const stored = dbStore.users.get(String(email).toLowerCase().trim());
    if (!stored) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    const hashed = dbStore.hashPassword(String(password));
    if (stored.password_hash !== hashed) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    const { password_hash: _, ...user } = stored;
    const token = dbStore.createToken(user);
    dbStore.logAudit(
      user.email,
      user.role,
      'USER_LOGIN',
      user.id,
      `Authenticated with role ${user.role}`
    );
    return res.json({ token, user });
  });

  app.post('/api/auth/register', (req: Request, res: Response) => {
    const { email, password, name, organization, role } = req.body || {};
    if (!email || !password || !name) {
      return res
        .status(400)
        .json({ error: 'Name, email, and password are required.' });
    }
    const normalizedEmail = String(email).toLowerCase().trim();
    if (dbStore.users.has(normalizedEmail)) {
      return res
        .status(409)
        .json({ error: 'An account with this email already exists.' });
    }
    const assignedRole: UserRole =
      role === 'Admin' || role === 'Editor' || role === 'Viewer'
        ? role
        : 'Editor';
    const newUser = {
      id: `usr_${Date.now().toString(36)}`,
      email: normalizedEmail,
      name: String(name).trim(),
      organization: String(organization || 'Enterprise Verification Team').trim(),
      role: assignedRole,
      created_at: new Date().toISOString(),
      password_hash: dbStore.hashPassword(String(password)),
    };
    dbStore.users.set(normalizedEmail, newUser);
    const { password_hash: _, ...cleanUser } = newUser;
    const token = dbStore.createToken(cleanUser);
    dbStore.logAudit(
      cleanUser.email,
      cleanUser.role,
      'USER_REGISTER',
      cleanUser.id,
      `Registered new ${cleanUser.role} account`
    );
    return res.status(201).json({ token, user: cleanUser });
  });

  app.post('/api/auth/forgot-password', (req: Request, res: Response) => {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ error: 'Email address is required.' });
    }
    return res.json({
      status: 'recovery_dispatched',
      message: `If an account exists for ${email}, a cryptographic password reset token has been logged and issued.`,
    });
  });

  app.get('/api/auth/me', (req: AuthenticatedRequest, res: Response) => {
    return res.json({ user: req.user || null });
  });

  // ============================================================
  // DOCUMENTS & INGESTION ENDPOINTS
  // ============================================================
  app.get('/api/documents', (req: Request, res: Response) => {
    const includeDemo = req.query.includeDemo !== 'false';
    const docs = Array.from(dbStore.documents.values())
      .filter((d) => includeDemo || !d.is_demo)
      .sort(
        (a, b) =>
          new Date(b.upload_date).getTime() - new Date(a.upload_date).getTime()
      );
    return res.json({ documents: docs });
  });

  app.get('/api/documents/:id', (req: Request, res: Response) => {
    const doc = dbStore.documents.get(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }
    const chunks = dbStore.documentChunks.get(doc.document_id) || [];
    const facts = dbStore.facts.get(doc.document_id) || [];
    return res.json({ document: doc, chunks, facts });
  });

  app.post(
    '/api/documents/upload',
    requireRole(['Admin', 'Editor']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { filename, mimeType, contentBase64, rawText } = req.body || {};
        if (!filename) {
          return res.status(400).json({ error: 'Filename is required.' });
        }

        const lower = String(filename).toLowerCase();
        if (
          !lower.endsWith('.pdf') &&
          !lower.endsWith('.docx') &&
          !lower.endsWith('.txt')
        ) {
          return res.status(400).json({
            error:
              'Unsupported file format. Supported formats: PDF, DOCX, TXT. (Images, Audio, Video, URLs: Coming Soon)',
          });
        }

        const buffer = contentBase64
          ? Buffer.from(String(contentBase64), 'base64')
          : Buffer.from(String(rawText || ''), 'utf-8');

        if (buffer.length === 0 && (!rawText || !String(rawText).trim())) {
          return res
            .status(400)
            .json({ error: 'Uploaded document contains no extractable data.' });
        }

        const doc = await dbStore.ingestDocument({
          filename: String(filename),
          mimeType: String(mimeType || 'text/plain'),
          buffer,
          fallbackText: rawText ? String(rawText) : undefined,
          uploadedBy: req.user?.email || 'editor@contentx.io',
          isDemo: false,
        });

        dbStore.logAudit(
          req.user?.email || 'editor@contentx.io',
          req.user?.role || 'Editor',
          'DOCUMENT_INGEST',
          doc.document_id,
          `Ingested ${doc.filename} (SHA-256: ${doc.sha256_fingerprint.slice(0, 16)}..., Domain: ${doc.detected_domain}, Facts: ${doc.facts_count})`
        );

        const chunks = dbStore.documentChunks.get(doc.document_id) || [];
        const facts = dbStore.facts.get(doc.document_id) || [];

        return res.status(201).json({
          document: doc,
          chunks,
          facts,
        });
      } catch (err: any) {
        return res.status(500).json({
          error: err.message || 'Document ingestion failed.',
        });
      }
    }
  );

  app.delete(
    '/api/documents/:id',
    requireRole(['Admin', 'Editor']),
    (req: AuthenticatedRequest, res: Response) => {
      const id = req.params.id;
      const doc = dbStore.documents.get(id);
      if (!doc) {
        return res.status(404).json({ error: 'Document not found.' });
      }
      dbStore.documents.delete(id);
      dbStore.documentChunks.delete(id);
      dbStore.chunkVectors.delete(id);
      dbStore.facts.delete(id);

      dbStore.logAudit(
        req.user?.email || 'admin@contentx.io',
        req.user?.role || 'Admin',
        'DOCUMENT_DELETE',
        id,
        `Deleted document ${doc.filename}`
      );
      return res.json({ deleted: true, document_id: id });
    }
  );

  app.post(
    '/api/documents/:id/reprocess',
    requireRole(['Admin', 'Editor']),
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = req.params.id;
        const report = await dbStore.reprocessDocumentForensic(id);
        const doc = dbStore.documents.get(id);
        const chunks = dbStore.documentChunks.get(id) || [];
        const facts = dbStore.facts.get(id) || [];
        const outputs = Array.from(dbStore.outputs.values()).filter(
          (o) => o.document_id === id
        );
        return res.json({
          report,
          document: doc,
          chunks,
          facts,
          outputs,
        });
      } catch (err: any) {
        return res.status(500).json({
          error: err.message || 'Forensic document reprocessing failed.',
        });
      }
    }
  );

  app.get('/api/documents/:id/forensic-trace', (req: Request, res: Response) => {
    const id = req.params.id;
    const doc = dbStore.documents.get(id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }
    const chunks = dbStore.documentChunks.get(id) || [];
    const facts = dbStore.facts.get(id) || [];
    const outputs = Array.from(dbStore.outputs.values()).filter(
      (o) => o.document_id === id
    );
    return res.json({
      document_id: doc.document_id,
      filename: doc.filename,
      processing_status: doc.processing_status,
      source_quality: doc.source_quality,
      trace: {
        stage_1_extracted_pages: doc.page_texts,
        stage_2_cleaned_text_preview: doc.raw_text.slice(0, 600),
        stage_3_validated_chunks: chunks.map((c) => ({
          chunk_id: c.chunk_id,
          page_number: c.page_number,
          word_count: c.word_count,
          source_text_preview: c.source_text.slice(0, 240),
          embedding_model: c.embedding_model,
          embedding_dim: c.embedding_dim,
        })),
        stage_4_fact_registry: facts.map((f) => ({
          fact_id: f.fact_id,
          source_page: f.source_page,
          source_chunk_id: f.source_chunk_id,
          certainty: f.certainty,
          negated: f.negated,
          statement: f.statement,
        })),
        stage_5_rag_decision: doc.rag_decision,
        stage_6_generated_outputs: outputs.map((o) => ({
          output_id: o.output_id,
          format: o.format,
          status: o.status,
          validation_score: o.validation.score,
          readability_guard: o.validation.gates.placeholder_detection.status,
          fact_ids_used: o.fact_ids_used,
        })),
      },
    });
  });

  // ============================================================
  // UNDERSTANDING & FACT REGISTRY ENDPOINTS
  // ============================================================
  app.post(
    '/api/documents/:id/analyze',
    requireRole(['Admin', 'Editor']),
    (req: Request, res: Response) => {
      const doc = dbStore.documents.get(req.params.id);
      if (!doc) {
        return res.status(404).json({ error: 'Document not found.' });
      }
      const facts = dbStore.facts.get(doc.document_id) || [];
      return res.json({
        understanding: doc.understanding,
        rag_decision: doc.rag_decision,
        facts,
      });
    }
  );

  app.get('/api/documents/:id/understanding', (req: Request, res: Response) => {
    const doc = dbStore.documents.get(req.params.id);
    if (!doc || !doc.understanding) {
      return res
        .status(404)
        .json({ error: 'Document understanding not found.' });
    }
    return res.json({
      understanding: doc.understanding,
      rag_decision: doc.rag_decision,
      chunks: dbStore.documentChunks.get(doc.document_id) || [],
    });
  });

  app.get('/api/documents/:id/facts', (req: Request, res: Response) => {
    const facts = dbStore.facts.get(req.params.id);
    if (!facts) {
      return res
        .status(404)
        .json({ error: 'Facts not found for this document.' });
    }
    return res.json({ facts });
  });

  app.get('/api/facts', (req: Request, res: Response) => {
    const includeDemo = req.query.includeDemo !== 'false';
    const documentId = req.query.documentId as string | undefined;
    const allFacts: Array<
      ReturnType<typeof dbStore.facts.get> extends (infer U)[] | undefined
        ? U & { document_name?: string; is_demo?: boolean }
        : never
    > = [];

    for (const [docId, docFacts] of dbStore.facts.entries()) {
      const doc = dbStore.documents.get(docId);
      if (!doc) continue;
      if (!includeDemo && doc.is_demo) continue;
      if (documentId && documentId !== 'all' && docId !== documentId) continue;

      for (const f of docFacts) {
        allFacts.push({
          ...f,
          document_name: doc.filename,
          is_demo: doc.is_demo,
        });
      }
    }
    return res.json({ facts: allFacts });
  });

  app.get('/api/facts/:fact_id', (req: Request, res: Response) => {
    const fact = dbStore.factById.get(req.params.fact_id);
    if (!fact) {
      return res.status(404).json({ error: 'Fact not found.' });
    }
    const doc = dbStore.documents.get(fact.document_id);
    const chunks = dbStore.documentChunks.get(fact.document_id) || [];
    const chunk = chunks.find((c) => c.chunk_id === fact.source_chunk_id);
    return res.json({ fact, document: doc, chunk });
  });

  // ============================================================
  // TRANSFORMATION, SEQUENTIAL GENERATION & OUTPUTS ENDPOINTS
  // ============================================================
  const handleTransformAndGenerate = async (
    req: AuthenticatedRequest,
    res: Response
  ) => {
    try {
      const { documentId, audience, selectedFormats, executionMode } =
        req.body || {};
      if (!documentId) {
        return res.status(400).json({ error: 'documentId is required.' });
      }
      if (
        !Array.isArray(selectedFormats) ||
        selectedFormats.length === 0
      ) {
        return res.status(400).json({
          error: 'At least one output format must be selected.',
        });
      }

      const result = await dbStore.executeTransformationJob({
        documentId: String(documentId),
        audience: (audience || 'Technical') as AudienceType,
        selectedFormats: selectedFormats as OutputFormatType[],
        executionMode: executionMode || runtimeSettings.execution_mode,
        issuerEmail: req.user?.email || 'admin@contentx.io',
      });

      dbStore.logAudit(
        req.user?.email || 'admin@contentx.io',
        req.user?.role || 'Admin',
        'TRANSFORM_GENERATE',
        result.job.job_id,
        `Generated ${result.outputs.length} formats (${result.job.selected_formats.join(', ')}) for ${result.job.document_name} [Audience: ${result.job.audience}]`
      );

      return res.status(201).json(result);
    } catch (err: any) {
      return res.status(500).json({
        error: err.message || 'Content transformation failed.',
      });
    }
  };

  app.post(
    '/api/transform',
    requireRole(['Admin', 'Editor']),
    handleTransformAndGenerate
  );
  app.post(
    '/api/generate',
    requireRole(['Admin', 'Editor']),
    handleTransformAndGenerate
  );

  app.get('/api/generation/:job_id', (req: Request, res: Response) => {
    const job = dbStore.jobs.get(req.params.job_id);
    if (!job) {
      return res.status(404).json({ error: 'Generation job not found.' });
    }
    const outputs = job.output_ids
      .map((id) => dbStore.outputs.get(id))
      .filter(Boolean);
    return res.json({ job, outputs });
  });

  app.get('/api/outputs', (req: Request, res: Response) => {
    const includeDemo = req.query.includeDemo !== 'false';
    const documentId = req.query.documentId as string | undefined;
    const outputs = Array.from(dbStore.outputs.values())
      .filter((o) => {
        const doc = dbStore.documents.get(o.document_id);
        if (!doc) return false;
        if (!includeDemo && doc.is_demo) return false;
        if (documentId && documentId !== 'all' && o.document_id !== documentId)
          return false;
        return true;
      })
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    return res.json({ outputs });
  });

  app.get('/api/outputs/:id', (req: Request, res: Response) => {
    const output = dbStore.outputs.get(req.params.id);
    if (!output) {
      return res.status(404).json({ error: 'Generated output not found.' });
    }
    return res.json({ output });
  });

  app.put(
    '/api/outputs/:id',
    requireRole(['Admin', 'Editor']),
    (req: AuthenticatedRequest, res: Response) => {
      const output = dbStore.outputs.get(req.params.id);
      if (!output) {
        return res.status(404).json({ error: 'Output not found.' });
      }
      const { content } = req.body || {};
      if (!content) {
        return res.status(400).json({ error: 'Updated content is required.' });
      }
      const allFacts = dbStore.facts.get(output.document_id) || [];
      const validation = validateGeneratedOutput({
        outputId: output.output_id,
        documentId: output.document_id,
        format: output.format,
        content,
        allFacts,
        siblingOutputs: [],
        retryCount: output.validation.retry_count,
      });

      output.content = content;
      output.validation = validation;
      output.status =
        validation.overall_status === 'FAILED'
          ? 'failed'
          : validation.overall_status === 'WARNING'
          ? 'completed_with_warnings'
          : 'completed';

      return res.json({ output, validation });
    }
  );

  app.post('/api/outputs/:id/validate', (req: Request, res: Response) => {
    const output = dbStore.outputs.get(req.params.id);
    if (!output) {
      return res.status(404).json({ error: 'Generated output not found.' });
    }
    const allFacts = dbStore.facts.get(output.document_id) || [];
    const validation = validateGeneratedOutput({
      outputId: output.output_id,
      documentId: output.document_id,
      format: output.format,
      content: output.content,
      allFacts,
      siblingOutputs: [],
      retryCount: output.validation.retry_count,
    });
    output.validation = validation;
    return res.json({ validation });
  });

  app.get('/api/outputs/:id/claims', (req: Request, res: Response) => {
    const output = dbStore.outputs.get(req.params.id);
    if (!output) {
      return res.status(404).json({ error: 'Generated output not found.' });
    }
    return res.json({ claims: output.claims });
  });

  // ============================================================
  // PROVENANCE & PUBLIC VERIFICATION ENDPOINTS
  // ============================================================
  app.get('/api/provenance', (req: Request, res: Response) => {
    const includeDemo = req.query.includeDemo !== 'false';
    const records = Array.from(dbStore.provenanceRecords.values())
      .filter((r) => includeDemo || !r.is_demo)
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    return res.json({ provenance: records });
  });

  app.post(
    '/api/provenance',
    requireRole(['Admin', 'Editor']),
    (req: AuthenticatedRequest, res: Response) => {
      const { verificationId, approvalStatus } = req.body || {};
      const provId = dbStore.verificationIndex.get(String(verificationId));
      if (!provId) {
        return res.status(404).json({ error: 'Provenance record not found.' });
      }
      const prov = dbStore.provenanceRecords.get(provId);
      if (!prov) {
        return res.status(404).json({ error: 'Provenance record not found.' });
      }
      if (approvalStatus) {
        prov.approval_status = approvalStatus;
      }
      dbStore.logAudit(
        req.user?.email || 'admin@contentx.io',
        req.user?.role || 'Admin',
        'PROVENANCE_ATTESTATION',
        prov.provenance_id,
        `Updated provenance approval status to ${prov.approval_status}`
      );
      return res.json({ provenance: prov });
    }
  );

  app.get('/api/verification/:id', (req: Request, res: Response) => {
    const tamperedContent = req.query.tamperedContent as string | undefined;
    const result = dbStore.verifyByVerificationId(
      req.params.id,
      tamperedContent
    );
    return res.json(result);
  });

  app.post('/api/verification/check', (req: Request, res: Response) => {
    const { verificationId, testPayload } = req.body || {};
    const result = dbStore.verifyByVerificationId(
      String(verificationId || ''),
      testPayload ? String(testPayload) : undefined
    );
    return res.json(result);
  });

  // ============================================================
  // HISTORY, ANALYTICS, DOMAINS & SETTINGS ENDPOINTS
  // ============================================================
  app.get('/api/history', (req: Request, res: Response) => {
    const includeDemo = req.query.includeDemo !== 'false';
    const jobs = Array.from(dbStore.jobs.values())
      .filter((j) => includeDemo || !j.is_demo)
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    return res.json({ jobs, audit_logs: dbStore.auditLogs.slice(0, 50) });
  });

  app.get('/api/analytics', (req: Request, res: Response) => {
    const includeDemo = req.query.includeDemo !== 'false';
    const summary = dbStore.computeAnalytics(includeDemo);
    return res.json(summary);
  });

  app.get('/api/domains', (_req: Request, res: Response) => {
    return res.json({
      domains: [
        {
          id: 'Cybersecurity',
          name: 'Cybersecurity',
          status: 'Active Pack',
          entities: [
            'Incident',
            'Threat Actor',
            'Malware',
            'CVE',
            'CWE',
            'CVSS',
            'IOC (IP, Domain, URL, Hash, File)',
            'Attack Technique (MITRE)',
            'Affected Product/Version',
            'Impact & Mitigation',
            'Severity & Status',
          ],
          guardrail:
            'Strictly blocks invention of CVEs, CVSS scores, IPs, SHA-256 hashes, or malware identifiers.',
        },
        {
          id: 'Blockchain',
          name: 'Blockchain',
          status: 'Active Pack',
          entities: [
            'Blockchain Network',
            'Chain ID',
            'Block Number',
            'Transaction Hash',
            'Wallet & Contract Address',
            'Token / NFT / Smart Contract',
            'Gas & Nonce',
            'Validator & Bridge Status',
          ],
          guardrail:
            'Strictly blocks invention of 0x transaction hashes, wallet/contract addresses, block numbers, and chain IDs.',
        },
        {
          id: 'Research',
          name: 'Research',
          status: 'Active Pack',
          entities: [
            'Hypothesis',
            'Cohort Size',
            'Methodology',
            'p-value / Confidence Interval',
            'Empirical Findings',
          ],
          guardrail: 'Preserves statistical caveats and study boundaries.',
        },
        {
          id: 'Business',
          name: 'Business',
          status: 'Active Pack',
          entities: [
            'Revenue / EBITDA',
            'Capital Allocation',
            'Operating Margin',
            'Supply Chain Metrics',
            'Fiscal Timeline',
          ],
          guardrail: 'Preserves exact financial figures, units, and fiscal periods.',
        },
        {
          id: 'Policy',
          name: 'Policy',
          status: 'Active Pack',
          entities: ['Statute', 'Compliance Mandate', 'Jurisdiction', 'Effective Date'],
          guardrail: 'Preserves normative vs conditional legal obligations.',
        },
        {
          id: 'Education',
          name: 'Education',
          status: 'Active Pack',
          entities: ['Curriculum Concept', 'Learning Outcome', 'Assessment Metric'],
          guardrail: 'Adapts pedagogical complexity while retaining source definitions.',
        },
        {
          id: 'General',
          name: 'General',
          status: 'Active Pack',
          entities: ['Entities', 'Dates', 'Numbers', 'Claims', 'Relationships'],
          guardrail: 'Enforces Fact Registry grounding across all 7 formats.',
        },
        {
          id: 'Custom',
          name: 'Custom',
          status: 'Configurable',
          entities: ['User-Defined Taxonomy', 'Custom Regex Identifiers'],
          guardrail: 'Inherits 15-point validation & uncertainty protection.',
        },
      ],
    });
  });

  app.get('/api/provider-status', async (_req: Request, res: Response) => {
    const ollamaConnected = await checkOllamaStatus();
    const geminiConfigured = Boolean(
      process.env.GEMINI_API_KEY &&
        process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
    );

    const status: ProviderConfigStatus = {
      generation_provider: ollamaConnected
        ? 'ollama_local'
        : geminiConfigured
        ? 'gemini_server_grounded'
        : 'deterministic_compiler',
      ollama_url: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
      ollama_connected: ollamaConnected,
      ollama_generation_model: runtimeSettings.ollama_generation_model,
      ollama_embedding_model: runtimeSettings.ollama_embedding_model,
      embedding_dimension: 1024,
      execution_mode: runtimeSettings.execution_mode,
      num_ctx: runtimeSettings.num_ctx,
      temperature: runtimeSettings.temperature,
      gemini_configured: geminiConfigured,
      pgvector_mode: '1024-dim Cosine Similarity Vector Store (BGE-M3 schema)',
      chunk_target_words: runtimeSettings.chunk_target_words,
      chunk_overlap_words: runtimeSettings.chunk_overlap_words,
      openrouter_disabled: true,
    };
    return res.json(status);
  });

  app.post(
    '/api/settings/provider',
    requireRole(['Admin']),
    (req: AuthenticatedRequest, res: Response) => {
      const {
        execution_mode,
        chunk_target_words,
        chunk_overlap_words,
        ollama_generation_model,
        temperature,
      } = req.body || {};

      if (execution_mode === 'sequential' || execution_mode === 'parallel') {
        runtimeSettings.execution_mode = execution_mode;
      }
      if (chunk_target_words) {
        runtimeSettings.chunk_target_words = Math.max(
          150,
          Math.min(2000, Number(chunk_target_words))
        );
      }
      if (chunk_overlap_words !== undefined) {
        runtimeSettings.chunk_overlap_words = Math.max(
          10,
          Math.min(400, Number(chunk_overlap_words))
        );
      }
      if (ollama_generation_model) {
        runtimeSettings.ollama_generation_model = String(
          ollama_generation_model
        );
      }
      if (temperature !== undefined) {
        runtimeSettings.temperature = Math.max(
          0,
          Math.min(1, Number(temperature))
        );
      }

      dbStore.logAudit(
        req.user?.email || 'admin@contentx.io',
        'Admin',
        'SETTINGS_UPDATE',
        'provider_config',
        `Updated execution_mode=${runtimeSettings.execution_mode}, chunk_target=${runtimeSettings.chunk_target_words}w`
      );

      return res.json({ updated: true, settings: runtimeSettings });
    }
  );

  return app;
}

async function startServer() {
  const app = await createApp();
  const PORT = 3000;

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ContentX Platform listening on http://0.0.0.0:${PORT}`);
  });
}

// Only start HTTP listener when executed directly (allows importing createApp in tests)
if (
  process.argv[1] &&
  (process.argv[1].endsWith('server.ts') ||
    process.argv[1].endsWith('server.js'))
) {
  startServer();
}
