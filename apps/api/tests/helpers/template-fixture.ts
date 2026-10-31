import type { AppDatabase } from '../../src/infrastructure/database/connection.js';
import { templates } from '../../src/infrastructure/database/schema.js';

export function insertTemplate(
  db: AppDatabase,
  values: Partial<typeof templates.$inferInsert> = {},
): void {
  db.insert(templates)
    .values({
      id: 'mensagem-exemplo',
      version: 1,
      name: 'Modelo de exemplo',
      description: 'Fixture local de integração',
      definition: { fields: [{ id: 'message', type: 'text' }] },
      isActive: true,
      createdAt: new Date('2026-10-01T10:00:00.000Z'),
      ...values,
    })
    .run();
}
