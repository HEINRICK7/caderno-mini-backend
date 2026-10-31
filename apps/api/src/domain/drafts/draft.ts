import type { JsonObject } from '../shared/json-value.js';

export type Draft = {
  id: string;
  templateId: string;
  templateVersion: number;
  data: JsonObject;
  createdAt: Date;
  updatedAt: Date;
};

export type NewDraft = {
  id: string;
  templateId: string;
  templateVersion: number;
  data: JsonObject;
  now: Date;
};

export function createDraft(input: NewDraft): Draft {
  return {
    id: input.id,
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    data: structuredClone(input.data),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function replaceDraftData(draft: Draft, data: JsonObject, now: Date): Draft {
  return {
    ...draft,
    data: structuredClone(data),
    updatedAt: now.getTime() >= draft.updatedAt.getTime() ? now : draft.updatedAt,
  };
}
