/**
 * AES-256-GCM encryption for Meta tokens at rest.
 *
 * Unlike the Google refresh token (stored as plain text in lib/google-auth.ts,
 * an existing precedent this phase does not touch), Meta tokens are encrypted
 * before they ever reach the store. META_ENCRYPTION_KEY is a base64-encoded
 * 32-byte key, checked by `isMetaEncryptionConfigured()` in lib/config.ts.
 *
 * Server-only module.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { env, isMetaEncryptionConfigured } from '../config';
import { AppError } from '../errors';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96-bit nonce, the recommended size for GCM

function key(): Buffer {
  if (!isMetaEncryptionConfigured()) {
    throw new AppError(
      'META_ENCRYPTION_NOT_CONFIGURED',
      'META_ENCRYPTION_KEY is not set (or is not a 32-byte base64 key). Generate one and set it before connecting Meta.',
      503,
    );
  }
  return Buffer.from(env().META_ENCRYPTION_KEY, 'base64');
}

/** Encrypts a token to a single opaque string: base64(iv).base64(authTag).base64(ciphertext). */
export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join('.');
}

/** Reverses encryptToken(). Throws if the key changed or the value was tampered with. */
export function decryptToken(encrypted: string): string {
  const parts = encrypted.split('.');
  if (parts.length !== 3) {
    throw new AppError('META_TOKEN_DECRYPT_FAILED', 'Stored Meta token is malformed.', 500);
  }
  const [ivB64, tagB64, dataB64] = parts as [string, string, string];
  try {
    const decipher = createDecipheriv(ALGORITHM, key(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    throw new AppError(
      'META_TOKEN_DECRYPT_FAILED',
      'Could not decrypt the stored Meta token. META_ENCRYPTION_KEY may have changed — reconnect Meta.',
      500,
    );
  }
}
