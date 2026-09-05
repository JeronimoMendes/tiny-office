import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
export const newSecret = () => randomBytes(32).toString('base64url');
export const hashSecret = (value: string) => createHash('sha256').update(value).digest('hex');
export const equalSecret = (a: string, b: string) =>
  timingSafeEqual(Buffer.from(hashSecret(a)), Buffer.from(hashSecret(b)));
