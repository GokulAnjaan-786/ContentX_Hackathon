import { query } from '../postgres/postgresClient.ts';
import { ProvenanceRecord } from '../../../types/contentx.ts';

export class ProvenanceRepository {
  public async saveProvenance(record: ProvenanceRecord): Promise<void> {
    const text = `
      INSERT INTO provenance_records (
        provenance_id, verification_id, document_id, document_name, output_id, format,
        sha256_output_hash, sha256_source_hash, fact_ids_used, validation_score,
        model_name, approval_status, is_demo, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
      )
      ON CONFLICT (provenance_id) DO UPDATE SET
        approval_status = EXCLUDED.approval_status;
    `;

    await query(text, [
      record.provenance_id,
      record.verification_id,
      record.document_id,
      record.document_name,
      record.output_id,
      record.format,
      record.sha256_output_hash,
      record.sha256_source_hash,
      JSON.stringify(record.fact_ids_used || []),
      record.validation_score || 100.0,
      record.model_name || 'Qwen2.5:7B',
      record.approval_status || 'APPROVED',
      record.is_demo || false,
      record.created_at || new Date().toISOString(),
    ]);
  }

  public async getProvenanceByVerificationId(
    verificationId: string
  ): Promise<ProvenanceRecord | null> {
    const res = await query(
      'SELECT * FROM provenance_records WHERE verification_id = $1 LIMIT 1;',
      [verificationId]
    );
    if (res.rows.length === 0) return null;
    return this.rowToProvenance(res.rows[0]);
  }

  public async listProvenance(includeDemo = true): Promise<ProvenanceRecord[]> {
    let sql = 'SELECT * FROM provenance_records';
    if (!includeDemo) {
      sql += ' WHERE is_demo = false';
    }
    sql += ' ORDER BY created_at DESC;';
    const res = await query(sql);
    return res.rows.map((row) => this.rowToProvenance(row));
  }

  private rowToProvenance(row: any): ProvenanceRecord {
    return {
      provenance_id: row.provenance_id,
      verification_id: row.verification_id,
      document_id: row.document_id,
      document_name: row.document_name,
      output_id: row.output_id,
      format: row.format,
      sha256_output_hash: row.sha256_output_hash,
      sha256_source_hash: row.sha256_source_hash,
      fact_ids_used:
        typeof row.fact_ids_used === 'string'
          ? JSON.parse(row.fact_ids_used)
          : row.fact_ids_used || [],
      validation_score: Number(row.validation_score),
      model_name: row.model_name,
      approval_status: row.approval_status,
      created_at: new Date(row.created_at).toISOString(),
      is_demo: row.is_demo,
    };
  }
}

export const provenanceRepository = new ProvenanceRepository();
