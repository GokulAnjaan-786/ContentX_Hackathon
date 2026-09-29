import { query } from '../postgres/postgresClient.ts';
import { GeneratedOutputRecord } from '../../../types/contentx.ts';

export class OutputRepository {
  public async saveOutput(output: GeneratedOutputRecord): Promise<void> {
    const text = `
      INSERT INTO generated_outputs (
        output_id, job_id, document_id, format, status, content, claims,
        fact_ids_used, validation, verification_id, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
      )
      ON CONFLICT (output_id) DO UPDATE SET
        status = EXCLUDED.status,
        content = EXCLUDED.content,
        claims = EXCLUDED.claims,
        fact_ids_used = EXCLUDED.fact_ids_used,
        validation = EXCLUDED.validation;
    `;

    await query(text, [
      output.output_id,
      output.job_id,
      output.document_id,
      output.format,
      output.status,
      JSON.stringify(output.content || {}),
      JSON.stringify(output.claims || []),
      JSON.stringify(output.fact_ids_used || []),
      JSON.stringify(output.validation || {}),
      output.verification_id,
      output.created_at || new Date().toISOString(),
    ]);
  }

  public async getOutput(outputId: string): Promise<GeneratedOutputRecord | null> {
    const res = await query('SELECT * FROM generated_outputs WHERE output_id = $1 LIMIT 1;', [
      outputId,
    ]);
    if (res.rows.length === 0) return null;
    return this.rowToOutput(res.rows[0]);
  }

  public async listOutputs(
    includeDemo = true,
    documentIdFilter?: string
  ): Promise<GeneratedOutputRecord[]> {
    let sql = `
      SELECT o.*, d.is_demo
      FROM generated_outputs o
      JOIN documents d ON o.document_id = d.document_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (!includeDemo) {
      sql += ' AND d.is_demo = false';
    }

    if (documentIdFilter && documentIdFilter !== 'all') {
      params.push(documentIdFilter);
      sql += ` AND o.document_id = $${params.length}`;
    }

    sql += ' ORDER BY o.created_at DESC;';
    const res = await query(sql, params);
    return res.rows.map((row) => this.rowToOutput(row));
  }

  public async deleteOutputsByDocumentId(docId: string): Promise<void> {
    await query('DELETE FROM generated_outputs WHERE document_id = $1;', [docId]);
  }

  private rowToOutput(row: any): GeneratedOutputRecord {
    return {
      output_id: row.output_id,
      job_id: row.job_id,
      document_id: row.document_id,
      format: row.format,
      status: row.status,
      content: typeof row.content === 'string' ? JSON.parse(row.content) : row.content || {},
      claims: typeof row.claims === 'string' ? JSON.parse(row.claims) : row.claims || [],
      fact_ids_used:
        typeof row.fact_ids_used === 'string'
          ? JSON.parse(row.fact_ids_used)
          : row.fact_ids_used || [],
      validation:
        typeof row.validation === 'string'
          ? JSON.parse(row.validation)
          : row.validation || {},
      verification_id: row.verification_id,
      created_at: new Date(row.created_at).toISOString(),
    };
  }
}

export const outputRepository = new OutputRepository();
