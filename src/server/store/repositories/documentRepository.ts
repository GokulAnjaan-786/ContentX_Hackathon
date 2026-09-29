import { query } from '../postgres/postgresClient.ts';
import { SourceDocument } from '../../../types/contentx.ts';

export class DocumentRepository {
  public async saveDocument(doc: SourceDocument, buffer?: Buffer): Promise<void> {
    const text = `
      INSERT INTO documents (
        document_id, filename, mime_type, file_size, pages, word_count,
        upload_date, sha256_fingerprint, processing_status, detected_domain,
        raw_text, page_texts, security_scan, source_quality, extraction_failure_reason,
        understanding, rag_decision, facts_count, outputs_count, uploaded_by, is_demo
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
      )
      ON CONFLICT (document_id) DO UPDATE SET
        processing_status = EXCLUDED.processing_status,
        detected_domain = EXCLUDED.detected_domain,
        raw_text = EXCLUDED.raw_text,
        page_texts = EXCLUDED.page_texts,
        security_scan = EXCLUDED.security_scan,
        source_quality = EXCLUDED.source_quality,
        extraction_failure_reason = EXCLUDED.extraction_failure_reason,
        understanding = EXCLUDED.understanding,
        rag_decision = EXCLUDED.rag_decision,
        facts_count = EXCLUDED.facts_count,
        outputs_count = EXCLUDED.outputs_count;
    `;

    await query(text, [
      doc.document_id,
      doc.filename,
      doc.mime_type,
      doc.file_size,
      doc.pages,
      doc.word_count,
      doc.upload_date || new Date().toISOString(),
      doc.sha256_fingerprint,
      doc.processing_status,
      doc.detected_domain,
      doc.raw_text || '',
      JSON.stringify(doc.page_texts || []),
      JSON.stringify(doc.security_scan || {}),
      JSON.stringify(doc.source_quality || {}),
      doc.extraction_failure_reason || null,
      doc.understanding ? JSON.stringify(doc.understanding) : null,
      doc.rag_decision ? JSON.stringify(doc.rag_decision) : null,
      doc.facts_count || 0,
      doc.outputs_count || 0,
      doc.uploaded_by,
      doc.is_demo || false,
    ]);

    if (buffer && buffer.length > 0) {
      await query(
        `INSERT INTO document_buffers (document_id, buffer_data)
         VALUES ($1, $2)
         ON CONFLICT (document_id) DO UPDATE SET buffer_data = EXCLUDED.buffer_data;`,
        [doc.document_id, buffer]
      );
    }
  }

  public async getDocument(docId: string): Promise<SourceDocument | null> {
    const res = await query('SELECT * FROM documents WHERE document_id = $1 LIMIT 1;', [docId]);
    if (res.rows.length === 0) return null;
    return this.rowToDocument(res.rows[0]);
  }

  public async getDocumentBuffer(docId: string): Promise<Buffer | null> {
    const res = await query('SELECT buffer_data FROM document_buffers WHERE document_id = $1 LIMIT 1;', [docId]);
    if (res.rows.length === 0 || !res.rows[0].buffer_data) return null;
    return res.rows[0].buffer_data;
  }

  public async listDocuments(includeDemo = true, ownerEmail?: string): Promise<SourceDocument[]> {
    let sql = 'SELECT * FROM documents WHERE 1=1';
    const params: any[] = [];

    if (!includeDemo) {
      sql += ' AND is_demo = false';
    }

    if (ownerEmail) {
      params.push(ownerEmail.toLowerCase().trim());
      sql += ` AND LOWER(uploaded_by) = $${params.length}`;
    }

    sql += ' ORDER BY upload_date DESC;';
    const res = await query(sql, params);
    return res.rows.map((row) => this.rowToDocument(row));
  }

  public async deleteDocument(docId: string): Promise<void> {
    await query('DELETE FROM documents WHERE document_id = $1;', [docId]);
  }

  private rowToDocument(row: any): SourceDocument {
    return {
      document_id: row.document_id,
      filename: row.filename,
      mime_type: row.mime_type,
      file_size: Number(row.file_size),
      pages: row.pages,
      word_count: row.word_count,
      upload_date: new Date(row.upload_date).toISOString(),
      sha256_fingerprint: row.sha256_fingerprint,
      processing_status: row.processing_status,
      detected_domain: row.detected_domain,
      raw_text: row.raw_text,
      page_texts: typeof row.page_texts === 'string' ? JSON.parse(row.page_texts) : row.page_texts || [],
      security_scan: typeof row.security_scan === 'string' ? JSON.parse(row.security_scan) : row.security_scan || {},
      source_quality: typeof row.source_quality === 'string' ? JSON.parse(row.source_quality) : row.source_quality || {},
      extraction_failure_reason: row.extraction_failure_reason || undefined,
      understanding: typeof row.understanding === 'string' ? JSON.parse(row.understanding) : row.understanding || undefined,
      rag_decision: typeof row.rag_decision === 'string' ? JSON.parse(row.rag_decision) : row.rag_decision || undefined,
      facts_count: row.facts_count,
      outputs_count: row.outputs_count,
      uploaded_by: row.uploaded_by,
      is_demo: row.is_demo,
    };
  }
}

export const documentRepository = new DocumentRepository();
