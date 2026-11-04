import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { assertTemplateFinancialState } from '../../src/domain/templates/financial-state.js';
import { TemplateFinancialStateError } from '../../src/domain/templates/errors.js';
import { validateTemplateDefinition, validateTemplateInput } from '../../src/domain/templates/validate-template-input.js';
import type { JsonObject } from '../../src/domain/shared/json-value.js';
import { createDatabase } from '../../src/infrastructure/database/connection.js';
import { migrateDatabase } from '../../src/infrastructure/database/migrate.js';
import { seedTemplateCatalog } from '../../src/infrastructure/database/template-catalog-seeder.js';
import type { AppDatabase } from '../../src/infrastructure/database/connection.js';
import type { Database } from 'better-sqlite3';

type CatalogTemplate = {
  id: string;
  version: number;
  description: string;
  definition: {
    catalog: { segment: 'product' | 'service' | 'both' };
    exampleData?: Record<string, unknown>;
    fields: Array<{
      id: string;
      type: string;
      label?: string;
      placeholder?: string;
      required?: boolean;
      editable?: boolean;
      section?: string;
      options?: string[];
    }>;
    card: {
      heading: string;
      highlightedText?: string;
      subtitle?: string;
      pixNoteFieldId?: string;
      message?: string;
      variables?: Record<string, string>;
      details?: Array<{ value: string; labelFieldId?: string; imageFieldId?: string; icon?: string }>;
      product?: {
        nameFieldId?: string;
        descriptionFieldId?: string;
        imageFieldId?: string;
        galleryFieldIds?: string[];
        priceFieldId?: string;
        originalPriceFieldId?: string;
      };
      financial?: { stateFieldId: string; expectedState: 'confirmed' | 'settled'; balanceFieldId?: string };
      brand?: { businessNameFieldId?: string; logoFieldId?: string };
      action?: { label?: string; labelFieldId?: string; hrefFieldId?: string; copyFieldId?: string };
      actions?: Array<{ label?: string; labelFieldId?: string; hrefFieldId?: string; copyFieldId?: string }>;
      socialLinks?: Array<{ platform: string; hrefFieldId: string }>;
    };
  };
};

