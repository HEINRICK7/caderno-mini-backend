import fastifySwagger from '@fastify/swagger';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyRawBody from 'fastify-raw-body';
import Fastify, { LogController } from 'fastify';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { FastifyLoggerOptions } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod/v4';

import {
  CheckoutNotConfiguredError,
  DraftNotFoundError,
  ExportContentTooLargeError,
  AnalyticsRangeError,
  InvalidMagicLinkError,
  InvalidCaktoWebhookError,
  InvalidImageUploadError,
  ImageStorageUnavailableError,
  MagicLinkDeliveryError,
  PurchaseNotFoundError,
  PublicationAccessDeniedError,
  TemplateNotFoundError,
  WebhookNotConfiguredError,
} from '../application/errors.js';
import {
  TemplateFinancialStateError,
  TemplateInputValidationError,
} from '../domain/templates/errors.js';
import { MAX_IMAGE_DATA_URL_LENGTH, MAX_IMAGE_UPLOAD_BODY_BYTES } from '../domain/images/image-limits.js';
import type { Draft } from '../domain/drafts/draft.js';
import { normalizeEmail } from '../domain/identity/identity.js';
import type {
  AnalyticsServices,
  ApplicationServices,
  CommerceServices,
  IdentityServices,
  PublishingServices,
  PreviewServices,
  ImageServices,
} from './services.js';

// Request bodies have already passed through Fastify's JSON parser; arbitrary JSON values are valid here.
const jsonObjectSchema = z.record(z.string(), z.any());
const templateResponseSchema = z.object({
  id: z.string(),
  version: z.number().int(),
  name: z.string(),
  description: z.string().nullable(),
  definition: jsonObjectSchema,
  createdAt: z.string().datetime(),
});
const templateValidationIssueSchema = z.object({
  path: z.string(),
  code: z.string(),
  message: z.string(),
});
const draftResponseSchema = z.object({
  id: z.uuid(),
  templateId: z.string(),
  templateVersion: z.number().int(),
  data: jsonObjectSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(templateValidationIssueSchema).optional(),
  }),
});
const idParamsSchema = z.object({ id: z.uuid() }).strict();
const templateIdParamsSchema = z.object({ id: z.string().min(1).max(120) }).strict();
const createDraftBodySchema = z
  .object({ templateId: z.string().min(1).max(120), data: jsonObjectSchema })
  .strict();
const validateTemplateBodySchema = z.object({ data: jsonObjectSchema }).strict();
const uploadImageBodySchema = z.object({ dataUrl: z.string().max(MAX_IMAGE_DATA_URL_LENGTH) }).strict();
const updateDraftBodySchema = z.object({ data: jsonObjectSchema }).strict();
const magicLinkBodySchema = z.object({ email: z.string().trim().toLowerCase().email().max(254) }).strict();
const verifyMagicLinkBodySchema = z.object({ token: z.string().min(32).max(256) }).strict();
const userResponseSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  createdAt: z.string().datetime(),
});
const sessionResponseSchema = z.object({ data: z.object({ user: userResponseSchema }) });
const authMessageResponseSchema = z.object({ data: z.object({ message: z.string() }) });
const attributionSchema = z.object({
  source: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/).optional(),
  medium: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/).optional(),
  campaign: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/).optional(),
  referrerUrl: z.url().max(2_048).optional(),
}).strict();
const createCheckoutBodySchema = z.object({ draftId: z.uuid(), attribution: attributionSchema.optional() }).strict();
const checkoutResponseSchema = z.object({
  data: z.object({ purchaseId: z.uuid(), checkoutUrl: z.url(), status: z.literal('pending') }),
});
const purchaseStatusResponseSchema = z.object({
  data: z.object({
    purchaseId: z.uuid(),
    draftId: z.uuid(),
    status: z.enum(['pending', 'paid', 'refunded', 'chargedback', 'canceled', 'refused']),
    accessStatus: z.enum(['active', 'revoked', 'none']),
    updatedAt: z.string().datetime(),
  }),
});
const userAccessItemSchema = z.object({
  purchaseId: z.uuid(),
  draftId: z.uuid(),
  purchaseStatus: z.enum(['pending', 'paid', 'refunded', 'chargedback', 'canceled', 'refused']),
  accessStatus: z.enum(['active', 'revoked']),
  grantedAt: z.string().datetime(),
});
const publicationResponseSchema = z.object({
  data: z.object({
    slug: z.string(),
    status: z.literal('published'),
    publicPath: z.string(),
    publicUrl: z.url(),
    publishedAt: z.string().datetime(),
  }),
});
const publicMessageResponseSchema = z.object({
  data: z.object({
    templateId: z.string(),
    templateVersion: z.number().int(),
    templateName: z.string(),
    templateDescription: z.string().nullable(),
    templateDefinition: jsonObjectSchema,
    publicUrl: z.url(),
    data: jsonObjectSchema,
    publishedAt: z.string().datetime(),
  }),
});
const analyticsEventBodySchema = z.object({
  eventId: z.uuid(),
  name: z.enum([
    'landing_viewed',
    'template_viewed',
    'template_selected',
    'preview_viewed',
    'whatsapp_share_clicked',
  ]),
  draftId: z.uuid().optional(),
  templateId: z.string().min(1).max(120).optional(),
  source: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/).optional(),
  medium: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/).optional(),
  campaign: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/).optional(),
  referrerUrl: z.url().max(2_048).optional(),
}).strict();
const analyticsSummaryQuerySchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
}).strict();
const analyticsSummaryResponseSchema = z.object({
  data: z.object({
    eventCounts: z.array(z.object({ name: z.string(), count: z.number().int().nonnegative() })),
    purchaseSources: z.array(z.object({
      source: z.string().nullable(),
      medium: z.string().nullable(),
      campaign: z.string().nullable(),
      purchases: z.number().int().nonnegative(),
    })),
  }),
});
const webhookAcceptedResponseSchema = z.object({
  data: z.object({ accepted: z.number().int().nonnegative(), duplicates: z.number().int().nonnegative() }),
});

