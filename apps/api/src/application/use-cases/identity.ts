import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { InvalidMagicLinkError, MagicLinkDeliveryError } from '../errors.js';
import type { EmailSender } from '../ports/email-sender.js';
import type { IdentityRepository } from '../ports/identity-repository.js';
import { normalizeEmail, type User } from '../../domain/identity/identity.js';

const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type IdentityDependencies = {
  identities: IdentityRepository;
  emailSender: EmailSender;
  generateToken?: () => string;
  generateUserId?: () => string;
  generateSessionId?: () => string;
  clock?: () => Date;
  publicAppUrl: string;
};

export async function requestMagicLink(
  input: { email: string },
  dependencies: IdentityDependencies,
): Promise<void> {
  const now = dependencies.clock?.() ?? new Date();
  const email = normalizeEmail(input.email);
  const token = (dependencies.generateToken ?? generateOpaqueToken)();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(now.getTime() + MAGIC_LINK_TTL_MS);
  const verifyUrl = new URL('/auth/verify', dependencies.publicAppUrl);
  verifyUrl.searchParams.set('token', token);

  dependencies.identities.createMagicLink({ email, tokenHash, createdAt: now, expiresAt });

  try {
    await dependencies.emailSender.sendMagicLink({
      to: email,
      link: verifyUrl.toString(),
      expiresAt,
    });
  } catch {
    dependencies.identities.deleteMagicLink(tokenHash);
    throw new MagicLinkDeliveryError();
  }
}

export async function verifyMagicLink(
  input: { token: string },
  dependencies: IdentityDependencies,
): Promise<{ token: string; user: User; expiresAt: Date }> {
  const now = dependencies.clock?.() ?? new Date();
  const token = (dependencies.generateToken ?? generateOpaqueToken)();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const result = dependencies.identities.consumeMagicLinkAndCreateSession({
    tokenHash: hashToken(input.token),
    userId: (dependencies.generateUserId ?? randomUUID)(),
    sessionId: (dependencies.generateSessionId ?? randomUUID)(),
    sessionTokenHash: hashToken(token),
    now,
    expiresAt,
  });

  if (!result) {
    throw new InvalidMagicLinkError();
  }

  return { token, user: result.user, expiresAt: result.expiresAt };
}

export function getSession(
  input: { token: string },
  dependencies: IdentityDependencies,
): User | undefined {
  const now = dependencies.clock?.() ?? new Date();
  return dependencies.identities.findSessionByTokenHash(hashToken(input.token), now);
}

export function getOrCreateAdminTestUser(
  input: { email: string },
  dependencies: IdentityDependencies,
): User | undefined {
  return dependencies.identities.findOrCreateAdminTestUser({
    email: normalizeEmail(input.email),
    userId: (dependencies.generateUserId ?? randomUUID)(),
    now: dependencies.clock?.() ?? new Date(),
  });
}

export function revokeSession(
  input: { token: string },
  dependencies: IdentityDependencies,
): void {
  const now = dependencies.clock?.() ?? new Date();
  dependencies.identities.revokeSessionByTokenHash(hashToken(input.token), now);
}

function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
