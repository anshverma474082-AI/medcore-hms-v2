export const MAX_CLINICAL_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export type ClinicalUpload = { originalname: string; mimetype: string; size: number; buffer: Buffer };

export function validateClinicalUpload(file: ClinicalUpload): { originalName: string; mimeType: string; sizeBytes: number } {
  if (!file.buffer?.length || file.size !== file.buffer.length) throw new Error('Choose a non-empty file');
  if (file.size > MAX_CLINICAL_ATTACHMENT_BYTES) throw new Error('Attachments must be 5 MB or smaller');
  const signatures: Record<string, (bytes: Buffer) => boolean> = {
    'application/pdf': (bytes) => bytes.subarray(0, 5).toString() === '%PDF-',
    'image/png': (bytes) => bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'image/jpeg': (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
  };
  const matches = signatures[file.mimetype]?.(file.buffer) || false;
  if (!matches) throw new Error('Only valid PDF, PNG, and JPEG files are accepted');
  const originalName = file.originalname.replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 160) || 'clinical-attachment';
  return { originalName, mimeType: file.mimetype, sizeBytes: file.size };
}
