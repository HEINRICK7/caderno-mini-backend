import type { User } from '../../domain/identity/identity.js';

export type NewMagicLink = {
  email: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
};

export type ConsumeMagicLink = {
  tokenHash: string;
  userId: string;
  sessionId: string;
  sessionTokenHash: string;
  now: Date;
  expiresAt: Date;
};

export type AdminTestUser = {
  email: string;
  userId: string;
  now: Date;
};

export interface IdentityRepository {
  createMagicLink(magicLink: NewMagicLink): void;
  deleteMagicLink(tokenHash: string): void;
  consumeMagicLinkAndCreateSession(input: ConsumeMagicLink): { user: User; expiresAt: Date } | undefined;
  findOrCreateAdminTestUser(input: AdminTestUser): User | undefined;
  findSessionByTokenHash(tokenHash: string, now: Date): User | undefined;
  revokeSessionByTokenHash(tokenHash: string, now: Date): void;
}