export type BuildAppOptions = {
  logger?: boolean | FastifyLoggerOptions;
  services?: ApplicationServices;
  commerceServices?: CommerceServices;
  identityServices?: IdentityServices;
  publishingServices?: PublishingServices;
  previewServices?: PreviewServices;
  imageServices?: ImageServices;
  analyticsServices?: AnalyticsServices;
  analyticsReadToken?: string;
  authCookieSecure?: boolean;
  authPublicAppUrl?: string;
  publicApiUrl?: string;
  publicAppUrl?: string;
  trustedProxyAddresses?: string[];
  healthCheck?: () => unknown | Promise<unknown>;
};

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 64 * 1024,
    trustProxy: options.trustedProxyAddresses?.length ? options.trustedProxyAddresses : false,
    logController: new LogController({ disableRequestLogging: true }),
  }).withTypeProvider<ZodTypeProvider>();
  app.register(fastifyCookie);
  app.register(fastifyRateLimit, { global: false });
  app.register(fastifyRawBody, { global: false, encoding: false });
  const authCookieSecure = options.authCookieSecure ?? false;
  const authPublicOrigin = options.authPublicAppUrl ? new URL(options.authPublicAppUrl).origin : undefined;
  const publicApiOrigin = new URL(options.publicApiUrl ?? 'http://localhost:3000').origin;
  const publicAppOrigin = new URL(options.publicAppUrl ?? 'http://localhost:3001').origin;
  const sessionCookieName = authCookieSecure ? '__Host-caderno_session' : 'caderno_session';
  const getAuthenticatedUser = (request: FastifyRequest) => {
    const token = request.cookies[sessionCookieName];
    return token && options.identityServices
      ? options.identityServices.getSession({ token })
      : undefined;
  };
  const requireSession = (request: FastifyRequest, response: FastifyReply) => {
    const user = getAuthenticatedUser(request);
    if (!user) {
      response.code(401).send({
        error: { code: 'AUTH_REQUIRED', message: 'Entre para continuar.' },
      });
      return undefined;
    }
    return user;
  };
  const healthResponseSchema = z.object({ status: z.enum(['ok', 'unavailable']) });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('preHandler', async (request, response) => {
    const isUnsafeMethod = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const routePath = request.routeOptions.url;
    const isIdentityMutation = routePath?.startsWith('/api/v1/auth/') ?? false;
    const isSessionMutation = [
      '/api/v1/drafts',
      '/api/v1/drafts/:id',
      '/api/v1/checkout',
      '/api/v1/drafts/:id/publication',
      '/api/v1/analytics/events',
    ].includes(routePath ?? '');
    const hasSessionCookie = Boolean(request.cookies[sessionCookieName]);
    const origin = request.headers.origin;
    const isBrowserRequest = origin !== undefined || request.headers['sec-fetch-site'] !== undefined;

    if (
      isUnsafeMethod &&
      isBrowserRequest &&
      (isIdentityMutation || (isSessionMutation && hasSessionCookie)) &&
      origin !== authPublicOrigin
    ) {
      return response.code(403).send({
        error: { code: 'CSRF_ORIGIN_INVALID', message: 'A origem da requisição não é permitida.' },
      });
    }
  });
  app.register(fastifySwagger, {
    openapi: {
      info: {
        title: 'Cadernô Express API',
        version: '0.1.0',
      },
      servers: [{ url: 'http://localhost:3000' }],
    },
    transform: jsonSchemaTransform,
    transformObject: jsonSchemaTransformObject,
  });

  app.addHook('onResponse', async (request, response) => {
    request.log.info(
      { method: request.method, route: request.routeOptions.url, statusCode: response.statusCode },
      'Requisição HTTP concluída',
    );
  });

  app.addHook('onSend', async (request, response, payload) => {
    if (
      request.routeOptions.url?.startsWith('/api/v1/drafts') ||
      request.routeOptions.url?.startsWith('/api/v1/auth') ||
      request.routeOptions.url?.startsWith('/api/v1/checkout') ||
      request.routeOptions.url?.startsWith('/api/v1/account') ||
      request.routeOptions.url?.startsWith('/api/v1/purchases') ||
      request.routeOptions.url?.startsWith('/api/v1/publications') ||
      request.routeOptions.url?.startsWith('/api/v1/analytics') ||
      request.routeOptions.url?.startsWith('/api/v1/webhooks')
    ) {
      response.header('cache-control', 'no-store');
    }
    if (request.routeOptions.url?.startsWith('/api/v1/auth')) {
      response.header('cache-control', 'no-store');
      response.header('referrer-policy', 'no-referrer');
    }
    return payload;
  });

  app.setErrorHandler((error, request, response) => {
    if (error instanceof TemplateNotFoundError) {
      return response.code(404).send({
        error: { code: 'TEMPLATE_NOT_FOUND', message: 'Modelo não encontrado.' },
      });
    }
    if (error instanceof DraftNotFoundError) {
      return response.code(404).send({
        error: { code: 'DRAFT_NOT_FOUND', message: 'Rascunho não encontrado.' },
      });
    }
    if (error instanceof PurchaseNotFoundError) {
      return response.code(404).send({
        error: { code: 'PURCHASE_NOT_FOUND', message: 'Compra não encontrada.' },
      });
    }
    if (error instanceof PublicationAccessDeniedError) {
      return response.code(403).send({
        error: { code: 'ACTIVE_LICENSE_REQUIRED', message: 'Uma licença ativa é necessária para esta ação.' },
      });
    }
    if (error instanceof TemplateFinancialStateError) {
      return response.code(422).send({
        error: { code: 'TEMPLATE_FINANCIAL_STATE_UNAVAILABLE', message: 'A confirmação financeira deste modelo precisa vir da aplicação.' },
      });
    }
    if (error instanceof ExportContentTooLargeError) {
      return response.code(422).send({
        error: { code: 'EXPORT_CONTENT_TOO_LARGE', message: 'O conteúdo ultrapassa o limite para exportação.' },
      });
    }
    if (error instanceof InvalidImageUploadError) {
      return response.code(422).send({
        error: { code: 'IMAGE_UPLOAD_INVALID', message: 'Envie uma imagem PNG, JPEG ou WebP de até 5 MB.' },
      });
    }
    if (error instanceof ImageStorageUnavailableError) {
      return response.code(503).send({
        error: { code: 'IMAGE_STORAGE_UNAVAILABLE', message: 'O armazenamento de imagens está indisponível agora.' },
      });
    }
    if (error instanceof AnalyticsRangeError) {
      return response.code(400).send({
        error: { code: 'INVALID_ANALYTICS_RANGE', message: 'O período deve ter até 90 dias.' },
      });
    }
    if (error instanceof TemplateInputValidationError) {
      return response.code(422).send({
        error: {
          code: 'TEMPLATE_INPUT_INVALID',
          message: 'Revise os campos informados para este modelo.',
          details: error.issues,
        },
      });
    }
    if (error instanceof InvalidMagicLinkError) {
      return response.code(400).send({
        error: { code: 'INVALID_MAGIC_LINK', message: 'O link é inválido ou expirou.' },
      });
    }
    if (error instanceof InvalidCaktoWebhookError) {
      return response.code(401).send({
        error: { code: 'INVALID_WEBHOOK', message: 'A assinatura do webhook é inválida.' },
      });
    }
    if (error instanceof WebhookNotConfiguredError) {
      return response.code(503).send({
        error: { code: 'WEBHOOK_UNAVAILABLE', message: 'O processamento de pagamentos está indisponível.' },
      });
    }
    if (error instanceof MagicLinkDeliveryError) {
      return response.code(503).send({
        error: { code: 'AUTH_DELIVERY_UNAVAILABLE', message: 'Não foi possível enviar o link agora.' },
      });
    }
    if (error instanceof CheckoutNotConfiguredError) {
      return response.code(503).send({
        error: { code: 'CHECKOUT_UNAVAILABLE', message: 'O checkout está indisponível no momento.' },
      });
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      error.statusCode === 413
    ) {
      return response.code(413).send({
        error: { code: 'REQUEST_TOO_LARGE', message: 'A imagem ultrapassa o limite permitido.' },
      });
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      error.statusCode === 400
    ) {
      return response.code(400).send({
        error: { code: 'INVALID_REQUEST', message: 'A requisição é inválida.' },
      });
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      error.statusCode === 429
    ) {
      return response.code(429).send({
        error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente mais tarde.' },
      });
    }

    request.log.error(
      { errorType: error instanceof Error ? error.name : 'UnknownError' },
      'Falha ao processar requisição',
    );
    return response.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Não foi possível concluir a requisição.' },
    });
  });

  app.setNotFoundHandler((_request, response) =>
    response.code(404).send({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } }),
  );

  app.after(() => {
    app.get(
    '/health',
    { schema: { response: { 200: healthResponseSchema, 503: healthResponseSchema } } },
    async (_request, response) => {
      try {
        await options.healthCheck?.();
        return { status: 'ok' as const };
      } catch {
        return response.code(503).send({ status: 'unavailable' as const });
      }
    },
    );

    if (options.imageServices) {
      app.post(
        '/api/v1/assets',
        {
          bodyLimit: MAX_IMAGE_UPLOAD_BODY_BYTES,
          schema: {
            tags: ['assets'],
            summary: 'Armazena uma imagem de template no MinIO',
            body: uploadImageBodySchema,
            response: {
              201: z.object({ data: z.object({ id: z.uuid(), contentUrl: z.string() }) }),
              400: errorResponseSchema,
              413: errorResponseSchema,
              422: errorResponseSchema,
              429: errorResponseSchema,
              503: errorResponseSchema,
            },
          },
          preHandler: app.rateLimit({
            max: 20,
            timeWindow: '1 minute',
            errorResponseBuilder: () => ({
              statusCode: 429,
              error: { code: 'RATE_LIMITED', message: 'Muitas imagens enviadas. Tente novamente em instantes.' },
            }),
          }),
        },
        async (request, response) => {
          const image = await options.imageServices!.upload(request.body);
          return response.code(201).send({
            data: { id: image.id, contentUrl: `/api/v1/assets/${image.id}/content` },
          });
        },
      );

      app.get(
        '/api/v1/assets/:id/content',
        {
          schema: {
            tags: ['assets'],
            summary: 'Exibe uma imagem armazenada no MinIO',
            params: idParamsSchema,
            response: {
              200: z.any().meta({ type: 'string', format: 'binary' }),
              404: errorResponseSchema,
              503: errorResponseSchema,
            },
          },
        },
        async (request, response) => {
          const image = await options.imageServices!.get({ id: request.params.id });
          if (!image) {
            return response.code(404).send({ error: { code: 'ASSET_NOT_FOUND', message: 'Imagem não encontrada.' } });
          }
          return response
            .header('cache-control', 'public, max-age=31536000, immutable')
            .header('content-disposition', 'inline')
            .header('x-content-type-options', 'nosniff')
            .type(image.contentType)
            .send(image.bytes);
        },
      );
    }

    if (options.services) {
    const services = options.services;

    app.get(
      '/api/v1/templates',
      {
        schema: {
          tags: ['templates'],
          summary: 'Lista os modelos ativos',
          response: { 200: z.object({ data: z.array(templateResponseSchema) }) },
        },
      },
      async () => ({
        data: services.listTemplates().map(serializeTemplate),
      }),
    );

    app.get(
      '/api/v1/templates/:id',
      {
        schema: {
          tags: ['templates'],
          summary: 'Recupera a definição da versão ativa de um modelo',
          params: templateIdParamsSchema,
          response: { 200: z.object({ data: templateResponseSchema }), 404: errorResponseSchema },
        },
      },
      async (request) => ({ data: serializeTemplate(services.getTemplate(request.params)) }),
    );

    app.post(
      '/api/v1/templates/:id/validate',
      {
        schema: {
          tags: ['templates'],
          summary: 'Valida dados sem criar um rascunho',
          params: templateIdParamsSchema,
          body: validateTemplateBodySchema,
          response: {
            200: z.object({ data: z.object({ valid: z.literal(true) }) }),
            400: errorResponseSchema,
            404: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request) => ({
        data: services.validateTemplateInput({ templateId: request.params.id, data: request.body.data }),
      }),
    );

    app.post(
      '/api/v1/drafts',
      {
        schema: {
          tags: ['drafts'],
          summary: 'Cria um rascunho anônimo ou vinculado à conta atual',
          body: createDraftBodySchema,
          response: {
            201: z.object({ data: draftResponseSchema }),
            400: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request, response) => {
        const user = getAuthenticatedUser(request);
        const draft = services.createDraft({
          ...request.body,
          ...(user ? { ownerUserId: user.id } : {}),
        });
        options.analyticsServices?.recordServerEvent({
          name: 'draft_created',
          entityKey: draft.id,
          draftId: draft.id,
          templateId: draft.templateId,
          ...(user ? { userId: user.id } : {}),
        });
        return response.code(201).send({ data: serializeDraft(draft) });
      },
    );

    app.get(
      '/api/v1/drafts/:id',
      {
        schema: {
          tags: ['drafts'],
          summary: 'Recupera um rascunho',
          params: idParamsSchema,
          response: {
            200: z.object({ data: draftResponseSchema }),
            400: errorResponseSchema,
            404: errorResponseSchema,
            422: errorResponseSchema,
          },
        },
      },
      async (request) => {
        const user = getAuthenticatedUser(request);
        return {
          data: serializeDraft(services.getDraft({ ...request.params, ...(user ? { userId: user.id } : {}) })),
        };
      },
    );

    app.put(
      '/api/v1/drafts/:id',
      {
        schema: {
          tags: ['drafts'],
          summary: 'Substitui os dados de um rascunho',
          params: idParamsSchema,
          body: updateDraftBodySchema,
          response: {
            200: z.object({ data: draftResponseSchema }),
            400: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
          },
        },
      },
      async (request) => {
        const user = getAuthenticatedUser(request);
        const draft = services.updateDraft({
          ...request.params,
          ...request.body,
          ...(user ? { userId: user.id } : {}),
        });
        options.analyticsServices?.recordServerEvent({
          name: 'draft_updated',
          entityKey: `${draft.id}:${draft.updatedAt.getTime()}:${randomUUID()}`,
          draftId: draft.id,
          templateId: draft.templateId,
          ...(user ? { userId: user.id } : {}),
        });
        return { data: serializeDraft(draft) };
      },
    );
    }

    if (options.previewServices) {
      app.get(
        '/api/v1/drafts/:id/preview.png',
        {
          schema: {
            tags: ['drafts'],
            summary: 'Gera uma prévia PNG sem exigir licença',
            params: idParamsSchema,
            response: {
              200: z.any().meta({ type: 'string', format: 'binary' }),
              404: errorResponseSchema,
              429: errorResponseSchema,
            },
          },
          preHandler: app.rateLimit({
            max: 60,
            timeWindow: '1 minute',
            errorResponseBuilder: () => ({
              statusCode: 429,
              error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente mais tarde.' },
            }),
          }),
        },
        async (request, response) => {
          const user = getAuthenticatedUser(request);
          const image = await options.previewServices!.previewDraft({
            draftId: request.params.id,
            ...(user ? { userId: user.id } : {}),
          });
          options.analyticsServices?.recordServerEvent({
            name: 'preview_viewed',
            entityKey: randomUUID(),
            draftId: request.params.id,
            ...(user ? { userId: user.id } : {}),
          });
          return response
            .header('cache-control', 'no-store')
            .header('content-type', 'image/png')
            .send(image);
        },
      );
    }

    if (options.identityServices) {
      const identity = options.identityServices;
      const limitMagicLinkByIp = app.createRateLimit({
        max: 12,
        timeWindow: '15 minutes',
      });
      const limitMagicLinkByEmail = app.createRateLimit({
        max: 3,
        timeWindow: '1 hour',
        keyGenerator: (request) => {
          const body = request.body as { email?: string } | undefined;
          const email = normalizeEmail(body?.email ?? '');
          return `email:${createHash('sha256').update(email).digest('hex')}`;
        },
      });
      const magicLinkRateLimit = async (
        request: FastifyRequest,
        response: FastifyReply,
      ) => {
        const ipLimit = await limitMagicLinkByIp(request);
        const emailLimit =
          !ipLimit.isAllowed && ipLimit.isExceeded
            ? ipLimit
            : await limitMagicLinkByEmail(request);
        if (!emailLimit.isAllowed && emailLimit.isExceeded) {
          return response.code(429).send({
            error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente mais tarde.' },
          });
        }
      };

      app.post(
        '/api/v1/auth/magic-link',
        {
          schema: {
            tags: ['identity'],
            summary: 'Envia um link de acesso por e-mail',
            body: magicLinkBodySchema,
            response: {
              202: authMessageResponseSchema,
              400: errorResponseSchema,
              403: errorResponseSchema,
              429: errorResponseSchema,
              503: errorResponseSchema,
            },
          },
          preHandler: magicLinkRateLimit,
        },
        async (request, response) => {
          await identity.requestMagicLink(request.body);
          options.analyticsServices?.recordServerEvent({
            name: 'login_link_requested',
            entityKey: randomUUID(),
          });
          return response.code(202).send({
            data: { message: 'Se o endereço puder receber um link, enviaremos as instruções.' },
          });
        },
      );

      app.post(
        '/api/v1/auth/verify',
        {
          schema: {
            tags: ['identity'],
            summary: 'Consome o link de acesso e cria uma sessão',
            body: verifyMagicLinkBodySchema,
            response: { 200: sessionResponseSchema, 400: errorResponseSchema, 403: errorResponseSchema },
          },
        },
        async (request, response) => {
          const session = await identity.verifyMagicLink(request.body);
          response.setCookie(sessionCookieName, session.token, {
            httpOnly: true,
            secure: authCookieSecure,
            sameSite: 'lax',
            path: '/',
            maxAge: 30 * 24 * 60 * 60,
          });
          return {
            data: {
              user: {
                ...session.user,
                createdAt: session.user.createdAt.toISOString(),
              },
            },
          };
        },
      );

      app.get(
        '/api/v1/auth/session',
        {
          schema: {
            tags: ['identity'],
            summary: 'Consulta a sessão atual',
            response: { 200: sessionResponseSchema, 401: errorResponseSchema },
          },
        },
        async (request, response) => {
          const token = request.cookies[sessionCookieName];
          const user = token ? identity.getSession({ token }) : undefined;
          if (!user) {
            response.clearCookie(sessionCookieName, { path: '/' });
            return response.code(401).send({
              error: { code: 'AUTH_REQUIRED', message: 'Entre para continuar.' },
            });
          }
          return { data: { user: { ...user, createdAt: user.createdAt.toISOString() } } };
        },
      );

      app.delete(
        '/api/v1/auth/session',
        {
          schema: {
            tags: ['identity'],
            summary: 'Encerra a sessão atual',
            response: { 204: z.null(), 403: errorResponseSchema },
          },
        },
        async (request, response) => {
          const token = request.cookies[sessionCookieName];
          if (token) {
            identity.revokeSession({ token });
          }
          response.clearCookie(sessionCookieName, { path: '/' });
          return response.code(204).send(null);
        },
      );
    }

    if (options.commerceServices) {
      const commerce = options.commerceServices;
      app.get(
        '/api/v1/account/access',
        {
          schema: {
            tags: ['commerce'],
            summary: 'Lista compras e licenças da conta atual',
            response: { 200: z.object({ data: z.array(userAccessItemSchema) }), 401: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireSession(request, response);
          if (!user) return response;
          return {
            data: commerce.listUserAccess({ userId: user.id }).map((item) => ({
              ...item,
              grantedAt: item.grantedAt.toISOString(),
            })),
          };
        },
      );

      app.get(
        '/api/v1/purchases/:id',
        {
          schema: {
            tags: ['commerce'],
            summary: 'Consulta o estado de uma compra da conta atual',
            params: idParamsSchema,
            response: {
              200: purchaseStatusResponseSchema,
              401: errorResponseSchema,
              404: errorResponseSchema,
            },
          },
        },
        async (request, response) => {
          const user = requireSession(request, response);
          if (!user) return response;
          const status = commerce.getPurchaseStatus({ purchaseId: request.params.id, userId: user.id });
          return {
            data: { ...status, updatedAt: status.updatedAt.toISOString() },
          };
        },
      );

      const checkoutRateLimit = app.rateLimit({
        max: 10,
        timeWindow: '1 hour',
        errorResponseBuilder: () => ({
          statusCode: 429,
          error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente mais tarde.' },
        }),
      });
      app.post(
        '/api/v1/checkout',
        {
          schema: {
            tags: ['commerce'],
            summary: 'Cria uma compra pendente e inicia o checkout hospedado da Cakto',
            body: createCheckoutBodySchema,
            response: {
              201: checkoutResponseSchema,
              400: errorResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
              429: errorResponseSchema,
              503: errorResponseSchema,
            },
          },
          preHandler: checkoutRateLimit,
        },
        async (request, response) => {
          const user = getAuthenticatedUser(request);
          const checkout = commerce.createCheckout({
            draftId: request.body.draftId,
            ...(user ? { userId: user.id } : {}),
          });
          const attribution = request.body.attribution;
          const referrerHost = attribution?.referrerUrl
            ? toReferrerHost(attribution.referrerUrl)
            : undefined;
          options.analyticsServices?.recordServerEvent({
            name: 'checkout_started',
            entityKey: checkout.purchaseId,
            purchaseId: checkout.purchaseId,
            draftId: request.body.draftId,
            ...(user ? { userId: user.id } : {}),
            ...(attribution?.source ? { source: attribution.source } : {}),
            ...(attribution?.medium ? { medium: attribution.medium } : {}),
            ...(attribution?.campaign ? { campaign: attribution.campaign } : {}),
            ...(referrerHost ? { referrerHost } : {}),
          });
          return response.code(201).send({ data: checkout });
        },
      );

      app.post(
        '/api/v1/webhooks/cakto',
        {
          config: { rawBody: true },
          bodyLimit: 256 * 1024,
          schema: {
            tags: ['commerce'],
            summary: 'Recebe e persiste um evento assinado da Cakto',
            response: { 202: webhookAcceptedResponseSchema, 401: errorResponseSchema, 503: errorResponseSchema },
          },
        },
        async (request, response) => {
          if (!Buffer.isBuffer(request.rawBody)) {
            throw new InvalidCaktoWebhookError();
          }
          const timestamp = request.headers['x-cakto-timestamp'];
          const signature = request.headers['x-cakto-signature'];
          const accepted = commerce.acceptCaktoWebhook({
            rawBody: request.rawBody,
            headers: {
              ...(typeof timestamp === 'string' ? { timestamp } : {}),
              ...(typeof signature === 'string' ? { signature } : {}),
            },
          });
          return response.code(202).send({ data: accepted });
        },
      );
    }

    if (options.publishingServices) {
      const publishing = options.publishingServices;
      const slugParamsSchema = z.object({ slug: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();

      app.post(
        '/api/v1/drafts/:id/publication',
        {
          schema: {
            tags: ['publishing'],
            summary: 'Publica ou atualiza o link público de um rascunho',
            params: idParamsSchema,
            response: {
              200: publicationResponseSchema,
              401: errorResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
            },
          },
        },
        async (request, response) => {
          const user = requireSession(request, response);
          if (!user) return response;
          const publication = publishing.publish({ draftId: request.params.id, userId: user.id });
          options.analyticsServices?.recordServerEvent({
            name: 'publication_published',
            entityKey: `${publication.id}:${publication.publishedAt.getTime()}`,
            publicationId: publication.id,
            draftId: publication.draftId,
            userId: user.id,
          });
          return response.code(200).send({
            data: {
              slug: publication.slug,
              status: 'published' as const,
              publicPath: `/p/${publication.slug}`,
              publicUrl: new URL(`/p/${publication.slug}`, `${publicAppOrigin}/`).toString(),
              publishedAt: publication.publishedAt.toISOString(),
            },
          });
        },
      );

      app.put(
        '/api/v1/drafts/:id/publication',
        {
          schema: {
            tags: ['publishing'],
            summary: 'Atualiza e mantém publicado o link público de um rascunho',
            params: idParamsSchema,
            response: {
              200: publicationResponseSchema,
              401: errorResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
            },
          },
        },
        async (request, response) => {
          const user = requireSession(request, response);
          if (!user) return response;
          const publication = publishing.publish({ draftId: request.params.id, userId: user.id });
          options.analyticsServices?.recordServerEvent({
            name: 'publication_published',
            entityKey: `${publication.id}:${publication.publishedAt.getTime()}`,
            publicationId: publication.id,
            draftId: publication.draftId,
            userId: user.id,
          });
          return response.code(200).send({
            data: {
              slug: publication.slug,
              status: 'published' as const,
              publicPath: `/p/${publication.slug}`,
              publicUrl: new URL(`/p/${publication.slug}`, `${publicAppOrigin}/`).toString(),
              publishedAt: publication.publishedAt.toISOString(),
            },
          });
        },
      );

      app.delete(
        '/api/v1/drafts/:id/publication',
        {
          schema: {
            tags: ['publishing'],
            summary: 'Remove o link público de um rascunho',
            params: idParamsSchema,
            response: { 204: z.null(), 401: errorResponseSchema, 403: errorResponseSchema, 404: errorResponseSchema },
          },
        },
        async (request, response) => {
          const user = requireSession(request, response);
          if (!user) return response;
          publishing.unpublish({ draftId: request.params.id, userId: user.id });
          options.analyticsServices?.recordServerEvent({
            name: 'publication_unpublished',
            entityKey: `${request.params.id}:${randomUUID()}`,
            draftId: request.params.id,
            userId: user.id,
          });
          return response.code(204).send(null);
        },
      );

      app.get(
        '/api/v1/publications/:slug',
        {
          schema: {
            tags: ['publishing'],
            summary: 'Recupera uma publicação pública ainda licenciada',
            params: slugParamsSchema,
            response: { 200: publicMessageResponseSchema, 404: errorResponseSchema },
          },
        },
        async (request, response) => {
          const message = publishing.getPublicMessage(request.params);
          if (!message) {
            return response.code(404).send({
              error: { code: 'PUBLICATION_NOT_FOUND', message: 'Publicação não encontrada.' },
            });
          }
          return {
            data: {
              ...message,
              publicUrl: new URL(`/p/${request.params.slug}`, `${publicAppOrigin}/`).toString(),
              publishedAt: message.publishedAt.toISOString(),
            },
          };
        },
      );

      app.get(
        '/api/v1/publications/:slug.png',
        {
          schema: {
            tags: ['publishing'],
            summary: 'Renderiza uma publicação pública como PNG',
            params: slugParamsSchema,
            response: {
              200: z.any().meta({ type: 'string', format: 'binary' }),
              404: errorResponseSchema,
              429: errorResponseSchema,
            },
          },
          preHandler: app.rateLimit({
            max: 120,
            timeWindow: '1 minute',
            errorResponseBuilder: () => ({
              statusCode: 429,
              error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente mais tarde.' },
            }),
          }),
        },
        async (request, response) => {
          const image = await publishing.renderPublicMessagePng(request.params);
          if (!image) {
            return response.code(404).send({
              error: { code: 'PUBLICATION_NOT_FOUND', message: 'Publicação não encontrada.' },
            });
          }
          return response
            .header('cache-control', 'no-store')
            .header('content-type', 'image/png')
            .send(image);
        },
      );

      app.get(
        '/p/:slug',
        {
          schema: {
            tags: ['publishing'],
            summary: 'Abre uma página pública para compartilhar o cartão',
            params: slugParamsSchema,
            response: { 200: z.string(), 404: errorResponseSchema, 429: errorResponseSchema },
          },
          preHandler: app.rateLimit({
            max: 120,
            timeWindow: '1 minute',
            errorResponseBuilder: () => ({
              statusCode: 429,
              error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente mais tarde.' },
            }),
          }),
        },
        async (request, response) => {
          const message = publishing.getPublicMessage(request.params);
          if (!message) {
            return response.code(404).send({
              error: { code: 'PUBLICATION_NOT_FOUND', message: 'Publicação não encontrada.' },
            });
          }
          const publicUrl = new URL(`/p/${request.params.slug}`, `${publicAppOrigin}/`).toString();
          const imageUrl = new URL(
            `/api/v1/publications/${request.params.slug}.png`,
            `${publicApiOrigin}/`,
          ).toString();
          const title = `${message.templateName} · Cadernô`;
          const description = message.templateDescription || 'Veja esta mensagem criada no Cadernô Express.';
          const safeTitle = escapeHtmlAttribute(title);
          const safeDescription = escapeHtmlAttribute(description);
          const safePublicUrl = escapeHtmlAttribute(publicUrl);
          const safeImageUrl = escapeHtmlAttribute(imageUrl);
          const html = `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${safeTitle}</title>
    <meta name="description" content="${safeDescription}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Cadernô">
    <meta property="og:title" content="${safeTitle}">
    <meta property="og:description" content="${safeDescription}">
    <meta property="og:url" content="${safePublicUrl}">
    <meta property="og:image" content="${safeImageUrl}">
    <meta property="og:image:secure_url" content="${safeImageUrl}">
    <meta property="og:image:type" content="image/png">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${safeTitle}">
    <meta name="twitter:description" content="${safeDescription}">
    <meta name="twitter:image" content="${safeImageUrl}">
  </head>
  <body><main><img src="${safeImageUrl}" alt="Mensagem compartilhada"></main></body>
</html>`;
          return response
            .header('cache-control', 'no-store')
            .header('content-security-policy', "default-src 'none'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
            .header('x-content-type-options', 'nosniff')
            .type('text/html; charset=utf-8')
            .send(html);
        },
      );

      app.get(
        '/api/v1/drafts/:id/export.png',
        {
          schema: {
            tags: ['publishing'],
            summary: 'Exporta um rascunho como PNG',
            params: idParamsSchema,
            response: {
              200: z.any().meta({ type: 'string', format: 'binary' }),
              401: errorResponseSchema,
              403: errorResponseSchema,
              404: errorResponseSchema,
              422: errorResponseSchema,
            },
          },
        },
        async (request, response) => {
          const user = requireSession(request, response);
          if (!user) return response;
          const image = await publishing.exportMessage({ draftId: request.params.id, userId: user.id });
          options.analyticsServices?.recordServerEvent({
            name: 'export_generated',
            entityKey: randomUUID(),
            draftId: request.params.id,
            userId: user.id,
          });
          return response
            .header('content-type', 'image/png')
            .header('content-disposition', `attachment; filename="caderno-${request.params.id}.png"`)
            .send(image);
        },
      );
    }

    app.post(
      '/api/v1/analytics/events',
      {
        schema: {
          tags: ['analytics'],
          summary: 'Registra um evento não financeiro do funil',
          body: analyticsEventBodySchema,
          response: {
            202: z.object({ data: z.object({ accepted: z.boolean() }) }),
            400: errorResponseSchema,
            403: errorResponseSchema,
            404: errorResponseSchema,
            429: errorResponseSchema,
            503: errorResponseSchema,
          },
        },
        preHandler: app.rateLimit({
          max: 60,
          timeWindow: '1 minute',
          errorResponseBuilder: () => ({
            statusCode: 429,
            error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Tente novamente mais tarde.' },
          }),
        }),
      },
      async (request, response) => {
        if (!options.analyticsServices) {
          return response.code(503).send({
            error: { code: 'ANALYTICS_UNAVAILABLE', message: 'O registro de eventos está indisponível.' },
          });
        }
        const user = getAuthenticatedUser(request);
        const body = request.body;
        const result = options.analyticsServices.trackClientEvent({
          eventId: body.eventId,
          name: body.name,
          ...(body.draftId ? { draftId: body.draftId } : {}),
          ...(body.templateId ? { templateId: body.templateId } : {}),
          ...(body.source ? { source: body.source } : {}),
          ...(body.medium ? { medium: body.medium } : {}),
          ...(body.campaign ? { campaign: body.campaign } : {}),
          ...(body.referrerUrl ? { referrerUrl: body.referrerUrl } : {}),
          ...(user ? { userId: user.id } : {}),
        });
        return response.code(202).send({ data: result });
      },
    );

    app.get(
      '/api/v1/analytics/summary',
      {
        schema: {
          tags: ['analytics'],
          summary: 'Consulta métricas agregadas do funil',
          querystring: analyticsSummaryQuerySchema,
          response: {
            200: analyticsSummaryResponseSchema,
            400: errorResponseSchema,
            401: errorResponseSchema,
            503: errorResponseSchema,
          },
        },
      },
      async (request, response) => {
        if (!options.analyticsServices || !options.analyticsReadToken) {
          return response.code(503).send({
            error: { code: 'ANALYTICS_UNAVAILABLE', message: 'A consulta de métricas não está configurada.' },
          });
        }
        if (!bearerTokenMatches(request.headers.authorization, options.analyticsReadToken)) {
          return response.code(401).send({
            error: { code: 'ANALYTICS_UNAUTHORIZED', message: 'A credencial de consulta é inválida.' },
          });
        }
        const summary = options.analyticsServices.getSummary({
          from: new Date(request.query.from),
          to: new Date(request.query.to),
        });
        return { data: summary };
      },
    );

    app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());
  });

  return app;
}

function serializeDraft(draft: Draft) {
  return {
    ...draft,
    createdAt: draft.createdAt.toISOString(),
    updatedAt: draft.updatedAt.toISOString(),
  };
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll("'", '&#39;');
}

function serializeTemplate(template: ReturnType<ApplicationServices['getTemplate']>) {
  return { ...template, createdAt: template.createdAt.toISOString() };
}

function bearerTokenMatches(authorization: string | undefined, expectedToken: string): boolean {
  if (!authorization?.startsWith('Bearer ')) return false;
  const candidate = Buffer.from(authorization.slice('Bearer '.length));
  const expected = Buffer.from(expectedToken);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

function toReferrerHost(referrerUrl: string): string | undefined {
  try {
    const url = new URL(referrerUrl);
    return ['http:', 'https:'].includes(url.protocol) ? url.hostname.slice(0, 253).toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}
