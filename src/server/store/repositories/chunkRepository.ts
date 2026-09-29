import { query } from '../postgres/postgresClient.ts';
import { DocumentChunk } from '../../../types/contentx.ts';
import { toSql as vectorToSql } from 'pgvector/pg';

export class ChunkRepository {
  public async saveChunks(
    docId: string,
    chunks: DocumentChunk[],
    vectors?: Map<string, number[]>
  ): Promise<void> {
    if (chunks.length === 0) return;

    // Delete previous chunks if any
    await query('DELETE FROM document_chunks WHERE document_id = $1;', [docId]);

    for (const c of chunks) {
      const vec = vectors?.get(c.chunk_id) || c.vector;
      let vecSql: any = null;
      if (vec && Array.isArray(vec) && vec.length === 1024) {
        vecSql = vectorToSql(vec);
      }

      const text = `
        INSERT INTO document_chunks (
          chunk_id, document_id, chunk_index, page_number,
          start_word_index, end_word_index, word_count, source_text,
          embedding_model, embedding_dim, embedding
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
        );
      `;

      await query(text, [
        c.chunk_id,
        docId,
        c.chunk_index,
        c.page_number,
        c.start_word_index,
        c.end_word_index,
        c.word_count,
        c.source_text,
        c.embedding_model || 'bge-m3:latest',
        c.embedding_dim || 1024,
        vecSql,
      ]);
    }
  }

  public async getChunksByDocumentId(docId: string): Promise<DocumentChunk[]> {
    const res = await query(
      'SELECT * FROM document_chunks WHERE document_id = $1 ORDER BY chunk_index ASC;',
      [docId]
    );
    return res.rows.map((row) => this.rowToChunk(row));
  }

  public async findSimilarChunksPgVector(
    docId: string,
    queryVector: number[],
    topK = 5
  ): Promise<Array<DocumentChunk & { distance: number }>> {
    if (!queryVector || queryVector.length !== 1024) {
      throw new Error(
        `Invalid vector dimension: expected 1024, got ${queryVector?.length || 0}`
      );
    }

    const vecSql = vectorToSql(queryVector);

    // PARAMETERIZED & STRICTLY DOCUMENT ISOLATED (Objective 9 & 13)
    const sql = `
      SELECT chunk_id, document_id, chunk_index, page_number,
             start_word_index, end_word_index, word_count, source_text,
             embedding_model, embedding_dim,
             (embedding <=> $1) AS distance
      FROM document_chunks
      WHERE document_id = $2 AND embedding IS NOT NULL
      ORDER BY embedding <=> $1 ASC
      LIMIT $3;
    `;

    const res = await query(sql, [vecSql, docId, topK]);
    return res.rows.map((row) => ({
      ...this.rowToChunk(row),
      distance: Number(row.distance),
    }));
  }

  public async deleteChunksByDocumentId(docId: string): Promise<void> {
    await query('DELETE FROM document_chunks WHERE document_id = $1;', [docId]);
  }

  private rowToChunk(row: any): DocumentChunk {
    let vec: number[] | undefined;
    if (row.embedding) {
      if (Array.isArray(row.embedding)) vec = row.embedding;
      else if (typeof row.embedding === 'string') {
        try {
          vec = JSON.parse(row.embedding);
        } catch {
          // ignore
        }
      }
    }

    return {
      chunk_id: row.chunk_id,
      document_id: row.document_id,
      chunk_index: row.chunk_index,
      page_number: row.page_number,
      start_word_index: row.start_word_index,
      end_word_index: row.end_word_index,
      word_count: row.word_count,
      source_text: row.source_text,
      embedding_model: row.embedding_model,
      embedding_dim: row.embedding_dim,
      vector: vec,
    };
  }
}

export const chunkRepository = new ChunkRepository();
