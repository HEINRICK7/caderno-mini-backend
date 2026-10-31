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

  const examples = [
    example('boas-vindas', 'Boas-vindas', 'Recebe novos clientes de forma acolhedora.', 'wave', 'Boas-vindas', 'both', '#e1f3ef', '#168a80', 'Olá, {{recipientName}}!', 'Que bom ter você por aqui!'),
    example('obrigado-compra', 'Agradecimento pela compra', 'Valoriza o cliente após a venda.', 'shopping-bag-heart', 'Agradecimento', 'product', '#e5f0ff', '#2563eb', 'Obrigado, {{recipientName}}!', 'Sua compra foi um sucesso!'),
    example('parcela-proxima', 'Parcela próxima do vencimento', 'Lembra a data com antecedência.', 'installment-calendar', 'Cobrança', 'both', '#e1f3ef', '#168a80', 'Olá, {{recipientName}}!', 'Passando para lembrar que sua parcela vence em 3 dias.'),
    example('parcela-hoje', 'Parcela vence hoje', 'Avisa que o pagamento é para hoje.', 'due-calendar', 'Cobrança', 'both', '#fff1dc', '#f97316', 'Olá, {{recipientName}}!', 'Sua parcela vence hoje.'),
    example('parcela-atrasada', 'Parcela em atraso', 'Informa que já está em atraso.', 'overdue-warning', 'Cobrança', 'both', '#ffe5e8', '#e53950', 'Olá, {{recipientName}}!', 'Consta uma parcela em aberto.'),
    example('cobranca-pix', 'Cobrança Pix', 'Envia a cobrança completa com QR Code.', 'pix-qr', 'Cobrança', 'both', '#e1f3ef', '#168a80', 'Olá, {{recipientName}}!', 'Sua cobrança está disponível.'),
    example('caderneta-quitada', 'Cadernetinha quitada', 'Celebra quando todas as parcelas foram pagas.', 'trophy', 'Cobrança', 'both', '#fff1dc', '#f97316', 'Parabéns, {{recipientName}}!', 'Sua caderneta foi totalmente quitada!'),
    example('aniversario', 'Aniversário', 'Parabeniza o cliente em uma data especial.', 'gift', 'Datas especiais', 'both', '#f3e8ff', '#7950e8', 'Feliz aniversário, {{recipientName}}!', 'Que seu novo ciclo seja especial. Somos gratos por ter você como cliente.'),
  ];

  for (const [index, example] of examples.entries()) {
    const existing = database.db
      .select()
      .from(templates)
      .where(and(eq(templates.id, example.id), eq(templates.version, 1)))
      .get();

    const values = {
      name: example.name,
      version: 1,
      description: example.description,
      definition: example.definition,
      isActive: true,
      createdAt: new Date(Date.UTC(2026, 9, 31, 0, 0, index)),
    };
    if (!existing) {
      database.db
        .insert(templates)
        .values({
          id: example.id,
          ...values,
        })
        .run();
    } else {
      database.db
        .update(templates)
        .set(values)
        .where(and(eq(templates.id, example.id), eq(templates.version, 1)))
        .run();
    }
  }
} finally {
  database.close();
}

function example(
  id: string,
  name: string,
  description: string,
  illustration: 'wave' | 'shopping-bag-heart' | 'installment-calendar' | 'due-calendar' | 'overdue-warning' | 'pix-qr' | 'trophy' | 'gift',
  category: 'Agradecimento' | 'Boas-vindas' | 'Datas especiais' | 'Cobrança' | 'Entrega' | 'Promoções',
  segment: 'product' | 'service' | 'both',
  background: string,
  accent: string,
  heading: string,
  message: string,
): { id: string; name: string; description: string; definition: JsonObject } {
  return {
    id,
    name,
    description,
    definition: {
      fields: [{ id: 'recipientName', type: 'text', label: 'Nome do cliente', placeholder: 'Maria', required: true, maxLength: 60 }],
      catalog: { segment, category },
      visual: { layout: 'centered', background, surface: '#ffffff', accent, heading: '#10264f', text: '#385176', muted: '#687895', headingFont: 'rounded', bodyFont: 'sans', frame: 'none' },
      card: { illustration, heading, message, footer: 'heart' },
    },
  };
}
