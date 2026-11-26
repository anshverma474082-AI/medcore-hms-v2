import { MAX_CLINICAL_ATTACHMENT_BYTES, validateClinicalUpload } from './attachment-rules';

describe('clinical attachment validation', () => {
  it('accepts small files only when the bytes match the allowed MIME type', () => {
    const pdf = Buffer.from('%PDF-1.7 sample');
    expect(validateClinicalUpload({ originalname: '../../visit.pdf', mimetype: 'application/pdf', size: pdf.length, buffer: pdf })).toEqual({ originalName: '.._.._visit.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length });
  });
  it('rejects an empty file and mismatched or unsupported content', () => {
    expect(() => validateClinicalUpload({ originalname: 'empty.pdf', mimetype: 'application/pdf', size: 0, buffer: Buffer.alloc(0) })).toThrow('non-empty');
    const html = Buffer.from('<script>alert(1)</script>');
    expect(() => validateClinicalUpload({ originalname: 'report.pdf', mimetype: 'application/pdf', size: html.length, buffer: html })).toThrow('Only valid');
    expect(() => validateClinicalUpload({ originalname: 'report.txt', mimetype: 'text/plain', size: html.length, buffer: html })).toThrow('Only valid');
  });
  it('enforces the 5 MB upload limit', () => {
    const large = Buffer.alloc(MAX_CLINICAL_ATTACHMENT_BYTES + 1);
    large.write('%PDF-');
    expect(() => validateClinicalUpload({ originalname: 'large.pdf', mimetype: 'application/pdf', size: large.length, buffer: large })).toThrow('5 MB');
  });
});
