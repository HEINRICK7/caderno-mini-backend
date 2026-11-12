import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { and, eq } from 'drizzle-orm';

import { loadConfig } from '../../bootstrap/config.js';
import { createDatabase } from './connection.js';
import { migrateDatabase } from './migrate.js';
import { templates } from './schema.js';
import { validateTemplateDefinition } from '../../domain/templates/validate-template-input.js';
import type { JsonObject } from '../../domain/shared/json-value.js';

type DevelopmentTemplate = {
  id: string;
  version: number;
  name: string;
  description: string | null;
  definition: JsonObject;
  isActive: boolean;
};

if (process.env.NODE_ENV === 'production') {
  throw new Error('O seed de exemplo é exclusivo de desenvolvimento.');
}

const config = loadConfig();
const database = createDatabase(config.databaseFile);

try {
  migrateDatabase(database.sqlite, 'apps/api/src/infrastructure/database/migrations');

  const catalogPath = resolve(process.env.TEMPLATE_CATALOG_FILE ?? './catalog/templates.json');
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as DevelopmentTemplate[];
  if (catalog.length !== 16) {
    throw new Error('O catálogo de desenvolvimento precisa conter os 16 modelos oficiais.');
  }
  const ids = new Set<string>();
  for (const template of catalog) {
    if (ids.has(template.id)) throw new Error(`O modelo "${template.id}" está duplicado no catálogo.`);
    ids.add(template.id);
    validateTemplateDefinition(template.definition);
  }

  database.db.transaction((transaction) => {
    transaction
      .update(templates)
      .set({ isActive: false, publicationStatus: 'archived' })
      .where(eq(templates.isActive, true))
      .run();

    for (const [index, template] of catalog.entries()) {
      const existing = transaction
        .select()
        .from(templates)
        .where(and(eq(templates.id, template.id), eq(templates.version, template.version)))
        .get();

      const values = {
        name: template.name,
        version: template.version,
        description: template.description,
        definition: template.definition,
        isActive: template.isActive,
        publicationStatus: template.isActive ? 'published' as const : 'archived' as const,
        createdAt: new Date(Date.UTC(2026, 9, 31, 0, 0, index)),
      };

      if (existing) {
        transaction
          .update(templates)
          .set(values)
          .where(and(eq(templates.id, template.id), eq(templates.version, template.version)))
          .run();
      } else {
        transaction.insert(templates).values({ id: template.id, ...values }).run();
      }
    }
  });
} finally {
  database.close();
}
