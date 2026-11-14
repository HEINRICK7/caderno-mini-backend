import { describe, expect, it } from 'vitest';

import { createMerchantCatalogItem, updateMerchantCatalogItem } from '../../../src/domain/merchant/merchant-catalog-item.js';

describe('merchant catalog item domain rules', () => {
  const now = new Date('2026-11-13T12:00:00.000Z');

  it('stores a product or service price as integer cents', () => {
    expect(createMerchantCatalogItem({
      id: 'item-1', ownerUserId: 'merchant-1', kind: 'service', name: '  Manutenção ',
      description: ' Mensal ', priceMinor: 12550, now,
    })).toEqual({
      id: 'item-1', ownerUserId: 'merchant-1', kind: 'service', name: 'Manutenção',
      description: 'Mensal', priceMinor: 12550, status: 'active', createdAt: now, updatedAt: now,
    });
  });

  it('rejects invalid prices and blank names', () => {
    expect(() => createMerchantCatalogItem({ id: '1', ownerUserId: 'm1', kind: 'product', name: 'Item', priceMinor: -1, now })).toThrow();
    expect(() => createMerchantCatalogItem({ id: '1', ownerUserId: 'm1', kind: 'product', name: 'Item', priceMinor: 1.2, now })).toThrow();
    expect(() => createMerchantCatalogItem({ id: '1', ownerUserId: 'm1', kind: 'product', name: ' ', priceMinor: 0, now })).toThrow();
  });

  it('updates the shared catalog record without changing its owner', () => {
    const original = createMerchantCatalogItem({ id: 'item-1', ownerUserId: 'merchant-1', kind: 'product', name: 'Caderno', priceMinor: 1000, now });
    const changed = updateMerchantCatalogItem(original, { kind: 'product', name: 'Caderno novo', priceMinor: 1500 }, new Date(now.getTime() + 1000));
    expect(changed).toMatchObject({ id: original.id, ownerUserId: original.ownerUserId, name: 'Caderno novo', priceMinor: 1500, createdAt: now });
  });
});
