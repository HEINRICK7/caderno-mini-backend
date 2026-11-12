import { CheckoutProviderUnavailableError } from '../../../application/errors.js';
import type { CheckoutLink } from '../../../application/ports/checkout-link.js';

const CHECKOUTS_ENDPOINT = 'https://api.abacatepay.com/v2/checkouts/create';

type AbacatePayEnvelope = {
  success?: unknown;
  data?: { url?: unknown };
};

export class AbacatePayHostedCheckoutLink implements CheckoutLink {
  private readonly appUrl: URL;

  constructor(
    private readonly options: {
      apiKey: string;
      productId: string;
      publicAppUrl: string;
      fetcher?: typeof fetch;
    },
  ) {
    this.appUrl = new URL(options.publicAppUrl);
    if (!['https:', 'http:'].includes(this.appUrl.protocol) || this.appUrl.username || this.appUrl.password) {
      throw new Error('PUBLIC_APP_URL must be a valid HTTP(S) origin.');
    }
  }

  async createUrl(
    callbackToken: string,
    context: { purchaseId: string; draftId: string },
  ): Promise<string> {
    try {
      const fetcher = this.options.fetcher ?? fetch;
      const response = await fetcher(CHECKOUTS_ENDPOINT, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: [{ id: this.options.productId, quantity: 1 }],
          externalId: callbackToken,
          completionUrl: new URL(`/compras/${encodeURIComponent(context.purchaseId)}`, this.appUrl).toString(),
          returnUrl: new URL(`/mensagens/${encodeURIComponent(context.draftId)}`, this.appUrl).toString(),
        }),
      });
      const payload = await response.json() as AbacatePayEnvelope;
      if (!response.ok || payload.success !== true || typeof payload.data?.url !== 'string') {
        throw new CheckoutProviderUnavailableError();
      }

      const checkoutUrl = new URL(payload.data.url);
      if (
        checkoutUrl.protocol !== 'https:' ||
        checkoutUrl.hostname !== 'app.abacatepay.com' ||
        checkoutUrl.username ||
        checkoutUrl.password
      ) {
        throw new CheckoutProviderUnavailableError();
      }
      return checkoutUrl.toString();
    } catch {
      throw new CheckoutProviderUnavailableError();
    }
  }
}
