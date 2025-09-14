import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12

function getKey(): Buffer {
  const key = process.env.TOKEN_ENCRYPTION_KEY || '';
  if (!key) throw new Error('TOKEN_ENCRYPTION_KEY missing');
  if (key.length === 64 && /^[0-9a-fA-F]+$/.test(key)) {
    return Buffer.from(key, 'hex');
  }
  const buf = Buffer.from(key, 'utf8');
  if (buf.length === 32) return buf;
  return crypto.createHash('sha256').update(buf).digest();
}

export function encryptToken(plain: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), enc.toString('base64'), tag.toString('base64')].join('.');
}

export function decryptToken(encValue: string): string {
  const key = getKey();
  const parts = encValue.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted token format');
  const [ivB64, dataB64, tagB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString('utf8');
}
