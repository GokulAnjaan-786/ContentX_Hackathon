import { query } from '../postgres/postgresClient.ts';
import { User, UserRole } from '../../../types/contentx.ts';

export class SessionRepository {
  public async saveSession(token: string, user: User, expiresAt: number): Promise<void> {
    const text = `
      INSERT INTO sessions (token, user_id, email, expires_at, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (token) DO UPDATE SET
        expires_at = EXCLUDED.expires_at;
    `;
    await query(text, [token, user.id, user.email, expiresAt]);
  }

  public async getSession(token: string): Promise<{ user: User; expiresAt: number } | null> {
    const text = `
      SELECT s.token, s.expires_at, u.id, u.email, u.name, u.organization, u.role
      FROM sessions s
      JOIN users u ON s.user_id = u.id
      WHERE s.token = $1 LIMIT 1;
    `;
    const res = await query(text, [token]);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      user: {
        id: row.id,
        email: row.email,
        name: row.name,
        organization: row.organization,
        role: row.role as UserRole,
      },
      expiresAt: Number(row.expires_at),
    };
  }

  public async deleteSession(token: string): Promise<void> {
    await query('DELETE FROM sessions WHERE token = $1;', [token]);
  }

  public async revokeToken(token: string): Promise<void> {
    await query('DELETE FROM sessions WHERE token = $1;', [token]);
    await query(
      'INSERT INTO revoked_tokens (token, revoked_at) VALUES ($1, NOW()) ON CONFLICT (token) DO NOTHING;',
      [token]
    );
  }

  public async isRevoked(token: string): Promise<boolean> {
    const res = await query('SELECT token FROM revoked_tokens WHERE token = $1 LIMIT 1;', [token]);
    return res.rows.length > 0;
  }
}

export const sessionRepository = new SessionRepository();
