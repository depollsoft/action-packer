/**
 * Encryption utilities for securing sensitive data (PATs, secrets)
 * Uses AES-256-GCM with a master key from environment
 */

import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * Get the encryption key from environment
 * Falls back to a derived key from a default secret for development
 */
function getEncryptionKey(): Buffer {
  const envKey = process.env.ENCRYPTION_KEY;
  
  if (envKey) {
    // If key is provided, ensure it's the right length
    if (envKey.length === KEY_LENGTH * 2) {
      // Hex-encoded key
      return Buffer.from(envKey, 'hex');
    } else if (envKey.length >= KEY_LENGTH) {
      // Use first 32 bytes if longer
      return Buffer.from(envKey.slice(0, KEY_LENGTH), 'utf8');
    } else {
      // Derive key from shorter input using SHA-256
      return crypto.createHash('sha256').update(envKey).digest();
    }
  }
  
  // Development fallback - NOT secure for production!
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ENCRYPTION_KEY environment variable is required in production');
  }
  
  console.warn('WARNING: Using development encryption key. Set ENCRYPTION_KEY in production!');
  return crypto.createHash('sha256').update('action-packer-dev-key').digest();
}

export type EncryptedData = {
  encrypted: string;  // Base64-encoded ciphertext
  iv: string;         // Base64-encoded initialization vector
  authTag: string;    // Base64-encoded authentication tag
};

/**
 * Encrypt sensitive data using AES-256-GCM
 */
export function encrypt(plaintext: string): EncryptedData {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  const authTag = cipher.getAuthTag();
  
  return {
    encrypted,
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
  };
}

/**
 * Decrypt data that was encrypted with encrypt()
 */
export function decrypt(data: EncryptedData): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(data.iv, 'base64');
  const authTag = Buffer.from(data.authTag, 'base64');
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  let decrypted = decipher.update(data.encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Generate a cryptographically secure random string
 * Useful for webhook secrets, etc.
 */
export function generateSecret(length: number = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Create HMAC-SHA256 signature for webhook verification
 */
export function createHmacSignature(payload: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Verify HMAC-SHA256 signature for webhook verification
 * Uses timing-safe comparison to prevent timing attacks
 */
export function verifyHmacSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = createHmacSignature(payload, secret);
  
  if (signature.length !== expected.length) {
    return false;
  }
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
