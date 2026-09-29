import { query } from '../postgres/postgresClient.ts';
import { AuditLogEntry } from '../databaseStore.ts';
import { UserRole } from '../../../types/contentx.ts';

export class AuditRepository {
  public async saveAuditLog(entry: AuditLogEntry): Promise<void> {
    const text = `
      INSERT INTO audit_logs (log_id, timestamp, user_email, user_role, action, resource_id, details)
      VALUES ($1, $2, $3, $4, $5, $6, $7);
    `;

    await query(text, [
      entry.log_id,
      entry.timestamp || new Date().toISOString(),
      entry.user_email,
      entry.user_role,
      entry.action,
      entry.resource_id,
      entry.details,
    ]);
  }

  public async listAuditLogs(limit = 50): Promise<AuditLogEntry[]> {
    const res = await query(
      'SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT $1;',
      [limit]
    );
    return res.rows.map((row) => ({
      log_id: row.log_id,
      timestamp: new Date(row.timestamp).toISOString(),
      user_email: row.user_email,
      user_role: row.user_role as UserRole,
      action: row.action,
      resource_id: row.resource_id,
      details: row.details,
    }));
  }
}

export const auditRepository = new AuditRepository();
