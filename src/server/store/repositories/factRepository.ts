import { query } from '../postgres/postgresClient.ts';
import { FactRegistryItem } from '../../../types/contentx.ts';

export class FactRepository {
  public async saveFacts(docId: string, facts: FactRegistryItem[]): Promise<void> {
    if (facts.length === 0) return;

    await query('DELETE FROM facts WHERE document_id = $1;', [docId]);

    for (const f of facts) {
      const text = `
        INSERT INTO facts (
          fact_id, document_id, source_chunk_id, source_page, category,
          importance, certainty, negated, statement, entities, dates,
          numbers, technical_identifiers, domain_specific
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
        );
      `;

      await query(text, [
        f.fact_id,
        docId,
        f.source_chunk_id,
        f.source_page || 1,
        f.category,
        f.importance || 'medium',
        f.certainty || 'confirmed',
        f.negated || false,
        f.statement,
        JSON.stringify(f.entities || []),
        JSON.stringify(f.dates || []),
        JSON.stringify(f.numbers || []),
        JSON.stringify(f.technical_identifiers || []),
        JSON.stringify(f.domain_specific || {}),
      ]);
    }
  }

  public async getFactsByDocumentId(docId: string): Promise<FactRegistryItem[]> {
    const res = await query('SELECT * FROM facts WHERE document_id = $1 ORDER BY source_page ASC;', [docId]);
    return res.rows.map((row) => this.rowToFact(row));
  }

  public async getFactById(factId: string): Promise<FactRegistryItem | null> {
    const res = await query('SELECT * FROM facts WHERE fact_id = $1 LIMIT 1;', [factId]);
    if (res.rows.length === 0) return null;
    return this.rowToFact(res.rows[0]);
  }

  public async getAllFacts(includeDemo = true, documentIdFilter?: string): Promise<FactRegistryItem[]> {
    let sql = `
      SELECT f.*, d.filename as document_name, d.is_demo
      FROM facts f
      JOIN documents d ON f.document_id = d.document_id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (!includeDemo) {
      sql += ' AND d.is_demo = false';
    }

    if (documentIdFilter && documentIdFilter !== 'all') {
      params.push(documentIdFilter);
      sql += ` AND f.document_id = $${params.length}`;
    }

    sql += ' ORDER BY f.created_at DESC;';
    const res = await query(sql, params);
    return res.rows.map((row) => ({
      ...this.rowToFact(row),
      document_name: row.document_name,
      is_demo: row.is_demo,
    }));
  }

  public async deleteFactsByDocumentId(docId: string): Promise<void> {
    await query('DELETE FROM facts WHERE document_id = $1;', [docId]);
  }

  private rowToFact(row: any): FactRegistryItem {
    return {
      fact_id: row.fact_id,
      document_id: row.document_id,
      source_chunk_id: row.source_chunk_id,
      source_page: row.source_page,
      category: row.category,
      importance: row.importance,
      certainty: row.certainty,
      negated: row.negated,
      statement: row.statement,
      entities: typeof row.entities === 'string' ? JSON.parse(row.entities) : row.entities || [],
      dates: typeof row.dates === 'string' ? JSON.parse(row.dates) : row.dates || [],
      numbers: typeof row.numbers === 'string' ? JSON.parse(row.numbers) : row.numbers || [],
      technical_identifiers:
        typeof row.technical_identifiers === 'string'
          ? JSON.parse(row.technical_identifiers)
          : row.technical_identifiers || [],
      domain_specific:
        typeof row.domain_specific === 'string'
          ? JSON.parse(row.domain_specific)
          : row.domain_specific || {},
    };
  }
}

export const factRepository = new FactRepository();
