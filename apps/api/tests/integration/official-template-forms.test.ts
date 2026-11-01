import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase } from '../../src/infrastructure/database/connection.js';
import { migrateDatabase } from '../../src/infrastructure/database/migrate.js';
import { seedTemplateCatalog } from '../../src/infrastructure/database/template-catalog-seeder.js';
import { validateTemplateInput } from '../../src/domain/templates/validate-template-input.js';
import type { JsonObject } from '../../src/domain/shared/json-value.js';
import type { AppDatabase } from '../../src/infrastructure/database/connection.js';
import type { Database } from 'better-sqlite3';

const officialCatalogPath = resolve(process.cwd(), 'catalog/templates.json');
const officialCatalog = JSON.parse(readFileSync(officialCatalogPath, 'utf8')) as Array<{
  id: string;
  description: string;
  definition: {
    catalog: { segment: 'product' | 'service' | 'both' };
    fields: Array<{
      id: string;
      type: string;
      label?: string;
      placeholder?: string;
      required?: boolean;
      section?: string;
    }>;
    card: {
      action?: { label: string };
      actions?: Array<{ hrefFieldId?: string }>;
      details?: Array<{ format?: string }>;
    };
  };
}>;

describe('formulários do catálogo oficial de modelos', () => {
  let database: AppDatabase;
  let sqlite: Database.Database;

  beforeEach(() => {
    const connection = createDatabase();
    database = connection.db;
    sqlite = connection.sqlite;
    migrateDatabase(sqlite, resolve(process.cwd(), 'apps/api/src/infrastructure/database/migrations'));
  });

  afterEach(() => sqlite.close());

  it('mantém os 16 formulários válidos no contrato do backend', () => {
    expect(officialCatalog).toHaveLength(16);
    expect(() => seedTemplateCatalog(database, officialCatalog)).not.toThrow();

    for (const template of officialCatalog) {
      const fields = new Set(template.definition.fields.map((field) => field.id));
      expect(fields).toContain('businessName');
      expect(fields).toContain('businessLogo');
      expect(fields).toContain('message');
      if (template.id !== 'produto-destaque') expect(fields).toContain('recipientName');
    }
  });

  it('publica novas versões para as correções sem alterar versões já usadas', () => {
    for (const id of ['boas-vindas', 'pagamento-confirmado', 'lembrete-aprovacao']) {
      expect(officialCatalog.find((template) => template.id === id)?.version).toBe(2);
    }
  });

  it('mantém cada título de seção em um único bloco contínuo nos formulários', () => {
    for (const template of officialCatalog) {
      const seen = new Set<string>();
      let previousSection: string | undefined;
      const repeatedSections: string[] = [];

      for (const field of template.definition.fields) {
        const section = field.section;
        if (!section) {
          previousSection = undefined;
          continue;
        }
        if (section !== previousSection && seen.has(section)) repeatedSections.push(section);
        seen.add(section);
        previousSection = section;
      }

      expect(repeatedSections, template.id).toEqual([]);
    }
  });

  it('conecta todos os campos de formulário ao conteúdo do cartão ou a uma ação', () => {
    for (const template of officialCatalog) {
      const card = template.definition.card as unknown as {
        heading: string;
        message?: string;
        details?: Array<{ value: string; imageFieldId?: string }>;
        action?: { hrefFieldId?: string };
        actions?: Array<{ hrefFieldId?: string }>;
        brand?: { businessNameFieldId: string; logoFieldId?: string };
      };
      const text = [card.heading, card.message ?? '', ...(card.details ?? []).map((detail) => detail.value)].join(' ');
      const references = new Set([...text.matchAll(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g)].map((match) => match[1]));
      for (const detail of card.details ?? []) {
        if (detail.imageFieldId) references.add(detail.imageFieldId);
      }
      if (card.action?.hrefFieldId) references.add(card.action.hrefFieldId);
      for (const action of card.actions ?? []) {
        if (action.hrefFieldId) references.add(action.hrefFieldId);
      }
      if (card.brand) {
        references.add(card.brand.businessNameFieldId);
        if (card.brand.logoFieldId) references.add(card.brand.logoFieldId);
      }

      const fieldIds = template.definition.fields.map((field) => field.id);
      expect([...references].sort(), template.id).toEqual([...fieldIds].sort());
    }
  });

  it('oferece campos de serviço nos modelos exclusivos para serviços', () => {
    const serviceTemplates = officialCatalog.filter((template) => template.definition.catalog.segment === 'service');
    expect(serviceTemplates.map((template) => template.id)).toEqual([
      'servico-contratado',
      'servico-concluido',
      'lembrete-aprovacao',
    ]);

    for (const template of serviceTemplates) {
      const fields = new Set(template.definition.fields.map((field) => field.id));
      expect(fields).toContain('recipientName');
      expect(fields).toContain('businessName');
      expect(fields).toContain('businessLogo');
      expect(fields).toContain('serviceName');
      expect(fields).not.toContain('productName');
    }
  });

  it('aceita um rascunho de serviço com nome, data e valor e rejeita campos de produto nele', () => {
    const serviceTemplate = officialCatalog.find((template) => template.id === 'servico-contratado');
    expect(serviceTemplate).toBeDefined();
    if (!serviceTemplate) return;

    expect(() => validateTemplateInput(serviceTemplate.definition as unknown as JsonObject, {
      recipientName: 'Maria',
      businessName: 'Oficina Exemplo',
      message: 'Confirmamos a contratação do seu serviço.',
      serviceName: 'Manutenção de equipamento',
      scheduledAt: '2026-11-10',
      servicePrice: 1200,
    })).not.toThrow();

    expect(() => validateTemplateInput(serviceTemplate.definition as unknown as JsonObject, {
      recipientName: 'Maria',
      businessName: 'Oficina Exemplo',
      message: 'Confirmamos a contratação do seu serviço.',
      serviceName: 'Manutenção de equipamento',
      scheduledAt: '2026-11-10',
      productName: 'Produto indevido neste serviço',
    })).toThrow();
  });

  it('mantém opcionais a data do serviço e o preço novo da oferta', () => {
    const serviceTemplate = officialCatalog.find((template) => template.id === 'servico-contratado');
    const offerTemplate = officialCatalog.find((template) => template.id === 'oferta-especial');
    expect(serviceTemplate).toBeDefined();
    expect(offerTemplate).toBeDefined();
    if (!serviceTemplate || !offerTemplate) return;

    const serviceDate = serviceTemplate.definition.fields.find((field) => field.id === 'scheduledAt');
    const servicePrice = serviceTemplate.definition.fields.find((field) => field.id === 'servicePrice');
    const offerPrice = offerTemplate.definition.fields.find((field) => field.id === 'newPrice');
    expect(serviceDate?.required).not.toBe(true);
    expect(serviceDate?.label).toBe('Data prevista para realização');
    expect(servicePrice?.label).toBe('Valor do serviço');
    expect(offerPrice?.required).not.toBe(true);

    expect(() => validateTemplateInput(serviceTemplate.definition as unknown as JsonObject, {
      recipientName: 'Maria',
      businessName: 'Oficina Exemplo',
      message: 'Confirmamos a contratação do seu serviço.',
      serviceName: 'Manutenção de equipamento',
    })).not.toThrow();

    expect(() => validateTemplateInput(offerTemplate.definition as unknown as JsonObject, {
      recipientName: 'Maria',
      businessName: 'Loja Exemplo',
      message: 'Aproveite esta condição especial.',
      offerName: 'Condição especial',
    })).not.toThrow();
  });

  it('usa linguagem neutra para o modelo de reativação compartilhado', () => {
    const template = officialCatalog.find((candidate) => candidate.id === 'reativacao-cliente');
    expect(template).toBeDefined();
    if (!template) return;

    const message = template.definition.fields.find((field) => field.id === 'message');
    expect(template.description).not.toMatch(/compra/i);
    expect(message?.placeholder).not.toMatch(/compra|novidades/i);
    expect(template.definition.card.action?.label).toBe('Saiba mais');
  });

  it('usa termos que também servem para empresas de serviço no modelo compartilhado', () => {
    const template = officialCatalog.find((candidate) => candidate.id === 'boas-vindas');
    expect(template?.definition.card.action?.label).toBe('Falar com a empresa');
  });

  it('mantém campos de produto e imagem nos modelos próprios para produtos', () => {
    const productTemplates = officialCatalog.filter((template) => template.definition.catalog.segment === 'product');
    expect(productTemplates.map((template) => template.id)).toEqual([
      'agradecimento-compra',
      'produto-destaque',
      'novidades-colecao',
    ]);

    for (const template of productTemplates) {
      const fields = new Set(template.definition.fields.map((field) => field.id));
      expect(fields).toContain('businessLogo');
      expect(fields).toContain('productImage');
    }
  });

  it('vincula cada resposta de aprovação ao seu próprio link externo', () => {
    const template = officialCatalog.find((candidate) => candidate.id === 'lembrete-aprovacao');
    expect(template).toBeDefined();
    if (!template) return;

    expect(template?.definition.card.actions).toEqual([
      { label: 'Sim, quero', hrefFieldId: 'approveLink' },
      { label: 'Agora não', hrefFieldId: 'rejectLink' },
    ]);

    for (const fieldId of ['approveLink', 'rejectLink']) {
      expect(template.definition.fields.find((field) => field.id === fieldId)?.required).toBe(true);
    }

    const validInput = {
      recipientName: 'Maria',
      businessName: 'Oficina Exemplo',
      message: 'Precisamos da sua aprovação antes de seguir.',
      serviceName: 'Manutenção de equipamento',
      approvalDetails: 'Aprovar a troca da peça.',
      approveLink: 'https://example.com/aprovar',
      rejectLink: 'https://example.com/recusar',
    };
    expect(() => validateTemplateInput(template.definition as unknown as JsonObject, validInput)).not.toThrow();

    const missingLinks: Record<string, string> = { ...validInput };
    delete missingLinks.approveLink;
    delete missingLinks.rejectLink;
    expect(() => validateTemplateInput(template.definition as unknown as JsonObject, missingLinks)).toThrow();
  });

  it('mantém os dados opcionais de parcela separados na confirmação de pagamento', () => {
    const template = officialCatalog.find((candidate) => candidate.id === 'pagamento-confirmado');
    expect(template?.definition.card.details?.slice(2)).toEqual([
      { label: 'Número da parcela', value: '{{installmentNumber}}', icon: 'check' },
      { label: 'Total de parcelas', value: '{{installmentTotal}}', icon: 'check' },
    ]);
  });

  it('mantém os dados específicos de parcelas, Pix e ofertas ligados aos cartões', () => {
    const fieldsFor = (id: string) => {
      const template = officialCatalog.find((candidate) => candidate.id === id);
      return new Set(template?.definition.fields.map((field) => field.id));
    };

    for (const id of ['parcela-proxima', 'parcela-hoje', 'parcela-atrasada']) {
      const fields = fieldsFor(id);
      expect(fields).toContain('installmentAmount');
      expect(fields).toContain('dueDate');
      expect(fields).toContain('installmentNumber');
      expect(fields).toContain('installmentTotal');
      expect(fields).toContain('paymentLink');
    }

    expect(fieldsFor('cobranca-pix').has('pixCopyPaste')).toBe(true);
    expect(fieldsFor('cobranca-pix').has('pixQrImage')).toBe(true);
    expect(fieldsFor('oferta-especial').has('offerName')).toBe(true);
    expect(fieldsFor('oferta-especial').has('oldPrice')).toBe(true);
    expect(fieldsFor('oferta-especial').has('newPrice')).toBe(true);
    expect(fieldsFor('oferta-especial').has('validUntil')).toBe(true);
  });
});
