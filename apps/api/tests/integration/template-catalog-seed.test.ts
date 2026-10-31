import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  InvalidTemplateCatalogError,
  TemplateCatalogConflictError,
  seedTemplateCatalog,
} from '../../src/infrastructure/database/template-catalog-seeder.js';
import { createDatabase } from '../../src/infrastructure/database/connection.js';
import { migrateDatabase } from '../../src/infrastructure/database/migrate.js';
import { templates } from '../../src/infrastructure/database/schema.js';
import { SqliteTemplateRepository } from '../../src/infrastructure/database/repositories/sqlite-template-repository.js';
import type { AppDatabase } from '../../src/infrastructure/database/connection.js';
import type { Database } from 'better-sqlite3';

const templateV1 = {
  id: 'mensagem-afetuosa',
  version: 1,
  name: 'Mensagem afetuosa',
  description: 'Definição de teste para o importador.',
  definition: {
    fields: [{ id: 'recipientName', type: 'text', required: true, label: 'Nome do cliente' }],
    visual: {
      layout: 'card',
      background: '#F7F1E8',
      surface: '#FFFFFF',
      accent: '#8B6245',
      heading: '#30271F',
      text: '#2F2A27',
      muted: '#705A49',
      headingFont: 'sans',
      bodyFont: 'sans',
      frame: 'none',
    },
    card: {
      illustration: 'wave',
      heading: 'Olá, {{recipientName}}!',
      message: 'Que bom ter você por aqui!',
      footer: 'heart',
    },
  },
  isActive: true,
};

describe('seedTemplateCatalog', () => {
  let db: AppDatabase;
  let sqlite: Database.Database;

  beforeEach(() => {
    const connection = createDatabase();
    db = connection.db;
    sqlite = connection.sqlite;
    migrateDatabase(sqlite, resolve(process.cwd(), 'apps/api/src/infrastructure/database/migrations'));
  });

  afterEach(() => {
    sqlite.close();
  });

  it('inserts valid templates and is idempotent for identical versions', () => {
    expect(seedTemplateCatalog(db, [templateV1])).toEqual({ inserted: 1, statusChanged: 0, unchanged: 0 });
    expect(seedTemplateCatalog(db, [templateV1])).toEqual({ inserted: 0, statusChanged: 0, unchanged: 1 });
    expect(db.select().from(templates).all()).toHaveLength(1);
  });

  it('lists models in backend catalog insertion order', () => {
    seedTemplateCatalog(db, [
      templateV1,
      { ...templateV1, id: 'modelo-seguinte', name: 'Modelo seguinte' },
    ], { clock: (() => {
      let tick = 0;
      return () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++));
    })() });

    expect(new SqliteTemplateRepository(db).findActive().map((template) => template.id)).toEqual([
      templateV1.id,
      'modelo-seguinte',
    ]);
  });

  it('activates a new immutable version and deactivates the previous one', () => {
    seedTemplateCatalog(db, [templateV1]);
    seedTemplateCatalog(db, [{ ...templateV1, version: 2, name: 'Mensagem afetuosa v2' }]);

    expect(db.select().from(templates).orderBy(templates.version).all()).toMatchObject([
      { id: templateV1.id, version: 1, isActive: false },
      { id: templateV1.id, version: 2, isActive: true },
    ]);
  });

  it('rejects invalid definitions before changing the catalog', () => {
    expect(() => seedTemplateCatalog(db, [
      templateV1,
      {
        ...templateV1,
        id: 'mensagem-invalida',
        definition: { fields: [{ id: 'message', type: 'unsupported' }] },
      },
    ])).toThrow();

    expect(db.select().from(templates).all()).toHaveLength(0);
  });

  it('requires visual tokens in catalog definitions so each official model can be rendered by the backend', () => {
    const legacyDefinition = { ...templateV1.definition };
    delete legacyDefinition.visual;
    expect(() => seedTemplateCatalog(db, [{ ...templateV1, definition: legacyDefinition }]))
      .toThrow(InvalidTemplateCatalogError);
    expect(db.select().from(templates).all()).toHaveLength(0);
  });

  it('requires a semantic card composition in official catalog definitions', () => {
    const legacyDefinition = Object.fromEntries(
      Object.entries(templateV1.definition).filter(([key]) => key !== 'card'),
    );
    expect(() => seedTemplateCatalog(db, [{ ...templateV1, definition: legacyDefinition }]))
      .toThrow(InvalidTemplateCatalogError);
    expect(db.select().from(templates).all()).toHaveLength(0);
  });

  it('rejects catalogs with multiple active versions for one template', () => {
    expect(() => seedTemplateCatalog(db, [
      templateV1,
      { ...templateV1, version: 2 },
    ])).toThrow(InvalidTemplateCatalogError);
  });

  it('keeps published version content immutable and rolls back the whole batch on conflict', () => {
    seedTemplateCatalog(db, [templateV1]);

    expect(() => seedTemplateCatalog(db, [
      { ...templateV1, id: 'mensagem-nova' },
      { ...templateV1, name: 'Conteúdo alterado na mesma versão' },
    ])).toThrow(TemplateCatalogConflictError);

    expect(db.select().from(templates).all()).toMatchObject([
      { id: templateV1.id, version: 1, name: templateV1.name, isActive: true },
    ]);
  });

  it('changes activation state without replacing a published definition', () => {
    seedTemplateCatalog(db, [templateV1]);

    expect(seedTemplateCatalog(db, [{ ...templateV1, isActive: false }])).toEqual({
      inserted: 0,
      statusChanged: 1,
      unchanged: 0,
    });
    expect(db.select().from(templates).get()?.isActive).toBe(false);
  });
});
