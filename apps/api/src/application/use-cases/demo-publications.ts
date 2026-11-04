import { randomBytes } from 'node:crypto';

import { DemoPublicationNotFoundError, DraftNotFoundError, TrialCategoryUnavailableError } from '../errors.js';
import type { DemoPublicationRepository } from '../ports/demo-publication-repository.js';
import type { DraftRepository } from '../ports/draft-repository.js';
import type { TemplateRepository } from '../ports/template-repository.js';
import { resolveTemplateCatalog } from '../../domain/templates/template-catalog.js';
import { assertTemplateFinancialState } from '../../domain/templates/financial-state.js';
import { validateTemplateInput } from '../../domain/templates/validate-template-input.js';

const DEMO_PUBLICATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1_000;

export function createDemoPublication(
  input: { draftId: string; visitorHash: string; userId?: string },
  dependencies: {
    demos: DemoPublicationRepository;
    drafts: DraftRepository;
    templates: TemplateRepository;
    generateSlug?: () => string;
    clock?: () => Date;
  },
) {
  const draft = dependencies.drafts.findByIdForUser(input.draftId, input.userId);
  if (!draft) throw new DraftNotFoundError();

  const template = dependencies.templates.findByIdAndVersion(draft.templateId, draft.templateVersion);
  if (!template) throw new DraftNotFoundError();
  const catalog = resolveTemplateCatalog(template.definition);
  if (!catalog?.homeCategory) throw new TrialCategoryUnavailableError();

  validateTemplateInput(template.definition, draft.data);
  const now = dependencies.clock?.() ?? new Date();
  assertTemplateFinancialState(template.definition, draft.data, template.id, now);

  const createdAt = now;
  const expiresAt = new Date(now.getTime() + DEMO_PUBLICATION_LIFETIME_MS);
  const result = dependencies.demos.refreshOrCreateByCategory({
    slug: (dependencies.generateSlug ?? generateSlug)(),
    visitorHash: input.visitorHash,
    category: catalog.homeCategory,
    draftId: draft.id,
    templateId: template.id,
    templateVersion: template.version,
    templateName: template.name,
    templateDescription: template.description,
    templateDefinition: template.definition,
    data: draft.data,
    createdAt,
    expiresAt,
  }, now);

  return { ...result.publication, created: result.created };
}

export function getDemoPublication(
  input: { slug: string },
  dependencies: { demos: DemoPublicationRepository; clock?: () => Date },
) {
  const now = dependencies.clock?.() ?? new Date();
  const publication = dependencies.demos.findActiveBySlug(input.slug, now);
  if (!publication) throw new DemoPublicationNotFoundError();
  assertTemplateFinancialState(
    publication.templateDefinition,
    publication.data,
    publication.templateId,
    now,
  );
  return publication;
}

function generateSlug(): string {
  return randomBytes(32).toString('base64url');
}
