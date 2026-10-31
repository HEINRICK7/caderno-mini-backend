import { sql } from 'drizzle-orm';
import {
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import type { JsonObject } from '../../domain/shared/json-value.js';

export const templates = sqliteTable(
  'templates',
  {
    id: text('id').notNull(),
    version: integer('version').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    definition: text('definition', { mode: 'json' }).$type<JsonObject>().notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.version] }),
    uniqueIndex('templates_one_active_version_per_id')
      .on(table.id)
      .where(sql`${table.isActive} = 1`),
    index('templates_active_id_version').on(table.id, table.isActive, table.version),
  ],
);

export const drafts = sqliteTable(
  'drafts',
  {
    id: text('id').primaryKey(),
    templateId: text('template_id').notNull(),
    templateVersion: integer('template_version').notNull(),
    data: text('data', { mode: 'json' }).$type<JsonObject>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.templateId, table.templateVersion],
      foreignColumns: [templates.id, templates.version],
      name: 'drafts_template_version_fk',
    }).onDelete('restrict'),
    index('drafts_template_reference').on(table.templateId, table.templateVersion),
  ],
);
