export interface CheckoutLink {
  createUrl(
    callbackToken: string,
    context: { purchaseId: string; draftId?: string },
  ): string | Promise<string>;
}
