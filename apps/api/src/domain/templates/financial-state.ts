import type { JsonObject } from '../shared/json-value.js';
import { TemplateFinancialStateError } from './errors.js';
import { resolveTemplateCard } from './template-card.js';

const FINANCIAL_TEMPLATES_REQUIRE_RULE = new Set(['pagamento-confirmado', 'caderneta-quitada']);
const DUE_DATE_RULES: Record<string, 'future' | 'today' | 'past'> = {
  'parcela-proxima': 'future',
  'parcela-hoje': 'today',
  'parcela-atrasada': 'past',
};

export function assertTemplateFinancialState(
  definition: JsonObject,
  data: JsonObject,
  templateId?: string,
  now: Date = new Date(),
): void {
  assertDueDateState(templateId, data, now);
  const rule = resolveTemplateCard(definition)?.financial;
  if (!rule) {
    // Older catalog versions predate domain-backed settlement fields. They cannot
    // prove that a payment cleared, so fail closed instead of trusting their copy.
    if (templateId && FINANCIAL_TEMPLATES_REQUIRE_RULE.has(templateId)) {
      throw new TemplateFinancialStateError();
    }
    return;
  }

  if (data[rule.stateFieldId] !== rule.expectedState) throw new TemplateFinancialStateError();
  if (rule.balanceFieldId && data[rule.balanceFieldId] !== 0) throw new TemplateFinancialStateError();
}

function assertDueDateState(templateId: string | undefined, data: JsonObject, now: Date): void {
  const expected = templateId ? DUE_DATE_RULES[templateId] : undefined;
  if (!expected) return;

  const dueDate = data.dueDate;
  if (typeof dueDate !== 'string' || !isIsoDate(dueDate)) throw new TemplateFinancialStateError();
  const today = brazilianBusinessDate(now);
  if (
    (expected === 'future' && dueDate <= today) ||
    (expected === 'today' && dueDate !== today) ||
    (expected === 'past' && dueDate >= today)
  ) {
    throw new TemplateFinancialStateError();
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function brazilianBusinessDate(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
