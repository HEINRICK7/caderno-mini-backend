import type { Template } from '../../domain/templates/template.js';
import type { TemplateRepository } from '../ports/template-repository.js';

export function listTemplates(dependencies: { templates: TemplateRepository }): Template[] {
  return dependencies.templates.findActive();
}
