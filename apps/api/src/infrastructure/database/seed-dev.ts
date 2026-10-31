import { loadConfig } from '../../bootstrap/config.js';
import { and, eq } from 'drizzle-orm';
import { createDatabase } from './connection.js';
import { migrateDatabase } from './migrate.js';
import { templates } from './schema.js';
import type { JsonObject } from '../../domain/shared/json-value.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('O seed de exemplo é exclusivo de desenvolvimento.');
}

const config = loadConfig();
const database = createDatabase(config.databaseFile);

try {
  migrateDatabase(database.sqlite, 'apps/api/src/infrastructure/database/migrations');
  database.db
    .update(templates)
    .set({ isActive: false })
    .where(and(eq(templates.id, 'mensagem-exemplo'), eq(templates.version, 1)))
    .run();

  const examples: Array<{ id: string; name: string; definition: JsonObject }> = [
    {
      id: 'boas-vindas',
      name: 'Boas-vindas',
      definition: {
        fields: [{ id: 'recipientName', type: 'text', label: 'Nome do cliente', placeholder: 'Maria', required: true, maxLength: 60 }],
        visual: { layout: 'centered', background: '#fff0c3', surface: '#ffffff', accent: '#ff6674', heading: '#10264f', text: '#385176', muted: '#687895', headingFont: 'rounded', bodyFont: 'sans', frame: 'none' },
        card: { illustration: 'wave', heading: 'Olá, {{recipientName}}!', message: 'Que bom ter você por aqui!', footer: 'heart' },
      },
    },
    {
      id: 'obrigado-compra',
      name: 'Agradecimento pela compra',
      definition: {
        fields: [{ id: 'recipientName', type: 'text', label: 'Nome do cliente', placeholder: 'Maria', required: true, maxLength: 60 }],
        visual: { layout: 'centered', background: '#d9edff', surface: '#ffffff', accent: '#ff6674', heading: '#10264f', text: '#385176', muted: '#687895', headingFont: 'rounded', bodyFont: 'sans', frame: 'none' },
        card: { illustration: 'shopping-bag-heart', heading: 'Obrigado, {{recipientName}}!', message: 'Sua compra foi um sucesso!', footer: 'heart' },
      },
    },
    {
      id: 'aniversario',
      name: 'Feliz aniversário',
      definition: {
        fields: [{ id: 'recipientName', type: 'text', label: 'Nome do cliente', placeholder: 'Maria', required: true, maxLength: 60 }],
        visual: { layout: 'centered', background: '#f1e1ff', surface: '#ffffff', accent: '#9750ec', heading: '#10264f', text: '#385176', muted: '#687895', headingFont: 'rounded', bodyFont: 'sans', frame: 'none' },
        card: { illustration: 'gift', heading: 'Feliz aniversário, {{recipientName}}!', footer: 'heart' },
      },
    },
  ];

  for (const example of examples) {
    const existing = database.db
      .select()
      .from(templates)
      .where(and(eq(templates.id, example.id), eq(templates.version, 1)))
      .get();

    if (!existing) {
      database.db
        .insert(templates)
        .values({
          id: example.id,
          version: 1,
          name: example.name,
          description: null,
          definition: example.definition,
          isActive: true,
          createdAt: new Date(),
        })
        .run();
    }
  }
} finally {
  database.close();
}
