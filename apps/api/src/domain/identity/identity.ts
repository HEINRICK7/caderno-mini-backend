export type User = {
  id: string;
  email: string;
  createdAt: Date;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
