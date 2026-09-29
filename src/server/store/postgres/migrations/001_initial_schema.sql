-- ContentX Initial PostgreSQL + pgvector Schema Migration
-- Migration: 001_initial_schema.sql

CREATE EXTENSION IF NOT EXISTS vector;

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(128) NOT NULL,
    password_salt VARCHAR(64) NOT NULL,
    name VARCHAR(255) NOT NULL,
    organization VARCHAR(255) NOT NULL,
    role VARCHAR(32) NOT NULL CHECK (role IN ('Admin', 'Editor', 'Viewer')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(LOWER(email));

-- 2. SESSIONS & REVOKED TOKENS
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    expires_at BIGINT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS revoked_tokens (
    token TEXT PRIMARY KEY,
    revoked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- 3. DOCUMENTS TABLE
CREATE TABLE IF NOT EXISTS documents (
    document_id VARCHAR(128) PRIMARY KEY,
    filename VARCHAR(512) NOT NULL,
    mime_type VARCHAR(128) NOT NULL,
    file_size BIGINT NOT NULL,
    pages INTEGER NOT NULL DEFAULT 1,
    word_count INTEGER NOT NULL DEFAULT 0,
    upload_date TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sha256_fingerprint VARCHAR(64) NOT NULL,
    processing_status VARCHAR(32) NOT NULL CHECK (processing_status IN ('pending', 'processing', 'completed', 'failed')),
    detected_domain VARCHAR(64) NOT NULL DEFAULT 'General',
    raw_text TEXT NOT NULL DEFAULT '',
    page_texts JSONB NOT NULL DEFAULT '[]'::jsonb,
    security_scan JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_quality JSONB NOT NULL DEFAULT '{}'::jsonb,
    extraction_failure_reason TEXT,
    understanding JSONB,
    rag_decision JSONB,
    facts_count INTEGER NOT NULL DEFAULT 0,
    outputs_count INTEGER NOT NULL DEFAULT 0,
    uploaded_by VARCHAR(255) NOT NULL,
    is_demo BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS document_buffers (
    document_id VARCHAR(128) PRIMARY KEY REFERENCES documents(document_id) ON DELETE CASCADE,
    buffer_data BYTEA NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_documents_uploaded_by ON documents(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_documents_status ON documents(processing_status);

-- 4. DOCUMENT CHUNKS TABLE WITH PGVECTOR
CREATE TABLE IF NOT EXISTS document_chunks (
    chunk_id VARCHAR(128) PRIMARY KEY,
    document_id VARCHAR(128) NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    page_number INTEGER NOT NULL DEFAULT 1,
    start_word_index INTEGER NOT NULL DEFAULT 0,
    end_word_index INTEGER NOT NULL DEFAULT 0,
    word_count INTEGER NOT NULL DEFAULT 0,
    source_text TEXT NOT NULL,
    embedding_model VARCHAR(128) NOT NULL DEFAULT 'bge-m3:latest',
    embedding_dim INTEGER NOT NULL DEFAULT 1024,
    embedding vector(1024),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chunks_document_id ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_embedding_hnsw ON document_chunks USING hnsw (embedding vector_cosine_ops);

-- 5. FACT REGISTRY TABLE
CREATE TABLE IF NOT EXISTS facts (
    fact_id VARCHAR(128) PRIMARY KEY,
    document_id VARCHAR(128) NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    source_chunk_id VARCHAR(128) NOT NULL,
    source_page INTEGER NOT NULL DEFAULT 1,
    category VARCHAR(64) NOT NULL,
    importance VARCHAR(32) NOT NULL DEFAULT 'medium',
    certainty VARCHAR(32) NOT NULL DEFAULT 'confirmed',
    negated BOOLEAN NOT NULL DEFAULT false,
    statement TEXT NOT NULL,
    entities JSONB NOT NULL DEFAULT '[]'::jsonb,
    dates JSONB NOT NULL DEFAULT '[]'::jsonb,
    numbers JSONB NOT NULL DEFAULT '[]'::jsonb,
    technical_identifiers JSONB NOT NULL DEFAULT '[]'::jsonb,
    domain_specific JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_facts_document_id ON facts(document_id);
CREATE INDEX IF NOT EXISTS idx_facts_category ON facts(category);

-- 6. GENERATION JOBS TABLE
CREATE TABLE IF NOT EXISTS generation_jobs (
    job_id VARCHAR(128) PRIMARY KEY,
    document_id VARCHAR(128) NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    document_name VARCHAR(512) NOT NULL,
    domain VARCHAR(64) NOT NULL,
    audience VARCHAR(64) NOT NULL,
    selected_formats JSONB NOT NULL DEFAULT '[]'::jsonb,
    execution_mode VARCHAR(32) NOT NULL DEFAULT 'sequential',
    status VARCHAR(32) NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    current_step TEXT NOT NULL DEFAULT '',
    completed_formats JSONB NOT NULL DEFAULT '[]'::jsonb,
    failed_formats JSONB NOT NULL DEFAULT '[]'::jsonb,
    output_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    issuer_email VARCHAR(255) NOT NULL,
    is_demo BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_jobs_document_id ON generation_jobs(document_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON generation_jobs(status);

-- 7. GENERATED OUTPUTS TABLE
CREATE TABLE IF NOT EXISTS generated_outputs (
    output_id VARCHAR(128) PRIMARY KEY,
    job_id VARCHAR(128) NOT NULL REFERENCES generation_jobs(job_id) ON DELETE CASCADE,
    document_id VARCHAR(128) NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    format VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL CHECK (status IN ('processing', 'completed', 'completed_with_warnings', 'failed')),
    content JSONB NOT NULL DEFAULT '{}'::jsonb,
    claims JSONB NOT NULL DEFAULT '[]'::jsonb,
    fact_ids_used JSONB NOT NULL DEFAULT '[]'::jsonb,
    validation JSONB NOT NULL DEFAULT '{}'::jsonb,
    verification_id VARCHAR(128) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_outputs_document_id ON generated_outputs(document_id);
CREATE INDEX IF NOT EXISTS idx_outputs_job_id ON generated_outputs(job_id);
CREATE INDEX IF NOT EXISTS idx_outputs_format ON generated_outputs(format);

-- 8. PROVENANCE & PUBLIC VERIFICATION TABLE
CREATE TABLE IF NOT EXISTS provenance_records (
    provenance_id VARCHAR(128) PRIMARY KEY,
    verification_id VARCHAR(128) NOT NULL UNIQUE,
    document_id VARCHAR(128) NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    document_name VARCHAR(512) NOT NULL,
    output_id VARCHAR(128) NOT NULL REFERENCES generated_outputs(output_id) ON DELETE CASCADE,
    format VARCHAR(64) NOT NULL,
    sha256_output_hash VARCHAR(64) NOT NULL,
    sha256_source_hash VARCHAR(64) NOT NULL,
    fact_ids_used JSONB NOT NULL DEFAULT '[]'::jsonb,
    validation_score DOUBLE PRECISION NOT NULL DEFAULT 100.0,
    model_name VARCHAR(128) NOT NULL DEFAULT 'Qwen2.5:7B',
    approval_status VARCHAR(32) NOT NULL DEFAULT 'APPROVED',
    is_demo BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_provenance_verification_id ON provenance_records(verification_id);
CREATE INDEX IF NOT EXISTS idx_provenance_document_id ON provenance_records(document_id);

-- 9. AUDIT LOGS TABLE
CREATE TABLE IF NOT EXISTS audit_logs (
    log_id VARCHAR(128) PRIMARY KEY,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    user_email VARCHAR(255) NOT NULL,
    user_role VARCHAR(32) NOT NULL,
    action VARCHAR(128) NOT NULL,
    resource_id VARCHAR(128) NOT NULL,
    details TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_email ON audit_logs(user_email);
