import { DraftNotFoundError } from '../errors.js';
import type { DraftRepository } from '../ports/draft-repository.js';
import type { PngRenderer } from '../ports/png-renderer.js';
import type { TemplateRepository } from '../ports/template-repository.js';

export type PreviewDraftDependencies = {
  drafts: DraftRepository;
  templates: TemplateRepository;
  renderer: PngRenderer;
};

export async function previewDraft(
  input: { draftId: string; userId?: string },
  dependencies: PreviewDraftDependencies,
): Promise<Buffer> {
  const draft = dependencies.drafts.findByIdForUser(input.draftId, input.userId);
  if (!draft) {
    throw new DraftNotFoundError();
  }

  const template = dependencies.templates.findByIdAndVersion(draft.templateId, draft.templateVersion);
  if (!template) {
    throw new DraftNotFoundError();
  }

  return dependencies.renderer.renderPreview(template, draft.data);
}
