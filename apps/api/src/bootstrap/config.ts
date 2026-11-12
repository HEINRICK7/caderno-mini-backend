import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  DATABASE_FILE: z.string().min(1).default('./data/caderno-mini.sqlite'),
  MINIO_ENDPOINT: z.string().min(1).refine((value) => !value.includes('://'), 'MINIO_ENDPOINT must be a host without a scheme.').default('127.0.0.1'),
  MINIO_PORT: z.coerce.number().int().min(1).max(65_535).default(9000),
  MINIO_USE_SSL: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  MINIO_REGION: z.string().min(1).default('us-east-1'),
  MINIO_ACCESS_KEY: z.string().min(3).default('caderno-local'),
  MINIO_SECRET_KEY: z.string().min(16).default('local-development-minio-secret'),
  MINIO_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/).default('caderno-assets'),
  TRUST_PROXY: z.string().default('').transform((value) =>
    value.split(',').map((address) => address.trim()).filter(Boolean),
  ),
  AUTH_PUBLIC_APP_URL: z
    .url()
    .refine((value) => {
      const parsed = new URL(value);
      return !parsed.username && !parsed.password;
    })
    .default('http://localhost:3000'),
  PUBLIC_API_URL: z
    .url()
    .refine((value) => {
      const parsed = new URL(value);
      return (
        ['http:', 'https:'].includes(parsed.protocol) &&
        !parsed.username &&
        !parsed.password &&
        parsed.pathname === '/' &&
        !parsed.search &&
        !parsed.hash
      );
    }, 'PUBLIC_API_URL must be an HTTP(S) origin without credentials, path, query, or fragment.')
    .default('http://localhost:3000'),
  PUBLIC_APP_URL: z
    .url()
    .refine((value) => {
      const parsed = new URL(value);
      return (
        ['http:', 'https:'].includes(parsed.protocol) &&
        !parsed.username &&
        !parsed.password &&
        parsed.pathname === '/' &&
        !parsed.search &&
        !parsed.hash
      );
    }, 'PUBLIC_APP_URL must be an HTTP(S) origin without credentials, path, query, or fragment.')
    .default('http://localhost:3001'),
  SMTP_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().url().refine((value) => value.startsWith('smtp://') || value.startsWith('smtps://')).optional(),
  ),
  EMAIL_FROM: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(3).optional(),
  ),
  ABACATEPAY_API_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(8).max(1_024).optional(),
  ),
  ABACATEPAY_WEBHOOK_SECRET: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(32).max(1_024).optional(),
  ),
  ABACATEPAY_WEBHOOK_SIGNATURE_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(64).max(1_024).optional(),
  ),
  ABACATEPAY_PRODUCT_ANNUAL_ID: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(4).max(200).optional(),
  ),
  ABACATEPAY_PRODUCT_LIFETIME_ID: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(4).max(200).optional(),
  ),
  CAKTO_CHECKOUT_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().url().optional(),
  ),
  CAKTO_PRODUCT_ID: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.uuid().optional(),
  ),
  CAKTO_WEBHOOK_SECRET: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(16).optional(),
  ),
  CAKTO_CHECKOUT_ANNUAL_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().url().optional(),
  ),
  CAKTO_PRODUCT_ANNUAL_ID: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.uuid().optional(),
  ),
  CAKTO_WEBHOOK_SECRET_ANNUAL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(16).optional(),
  ),
  CAKTO_CHECKOUT_LIFETIME_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().url().optional(),
  ),
  CAKTO_PRODUCT_LIFETIME_ID: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.uuid().optional(),
  ),
  CAKTO_WEBHOOK_SECRET_LIFETIME: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(16).optional(),
  ),
  ANALYTICS_READ_TOKEN: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(32).optional(),
  ),
  ADMIN_EMAIL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().trim().toLowerCase().email().optional(),
  ),
  ADMIN_PASSWORD_HASH: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().regex(/^scrypt\.32768\.8\.1\.[A-Za-z0-9_-]{22}\.[a-f0-9]{128}$/).optional(),
  ),
  ADMIN_SESSION_SECRET: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
  ),
});

export type CaktoPlanConfig = {
  checkoutUrl: string;
  productId: string;
  webhookSecret: string;
};

export type AbacatePayConfig = {
  apiKey: string;
  webhookSecret: string;
  signatureKey: string;
  plans?: {
    annual: { productId: string };
    lifetime: { productId: string };
  };
};

