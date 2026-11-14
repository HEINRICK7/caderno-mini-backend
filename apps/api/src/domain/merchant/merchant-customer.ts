export type MerchantCustomerStatus = 'active' | 'archived';

export type MerchantCustomer = {
  id: string;
  ownerUserId: string;
  name: string;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  status: MerchantCustomerStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type MerchantCustomerInput = {
  name: string;
  whatsapp?: string | null | undefined;
  email?: string | null | undefined;
  address?: string | null | undefined;
  notes?: string | null | undefined;
  status?: MerchantCustomerStatus | undefined;
};

export function createMerchantCustomer(
  input: MerchantCustomerInput & { id: string; ownerUserId: string; now: Date },
): MerchantCustomer {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) throw new Error('Customer name must have between 2 and 120 characters.');

  return {
    id: input.id,
    ownerUserId: input.ownerUserId,
    name,
    whatsapp: cleanOptional(input.whatsapp),
    email: cleanOptional(input.email)?.toLowerCase() ?? null,
    address: cleanOptional(input.address),
    notes: cleanOptional(input.notes),
    status: input.status ?? 'active',
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function updateMerchantCustomer(
  current: MerchantCustomer,
  input: MerchantCustomerInput,
  now: Date,
): MerchantCustomer {
  const updated = createMerchantCustomer({
    ...input,
    id: current.id,
    ownerUserId: current.ownerUserId,
    now: current.createdAt,
  });
  return { ...updated, createdAt: current.createdAt, updatedAt: now };
}

function cleanOptional(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
