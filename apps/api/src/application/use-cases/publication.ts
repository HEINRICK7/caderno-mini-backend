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

export type PublicationDependencies = {
  drafts: DraftRepository;
  publications: PublicationRepository;
  purchases: PurchaseRepository;
  templates: TemplateRepository;
  renderer: PngRenderer;
  generateId?: () => string;
  generateSlug?: () => string;
  clock?: () => Date;
};

export function publishMessage(
  input: { draftId: string; userId: string },
  dependencies: PublicationDependencies,
): Publication {
  const draft = requireOwnedDraft(input, dependencies.drafts);
  if (!dependencies.purchases.hasActiveGrantForUserAndDraft(input.userId, draft.id)) {
    throw new PublicationAccessDeniedError();
  }

  const now = dependencies.clock?.() ?? new Date();
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
  const publication = dependencies.publications.findPublishedBySlug(input.slug);
  if (!publication || !dependencies.purchases.hasActiveGrantForDraft(publication.draftId)) {
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
  const publication = dependencies.publications.findPublishedBySlug(input.slug);
  if (!publication || !dependencies.purchases.hasActiveGrantForDraft(publication.draftId)) {
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
  return dependencies.renderer.render(template, draft.data);
}

export async function exportMessage(
  input: { draftId: string; userId: string },
  dependencies: PublicationDependencies,
): Promise<Buffer> {
  const draft = requireOwnedDraft(input, dependencies.drafts);
  if (!dependencies.purchases.hasActiveGrantForUserAndDraft(input.userId, draft.id)) {
    throw new PublicationAccessDeniedError();
  }
  const template = dependencies.templates.findByIdAndVersion(draft.templateId, draft.templateVersion);
  if (!template) {
    throw new DraftNotFoundError();
  }
  return dependencies.renderer.render(template as Template, draft.data);
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
