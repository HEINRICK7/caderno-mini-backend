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

export class PurchaseNotFoundError extends Error {
  constructor() {
    super('Purchase not found');
    this.name = 'PurchaseNotFoundError';
  }
}

export class PublicationAccessDeniedError extends Error {
  constructor() {
    super('An active license is required to publish or export this draft.');
    this.name = 'PublicationAccessDeniedError';
  }
}

export class TrialCategoryUnavailableError extends Error {
  constructor() {
    super('A free demonstration is not available for this template category.');
    this.name = 'TrialCategoryUnavailableError';
  }
}

export class DemoPublicationNotFoundError extends Error {
  constructor() {
    super('Demo publication not found or expired.');
    this.name = 'DemoPublicationNotFoundError';
  }
}

export class ExportContentTooLargeError extends Error {
  constructor() {
    super('The content is too large to export as an image.');
    this.name = 'ExportContentTooLargeError';
  }
}

export class InvalidImageUploadError extends Error {
  constructor() {
    super('The uploaded image is invalid or exceeds the allowed size.');
    this.name = 'InvalidImageUploadError';
  }
}

export class ImageStorageUnavailableError extends Error {
  constructor() {
    super('Image storage is temporarily unavailable.');
    this.name = 'ImageStorageUnavailableError';
  }
}

export class AnalyticsRangeError extends Error {
  constructor() {
    super('The analytics time range is invalid or too large.');
    this.name = 'AnalyticsRangeError';
  }
}

export class InvalidMagicLinkError extends Error {
  constructor() {
    super('The magic link is invalid or expired.');
    this.name = 'InvalidMagicLinkError';
  }
}

export class MagicLinkDeliveryError extends Error {
  constructor() {
    super('The sign-in link could not be delivered.');
    this.name = 'MagicLinkDeliveryError';
  }
}

export class InvalidCaktoWebhookError extends Error {
  constructor() {
    super('The Cakto webhook could not be authenticated or parsed.');
    this.name = 'InvalidCaktoWebhookError';
  }
}

export class CheckoutNotConfiguredError extends Error {
  constructor() {
    super('Hosted checkout is not configured.');
    this.name = 'CheckoutNotConfiguredError';
  }
}

export class CheckoutPlanRequiredError extends Error {
  constructor() {
    super('A checkout plan is required.');
    this.name = 'CheckoutPlanRequiredError';
  }
}

export class WebhookNotConfiguredError extends Error {
  constructor() {
    super('Cakto webhook verification is not configured.');
    this.name = 'WebhookNotConfiguredError';
  }
}
