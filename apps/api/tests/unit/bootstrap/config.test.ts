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
      PUBLIC_API_URL: 'https://api.example.com',
      PUBLIC_APP_URL: 'https://app.example.com',
      SMTP_URL: 'smtps://mailer:secret@mail.example.com:465',
      EMAIL_FROM: 'Cadernô <login@example.com>',
      MINIO_ENDPOINT: 'storage.example.com',
      MINIO_PORT: '9443',
      MINIO_USE_SSL: 'true',
      MINIO_REGION: 'eu-west-1',
      MINIO_ACCESS_KEY: 'caderno-api',
      MINIO_SECRET_KEY: 'caderno-api-secret-key-value',
      MINIO_BUCKET: 'caderno-public-assets',
    });

    expect(config).toEqual({
      nodeEnv: 'test',
      host: '127.0.0.1',
      port: 4500,
      logLevel: 'debug',
      databaseFile: './data/test.sqlite',
      imageStorage: {
        endpoint: 'storage.example.com',
        port: 9443,
        useSSL: true,
        region: 'eu-west-1',
        accessKey: 'caderno-api',
        secretKey: 'caderno-api-secret-key-value',
        bucket: 'caderno-public-assets',
      },
      trustedProxyAddresses: ['127.0.0.1', '172.16.0.0/12'],
      authPublicAppUrl: 'https://app.example.com',
      publicApiUrl: 'https://api.example.com',
      publicAppUrl: 'https://app.example.com',
      smtpUrl: 'smtps://mailer:secret@mail.example.com:465',
      emailFrom: 'Cadernô <login@example.com>',
      superAdminEmails: [],
    });
  });

  it('uses safe development defaults', () => {
    expect(loadConfig({})).toEqual({
      nodeEnv: 'development',
      host: '0.0.0.0',
      port: 3000,
      logLevel: 'info',
      databaseFile: './data/caderno-mini.sqlite',
      imageStorage: {
        endpoint: '127.0.0.1',
        port: 9000,
        useSSL: false,
        region: 'us-east-1',
        accessKey: 'caderno-local',
        secretKey: 'local-development-minio-secret',
        bucket: 'caderno-assets',
      },
      trustedProxyAddresses: [],
      authPublicAppUrl: 'http://localhost:3000',
      publicApiUrl: 'http://localhost:3000',
      publicAppUrl: 'http://localhost:3001',
      superAdminEmails: [],
    });
  });

  it('rejects a port outside the valid range', () => {
    expect(() => loadConfig({ PORT: '70000' })).toThrow();
  });

  it('requires HTTPS for authentication links in production', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow('AUTH_PUBLIC_APP_URL must use HTTPS in production.');
  });

  it('requires HTTPS for public share links in production', () => {
    expect(() =>
      loadConfig({
        NODE_ENV: 'production',
        AUTH_PUBLIC_APP_URL: 'https://app.example.com',
        PUBLIC_API_URL: 'http://api.example.com',
        PUBLIC_APP_URL: 'https://app.example.com',
      }),
    ).toThrow('PUBLIC_API_URL must use HTTPS in production.');
  });

  it('requires HTTPS for public app links in production', () => {
    expect(() => loadConfig({
      NODE_ENV: 'production',
      AUTH_PUBLIC_APP_URL: 'https://app.example.com',
      PUBLIC_API_URL: 'https://api.example.com',
      PUBLIC_APP_URL: 'http://app.example.com',
    })).toThrow('PUBLIC_APP_URL must use HTTPS in production.');
  });

  it('requires non-development MinIO credentials in production', () => {
    expect(() => loadConfig({
      NODE_ENV: 'production',
      AUTH_PUBLIC_APP_URL: 'https://app.example.com',
      PUBLIC_API_URL: 'https://api.example.com',
      PUBLIC_APP_URL: 'https://app.example.com',
      MINIO_USE_SSL: 'true',
    })).toThrow('MinIO credentials must be changed from development defaults in production.');
  });

  it('loads both Cakto plans when the six variables are set together', () => {
    const config = loadConfig({
      CAKTO_CHECKOUT_ANNUAL_URL: 'https://pay.cakto.com.br/annual',
      CAKTO_PRODUCT_ANNUAL_ID: '11111111-1111-4111-8111-111111111111',
      CAKTO_WEBHOOK_SECRET_ANNUAL: 'annual-webhook-secret',
      CAKTO_CHECKOUT_LIFETIME_URL: 'https://pay.cakto.com.br/lifetime',
      CAKTO_PRODUCT_LIFETIME_ID: '22222222-2222-4222-8222-222222222222',
      CAKTO_WEBHOOK_SECRET_LIFETIME: 'lifetime-webhook-secret',
    });

    expect(config.caktoPlans).toEqual({
      annual: {
        checkoutUrl: 'https://pay.cakto.com.br/annual',
        productId: '11111111-1111-4111-8111-111111111111',
        webhookSecret: 'annual-webhook-secret',
      },
      lifetime: {
        checkoutUrl: 'https://pay.cakto.com.br/lifetime',
        productId: '22222222-2222-4222-8222-222222222222',
        webhookSecret: 'lifetime-webhook-secret',
      },
    });
  });

  it('rejects a partial pair of Cakto plans', () => {
    expect(() => loadConfig({
      CAKTO_CHECKOUT_ANNUAL_URL: 'https://pay.cakto.com.br/annual',
    })).toThrow(/together/);
  });

  it('requires TLS for MinIO in production', () => {
    expect(() => loadConfig({
      NODE_ENV: 'production',
      AUTH_PUBLIC_APP_URL: 'https://app.example.com',
      PUBLIC_API_URL: 'https://api.example.com',
      PUBLIC_APP_URL: 'https://app.example.com',
      MINIO_ACCESS_KEY: 'caderno-api',
      MINIO_SECRET_KEY: 'caderno-api-secret-key-value',
    })).toThrow('MINIO_USE_SSL must be true in production.');
  });
});
