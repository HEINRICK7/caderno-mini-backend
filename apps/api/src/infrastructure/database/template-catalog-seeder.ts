import { isDeepStrictEqual } from 'node:util';

import { and, eq, ne } from 'drizzle-orm';
import { z } from 'zod';

import { validateTemplateDefinition } from '../../domain/templates/validate-template-input.js';
import type { JsonObject, JsonValue } from '../../domain/shared/json-value.js';
import type { AppDatabase } from './connection.js';
import { templates } from './schema.js';

const catalogEntrySchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/),
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).nullable().default(null),
  definition: z.unknown(),
  isActive: z.boolean(),
}).strict();

const catalogSchema = z.array(catalogEntrySchema).min(1).max(100);

export class InvalidTemplateCatalogError extends Error {
  constructor(message = 'O catálogo de modelos é inválido.') {
    super(message);
    this.name = 'InvalidTemplateCatalogError';
  }
}

export class TemplateCatalogConflictError extends Error {
  constructor(templateId: string, version: number) {
    super(`A versão ${version} do modelo "${templateId}" já existe com outro conteúdo.`);
    this.name = 'TemplateCatalogConflictError';
  }
}

export type TemplateCatalogSeedResult = {
  inserted: number;
  statusChanged: number;
  unchanged: number;
};

export function seedTemplateCatalog(
  db: AppDatabase,
  input: unknown,
  options: { clock?: () => Date } = {},
): TemplateCatalogSeedResult {
  const parsedEntries = catalogSchema.parse(input);
  const keys = new Set<string>();
  const activeVersions = new Set<string>();
  const entries = parsedEntries.map((entry) => {
    const definition = entry.definition;
    if (!isJsonObject(definition)) {
      throw new InvalidTemplateCatalogError(`A definição do modelo "${entry.id}" precisa ser um objeto JSON.`);
    }
    validateTemplateDefinition(definition);
    if (!Object.hasOwn(definition, 'visual')) {
      throw new InvalidTemplateCatalogError(
        `O modelo "${entry.id}" precisa declarar o estilo visual no catálogo oficial.`,
      );
    }
    if (!Object.hasOwn(definition, 'card')) {
      throw new InvalidTemplateCatalogError(
        `O modelo "${entry.id}" precisa declarar a composição do cartão no catálogo oficial.`,
      );
    }

    const versionKey = `${entry.id}:${entry.version}`;
    if (keys.has(versionKey)) {
      throw new InvalidTemplateCatalogError(`O modelo "${entry.id}" versão ${entry.version} aparece mais de uma vez.`);
    }
    keys.add(versionKey);

    if (entry.isActive) {
      if (activeVersions.has(entry.id)) {
        throw new InvalidTemplateCatalogError(`O modelo "${entry.id}" tem mais de uma versão ativa no catálogo.`);
      }
      activeVersions.add(entry.id);
    }

    return { ...entry, definition };
  });

  const clock = options.clock ?? (() => new Date());
  return db.transaction((transaction): TemplateCatalogSeedResult => {
    const result: TemplateCatalogSeedResult = { inserted: 0, statusChanged: 0, unchanged: 0 };

    for (const entry of entries) {
      const existing = transaction
        .select()
        .from(templates)
        .where(and(eq(templates.id, entry.id), eq(templates.version, entry.version)))
        .get();

      if (existing && (
        existing.name !== entry.name ||
        existing.description !== entry.description ||
        !isDeepStrictEqual(existing.definition, entry.definition)
      )) {
        throw new TemplateCatalogConflictError(entry.id, entry.version);
      }

      if (entry.isActive) {
        transaction
          .update(templates)
          .set({ isActive: false })
          .where(and(eq(templates.id, entry.id), ne(templates.version, entry.version)))
          .run();
      }

      if (existing) {
        if (existing.isActive !== entry.isActive) {
          transaction
            .update(templates)
            .set({ isActive: entry.isActive })
            .where(and(eq(templates.id, entry.id), eq(templates.version, entry.version)))
            .run();
          result.statusChanged += 1;
        } else {
          result.unchanged += 1;
        }
        continue;
      }

      transaction
        .insert(templates)
        .values({
          id: entry.id,
          version: entry.version,
          name: entry.name,
          description: entry.description,
          definition: entry.definition,
          isActive: entry.isActive,
          createdAt: clock(),
        })
        .run();
      result.inserted += 1;
    }

    return result;
  });
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && Object.values(value).every((entry) => isJsonValue(entry));
}

function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 64) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry, depth + 1));
  if (isRecord(value)) return Object.values(value).every((entry) => isJsonValue(entry, depth + 1));
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
