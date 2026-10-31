import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../../src/bootstrap/config.js';

describe('loadConfig', () => {
  it('loads validated values from the environment', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      HOST: '127.0.0.1',
      PORT: '4500',
      LOG_LEVEL: 'debug',
      DATABASE_FILE: './data/test.sqlite',
      TRUST_PROXY: '127.0.0.1, 172.16.0.0/12',
      AUTH_PUBLIC_APP_URL: 'https://app.example.com',
      SMTP_URL: 'smtps://mailer:secret@mail.example.com:465',
      EMAIL_FROM: 'Cadernô <login@example.com>',
    });

    expect(config).toEqual({
      nodeEnv: 'test',
      host: '127.0.0.1',
      port: 4500,
      logLevel: 'debug',
      databaseFile: './data/test.sqlite',
      trustedProxyAddresses: ['127.0.0.1', '172.16.0.0/12'],
      authPublicAppUrl: 'https://app.example.com',
      smtpUrl: 'smtps://mailer:secret@mail.example.com:465',
      emailFrom: 'Cadernô <login@example.com>',
    });
  });

  it('uses safe development defaults', () => {
    expect(loadConfig({})).toEqual({
      nodeEnv: 'development',
      host: '0.0.0.0',
      port: 3000,
      logLevel: 'info',
      databaseFile: './data/caderno-mini.sqlite',
      trustedProxyAddresses: [],
      authPublicAppUrl: 'http://localhost:3000',
    });
  });

  it('rejects a port outside the valid range', () => {
    expect(() => loadConfig({ PORT: '70000' })).toThrow();
  });

  it('requires HTTPS for authentication links in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow('AUTH_PUBLIC_APP_URL must use HTTPS in production.');
  });
});
