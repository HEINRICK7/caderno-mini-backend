import fastifySwagger from '@fastify/swagger';
import Fastify from 'fastify';
import type { FastifyLoggerOptions } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { z } from 'zod/v4';

export type BuildAppOptions = {
  logger?: boolean | FastifyLoggerOptions;
};

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 64 * 1024 }).withTypeProvider<ZodTypeProvider>();
  const healthResponseSchema = z.object({ status: z.literal('ok') });

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
  });

  app.after(() => {
    app.get(
      '/health',
      {
        schema: {
          response: {
            200: healthResponseSchema,
          },
        },
      },
      async () => ({ status: 'ok' as const }),
    );

    app.get(
      '/openapi.json',
      {
        schema: { hide: true },
      },
      async () => app.swagger(),
    );
  });

  return app;
}
