export type MerchantCatalogItemKind = 'product' | 'service';
export type MerchantCatalogItemStatus = 'active' | 'archived';

export type MerchantCatalogItem = {
  id: string;
  ownerUserId: string;
  kind: MerchantCatalogItemKind;
  name: string;
  description: string | null;
  priceMinor: number;
  status: MerchantCatalogItemStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type MerchantCatalogItemInput = {
  kind: MerchantCatalogItemKind;
  name: string;
  description?: string | null | undefined;
  priceMinor: number;
  status?: MerchantCatalogItemStatus | undefined;
};

export function createMerchantCatalogItem(
  input: MerchantCatalogItemInput & { id: string; ownerUserId: string; now: Date },
): MerchantCatalogItem {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) throw new Error('Catalog item name must have between 2 and 120 characters.');
  if (!Number.isSafeInteger(input.priceMinor) || input.priceMinor < 0 || input.priceMinor > 99_999_999) {
    throw new Error('Catalog item price must be a non-negative amount in cents.');
  }

  const description = input.description?.trim();
  return {
    id: input.id,
    ownerUserId: input.ownerUserId,
    kind: input.kind,
    name,
    description: description || null,
    priceMinor: input.priceMinor,
    status: input.status ?? 'active',
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function updateMerchantCatalogItem(
  current: MerchantCatalogItem,
  input: MerchantCatalogItemInput,
  now: Date,
): MerchantCatalogItem {
  const updated = createMerchantCatalogItem({
    ...input,
    id: current.id,
    ownerUserId: current.ownerUserId,
    now: current.createdAt,
  });
  return { ...updated, createdAt: current.createdAt, updatedAt: now };
}
