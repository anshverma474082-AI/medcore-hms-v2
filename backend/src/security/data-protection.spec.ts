import { decryptClinicalBytes, decryptClinicalText, encryptClinicalBytes, encryptClinicalText, signClinicalArtifact, verifyClinicalArtifact } from './data-protection';

describe('clinical text encryption', () => {
  beforeAll(() => { process.env.CLINICAL_ENCRYPTION_KEY = Buffer.from('test-only-key-32-bytes-long!!!!!').subarray(0, 32).toString('base64'); });
  it('round trips clinical text without storing plaintext', () => {
    const plain = 'Routine follow-up notes';
    const encrypted = encryptClinicalText(plain);
    expect(encrypted).not.toContain(plain);
    expect(decryptClinicalText(encrypted)).toBe(plain);
  });
  it('uses a fresh nonce for each encryption', () => {
    expect(encryptClinicalText('same text')).not.toBe(encryptClinicalText('same text'));
  });
  it('handles empty fields and rejects damaged ciphertext', () => {
    expect(encryptClinicalText('')).toBe('');
    expect(decryptClinicalText('')).toBe('');
    expect(() => decryptClinicalText('v1.bad.data.value')).toThrow();
  });
  it('encrypts file bytes and rejects tampering', () => {
    const source = Buffer.from('%PDF-1.7 fictional clinical attachment');
    const encrypted = encryptClinicalBytes(source);
    expect(encrypted).not.toEqual(source);
    expect(decryptClinicalBytes(encrypted)).toEqual(source);
    encrypted[encrypted.length - 1] ^= 1;
    expect(() => decryptClinicalBytes(encrypted)).toThrow();
  });
  it('creates an authenticated, tamper-evident clinical sign-off', () => {
    const artifact = { doctorId: 12, appointmentId: 44, diagnosis: 'Test entry' };
    const digest = signClinicalArtifact(artifact);
    expect(verifyClinicalArtifact(artifact, digest)).toBe(true);
    expect(verifyClinicalArtifact({ ...artifact, diagnosis: 'Changed' }, digest)).toBe(false);
    expect(verifyClinicalArtifact(artifact, 'not-a-digest')).toBe(false);
  });
  it('derives a stable encryption key from a generated Render secret', () => {
    const original = process.env.CLINICAL_ENCRYPTION_KEY;
    process.env.CLINICAL_ENCRYPTION_KEY = 'render-generated-random-secret-value-that-is-long-enough';
    const cipherText = encryptClinicalText('durable across restarts');
    expect(decryptClinicalText(cipherText)).toBe('durable across restarts');
    process.env.CLINICAL_ENCRYPTION_KEY = original;
  });
});
