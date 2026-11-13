import { randomBytes, randomUUID } from 'node:crypto';

import { DraftNotFoundError, PublicationAccessDeniedError } from '../errors.js';
import type { DraftRepository } from '../ports/draft-repository.js';
import type { PngRenderer } from '../ports/png-renderer.js';
import type { PublicationRepository } from '../ports/publication-repository.js';
import type { PurchaseRepository } from '../ports/purchase-repository.js';
import type { TemplateRepository } from '../ports/template-repository.js';
import type { Draft } from '../../domain/drafts/draft.js';
import type { Publication } from '../../domain/publication/publication.js';
import type { Template } from '../../domain/templates/template.js';
import { TemplateFinancialStateError } from '../../domain/templates/errors.js';
import { assertTemplateFinancialState } from '../../domain/templates/financial-state.js';

export type PublicationDependencies = {
  drafts: DraftRepository;
  publications: PublicationRepository;
  purchases: PurchaseRepository;
  templates: TemplateRepository;
  renderer: PngRenderer;
  hasActivePlatformAccess?: (userId: string, now: Date) => boolean;
  generateId?: () => string;
  generateSlug?: () => string;
  clock?: () => Date;
};

export function publishMessage(
  input: { draftId: string; userId: string },
  dependencies: PublicationDependencies,
): Publication {
  const draft = requireOwnedDraft(input, dependencies.drafts);
  const now = dependencies.clock?.() ?? new Date();
  if (!hasPublicationAccess(input.userId, draft.id, now, dependencies)) {
    throw new PublicationAccessDeniedError();
  }
  const template = dependencies.templates.findByIdAndVersion(draft.templateId, draft.templateVersion);
  if (!template) throw new DraftNotFoundError();
  assertTemplateFinancialState(template.definition, draft.data, template.id, now);
  const publication = dependencies.publications.publish({
    id: (dependencies.generateId ?? randomUUID)(),
    draftId: draft.id,
    ownerUserId: input.userId,
    slug: (dependencies.generateSlug ?? generateSlug)(),
    now,
  });
  if (!publication) {
    throw new DraftNotFoundError();
  }
  return publication;
}

export function unpublishMessage(
  input: { draftId: string; userId: string },
  dependencies: PublicationDependencies,
): void {
  const draft = requireOwnedDraft(input, dependencies.drafts);
  dependencies.publications.unpublish(draft.id, input.userId, dependencies.clock?.() ?? new Date());
}

export function getPublicMessage(
  input: { slug: string },
  dependencies: PublicationDependencies,
): {
  templateId: string;
  templateVersion: number;
  templateName: string;
  templateDescription: string | null;
  templateDefinition: Template['definition'];
  data: Draft['data'];
  publishedAt: Date;
} | undefined {
  const now = dependencies.clock?.() ?? new Date();
  const publication = dependencies.publications.findPublishedBySlug(input.slug);
  if (!publication || (
    !dependencies.purchases.hasActiveGrantForDraft(publication.draftId, now)
    && !hasActivePlatformAccess(publication.ownerUserId, now, dependencies)
  )) {
    return undefined;
  }

  const draft = dependencies.drafts.findById(publication.draftId);
  if (!draft) {
    return undefined;
  }
  const template = dependencies.templates.findByIdAndVersion(draft.templateId, draft.templateVersion);
  if (!template) {
    return undefined;
  }
  try {
    assertTemplateFinancialState(template.definition, draft.data, template.id, now);
  } catch (error) {
    if (error instanceof TemplateFinancialStateError) return undefined;
    throw error;
  }
  return {
    templateId: draft.templateId,
    templateVersion: draft.templateVersion,
    templateName: template.name,
    templateDescription: template.description,
    templateDefinition: template.definition,
    data: draft.data,
    publishedAt: publication.publishedAt,
  };
}

export async function renderPublicMessagePng(
  input: { slug: string },
  dependencies: PublicationDependencies,
): Promise<Buffer | undefined> {
  const now = dependencies.clock?.() ?? new Date();
  const publication = dependencies.publications.findPublishedBySlug(input.slug);
  if (!publication || (
    !dependencies.purchases.hasActiveGrantForDraft(publication.draftId, now)
    && !hasActivePlatformAccess(publication.ownerUserId, now, dependencies)
  )) {
    return undefined;
  }
  const draft = dependencies.drafts.findById(publication.draftId);
  if (!draft) {
    return undefined;
  }
  const template = dependencies.templates.findByIdAndVersion(draft.templateId, draft.templateVersion);
  if (!template) {
    return undefined;
  }
  try {
    assertTemplateFinancialState(template.definition, draft.data, template.id, now);
  } catch (error) {
    if (error instanceof TemplateFinancialStateError) return undefined;
    throw error;
  }
  return dependencies.renderer.render(template, draft.data);
}

export async function exportMessage(
  input: { draftId: string; userId: string },
  dependencies: PublicationDependencies,
): Promise<Buffer> {
  const draft = requireOwnedDraft(input, dependencies.drafts);
  const now = dependencies.clock?.() ?? new Date();
  if (!hasPublicationAccess(input.userId, draft.id, now, dependencies)) {
    throw new PublicationAccessDeniedError();
  }
  const template = dependencies.templates.findByIdAndVersion(draft.templateId, draft.templateVersion);
  if (!template) {
    throw new DraftNotFoundError();
  }
  assertTemplateFinancialState(template.definition, draft.data, template.id, now);
  return dependencies.renderer.render(template as Template, draft.data);
}

function hasPublicationAccess(
  userId: string,
  draftId: string,
  now: Date,
  dependencies: PublicationDependencies,
): boolean {
  return dependencies.purchases.hasActiveGrantForUserAndDraft(userId, draftId, now)
    || hasActivePlatformAccess(userId, now, dependencies);
}

function hasActivePlatformAccess(userId: string, now: Date, dependencies: PublicationDependencies): boolean {
  return dependencies.hasActivePlatformAccess?.(userId, now) ?? false;
}

function requireOwnedDraft(
  input: { draftId: string; userId: string },
  drafts: DraftRepository,
): Draft {
  const draft = drafts.findByIdForUser(input.draftId, input.userId);
  if (!draft) {
    throw new DraftNotFoundError();
  }
  return draft;
}

function generateSlug(): string {
  return randomBytes(32).toString('base64url');
}
