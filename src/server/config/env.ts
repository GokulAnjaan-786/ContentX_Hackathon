import dotenv from 'dotenv';

dotenv.config();

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  port: number;
  jwtSecret: string;
  demoMode: boolean;
  corsOrigin: string;
  storageMode: 'postgres' | 'memory';
  databaseUrl: string;
  databaseRequired: boolean;
  postgresHost: string;
  postgresPort: number;
  postgresDb: string;
  postgresUser: string;
  postgresPassword?: string;
  ollamaBaseUrl: string;
  ollamaGenerationModel: string;
  ollamaEmbeddingModel: string;
  ollamaEmbeddingDim: number;
  ollamaNumCtx: number;
  ollamaTemperature: number;
  ollamaExecutionMode: 'sequential' | 'parallel';
  chunkTargetWords: number;
  chunkOverlapWords: number;
  ragMinWordsThreshold: number;
  maxFileSizeMb: number;
  adminEmail?: string;
  adminPassword?: string;
}

export function validateAndLoadConfig(): AppConfig {
  const nodeEnv = (process.env.NODE_ENV || 'development').toLowerCase();
  const env =
    nodeEnv === 'production'
      ? 'production'
      : nodeEnv === 'test'
      ? 'test'
      : 'development';

  const isProd = env === 'production';

  const jwtSecret = process.env.JWT_SECRET || '';

  // CRITICAL SECURITY CHECK (CRIT-04 & SEC-05/06):
  // Production startup MUST fail fast if JWT_SECRET is missing, empty, default, or insecure (< 32 chars).
  if (isProd) {
    if (
      !jwtSecret ||
      jwtSecret.trim() === '' ||
      jwtSecret === 'contentx-institutional-verification-secret-key' ||
      jwtSecret === 'contentx-secret' ||
      jwtSecret.length < 32
    ) {
      throw new Error(
        '[FATAL CONFIG ERROR] JWT_SECRET is invalid for production mode. Production requires a strong, random secret of at least 32 characters set via environment variable. Application startup aborted.'
      );
    }
  }

  const effectiveJwtSecret =
    jwtSecret || 'contentx-dev-secret-key-do-not-use-in-production-32-chars-min';

  // Demo mode is explicitly disabled in production unless explicitly overridden
  const rawDemoMode = process.env.CONTENTX_DEMO_MODE;
  const demoMode =
    isProd
      ? rawDemoMode === 'true'
      : rawDemoMode !== 'false';

  const port = Number(process.env.PORT || 3000);
  const corsOrigin = process.env.CORS_ORIGIN || (isProd ? '' : 'http://localhost:3000');

  // Storage Mode & PostgreSQL Configuration
  const rawStorageMode = (process.env.CONTENTX_STORAGE_MODE || '').toLowerCase();
  const storageMode: 'postgres' | 'memory' =
    rawStorageMode === 'memory'
      ? 'memory'
      : isProd || rawStorageMode === 'postgres'
      ? 'postgres'
      : 'memory'; // default to memory in dev/test unless explicitly postgres

  const databaseRequired =
    process.env.DATABASE_REQUIRED === 'true' || (isProd && storageMode === 'postgres');

  const postgresHost = process.env.POSTGRES_HOST || 'localhost';
  const postgresPort = Number(process.env.POSTGRES_PORT || 5432);
  const postgresDb = process.env.POSTGRES_DB || 'contentx_db';
  const postgresUser = process.env.POSTGRES_USER || 'contentx_app';
  const postgresPassword = process.env.POSTGRES_PASSWORD || 'contentx_secure_pass_2026';

  const databaseUrl =
    process.env.DATABASE_URL ||
    `postgres://${postgresUser}:${encodeURIComponent(
      postgresPassword
    )}@${postgresHost}:${postgresPort}/${postgresDb}`;

  return {
    env,
    port,
    jwtSecret: effectiveJwtSecret,
    demoMode,
    corsOrigin,
    storageMode,
    databaseUrl,
    databaseRequired,
    postgresHost,
    postgresPort,
    postgresDb,
    postgresUser,
    postgresPassword,
    ollamaBaseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    ollamaGenerationModel: process.env.OLLAMA_GENERATION_MODEL || 'qwen2.5:7b',
    ollamaEmbeddingModel: process.env.OLLAMA_EMBEDDING_MODEL || 'bge-m3:latest',
    ollamaEmbeddingDim: Number(process.env.OLLAMA_EMBEDDING_DIM || 1024),
    ollamaNumCtx: Number(process.env.OLLAMA_NUM_CTX || 16384),
    ollamaTemperature: Number(process.env.OLLAMA_TEMPERATURE || 0.1),
    ollamaExecutionMode:
      process.env.OLLAMA_GENERATION_EXECUTION_MODE === 'parallel'
        ? 'parallel'
        : 'sequential',
    chunkTargetWords: Number(process.env.CHUNK_TARGET_WORDS || 600),
    chunkOverlapWords: Number(
      process.env.OLLAMA_OVERLAP_WORDS || process.env.CHUNK_OVERLAP_WORDS || 50
    ),
    ragMinWordsThreshold: Number(process.env.RAG_MIN_WORDS_THRESHOLD || 800),
    maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB || 25),
    adminEmail: process.env.CONTENTX_ADMIN_EMAIL,
    adminPassword: process.env.CONTENTX_ADMIN_PASSWORD,
  };
}

export const config = validateAndLoadConfig();
