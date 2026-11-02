import nodemailer, { type Transporter } from 'nodemailer';

import type { EmailSender, MagicLinkEmail } from '../../application/ports/email-sender.js';
import { MagicLinkDeliveryError } from '../../application/errors.js';

export class NodemailerEmailSender implements EmailSender {
  private readonly transporter: Transporter | undefined;

  constructor(
    private readonly options: { smtpUrl?: string; from?: string },
  ) {
    if (options.smtpUrl && options.from) {
      this.transporter = nodemailer.createTransport({
        url: options.smtpUrl,
        connectionTimeout: 8_000,
        greetingTimeout: 8_000,
        socketTimeout: 8_000,
      });
    }
  }

  async sendMagicLink(message: MagicLinkEmail): Promise<void> {
    if (!this.transporter || !this.options.from) {
      throw new MagicLinkDeliveryError();
    }

    const safeLink = escapeHtml(message.link);
    try {
      await this.transporter.sendMail({
        from: this.options.from,
        to: message.to,
        subject: 'Seu link para entrar no Cadernô Express',
        text: `Use este link para entrar no Cadernô Express. Ele expira em 15 minutos.\n\n${message.link}`,
        html: `<p>Use este link para entrar no Cadernô Express.</p><p><a href="${safeLink}">Entrar na minha conta</a></p><p>O link expira em 15 minutos.</p>`,
      });
    } catch {
      throw new MagicLinkDeliveryError();
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character] ?? character;
  });
}
