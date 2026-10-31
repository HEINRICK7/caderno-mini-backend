export type MagicLinkEmail = {
  to: string;
  link: string;
  expiresAt: Date;
};

export interface EmailSender {
  sendMagicLink(message: MagicLinkEmail): Promise<void>;
}
