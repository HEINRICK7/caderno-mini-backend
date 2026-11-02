import { afterEach, describe, expect, it } from 'vitest';

import { createTestApp } from '../helpers/test-app.js';

describe('passwordless identity API', () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  it('rejects cross-origin login and session changes', async () => {
    const { app, database, sentMagicLinks } = await createTestApp();
    close = async () => {
      await app.close();
      database.close();
    };

    const rejectedLogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link',
      headers: { origin: 'https://attacker.example' },
      payload: { email: 'customer@example.com' },
    });
    expect(rejectedLogin.statusCode).toBe(403);
    expect(sentMagicLinks).toHaveLength(0);

    const requestLink = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link',
      headers: { origin: 'http://localhost:3000' },
      payload: { email: 'customer@example.com' },
    });
    expect(requestLink.statusCode).toBe(202);
    const token = new URL(sentMagicLinks[0]!.link).searchParams.get('token');
    const verify = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      headers: { origin: 'http://localhost:3000' },
      payload: { token },
    });
    expect(verify.statusCode).toBe(200);
    const cookie = String(verify.headers['set-cookie']).split(';')[0];

    const rejectedCheckout = await app.inject({
      method: 'POST',
      url: '/api/v1/checkout',
      headers: { cookie, origin: 'https://attacker.example' },
      payload: { draftId: '00000000-0000-4000-8000-000000000000' },
    });
    expect(rejectedCheckout.statusCode).toBe(403);

    const rejectedLogout = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/session',
      headers: { cookie, origin: 'https://attacker.example' },
    });
    expect(rejectedLogout.statusCode).toBe(403);

    const logout = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/session',
      headers: { cookie, origin: 'http://localhost:3000' },
    });
    expect(logout.statusCode).toBe(204);
  });

  it('sends a generic login response, creates a session from one-use link, and supports logout', async () => {
    const { app, database, sentMagicLinks } = await createTestApp();
    close = async () => {
      await app.close();
      database.close();
    };

    const requestLink = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link',
      payload: { email: ' Customer@Example.com ' },
    });

    expect(requestLink.statusCode).toBe(202);
    expect(requestLink.json()).toEqual({
      data: { message: 'Se o endereço puder receber um link, enviaremos as instruções.' },
    });
    expect(sentMagicLinks).toHaveLength(1);
    expect(sentMagicLinks[0]?.to).toBe('customer@example.com');

    const token = new URL(sentMagicLinks[0]!.link).searchParams.get('token');
    expect(token).toBeTruthy();

    const verify = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      payload: { token },
    });

    expect(verify.statusCode).toBe(200);
    expect(verify.json().data.user.email).toBe('customer@example.com');
    const setCookie = verify.headers['set-cookie'];
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
    const cookie = String(setCookie).split(';')[0];

    const session = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().data.user.email).toBe('customer@example.com');

    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/verify',
      payload: { token },
    });
    expect(replay.statusCode).toBe(400);

    const logout = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/session',
      headers: { cookie },
    });
    expect(logout.statusCode).toBe(204);

    const revoked = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie },
    });
    expect(revoked.statusCode).toBe(401);
  });

  it('uses the same response for registered and unregistered addresses', async () => {
    const { app, database, sentMagicLinks } = await createTestApp();
    close = async () => {
      await app.close();
      database.close();
    };

    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link',
      payload: { email: 'registered@example.com' },
    });
    const token = new URL(sentMagicLinks[0]!.link).searchParams.get('token');
    await app.inject({ method: 'POST', url: '/api/v1/auth/verify', payload: { token } });

    const existing = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link',
      payload: { email: 'registered@example.com' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/magic-link',
      payload: { email: 'new@example.com' },
    });

    expect(first.statusCode).toBe(202);
    expect(existing.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(202);
    expect(existing.body).toBe(unknown.body);
  });

  it('rate limits repeated requests for the same e-mail address', async () => {
    const { app, database } = await createTestApp();
    close = async () => {
      await app.close();
      database.close();
    };

    const responses = [];
    for (let index = 0; index < 4; index += 1) {
      responses.push(await app.inject({
          method: 'POST',
          url: '/api/v1/auth/magic-link',
          payload: { email: 'limited@example.com' },
        }));
    }

    expect(responses.slice(0, 3).every((response) => response.statusCode === 202)).toBe(true);
    expect(responses[3]?.statusCode).toBe(429);
    expect(responses[3]?.json()).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente mais tarde.' },
    });
  });
});
