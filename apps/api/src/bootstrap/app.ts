import fastifySwagger from '@fastify/swagger';
import Fastify, { LogController } from 'fastify';
import type { FastifyLoggerOptions } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  jsonSchemaTransform,
  jsonSchemaTransformObject,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { z } from 'zod/v4';

import { DraftNotFoundError, TemplateNotFoundError } from '../application/errors.js';
import type { Draft } from '../domain/drafts/draft.js';
import type { ApplicationServices } from './services.js';

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
const draftResponseSchema = z.object({
  id: z.uuid(),
  templateId: z.string(),
  templateVersion: z.number().int(),
  data: jsonObjectSchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
const errorResponseSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
const idParamsSchema = z.object({ id: z.uuid() }).strict();
const createDraftBodySchema = z
  .object({ templateId: z.string().min(1).max(120), data: jsonObjectSchema })
  .strict();
const updateDraftBodySchema = z.object({ data: jsonObjectSchema }).strict();

export type BuildAppOptions = {
  logger?: boolean | FastifyLoggerOptions;
  services?: ApplicationServices;
  healthCheck?: () => unknown | Promise<unknown>;
};

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 64 * 1024,
    logController: new LogController({ disableRequestLogging: true }),
  }).withTypeProvider<ZodTypeProvider>();
  const healthResponseSchema = z.object({ status: z.enum(['ok', 'unavailable']) });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
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
    if (request.routeOptions.url?.startsWith('/api/v1/drafts')) {
      response.header('cache-control', 'no-store');
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
        data: services.listTemplates().map((template) => ({
          ...template,
          createdAt: template.createdAt.toISOString(),
        })),
      }),
    );

    app.post(
      '/api/v1/drafts',
      {
        schema: {
          tags: ['drafts'],
          summary: 'Cria um rascunho anônimo',
          body: createDraftBodySchema,
          response: { 201: z.object({ data: draftResponseSchema }), 400: errorResponseSchema, 404: errorResponseSchema },
        },
      },
      async (request, response) => {
        const draft = services.createDraft(request.body);
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
          response: { 200: z.object({ data: draftResponseSchema }), 400: errorResponseSchema, 404: errorResponseSchema },
        },
      },
      async (request) => ({ data: serializeDraft(services.getDraft(request.params)) }),
    );

    app.put(
      '/api/v1/drafts/:id',
      {
        schema: {
          tags: ['drafts'],
          summary: 'Substitui os dados de um rascunho',
          params: idParamsSchema,
          body: updateDraftBodySchema,
          response: { 200: z.object({ data: draftResponseSchema }), 400: errorResponseSchema, 404: errorResponseSchema },
        },
      },
      async (request) => ({
        data: serializeDraft(services.updateDraft({ ...request.params, ...request.body })),
      }),
    );
    }

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
