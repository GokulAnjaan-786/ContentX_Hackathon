import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { registerType as registerPgVectorType } from 'pgvector/pg';
import { config } from '../../config/env.ts';
import { metricsRegistry } from '../../services/metricsService.ts';
import { logger } from '../../utils/logger.ts';

const { Pool } = pg;

let pool: pg.Pool | null = null;
let pgvectorRegistered = false;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    pool.on('error', (err) => {
      metricsRegistry.databaseErrorsTotal.inc();
      logger.error('[POSTGRES POOL ERROR]', {
        event: 'db_pool_error',
        error: err.message,
      });
    });
  }
  return pool;
}

export async function setupPgVectorTypes(client: pg.PoolClient | pg.Pool): Promise<void> {
  if (pgvectorRegistered) return;
  try {
    await registerPgVectorType(client);
    pgvectorRegistered = true;
  } catch (err: any) {
    // If pgvector extension is not installed yet or registered on mock, log warning
    logger.warn('[PGVECTOR TYPE NOTICE]', {
      event: 'pgvector_type_warning',
      error: err.message,
    });
  }
}

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<T>> {
  metricsRegistry.databaseOperationsTotal.inc({ operation: 'query' });
  try {
    const p = getPool();
    return await p.query<T>(text, params);
  } catch (err: any) {
    metricsRegistry.databaseErrorsTotal.inc();
    throw err;
  }
}

export async function getClient(): Promise<pg.PoolClient> {
  metricsRegistry.databaseOperationsTotal.inc({ operation: 'connect' });
  try {
    const p = getPool();
    const client = await p.connect();
    return client;
  } catch (err: any) {
    metricsRegistry.databaseErrorsTotal.inc();
    throw err;
  }
}

export async function checkDatabaseHealth(): Promise<{
  connected: boolean;
  pgvectorAvailable: boolean;
  version?: string;
  error?: string;
}> {
  try {
    const res = await query('SELECT version();');
    const versionStr = res.rows[0]?.version || '';
    
    let vectorAvail = false;
    try {
      const vecRes = await query("SELECT extname FROM pg_extension WHERE extname = 'vector';");
      vectorAvail = vecRes.rows.length > 0;
    } catch {
      vectorAvail = false;
    }

    return {
      connected: true,
      pgvectorAvailable: vectorAvail,
      version: versionStr,
    };
  } catch (err: any) {
    return {
      connected: false,
      pgvectorAvailable: false,
      error: err.message,
    };
  }
}

export async function runMigrations(): Promise<void> {
  const client = await getClient();
  try {
    await client.query('BEGIN;');
    
    // Ensure migrations table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(128) PRIMARY KEY,
        applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const migrationFile = path.join(
      process.cwd(),
      'src/server/store/postgres/migrations/001_initial_schema.sql'
    );
    if (fs.existsSync(migrationFile)) {
      const sql = fs.readFileSync(migrationFile, 'utf-8');
      const applied = await client.query(
        "SELECT version FROM schema_migrations WHERE version = '001_initial_schema';"
      );

      if (applied.rows.length === 0) {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (version) VALUES ('001_initial_schema');"
        );
        logger.info('✓ [POSTGRES MIGRATION] Applied 001_initial_schema.sql successfully', {
          event: 'db_migration_applied',
        });
      }
    }

    await client.query('COMMIT;');
    await setupPgVectorTypes(client);
  } catch (err: any) {
    await client.query('ROLLBACK;');
    logger.error('[POSTGRES MIGRATION ERROR]', {
      event: 'db_migration_error',
      error: err.message,
    });
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    pgvectorRegistered = false;
  }
}
