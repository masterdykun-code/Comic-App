import 'dotenv/config';

export const ACCESS_TOKEN_SECONDS = 15 * 60;
export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export const JWT_ISSUER = 'webnovel-api';
export const JWT_AUDIENCE = 'webnovel-client';

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32 || /^(replace|change|your_)/i.test(secret)) {
    throw new Error('Configure a random JWT_SECRET of at least 32 bytes in backend/.env');
  }
  return secret;
}
