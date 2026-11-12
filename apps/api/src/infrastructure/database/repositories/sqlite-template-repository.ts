import { isDeepStrictEqual } from 'node:util';

import { and, desc, eq, max } from 'drizzle-orm';

import type { AdminTemplate, AdminTemplateRepository } from '../../../application/ports/admin-template-repository.js';
import type { TemplateRepository } from '../../../application/ports/template-repository.js';
import type { Template } from '../../../domain/templates/template.js';
import type { AppDatabase } from '../connection.js';
import { templates } from '../schema.js';

export class SqliteTemplateRepository implements TemplateRepository, AdminTemplateRepository {
  constructor(private readonly db: AppDatabase) {}

  findActive(): Template[] {
    return this.db
      .select()
      .from(templates)
      .where(eq(templates.isActive, true))
      .orderBy(templates.createdAt, templates.id)
      .all();
  }

  findAll(): AdminTemplate[] {
    return this.db
      .select()
      .from(templates)
      .orderBy(desc(templates.createdAt), desc(templates.version), templates.id)
      .all();
  }

  createDraft(input: {
    id: string;
    name: string;
    description: string | null;
    definition: Template['definition'];
    createdAt: Date;
  }): AdminTemplate {
    return this.db.transaction((transaction) => {
      const latestVersion = transaction
        .select({ value: max(templates.version) })
        .from(templates)
        .where(eq(templates.id, input.id))
        .get()?.value ?? 0;
      const version = latestVersion + 1;

      transaction
        .insert(templates)
        .values({ ...input, version, isActive: false, publicationStatus: 'draft' })
        .run();

      const draft = transaction
        .select()
        .from(templates)
        .where(and(eq(templates.id, input.id), eq(templates.version, version)))
        .get();
      if (!draft) throw new Error('O rascunho criado não foi encontrado após a gravação.');
      return draft;
    });
  }

  updateDraft(input: {
    id: string;
    version: number;
    name: string;
    description: string | null;
    definition: Template['definition'];
  }): AdminTemplate | undefined {
    return this.db.transaction((transaction) => {
      const result = transaction
        .update(templates)
        .set({ name: input.name, description: input.description, definition: input.definition })
        .where(and(
          eq(templates.id, input.id),
          eq(templates.version, input.version),
          eq(templates.publicationStatus, 'draft'),
        ))
        .run();
      if (result.changes === 0) return undefined;
      return transaction
        .select()
        .from(templates)
        .where(and(eq(templates.id, input.id), eq(templates.version, input.version)))
        .get();
    });
  }

  publishDraft(input: { id: string; version: number; expectedDefinition: Template['definition'] }): AdminTemplate | undefined {
    return this.db.transaction((transaction) => {
      const draft = transaction
        .select()
        .from(templates)
        .where(and(
          eq(templates.id, input.id),
          eq(templates.version, input.version),
          eq(templates.publicationStatus, 'draft'),
        ))
        .get();
      if (!draft || !isDeepStrictEqual(draft.definition, input.expectedDefinition)) return undefined;

      transaction
        .update(templates)
        .set({ isActive: false, publicationStatus: 'archived' })
        .where(and(eq(templates.id, input.id), eq(templates.publicationStatus, 'published')))
        .run();
      transaction
        .update(templates)
        .set({ isActive: true, publicationStatus: 'published' })
        .where(and(eq(templates.id, input.id), eq(templates.version, input.version)))
        .run();
      return transaction
        .select()
        .from(templates)
        .where(and(eq(templates.id, input.id), eq(templates.version, input.version)))
        .get();
    });
  }

  archiveActive(id: string): boolean {
    const result = this.db
      .update(templates)
      .set({ isActive: false, publicationStatus: 'archived' })
      .where(and(eq(templates.id, id), eq(templates.publicationStatus, 'published')))
      .run();
    return result.changes > 0;
  }

  findActiveById(id: string): Template | undefined {
    return this.db
      .select()
      .from(templates)
      .where(and(eq(templates.id, id), eq(templates.isActive, true)))
      .orderBy(desc(templates.version))
      .get();
  }

  findByIdAndVersion(id: string, version: number): AdminTemplate | undefined {
    return this.db
      .select()
      .from(templates)
      .where(and(eq(templates.id, id), eq(templates.version, version)))
      .get();
  }
}
