import type { CheckoutLink } from '../../../application/ports/checkout-link.js';

export class CaktoHostedCheckoutLink implements CheckoutLink {
  private readonly checkoutUrl: URL;

  constructor(checkoutUrl: string) {
    this.checkoutUrl = new URL(checkoutUrl);
    if (
      this.checkoutUrl.protocol !== 'https:' ||
      this.checkoutUrl.hostname !== 'pay.cakto.com.br' ||
      this.checkoutUrl.username !== '' ||
      this.checkoutUrl.password !== '' ||
      this.checkoutUrl.searchParams.has('callback')
    ) {
      throw new Error('CAKTO_CHECKOUT_URL must be a hosted Cakto offer URL without callback.');
    }
  }

  createUrl(callbackToken: string): string {
    const url = new URL(this.checkoutUrl);
    url.searchParams.set('callback', callbackToken);
    return url.toString();
  }
}
