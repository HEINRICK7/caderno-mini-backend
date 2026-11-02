import { TemplateNotFoundError } from '../errors.js';
import type { TemplateRepository } from '../ports/template-repository.js';
import type { JsonObject } from '../../domain/shared/json-value.js';
import { validateTemplateInput } from '../../domain/templates/validate-template-input.js';

export function validateActiveTemplateInput(
  input: { templateId: string; data: JsonObject },
  dependencies: { templates: TemplateRepository },
): { valid: true } {
  const template = dependencies.templates.findActiveById(input.templateId);
  if (!template) {
    throw new TemplateNotFoundError();
  }
  validateTemplateInput(template.definition, input.data);
  return { valid: true };
}
