import crypto from "crypto";

// 32-byte key for AES-256
const MASTER_KEY = process.env.ENCRYPTION_SECRET || "12345678901234567890123456789012";

/**
 * Encrypts a binary payload (e.g., a tarball of the built website) using AES-256-GCM.
 * This guarantees the IPFS CID content is completely obfuscated.
 */
export function encryptBuffer(buffer: Buffer): Buffer {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(MASTER_KEY), iv);
  const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  // Package IV + Auth Tag + Encrypted Payload together
  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypts the binary payload fetched from the public IPFS gateway back into the raw tarball.
 */
export function decryptBuffer(encryptedBuffer: Buffer): Buffer {
  const iv = encryptedBuffer.subarray(0, 16);
  const authTag = encryptedBuffer.subarray(16, 32);
  const encrypted = encryptedBuffer.subarray(32);
  
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(MASTER_KEY), iv);
  decipher.setAuthTag(authTag);
  
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}