export type AppConfig = {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  databaseFile: string;
  imageStorage: {
    endpoint: string;
    port: number;
    useSSL: boolean;
    region: string;
    accessKey: string;
    secretKey: string;
    bucket: string;
  };
  trustedProxyAddresses: string[];
  authPublicAppUrl: string;
  publicApiUrl: string;
  publicAppUrl: string;
  smtpUrl?: string;
  emailFrom?: string;
  abacatePay?: AbacatePayConfig;
  caktoCheckoutUrl?: string;
  caktoProductId?: string;
  caktoWebhookSecret?: string;
  caktoPlans?: {
    annual: CaktoPlanConfig;
    lifetime: CaktoPlanConfig;
  };
  analyticsReadToken?: string;
  adminEmail?: string;
  adminPasswordHash?: string;
  adminSessionSecret?: string;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = configSchema.parse(environment);

  if (parsed.NODE_ENV === 'production' && new URL(parsed.AUTH_PUBLIC_APP_URL).protocol !== 'https:') {
    throw new Error('AUTH_PUBLIC_APP_URL must use HTTPS in production.');
  }
  if (parsed.NODE_ENV === 'production' && new URL(parsed.PUBLIC_API_URL).protocol !== 'https:') {
    throw new Error('PUBLIC_API_URL must use HTTPS in production.');
  }
  if (parsed.NODE_ENV === 'production' && new URL(parsed.PUBLIC_APP_URL).protocol !== 'https:') {
    throw new Error('PUBLIC_APP_URL must use HTTPS in production.');
  }
  if (parsed.NODE_ENV === 'production' && !parsed.MINIO_USE_SSL) {
    throw new Error('MINIO_USE_SSL must be true in production.');
  }
  if (
    parsed.NODE_ENV === 'production' &&
    (parsed.MINIO_ACCESS_KEY === 'caderno-local' || parsed.MINIO_SECRET_KEY === 'local-development-minio-secret')
  ) {
    throw new Error('MinIO credentials must be changed from development defaults in production.');
  }

  const adminCredentialCount = [
    parsed.ADMIN_EMAIL,
    parsed.ADMIN_PASSWORD_HASH,
    parsed.ADMIN_SESSION_SECRET,
  ].filter(Boolean).length;
  if (adminCredentialCount !== 0 && adminCredentialCount !== 3) {
    throw new Error('Set ADMIN_EMAIL, ADMIN_PASSWORD_HASH, and ADMIN_SESSION_SECRET together.');
  }
  if (parsed.NODE_ENV === 'production' && adminCredentialCount !== 3) {
    throw new Error('Set ADMIN_EMAIL, ADMIN_PASSWORD_HASH, and ADMIN_SESSION_SECRET for production administration.');
  }
  if (parsed.NODE_ENV === 'production' && !parsed.ABACATEPAY_WEBHOOK_SECRET) {
    throw new Error('Set ABACATEPAY_WEBHOOK_SECRET for production webhook verification.');
  }
  if (parsed.NODE_ENV === 'production' && !parsed.ABACATEPAY_WEBHOOK_SIGNATURE_KEY) {
    throw new Error('Set ABACATEPAY_WEBHOOK_SIGNATURE_KEY for production webhook signature verification.');
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    logLevel: parsed.LOG_LEVEL,
    databaseFile: parsed.DATABASE_FILE,
    imageStorage: {
      endpoint: parsed.MINIO_ENDPOINT,
      port: parsed.MINIO_PORT,
      useSSL: parsed.MINIO_USE_SSL,
      region: parsed.MINIO_REGION,
      accessKey: parsed.MINIO_ACCESS_KEY,
      secretKey: parsed.MINIO_SECRET_KEY,
      bucket: parsed.MINIO_BUCKET,
    },
    trustedProxyAddresses: parsed.TRUST_PROXY,
    authPublicAppUrl: parsed.AUTH_PUBLIC_APP_URL,
    publicApiUrl: parsed.PUBLIC_API_URL,
    publicAppUrl: parsed.PUBLIC_APP_URL,
    ...(parsed.SMTP_URL ? { smtpUrl: parsed.SMTP_URL } : {}),
    ...(parsed.EMAIL_FROM ? { emailFrom: parsed.EMAIL_FROM } : {}),
    ...abacatePayFrom(parsed),
    ...(parsed.CAKTO_CHECKOUT_URL ? { caktoCheckoutUrl: parsed.CAKTO_CHECKOUT_URL } : {}),
    ...(parsed.CAKTO_PRODUCT_ID ? { caktoProductId: parsed.CAKTO_PRODUCT_ID } : {}),
    ...(parsed.CAKTO_WEBHOOK_SECRET ? { caktoWebhookSecret: parsed.CAKTO_WEBHOOK_SECRET } : {}),
    ...caktoPlansFrom(parsed),
    ...(parsed.ANALYTICS_READ_TOKEN ? { analyticsReadToken: parsed.ANALYTICS_READ_TOKEN } : {}),
    ...(parsed.ADMIN_EMAIL ? { adminEmail: parsed.ADMIN_EMAIL } : {}),
    ...(parsed.ADMIN_PASSWORD_HASH ? { adminPasswordHash: parsed.ADMIN_PASSWORD_HASH } : {}),
    ...(parsed.ADMIN_SESSION_SECRET ? { adminSessionSecret: parsed.ADMIN_SESSION_SECRET } : {}),
  };
}