const officialCatalogPath = resolve(process.cwd(), 'catalog/templates.json');
const officialCatalog = JSON.parse(readFileSync(officialCatalogPath, 'utf8')) as CatalogTemplate[];
const approvedTemplateIds = [
  'boas-vindas',
  'agradecimento-compra',
  'parcela-proxima',
  'parcela-hoje',
  'parcela-atrasada',
  'cobranca-pix',
  'pagamento-confirmado',
  'caderneta-quitada',
  'servico-contratado',
  'servico-concluido',
  'aniversario',
  'produto-destaque',
  'oferta-especial',
  'novidades-colecao',
  'reativacao-cliente',
  'lembrete-aprovacao',
];

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

  it('mantém os 16 layouts válidos e os exemplos do PNG separados dos slots visuais', () => {
    expect(officialCatalog.map((template) => template.id)).toEqual(approvedTemplateIds);
    expect(() => seedTemplateCatalog(database, officialCatalog)).not.toThrow();

    for (const template of officialCatalog) {
      expect(() => validateTemplateDefinition(template.definition as unknown as JsonObject), template.id).not.toThrow();
      expect(template.definition.fields.some((field) => field.id === 'title' && field.required)).toBe(true);
      expect(template.definition.fields.some((field) => field.id === 'businessLogo')).toBe(true);
      expect(template.definition.fields.every((field) => field.editable !== false || field.required !== true)).toBe(true);
      expect(template.definition.exampleData, template.id).toBeDefined();
      expect(JSON.stringify(template.definition.card), template.id).not.toMatch(/Maria|Conjunto de mesa|Pagar agora/i);
      expect(Object.keys(template.definition.exampleData ?? {}).every((fieldId) =>
        template.definition.fields.some((field) => field.id === fieldId)), template.id).toBe(true);
    }
  });

  it('publica versões novas para as mudanças no contrato de edição', () => {
    for (const id of ['parcela-proxima', 'parcela-hoje', 'parcela-atrasada', 'cobranca-pix']) {
      expect(officialCatalog.find((template) => template.id === id)?.version).toBe(8);
    }
    expect(officialCatalog.find((template) => template.id === 'boas-vindas')?.version).toBe(8);
    expect(officialCatalog.find((template) => template.id === 'pagamento-confirmado')?.version).toBe(8);
    expect(officialCatalog.find((template) => template.id === 'lembrete-aprovacao')?.version).toBe(9);
  });

  it('mantém cada seção de edição em um único bloco e conecta todos os campos ao cartão', () => {
    for (const template of officialCatalog) {
      const seen = new Set<string>();
      let previousSection: string | undefined;
      const repeatedSections: string[] = [];
      for (const field of template.definition.fields) {
        if (!field.section) {
          previousSection = undefined;
          continue;
        }
        if (field.section !== previousSection && seen.has(field.section)) repeatedSections.push(field.section);
        seen.add(field.section);
        previousSection = field.section;
      }
      expect(repeatedSections, template.id).toEqual([]);

      const { card } = template.definition;
      const text = [card.heading, card.highlightedText ?? '', card.subtitle ?? '', card.message ?? '', ...(card.details ?? []).map((detail) => detail.value)].join(' ');
      const references = new Set([...text.matchAll(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g)].map((match) => match[1]));
      for (const detail of card.details ?? []) {
        if (detail.labelFieldId) references.add(detail.labelFieldId);
        if (detail.imageFieldId) references.add(detail.imageFieldId);
      }
      for (const fieldId of Object.values(card.variables ?? {})) references.add(fieldId);
      if (card.brand?.businessNameFieldId) references.add(card.brand.businessNameFieldId);
      if (card.brand?.logoFieldId) references.add(card.brand.logoFieldId);
      if (card.pixNoteFieldId) references.add(card.pixNoteFieldId);
      for (const socialLink of card.socialLinks ?? []) references.add(socialLink.hrefFieldId);
      if (card.product) {
        for (const [key, fieldId] of Object.entries(card.product)) {
          if (key === 'icon') continue;
          if (Array.isArray(fieldId)) fieldId.forEach((entry) => references.add(entry));
          else if (typeof fieldId === 'string') references.add(fieldId);
        }
      }
      if (card.financial) {
        references.add(card.financial.stateFieldId);
        if (card.financial.balanceFieldId) references.add(card.financial.balanceFieldId);
      }
      const actions = [...(card.action ? [card.action] : []), ...(card.actions ?? [])];
      for (const action of actions) {
        if (action.labelFieldId) references.add(action.labelFieldId);
        if (action.hrefFieldId) references.add(action.hrefFieldId);
        if (action.copyFieldId) references.add(action.copyFieldId);
      }
      expect([...references].sort(), template.id).toEqual(template.definition.fields.map((field) => field.id).sort());
    }
  });

  it('valida conteúdo personalizado diferente dos exemplos em cada formulário', () => {
    for (const template of officialCatalog) {
      const data: JsonObject = {};
      for (const field of template.definition.fields) {
        if (field.editable === false) continue;
        if (field.id === 'pixCopyPaste') data[field.id] = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D';
        else if (field.id === 'oldPrice') data[field.id] = 130;
        else if (field.id === 'newPrice') data[field.id] = 87.5;
        else if (field.type === 'text' || field.type === 'textarea') data[field.id] = `Conteúdo personalizado para ${field.id}`;
        else if (field.type === 'number') data[field.id] = 42;
        else if (field.type === 'date') data[field.id] = '2027-02-19';
        else if (field.id === 'instagramUrl') data[field.id] = 'https://instagram.com/example-shop';
        else if (field.id === 'whatsappUrl') data[field.id] = 'https://wa.me/5511999999999';
        else if (field.id === 'facebookUrl') data[field.id] = 'https://facebook.com/example.shop';
        else if (field.id === 'tiktokUrl') data[field.id] = 'https://tiktok.com/@example-shop';
        else if (field.id === 'youtubeUrl') data[field.id] = 'https://youtube.com/@example-shop';
        else if (field.type === 'url') data[field.id] = `https://cliente.example/${field.id}`;
        else if (field.type === 'image') data[field.id] = '7b7d828b-f189-496a-b59b-9fae6a9b8531';
        else if (field.type === 'select') data[field.id] = field.options?.[0] ?? '';
        else if (field.type === 'boolean') data[field.id] = true;
      }
      expect(() => validateTemplateInput(template.definition as unknown as JsonObject, data), template.id).not.toThrow();
      expect(data.title).toBe(`Conteúdo personalizado para title`);
    }
  });

  it('oferece campos de produto e serviço adequados ao segmento', () => {
    const serviceTemplates = officialCatalog.filter((template) => template.definition.catalog.segment === 'service');
    expect(serviceTemplates.map((template) => template.id)).toEqual([
      'servico-contratado',
      'servico-concluido',
      'lembrete-aprovacao',
    ]);
    for (const template of serviceTemplates) {
      const fields = new Set(template.definition.fields.map((field) => field.id));
      expect(fields).toContain('serviceName');
      expect(fields).not.toContain('productName');
    }

    const productTemplates = officialCatalog.filter((template) => template.definition.catalog.segment === 'product');
    expect(productTemplates.map((template) => template.id)).toEqual([
      'agradecimento-compra',
      'produto-destaque',
      'novidades-colecao',
    ]);
    for (const template of productTemplates) {
      expect(template.definition.fields.some((field) => field.id === 'productName' || field.id === 'offerName' || field.id.startsWith('collectionImage'))).toBe(true);
      expect(template.definition.fields.some((field) => field.type === 'image')).toBe(true);
    }
  });

  it('preserva a ordem visual dos subtítulos e os estilos de cada bloco', () => {
    const dueSoon = requireTemplate('parcela-proxima').definition.card;
    expect(dueSoon?.subtitlePlacement).toBe('before-highlight');
    expect(dueSoon?.subtitleStyle).toBe('subheading');
    expect(requireTemplate('cobranca-pix').definition.card.subtitlePlacement).toBe('after-highlight');

    expect(requireTemplate('produto-destaque').definition.card.product?.icon).toBe('cake');
    expect(requireTemplate('oferta-especial').definition.card.product?.icon).toBe('calendar');
    expect(requireTemplate('parcela-hoje').definition.card.details?.[0].statusBadge).toBe('HOJE');
    expect(requireTemplate('servico-contratado').definition.card.details?.map((detail) => detail.value)).toEqual([
      '{{serviceName}}',
      '{{servicePrice}}',
      '{{scheduledAt}}',
    ]);
    expect(requireTemplate('lembrete-aprovacao').definition.card.details?.every((detail) => detail.valueStyle === 'supporting')).toBe(true);
  });

  it('exige as duas opções editáveis e destinos independentes no modelo de aprovação', () => {
    const template = requireTemplate('lembrete-aprovacao');
    expect(template.definition.card.actions?.map((action) => [action.labelFieldId, action.hrefFieldId])).toEqual([
      ['primaryActionLabel', 'approveLink'],
      ['secondaryActionLabel', 'rejectLink'],
    ]);
    for (const id of ['approveLink', 'rejectLink', 'primaryActionLabel', 'secondaryActionLabel']) {
      expect(template.definition.fields.find((field) => field.id === id)?.required).toBe(true);
    }

    const validInput = personalizedInput(template);
    expect(() => validateTemplateInput(template.definition as unknown as JsonObject, validInput)).not.toThrow();
    for (const id of ['approveLink', 'rejectLink', 'primaryActionLabel', 'secondaryActionLabel']) {
      const missing = { ...validInput };
      delete missing[id];
      expect(() => validateTemplateInput(template.definition as unknown as JsonObject, missing)).toThrow();
    }
  });

  it('valida o Pix copia e cola da cobrança Pix sem inserir código demonstrativo', () => {
    const template = requireTemplate('cobranca-pix');
    const pixField = template.definition.fields.find((field) => field.id === 'pixCopyPaste');
    expect(pixField?.editable).not.toBe(false);
    expect(pixField?.required).toBe(false);
    expect(template.definition.fields.some((field) => field.id === 'pixQrImage')).toBe(false);

    const officialPixPayload = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D';
    expect(() => validateTemplateInput(template.definition as unknown as JsonObject, { title: 'Cobrança', pixCopyPaste: officialPixPayload })).not.toThrow();
    expect(() => validateTemplateInput(template.definition as unknown as JsonObject, { title: 'Cobrança' })).not.toThrow();
    expect(() => validateTemplateInput(template.definition as unknown as JsonObject, { title: 'Cobrança', pixCopyPaste: `${officialPixPayload.slice(0, -1)}0` })).toThrow();
    expect(() => validateTemplateInput(template.definition as unknown as JsonObject, { title: 'Cobrança', pixCopyPaste: ` ${officialPixPayload}` })).toThrow();

    expect(template.definition.card?.pixNoteFieldId).toBe('pixSecurityNote');
    expect(template.definition.fields.find((field) => field.id === 'pixSecurityNote')?.editable).not.toBe(false);
    expect(template.definition.card.action?.copyFieldId).toBe('pixCopyPaste');
  });

  it('oferece Pix opcional nas três cobranças de parcela e liga o campo ao botão de cópia', () => {
    for (const id of ['parcela-proxima', 'parcela-hoje', 'parcela-atrasada']) {
      const template = requireTemplate(id);
      const pixField = template.definition.fields.find((field) => field.id === 'pixCopyPaste');
      expect(pixField?.type).toBe('textarea');
      expect(pixField?.required).toBe(false);
      expect(template.definition.card.details?.some((detail) => detail.icon === 'qrcode')).toBe(true);
      expect(template.definition.card.actions?.some((action) => action.copyFieldId === 'pixCopyPaste')).toBe(true);
    }
  });

  it('inclui cinco canais sociais opcionais em todos os modelos', () => {
    const expected = ['instagramUrl', 'whatsappUrl', 'facebookUrl', 'tiktokUrl', 'youtubeUrl'];
    for (const template of officialCatalog) {
      expect(template.definition.card.socialLinks?.map((link) => link.hrefFieldId).sort()).toEqual([...expected].sort());
      for (const id of expected) {
        const field = template.definition.fields.find((candidate) => candidate.id === id);
        expect(field?.type, `${template.id}.${id}`).toBe('url');
        expect(field?.required, `${template.id}.${id}`).toBe(false);
        expect(template.definition.exampleData?.[id], `${template.id}.${id}`).toBeUndefined();
      }
    }

    const template = requireTemplate('boas-vindas');
    const validInput = personalizedInput(template);
    expect(() => validateTemplateInput(template.definition as unknown as JsonObject, validInput)).not.toThrow();
    expect(() => validateTemplateInput(template.definition as unknown as JsonObject, {
      ...validInput,
      instagramUrl: 'https://instagram.com.evil.example/loja',
    })).toThrow();
  });

  it('protege estado pago e saldo quitado no domínio financeiro', () => {
    const payment = requireTemplate('pagamento-confirmado');
    const paymentData = { paymentStatus: 'confirmed' } as JsonObject;
    expect(() => assertTemplateFinancialState(payment.definition as unknown as JsonObject, paymentData)).not.toThrow();
    expect(() => assertTemplateFinancialState(payment.definition as unknown as JsonObject, {})).toThrow(TemplateFinancialStateError);
    expect(() => assertTemplateFinancialState(payment.definition as unknown as JsonObject, { paymentStatus: 'pending' })).toThrow(TemplateFinancialStateError);
    expect(() => validateTemplateInput(payment.definition as unknown as JsonObject, { title: 'Pagamento recebido', paymentStatus: 'confirmed' })).toThrow();

    const settled = requireTemplate('caderneta-quitada');
    const settledData = { settlementStatus: 'settled', outstandingBalance: 0 } as JsonObject;
    expect(() => assertTemplateFinancialState(settled.definition as unknown as JsonObject, settledData)).not.toThrow();
    expect(() => assertTemplateFinancialState(settled.definition as unknown as JsonObject, { settlementStatus: 'open', outstandingBalance: 0 })).toThrow(TemplateFinancialStateError);
    expect(() => assertTemplateFinancialState(settled.definition as unknown as JsonObject, { settlementStatus: 'settled', outstandingBalance: 0.01 })).toThrow(TemplateFinancialStateError);
    expect(() => validateTemplateInput(settled.definition as unknown as JsonObject, { title: 'Quitado', settlementStatus: 'settled', outstandingBalance: 0 })).toThrow();
  });

  it('bloqueia versões antigas de templates financeiros sem estado verificável', () => {
    const payment = requireTemplate('pagamento-confirmado');
    const legacyPaymentDefinition = structuredClone(payment.definition) as unknown as JsonObject;
    delete (legacyPaymentDefinition.card as Record<string, unknown>).financial;
    expect(() => assertTemplateFinancialState(legacyPaymentDefinition, {}, payment.id))
      .toThrow(TemplateFinancialStateError);

    const settled = requireTemplate('caderneta-quitada');
    const legacySettledDefinition = structuredClone(settled.definition) as unknown as JsonObject;
    delete (legacySettledDefinition.card as Record<string, unknown>).financial;
    expect(() => assertTemplateFinancialState(legacySettledDefinition, {}, settled.id))
      .toThrow(TemplateFinancialStateError);

    const unrelatedDefinition = structuredClone(payment.definition) as unknown as JsonObject;
    delete (unrelatedDefinition.card as Record<string, unknown>).financial;
    expect(() => assertTemplateFinancialState(unrelatedDefinition, {}, 'agradecimento-compra')).not.toThrow();
  });

  it('confere o vencimento com o tipo de lembrete antes de publicar/exportar', () => {
    const dueToday = requireTemplate('parcela-hoje');
    const tomorrow = requireTemplate('parcela-proxima');
    const overdue = requireTemplate('parcela-atrasada');
    const now = new Date('2026-12-04T15:00:00.000Z');

    expect(() => assertTemplateFinancialState(dueToday.definition as unknown as JsonObject, { dueDate: '2026-12-04' }, dueToday.id, now)).not.toThrow();
    expect(() => assertTemplateFinancialState(dueToday.definition as unknown as JsonObject, { dueDate: '2026-12-05' }, dueToday.id, now)).toThrow(TemplateFinancialStateError);
    expect(() => assertTemplateFinancialState(tomorrow.definition as unknown as JsonObject, { dueDate: '2026-12-05' }, tomorrow.id, now)).not.toThrow();
    expect(() => assertTemplateFinancialState(tomorrow.definition as unknown as JsonObject, { dueDate: '2026-12-04' }, tomorrow.id, now)).toThrow(TemplateFinancialStateError);
    expect(() => assertTemplateFinancialState(overdue.definition as unknown as JsonObject, { dueDate: '2026-12-03' }, overdue.id, now)).not.toThrow();
    expect(() => assertTemplateFinancialState(overdue.definition as unknown as JsonObject, { dueDate: '2026-12-04' }, overdue.id, now)).toThrow(TemplateFinancialStateError);
  });

  it('valida preço promocional como um par coerente', () => {
    const template = requireTemplate('oferta-especial');
    const base = { title: 'Oferta personalizada' };
    expect(() => validateTemplateInput(template.definition as unknown as JsonObject, { ...base, oldPrice: 130, newPrice: 87.5 })).not.toThrow();
    expect(() => validateTemplateInput(template.definition as unknown as JsonObject, { ...base, oldPrice: 130 })).toThrow();
    expect(() => validateTemplateInput(template.definition as unknown as JsonObject, { ...base, oldPrice: 130, newPrice: 130 })).toThrow();
    expect(() => validateTemplateInput(template.definition as unknown as JsonObject, { ...base, oldPrice: 130, newPrice: 140 })).toThrow();
  });
});

