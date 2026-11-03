import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const SCRYPT_COST = 32_768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

function derivePasswordKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, key) => {
        if (error) reject(error);
        else resolve(Buffer.from(key));
      },
    );
  });
}

export async function hashAdminPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = await derivePasswordKey(password, salt);
  return [
    'scrypt',
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString('base64url'),
    derivedKey.toString('hex'),
  ].join('.');
}

export async function verifyAdminPassword(password: string, encodedHash: string): Promise<boolean> {
  const match = /^scrypt\.(\d+)\.(\d+)\.(\d+)\.([A-Za-z0-9_-]{22})\.([a-f0-9]{128})$/.exec(encodedHash);
  if (
    !match ||
    Number(match[1]) !== SCRYPT_COST ||
    Number(match[2]) !== SCRYPT_BLOCK_SIZE ||
    Number(match[3]) !== SCRYPT_PARALLELIZATION
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(match[4]!, 'base64url');
    const expected = Buffer.from(match[5]!, 'hex');
    if (salt.length !== 16 || expected.length !== SCRYPT_KEY_LENGTH) return false;
    const actual = await derivePasswordKey(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createAdminSessionToken(input: {
  email: string;
  secret: string;
  now?: Date;
}): string {
  const payload = Buffer.from(JSON.stringify({
    email: input.email,
    expiresAt: Math.floor((input.now ?? new Date()).getTime() / 1000) + ADMIN_SESSION_TTL_SECONDS,
    nonce: randomBytes(32).toString('base64url'),
  })).toString('base64url');
  const signature = createHmac('sha256', input.secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function getAdminSessionEmail(input: {
  token: string | undefined;
  email: string | undefined;
  secret: string | undefined;
  now?: Date;
}): string | undefined {
  if (!input.token || !input.email || !input.secret || input.token.length > 2_048) return undefined;
  const [payload, signature, extra] = input.token.split('.');
  if (!payload || !signature || extra !== undefined) return undefined;

  try {
    const expectedSignature = createHmac('sha256', input.secret).update(payload).digest();
    const receivedSignature = Buffer.from(signature, 'base64url');
    if (
      receivedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(receivedSignature, expectedSignature)
    ) return undefined;

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      email?: unknown;
      expiresAt?: unknown;
      nonce?: unknown;
    };
    const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
    if (
      decoded.email !== input.email ||
      typeof decoded.expiresAt !== 'number' ||
      !Number.isSafeInteger(decoded.expiresAt) ||
      decoded.expiresAt <= now ||
      typeof decoded.nonce !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(decoded.nonce)
    ) return undefined;

    return input.email;
  } catch {
    return undefined;
  }
}
