export class TemplateNotFoundError extends Error {
  constructor() {
    super('Template not found');
    this.name = 'TemplateNotFoundError';
  }
}

export class DraftNotFoundError extends Error {
  constructor() {
    super('Draft not found');
    this.name = 'DraftNotFoundError';
  }
}
