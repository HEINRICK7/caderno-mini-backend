export type TemplateValidationIssue = {
  path: string;
  code: string;
  message: string;
};

export class InvalidTemplateDefinitionError extends Error {
  constructor() {
    super('The stored template definition is invalid.');
    this.name = 'InvalidTemplateDefinitionError';
  }
}

export class TemplateInputValidationError extends Error {
  constructor(readonly issues: TemplateValidationIssue[]) {
    super('The input does not match the template definition.');
    this.name = 'TemplateInputValidationError';
  }
}
