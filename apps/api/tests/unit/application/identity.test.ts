import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  InvalidMagicLinkError,
  MagicLinkDeliveryError,
} from '../../../src/application/errors.js';
import {
  getSession,
  requestMagicLink,
  revokeSession,
  verifyMagicLink,
} from '../../../src/application/use-cases/identity.js';

const now = new Date('2026-10-31T12:00:00.000Z');
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

function dependencies() {
  return {
    identities: {
      createMagicLink: vi.fn(),
      deleteMagicLink: vi.fn(),
      consumeMagicLinkAndCreateSession: vi.fn(),
      findSessionByTokenHash: vi.fn(),
      revokeSessionByTokenHash: vi.fn(),
    },
    emailSender: { sendMagicLink: vi.fn() },
    generateToken: vi.fn(() => 'a'.repeat(43)),
    generateUserId: vi.fn(() => 'user-id'),
    generateSessionId: vi.fn(() => 'session-id'),
    clock: () => now,
    publicAppUrl: 'https://app.example.com',
  };
}

describe('passwordless identity use cases', () => {
  it('stores only the hash and sends a normalized, expiring one-time link', async () => {
    const deps = dependencies();

    await requestMagicLink({ email: '  Client@Example.COM ' }, deps);

    expect(deps.identities.createMagicLink).toHaveBeenCalledWith({
      email: 'client@example.com',
      tokenHash: hash('a'.repeat(43)),
      createdAt: now,
      expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
    });
    expect(deps.emailSender.sendMagicLink).toHaveBeenCalledWith({
      to: 'client@example.com',
      link: `https://app.example.com/auth/verify?token=${'a'.repeat(43)}`,
      expiresAt: new Date(now.getTime() + 15 * 60 * 1000),
    });
  });

  it('removes the unconsumed token and hides mail delivery failure behind a safe error', async () => {
    const deps = dependencies();
    deps.emailSender.sendMagicLink.mockRejectedValue(new Error('SMTP password must not escape'));

    await expect(requestMagicLink({ email: 'client@example.com' }, deps)).rejects.toBeInstanceOf(
      MagicLinkDeliveryError,
    );
    expect(deps.identities.deleteMagicLink).toHaveBeenCalledWith(hash('a'.repeat(43)));
  });

  it('consumes a valid magic link and returns a new opaque session token', async () => {
    const deps = dependencies();
    const user = {
      id: 'user-id',
      email: 'client@example.com',
      createdAt: now,
    };
    const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    deps.identities.consumeMagicLinkAndCreateSession.mockReturnValue({ user, expiresAt });

    const session = await verifyMagicLink({ token: 'one-time-token' }, deps);

    expect(deps.identities.consumeMagicLinkAndCreateSession).toHaveBeenCalledWith({
      tokenHash: hash('one-time-token'),
      userId: 'user-id',
      sessionId: 'session-id',
      sessionTokenHash: hash('a'.repeat(43)),
      now,
      expiresAt,
    });
    expect(session).toEqual({ token: 'a'.repeat(43), user, expiresAt });
  });

  it('rejects invalid, expired, or already consumed links', async () => {
    const deps = dependencies();
    deps.identities.consumeMagicLinkAndCreateSession.mockReturnValue(undefined);

    await expect(verifyMagicLink({ token: 'invalid-token' }, deps)).rejects.toBeInstanceOf(
      InvalidMagicLinkError,
    );
  });

  it('returns the current user for an active session and revokes by token hash', async () => {
    const deps = dependencies();
    const user = { id: 'user-id', email: 'client@example.com', createdAt: now };
    deps.identities.findSessionByTokenHash.mockReturnValue(user);

    expect(getSession({ token: 'session-token' }, deps)).toEqual(user);
    await revokeSession({ token: 'session-token' }, deps);

    expect(deps.identities.findSessionByTokenHash).toHaveBeenCalledWith(hash('session-token'), now);
    expect(deps.identities.revokeSessionByTokenHash).toHaveBeenCalledWith(
      hash('session-token'),
      now,
    );
  });
});
