import { query } from '../postgres/postgresClient.ts';
import { StoredUser } from '../databaseStore.ts';
import { UserRole } from '../../../types/contentx.ts';

export class UserRepository {
  public async saveUser(user: StoredUser): Promise<void> {
    const text = `
      INSERT INTO users (id, email, password_hash, password_salt, name, organization, role, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (email) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        password_salt = EXCLUDED.password_salt,
        name = EXCLUDED.name,
        organization = EXCLUDED.organization,
        role = EXCLUDED.role,
        updated_at = NOW();
    `;
    await query(text, [
      user.id,
      user.email.toLowerCase().trim(),
      user.password_hash,
      user.password_salt,
      user.name,
      user.organization,
      user.role,
      user.created_at || new Date().toISOString(),
    ]);
  }

  public async findByEmail(email: string): Promise<StoredUser | null> {
    const normEmail = email.toLowerCase().trim();
    const res = await query('SELECT * FROM users WHERE LOWER(email) = $1 LIMIT 1;', [normEmail]);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      organization: row.organization,
      role: row.role as UserRole,
      created_at: new Date(row.created_at).toISOString(),
      password_hash: row.password_hash,
      password_salt: row.password_salt,
    };
  }

  public async findById(id: string): Promise<StoredUser | null> {
    const res = await query('SELECT * FROM users WHERE id = $1 LIMIT 1;', [id]);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      organization: row.organization,
      role: row.role as UserRole,
      created_at: new Date(row.created_at).toISOString(),
      password_hash: row.password_hash,
      password_salt: row.password_salt,
    };
  }

  public async listUsers(): Promise<StoredUser[]> {
    const res = await query('SELECT * FROM users ORDER BY created_at ASC;');
    return res.rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      organization: row.organization,
      role: row.role as UserRole,
      created_at: new Date(row.created_at).toISOString(),
      password_hash: row.password_hash,
      password_salt: row.password_salt,
    }));
  }
}

export const userRepository = new UserRepository();
