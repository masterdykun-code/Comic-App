import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parse } from 'dotenv';
import type { Client, PoolClient } from 'pg';

export const TEST_DATABASE = 'webnovel_test_db';
export const APP_TABLES = ['users', 'stories', 'genres', 'story_genres', 'chapters', 'chapter_pages', 'favorites', 'reading_progress', 'reading_history', 'ratings', 'comments', 'auth_sessions', 'refresh_tokens', 'bookmarks', 'password_resets', 'coin_wallets', 'coin_transactions', 'chapter_unlocks', 'coin_daily_activities'] as const;
export function validateIntegrationUrl(raw: string): void {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Invalid integration configuration; details suppressed.'); }
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || decodeURIComponent(url.pathname) !== `/${TEST_DATABASE}` ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.username ||
      /YOUR_URL_ENCODED_PASSWORD|<PASSWORD>/i.test(raw)) throw new Error('Integration URL must explicitly target local webnovel_test_db.');
  const parameters = [...url.searchParams.entries()];
  if (parameters.length > 1 || parameters.some(([key, value]) => key !== 'schema' || value !== 'public')) throw new Error('Only schema=public is allowed in the integration URL query.');
}
export function configureIntegration(): string {
  const file = resolve('.env.integration');
  let values: ReturnType<typeof parse>;
  try { values = parse(readFileSync(file)); } catch { throw new Error('Create backend/.env.integration with INTEGRATION_DATABASE_URL.'); }
  if (Object.keys(values).some((key) => key !== 'INTEGRATION_DATABASE_URL')) throw new Error('Only INTEGRATION_DATABASE_URL is allowed in .env.integration.');
  const raw = values.INTEGRATION_DATABASE_URL;
  validateIntegrationUrl(raw);
  // There is no fallback to .env or an inherited production DATABASE_URL.
  process.env.DATABASE_URL = raw;
  process.env.DOTENV_CONFIG_PATH = file;
  process.env.DOTENV_CONFIG_QUIET = 'true';
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = randomBytes(48).toString('hex');
  delete process.env.CLOUDINARY_URL;
  process.env.CLOUDINARY_CLOUD_NAME = '';
  process.env.CLOUDINARY_API_KEY = '';
  process.env.CLOUDINARY_API_SECRET = '';
  return raw;
}
export async function assertTestDatabase(client: Pick<Client | PoolClient, 'query'>): Promise<void> {
  const identity = await client.query('SELECT current_database() AS name, current_schema() AS schema');
  if (identity.rows[0]?.name !== TEST_DATABASE || identity.rows[0]?.schema !== 'public') throw new Error('Refusing operation: actual database/schema is not webnovel_test_db/public.');
}