function requireTemplate(id: string): CatalogTemplate {
  const template = officialCatalog.find((candidate) => candidate.id === id);
  if (!template) throw new Error(`O modelo ${id} precisa existir no catálogo.`);
  return template;
}

function personalizedInput(template: CatalogTemplate): JsonObject {
  const data: JsonObject = {};
  const socialUrls: Record<string, string> = {
    instagramUrl: 'https://instagram.com/example-shop',
    whatsappUrl: 'https://wa.me/5511999999999',
    facebookUrl: 'https://facebook.com/example.shop',
    tiktokUrl: 'https://tiktok.com/@example-shop',
    youtubeUrl: 'https://youtube.com/@example-shop',
  };
  for (const field of template.definition.fields) {
    if (field.editable === false) continue;
    if (field.id === 'pixCopyPaste') data[field.id] = '00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D';
    else if (socialUrls[field.id]) data[field.id] = socialUrls[field.id];
    else if (field.id === 'oldPrice') data[field.id] = 130;
    else if (field.id === 'newPrice') data[field.id] = 87.5;
    else if (field.type === 'text' || field.type === 'textarea') data[field.id] = `Conteúdo personalizado para ${field.id}`;
    else if (field.type === 'number') data[field.id] = 42;
    else if (field.type === 'date') data[field.id] = '2027-02-19';
    else if (field.type === 'url') data[field.id] = `https://cliente.example/${field.id}`;
    else if (field.type === 'image') data[field.id] = '7b7d828b-f189-496a-b59b-9fae6a9b8531';
    else if (field.type === 'select') data[field.id] = field.options?.[0] ?? '';
    else if (field.type === 'boolean') data[field.id] = true;
  }
  return data;
}
