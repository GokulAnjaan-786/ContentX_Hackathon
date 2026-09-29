# ContentX — AI Content Transformation, RAG, Verification & Provenance Platform

> **Tagline:** *"One Source. Every Format. Verified at Every Step."*  
> **Core Innovation:** *"Change the complexity of the message, not the truth behind it."*

---

## 1. Project Overview & Architecture

**ContentX** is a domain-aware, source-grounded AI content transformation and cryptographic verification platform. It ingests a trusted source document (`PDF`, `DOCX`, `TXT`), performs security and prompt-injection scanning, extracts domain-specific intelligence (`Cybersecurity`, `Blockchain`, `Research`, `Business`, `Policy`, `Education`, `General`, `Custom`), constructs a canonical **Fact Registry**, evaluates selective **BGE-M3 (1024-dim)** vector retrieval, applies **Truth Compression** for the target audience, sequentially generates up to **7 structured formats**, validates every output against a **15-point verification gate**, and issues a **SHA-256 Provenance Certificate** verifiable at `/verify/{verification_id}`.

```text
SOURCE → UNDERSTANDING → FACT REGISTRY → DOMAIN INTELLIGENCE → AUDIENCE / TRUTH COMPRESSION → 7 OUTPUTS → 15-POINT VALIDATION → PROVENANCE → PUBLIC VERIFICATION
```

---

## 2. Repository Structure

```text
/
├── server.ts                                      # Full-stack Express + Vite server & REST API endpoints
├── docker-compose.yml                             # PostgreSQL (pgvector), Redis, Ollama (qwen2.5:7b + bge-m3)
├── .env.example                                   # Environment configuration template
├── package.json                                   # Scripts & dependencies
└── src/
    ├── App.tsx                                    # Institutional SaaS Dashboard & 9 Primary Workspace Views
    ├── types/
    │   └── contentx.ts                            # Canonical TypeScript schemas & interfaces
    ├── components/
    │   ├── TransformWorkspace.tsx                 # 7-Step Transformation Workspace
    │   ├── OutputStudioView.tsx                   # 7-Format Output Studio + Clickable Claim Inspector
    │   ├── ClaimInspectorDrawer.tsx               # Claim → Fact ID → Chunk → Page → Verbatim Source Drawer
    │   ├── VerificationAndProvenanceView.tsx      # Public /verify/{id} Portal + Tamper Sandbox + Provenance
    │   └── AuthModal.tsx                          # JWT Authentication & RBAC Role Switcher (Admin/Editor/Viewer)
    └── server/
        ├── services/
        │   ├── ingestionService.ts                # PDF/DOCX/TXT extraction, SHA-256, Security Scan, BGE-M3 1024-d RAG
        │   ├── domainAndUnderstandingService.ts   # 8 Domain Packs (Cybersecurity & Blockchain), Fact Registry, Context Builder
        │   └── generationAndValidationService.ts  # Sequential 7-Format Generator + 15-Point Validation Engine
        ├── store/
        │   └── databaseStore.ts                   # Relational entity store + Labeled DEMO DATA seeder
        └── tests/
            └── runTests.ts                        # 17-category automated backend verification suite
```

---

## 3. Setup Instructions & Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Key environment variables:
- `OLLAMA_BASE_URL="http://localhost:11434"`
- `OLLAMA_GENERATION_MODEL="qwen2.5:7b"`
- `OLLAMA_EMBEDDING_MODEL="bge-m3:latest"`
- `OLLAMA_EMBEDDING_DIM="1024"`
- `OLLAMA_NUM_CTX="16384"`
- `OLLAMA_TEMPERATURE="0.1"`
- `OLLAMA_GENERATION_EXECUTION_MODE="sequential"`
- `CHUNK_TARGET_WORDS="600"`
- `CHUNK_OVERLAP_WORDS="50"`

> **AI Provider Rule:** ContentX never uses OpenRouter. It connects to local Ollama (`qwen2.5:7b` + `bge-m3:latest`) when running locally and includes a deterministic Fact-Registry Grounded Compiler so all 7 outputs and 15 validation gates work out-of-the-box in cloud sandboxes.

---

## 4. Local Ollama & BGE-M3 Setup

```bash
# Pull default generation model (qwen2.5:7b) and 1024-dim embedding model (bge-m3:latest)
ollama pull qwen2.5:7b
ollama pull bge-m3:latest
```

---

## 5. Development & Test Commands

```bash
# Install dependencies
npm install

# Start full-stack server on http://0.0.0.0:3000
npm run dev

# Run the 17-category automated test suite
npm test

# Type-check and build production bundle
npm run lint
npm run build
```

---

## 6. REST API Documentation

- `POST /api/auth/login` · `POST /api/auth/register` · `POST /api/auth/forgot-password` · `GET /api/auth/me`
- `POST /api/documents/upload` · `GET /api/documents` · `GET /api/documents/:id` · `DELETE /api/documents/:id`
- `POST /api/documents/:id/analyze` · `GET /api/documents/:id/understanding`
- `GET /api/documents/:id/facts` · `GET /api/facts` · `GET /api/facts/:fact_id`
- `POST /api/transform` · `POST /api/generate` · `GET /api/generation/:job_id`
- `GET /api/outputs` · `GET /api/outputs/:id` · `PUT /api/outputs/:id`
- `POST /api/outputs/:id/validate` · `GET /api/outputs/:id/claims`
- `GET /api/verification/:id` · `POST /api/verification/check`
- `GET /api/provenance` · `POST /api/provenance`
- `GET /api/history` · `GET /api/analytics` · `GET /api/domains` · `GET /api/provider-status`

---

## 7. Known Limitations & Modular Roadmap

- **Supported Ingestion Formats:** `PDF`, `DOCX`, `TXT`.
- **Modular / Coming Soon Extensions:** Direct OCR on scanned image PDFs, audio/video transcription ingestion, MP4 video rendering, and live L1/L2 on-chain transaction anchoring are represented transparently as modular extensions (`Provider Not Configured` / `Coming Soon`).
