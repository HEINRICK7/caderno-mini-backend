import { afterEach, describe, expect, it } from 'vitest';

import { hashAdminPassword } from '../../src/application/use-cases/admin-auth.js';
import { createTestApp } from '../helpers/test-app.js';

describe('GET /api/v1/admin/users', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('lists customer summaries after admin authentication without SQLite query errors', async () => {
    const adminEmail = 'owner@example.test';
    const adminPassword = 'integration-test-password';
    const { app, database, sentMagicLinks } = await createTestApp(':memory:', {
      admin: {
        email: adminEmail,
        passwordHash: await hashAdminPassword(adminPassword),
        sessionSecret: 'integration-test-admin-session-secret',
      },
    });
    close = async () => {
      await app.close();
      database.close();
    };

    const unauthorized = await app.inject({ method: 'GET', url: '/api/v1/admin/users' });
    expect(unauthorized.statusCode).toBe(401);

    const magicLinkRequest = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link',
      payload: { email: 'customer@example.test' },
    });
    expect(magicLinkRequest.statusCode).toBe(202);
    const token = new URL(sentMagicLinks[0]!.link).searchParams.get('token');
    const customerSession = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      payload: { token },
    });
    expect(customerSession.statusCode).toBe(200);

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/session',
      payload: { email: adminEmail, password: adminPassword },
    });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers['set-cookie']).split(';')[0];

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?q=customer&limit=25&offset=0',
      headers: { cookie },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      total: 1,
      users: [
        {
          email: 'customer@example.test',
          accountStatus: 'active',
          activeSessions: 1,
          purchaseCount: 0,
          activeLicenses: 0,
          draftCount: 0,
        },
      ],
    });
  });
});
