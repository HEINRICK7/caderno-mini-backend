import type { Template } from '../../domain/templates/template.js';

export interface TemplateRepository {
  findActive(): Template[];
  findActiveById(id: string): Template | undefined;
}
