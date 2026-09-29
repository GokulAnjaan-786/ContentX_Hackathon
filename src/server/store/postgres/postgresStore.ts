import { config } from '../../config/env.ts';
import {
  checkDatabaseHealth,
  closePool,
  runMigrations,
} from './postgresClient.ts';
import { userRepository } from '../repositories/userRepository.ts';
import { sessionRepository } from '../repositories/sessionRepository.ts';
import { documentRepository } from '../repositories/documentRepository.ts';
import { chunkRepository } from '../repositories/chunkRepository.ts';
import { factRepository } from '../repositories/factRepository.ts';
import { generationRepository } from '../repositories/generationRepository.ts';
import { outputRepository } from '../repositories/outputRepository.ts';
import { provenanceRepository } from '../repositories/provenanceRepository.ts';
import { auditRepository } from '../repositories/auditRepository.ts';
import { StoredUser, AuditLogEntry } from '../databaseStore.ts';
import {
  DocumentChunk,
  FactRegistryItem,
  GeneratedOutputRecord,
  GenerationJob,
  ProvenanceRecord,
  SourceDocument,
  User,
} from '../../../types/contentx.ts';

export class PostgresStoreService {
  public async initializeDatabase(): Promise<boolean> {
    const health = await checkDatabaseHealth();
    if (!health.connected) {
      if (config.databaseRequired) {
        throw new Error(
          `[FATAL DATABASE ERROR] Production PostgreSQL database is required but unreachable: ${
            health.error || 'Connection failed'
          }`
        );
      }
      console.warn(
        `[POSTGRES STORE NOTICE] PostgreSQL is unreachable (${health.error}). Operating in memory mode.`
      );
      return false;
    }

    try {
      await runMigrations();
      console.log('✓ [POSTGRES STORE] Database initialized and schema verified');
      return true;
    } catch (err: any) {
      if (config.databaseRequired) {
        throw new Error(
          `[FATAL DATABASE ERROR] PostgreSQL migration failed: ${err.message}`
        );
      }
      console.warn(
        `[POSTGRES STORE NOTICE] Migration failed (${err.message}). Falling back to memory mode.`
      );
      return false;
    }
  }

  // Sync users
  public async saveUser(user: StoredUser): Promise<void> {
    await userRepository.saveUser(user);
  }

  public async loadUsers(): Promise<StoredUser[]> {
    return userRepository.listUsers();
  }

  // Sync sessions
  public async saveSession(token: string, user: User, expiresAt: number): Promise<void> {
    await sessionRepository.saveSession(token, user, expiresAt);
  }

  public async revokeToken(token: string): Promise<void> {
    await sessionRepository.revokeToken(token);
  }

  public async loadSessions(): Promise<Map<string, User>> {
    // Session state
    return new Map();
  }

  // Sync documents & buffers
  public async saveDocument(doc: SourceDocument, buffer?: Buffer): Promise<void> {
    await documentRepository.saveDocument(doc, buffer);
  }

  public async loadDocuments(includeDemo = true): Promise<SourceDocument[]> {
    return documentRepository.listDocuments(includeDemo);
  }

  public async loadDocumentBuffer(docId: string): Promise<Buffer | null> {
    return documentRepository.getDocumentBuffer(docId);
  }

  public async deleteDocument(docId: string): Promise<void> {
    await documentRepository.deleteDocument(docId);
  }

  // Sync chunks & pgvector
  public async saveChunks(
    docId: string,
    chunks: DocumentChunk[],
    vectors?: Map<string, number[]>
  ): Promise<void> {
    await chunkRepository.saveChunks(docId, chunks, vectors);
  }

  public async loadChunks(docId: string): Promise<DocumentChunk[]> {
    return chunkRepository.getChunksByDocumentId(docId);
  }

  public async vectorSearch(
    docId: string,
    queryVector: number[],
    topK = 5
  ): Promise<Array<DocumentChunk & { distance: number }>> {
    return chunkRepository.findSimilarChunksPgVector(docId, queryVector, topK);
  }

  // Sync facts
  public async saveFacts(docId: string, facts: FactRegistryItem[]): Promise<void> {
    await factRepository.saveFacts(docId, facts);
  }

  public async loadFacts(docId: string): Promise<FactRegistryItem[]> {
    return factRepository.getFactsByDocumentId(docId);
  }

  public async loadAllFacts(includeDemo = true): Promise<FactRegistryItem[]> {
    return factRepository.getAllFacts(includeDemo);
  }

  // Sync jobs & outputs
  public async saveJob(job: GenerationJob): Promise<void> {
    await generationRepository.saveJob(job);
  }

  public async loadJobs(includeDemo = true): Promise<GenerationJob[]> {
    return generationRepository.listJobs(includeDemo);
  }

  public async saveOutput(output: GeneratedOutputRecord): Promise<void> {
    await outputRepository.saveOutput(output);
  }

  public async loadOutputs(includeDemo = true): Promise<GeneratedOutputRecord[]> {
    return outputRepository.listOutputs(includeDemo);
  }

  // Sync provenance
  public async saveProvenance(record: ProvenanceRecord): Promise<void> {
    await provenanceRepository.saveProvenance(record);
  }

  public async getProvenanceByVerificationId(
    verificationId: string
  ): Promise<ProvenanceRecord | null> {
    return provenanceRepository.getProvenanceByVerificationId(verificationId);
  }

  public async loadProvenance(includeDemo = true): Promise<ProvenanceRecord[]> {
    return provenanceRepository.listProvenance(includeDemo);
  }

  // Sync audit logs
  public async saveAuditLog(entry: AuditLogEntry): Promise<void> {
    await auditRepository.saveAuditLog(entry);
  }

  public async loadAuditLogs(limit = 50): Promise<AuditLogEntry[]> {
    return auditRepository.listAuditLogs(limit);
  }
}

export const postgresStore = new PostgresStoreService();
