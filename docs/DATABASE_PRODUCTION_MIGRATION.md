# ContentX Database Production Migration & pgvector Operations Guide

## Executive Summary
This document provides the operational runbook and architecture reference for migrating ContentX from volatile in-memory storage to **PostgreSQL 16 with pgvector**.

---

## 1. Database Architecture & Schema Design

### 1.1 Core Database Entities
The ContentX schema (`001_initial_schema.sql`) implements 9 relational tables with foreign keys and strict constraints:

| Entity Name | Primary Key | Description & Special Features |
| :--- | :--- | :--- |
| `users` | `email` (TEXT) | RBAC role management (`Admin`, `Analyst`, `Viewer`), scrypt salt & password hash storage. |
| `sessions` | `token` (TEXT) | Active JWT sessions with expiration timestamps (`expires_at`). |
| `revoked_tokens` | `token` (TEXT) | Revoked token blacklist for invalidating JWTs upon logout. |
| `documents` | `document_id` (TEXT) | Metadata, filename, file size, page count, SHA-256 fingerprint, domain classification, and audit status. |
| `document_buffers` | `document_id` (TEXT) | Binary buffer storage for uploaded documents (`BYTEA`). |
| `document_chunks` | `chunk_id` (TEXT) | Text chunks, page mapping, word counts, and 1024-dimensional BGE-M3 `embedding vector(1024)`. |
| `facts` | `fact_id` (TEXT) | Extracted atomic facts, ground truth statements, page numbers, line ranges, and confidence metrics. |
| `generation_jobs` | `job_id` (TEXT) | Sequential Qwen2.5:7B generation job state tracking (`queued`, `processing`, `completed`, `failed`). |
| `generated_outputs` | `output_id` (TEXT) | Output contents (JSONB), format type, claims, validation results (JSONB), and verification ID. |
| `provenance_records` | `provenance_id` (TEXT) | Cryptographic SHA-256 attestation records linking outputs, source document hashes, facts, and model parameters. |
| `audit_logs` | `id` (BIGSERIAL) | Write-only security audit trail storing timestamp, user email, role, action, resource, and details. |

---

## 2. pgvector Extension & Indexing Strategy

### 2.1 Vector Column & Embedding Specification
- **Embedding Model**: `BGE-M3` (BAAI)
- **Vector Dimension**: `1024` dimensions
- **Column Definition**: `embedding vector(1024)` in table `document_chunks`.

### 2.2 Vector Search Indexing (HNSW)
To enable sub-millisecond similarity search across large document corpora, ContentX creates an HNSW index with cosine distance operator:

```sql
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw 
ON document_chunks 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);
```

### 2.3 Parameterized Vector Query & Document Isolation
ContentX strictly enforces **Document Isolation** on vector similarity searches. Query vectors use pgvector's cosine distance operator `<=>` filtered by `document_id`:

```sql
SELECT 
    chunk_id,
    document_id,
    chunk_index,
    page_number,
    text,
    word_count,
    1 - (embedding <=> $1) AS similarity
FROM document_chunks
WHERE document_id = $2
ORDER BY embedding <=> $1
LIMIT $3;
```

---

## 3. Migration Execution Procedure

### 3.1 Automatic Migration on Startup
When `CONTENTX_STORAGE_MODE=postgres`, the ContentX server automatically verifies and executes pending SQL schema migrations located in `src/server/store/postgres/migrations/` using `postgresClient.ts`.

### 3.2 Manual Migration Procedure
To run migrations manually or against an external database cluster:

```bash
# Set connection parameters
export DATABASE_URL="postgresql://contentx:contentx_secure_password@localhost:5432/contentx_db"

# Apply initial schema migration
psql $DATABASE_URL -f src/server/store/postgres/migrations/001_initial_schema.sql
```

---

## 4. Connection Pooling & Environment Configuration

### 4.1 Environment Variables
| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `CONTENTX_STORAGE_MODE` | `postgres` | `postgres` (production) or `memory` (dev/test fallback). |
| `DATABASE_URL` | `postgresql://...` | Connection URI for PostgreSQL. |
| `DATABASE_REQUIRED` | `true` | When `true` in production, server fails startup if DB connection fails. |
| `POSTGRES_POOL_MAX` | `20` | Maximum concurrent connections in `pg.Pool`. |
| `POSTGRES_IDLE_TIMEOUT_MS` | `30000` | Idle connection close timeout (ms). |

### 4.2 Pool Health Checks & Readiness
The `/api/health` and `/api/readiness` endpoints query `SELECT 1` and test pgvector status. If PostgreSQL is unreachable when `DATABASE_REQUIRED=true`, readiness returns `503 Service Unavailable` with `database: disconnected`.
