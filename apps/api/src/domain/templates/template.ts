import type { JsonObject } from '../shared/json-value.js';

export type Template = {
  id: string;
  version: number;
  name: string;
  description: string | null;
  definition: JsonObject;
  isActive: boolean;
  createdAt: Date;
};
