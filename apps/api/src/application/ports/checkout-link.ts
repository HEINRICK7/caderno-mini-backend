export interface CheckoutLink {
  createUrl(callbackToken: string): string;
}
