import type { JsonObject } from '../../domain/shared/json-value.js';
import type { Template } from '../../domain/templates/template.js';

export interface PngRenderer {
  render(template: Template, data: JsonObject): Promise<Buffer>;
  renderPreview(template: Template, data: JsonObject): Promise<Buffer>;
}
