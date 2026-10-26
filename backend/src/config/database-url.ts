import 'dotenv/config';

export function getDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();

  if (!value || /YOUR_URL_ENCODED_PASSWORD|<PASSWORD>/i.test(value)) {
    throw new Error('Set DATABASE_URL in backend/.env with your URL-encoded password.');
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL URL.');
  }

  if (!['postgresql:', 'postgres:'].includes(url.protocol) || !url.hostname ||
      !url.username || url.pathname.length <= 1) {
    throw new Error('DATABASE_URL must include a PostgreSQL host, username and database.');
  }

  return value;
}
