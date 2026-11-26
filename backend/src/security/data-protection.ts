import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

function encryptionKey(): Buffer {
  const encoded = process.env.CLINICAL_ENCRYPTION_KEY || '';
  const key = Buffer.from(encoded, 'base64');
  if (key.length === 32 && key.toString('base64') === encoded) return key;
  if (Buffer.byteLength(encoded, 'utf8') < 32) throw new Error('CLINICAL_ENCRYPTION_KEY must be a base64 encoded 32-byte key or a secret with at least 32 characters');
  return createHash('sha256').update(encoded, 'utf8').digest();
}

export function encryptClinicalText(value: string): string {
  if (!value) return '';
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ciphertext.toString('base64')].join('.');
}

export function decryptClinicalText(value: string): string {
  if (!value) return '';
  const [version, iv, tag, ciphertext] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Encrypted clinical field has an unsupported format');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8');
}

export function encryptClinicalBytes(value: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return Buffer.concat([Buffer.from('MCA1'), iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptClinicalBytes(value: Buffer): Buffer {
  if (value.length < 32 || value.subarray(0, 4).toString() !== 'MCA1') throw new Error('Encrypted attachment has an unsupported format');
  const iv = value.subarray(4, 16);
  const tag = value.subarray(16, 32);
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(value.subarray(32)), decipher.final()]);
}

export function signClinicalArtifact(value: unknown): string {
  const signingKey = createHmac('sha256', encryptionKey()).update('medcore:clinical-signature:v1').digest();
  return createHmac('sha256', signingKey).update(JSON.stringify(value)).digest('hex');
}

export function verifyClinicalArtifact(value: unknown, digest: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(digest)) return false;
  const expected = Buffer.from(signClinicalArtifact(value), 'hex');
  const actual = Buffer.from(digest, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
