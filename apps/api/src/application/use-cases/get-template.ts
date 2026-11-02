import { TemplateNotFoundError } from '../errors.js';
import type { TemplateRepository } from '../ports/template-repository.js';
import type { Template } from '../../domain/templates/template.js';

export function getTemplate(input: { id: string }, dependencies: { templates: TemplateRepository }): Template {
  const template = dependencies.templates.findActiveById(input.id);
  if (!template) {
    throw new TemplateNotFoundError();
  }
  return template;
}
