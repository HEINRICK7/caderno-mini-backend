export type User = {
  id: string;
  email: string;
  name: string | null;
  whatsapp: string | null;
  birthDate: string | null;
  profileComplete: boolean;
  createdAt: Date;
};

export function normalizeWhatsApp(value: string): string {
  const trimmed = value.trim();
  let digits = trimmed.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!trimmed.startsWith('+') && (digits.length === 10 || digits.length === 11)) {
    digits = `55${digits}`;
  }
  return `+${digits}`;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
