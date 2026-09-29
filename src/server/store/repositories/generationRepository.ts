import { query } from '../postgres/postgresClient.ts';
import { GenerationJob } from '../../../types/contentx.ts';

export class GenerationRepository {
  public async saveJob(job: GenerationJob): Promise<void> {
    const text = `
      INSERT INTO generation_jobs (
        job_id, document_id, document_name, domain, audience, selected_formats,
        execution_mode, status, current_step, completed_formats, failed_formats,
        output_ids, issuer_email, is_demo, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15
      )
      ON CONFLICT (job_id) DO UPDATE SET
        status = EXCLUDED.status,
        current_step = EXCLUDED.current_step,
        completed_formats = EXCLUDED.completed_formats,
        failed_formats = EXCLUDED.failed_formats,
        output_ids = EXCLUDED.output_ids;
    `;

    await query(text, [
      job.job_id,
      job.document_id,
      job.document_name,
      job.domain,
      job.audience,
      JSON.stringify(job.selected_formats || []),
      job.execution_mode || 'sequential',
      job.status,
      job.current_step || '',
      JSON.stringify(job.completed_formats || []),
      JSON.stringify(job.failed_formats || []),
      JSON.stringify(job.output_ids || []),
      job.issuer_email || 'admin@contentx.io',
      job.is_demo || false,
      job.created_at || new Date().toISOString(),
    ]);
  }

  public async getJob(jobId: string): Promise<GenerationJob | null> {
    const res = await query('SELECT * FROM generation_jobs WHERE job_id = $1 LIMIT 1;', [jobId]);
    if (res.rows.length === 0) return null;
    return this.rowToJob(res.rows[0]);
  }

  public async listJobs(includeDemo = true): Promise<GenerationJob[]> {
    let sql = 'SELECT * FROM generation_jobs';
    if (!includeDemo) {
      sql += ' WHERE is_demo = false';
    }
    sql += ' ORDER BY created_at DESC;';
    const res = await query(sql);
    return res.rows.map((row) => this.rowToJob(row));
  }

  private rowToJob(row: any): GenerationJob {
    return {
      job_id: row.job_id,
      document_id: row.document_id,
      document_name: row.document_name,
      domain: row.domain,
      audience: row.audience,
      selected_formats:
        typeof row.selected_formats === 'string'
          ? JSON.parse(row.selected_formats)
          : row.selected_formats || [],
      execution_mode: row.execution_mode,
      status: row.status,
      current_step: row.current_step,
      completed_formats:
        typeof row.completed_formats === 'string'
          ? JSON.parse(row.completed_formats)
          : row.completed_formats || [],
      failed_formats:
        typeof row.failed_formats === 'string'
          ? JSON.parse(row.failed_formats)
          : row.failed_formats || [],
      output_ids:
        typeof row.output_ids === 'string'
          ? JSON.parse(row.output_ids)
          : row.output_ids || [],
      created_at: new Date(row.created_at).toISOString(),
      issuer_email: row.issuer_email,
      is_demo: row.is_demo,
    };
  }
}

export const generationRepository = new GenerationRepository();
