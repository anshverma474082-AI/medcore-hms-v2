import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

if (existsSync('.env')) {
  console.log('.env already exists; left unchanged.');
  process.exit(0);
}
const example = readFileSync('.env.example', 'utf8');
const output = example
  .replace('replace-with-at-least-32-random-bytes', randomBytes(48).toString('base64url'))
  .replace('base64-encoded-32-byte-key', randomBytes(32).toString('base64'));
writeFileSync('.env', output, { mode: 0o600, flag: 'wx' });
console.log('Created a private .env with fresh local secrets. Review provider and database values before starting services.');
