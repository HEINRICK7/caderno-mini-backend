import { and, desc, eq } from 'drizzle-orm';

import type { TemplateRepository } from '../../../application/ports/template-repository.js';
import type { Template } from '../../../domain/templates/template.js';
import type { AppDatabase } from '../connection.js';
import { templates } from '../schema.js';

export class SqliteTemplateRepository implements TemplateRepository {
  constructor(private readonly db: AppDatabase) {}

  findActive(): Template[] {
    return this.db
      .select()
      .from(templates)
      .where(eq(templates.isActive, true))
      .orderBy(templates.createdAt, templates.id)
      .all();
  }

  findActiveById(id: string): Template | undefined {
    return this.db
      .select()
      .from(templates)
      .where(and(eq(templates.id, id), eq(templates.isActive, true)))
      .orderBy(desc(templates.version))
      .get();
  }

  findByIdAndVersion(id: string, version: number): Template | undefined {
    return this.db
      .select()
      .from(templates)
      .where(and(eq(templates.id, id), eq(templates.version, version)))
      .get();
  }
}