function abacatePayFrom(
  parsed: z.infer<typeof configSchema>,
): { abacatePay: AbacatePayConfig } | Record<string, never> {
  const hasApiKey = parsed.ABACATEPAY_API_KEY !== undefined;
  const hasWebhookSecret = parsed.ABACATEPAY_WEBHOOK_SECRET !== undefined;
  const signatureKey = parsed.ABACATEPAY_WEBHOOK_SIGNATURE_KEY;
  const annualProductId = parsed.ABACATEPAY_PRODUCT_ANNUAL_ID;
  const lifetimeProductId = parsed.ABACATEPAY_PRODUCT_LIFETIME_ID;
  const hasAnnualProduct = annualProductId !== undefined;
  const hasLifetimeProduct = lifetimeProductId !== undefined;

  if (!hasApiKey && !hasWebhookSecret && !signatureKey && !hasAnnualProduct && !hasLifetimeProduct) return {};
  if (!hasApiKey || !hasWebhookSecret) {
    throw new Error('Set ABACATEPAY_API_KEY and ABACATEPAY_WEBHOOK_SECRET together.');
  }
  if (!signatureKey) {
    throw new Error('Set ABACATEPAY_WEBHOOK_SIGNATURE_KEY for AbacatePay webhook signature verification.');
  }
  if (hasAnnualProduct !== hasLifetimeProduct) {
    throw new Error('Set ABACATEPAY_PRODUCT_ANNUAL_ID and ABACATEPAY_PRODUCT_LIFETIME_ID together to enable AbacatePay checkout.');
  }
  if (hasAnnualProduct && annualProductId === lifetimeProductId) {
    throw new Error('ABACATEPAY_PRODUCT_ANNUAL_ID and ABACATEPAY_PRODUCT_LIFETIME_ID must be different products.');
  }
  return {
    abacatePay: {
      apiKey: parsed.ABACATEPAY_API_KEY!,
      webhookSecret: parsed.ABACATEPAY_WEBHOOK_SECRET!,
      signatureKey,
      ...(hasAnnualProduct && hasLifetimeProduct
        ? { plans: { annual: { productId: annualProductId! }, lifetime: { productId: lifetimeProductId! } } }
        : {}),
    },
  };
}

function caktoPlansFrom(
  parsed: z.infer<typeof configSchema>,
): { caktoPlans: { annual: CaktoPlanConfig; lifetime: CaktoPlanConfig } } | Record<string, never> {
  const annualUrl = parsed.CAKTO_CHECKOUT_ANNUAL_URL;
  const annualProductId = parsed.CAKTO_PRODUCT_ANNUAL_ID;
  const annualSecret = parsed.CAKTO_WEBHOOK_SECRET_ANNUAL;
  const lifetimeUrl = parsed.CAKTO_CHECKOUT_LIFETIME_URL;
  const lifetimeProductId = parsed.CAKTO_PRODUCT_LIFETIME_ID;
  const lifetimeSecret = parsed.CAKTO_WEBHOOK_SECRET_LIFETIME;
  const values = [annualUrl, annualProductId, annualSecret, lifetimeUrl, lifetimeProductId, lifetimeSecret];
  const present = values.filter((value) => value !== undefined).length;
  if (present === 0) return {};
  if (present !== values.length || !annualUrl || !annualProductId || !annualSecret || !lifetimeUrl || !lifetimeProductId || !lifetimeSecret) {
    throw new Error('Set CAKTO_CHECKOUT_ANNUAL_URL, CAKTO_PRODUCT_ANNUAL_ID, CAKTO_WEBHOOK_SECRET_ANNUAL, CAKTO_CHECKOUT_LIFETIME_URL, CAKTO_PRODUCT_LIFETIME_ID, and CAKTO_WEBHOOK_SECRET_LIFETIME together.');
  }
  if (annualProductId === lifetimeProductId) {
    throw new Error('CAKTO_PRODUCT_ANNUAL_ID and CAKTO_PRODUCT_LIFETIME_ID must be different products.');
  }

  return {
    caktoPlans: {
      annual: { checkoutUrl: annualUrl, productId: annualProductId, webhookSecret: annualSecret },
      lifetime: { checkoutUrl: lifetimeUrl, productId: lifetimeProductId, webhookSecret: lifetimeSecret },
    },
  };
}
