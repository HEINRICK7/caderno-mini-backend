import { describe, expect, it } from 'vitest';

import { createMerchantCustomer, updateMerchantCustomer } from '../../../src/domain/merchant/merchant-customer.js';

describe('merchant customer domain rules', () => {
  const now = new Date('2026-11-13T12:00:00.000Z');

  it('trims optional fields, normalizes the email, and starts active', () => {
    expect(createMerchantCustomer({
      id: 'customer-1',
      ownerUserId: 'merchant-1',
      name: '  Maria Silva ',
      whatsapp: ' (85) 99999-1234 ',
      email: ' MARIA@EXAMPLE.COM ',
      address: ' Rua A, 10 ',
      notes: ' Cliente antiga ',
      now,
    })).toEqual({
      id: 'customer-1', ownerUserId: 'merchant-1', name: 'Maria Silva', whatsapp: '(85) 99999-1234',
      email: 'maria@example.com', address: 'Rua A, 10', notes: 'Cliente antiga', status: 'active', createdAt: now, updatedAt: now,
    });
  });

  it('rejects a blank or oversized name', () => {
    expect(() => createMerchantCustomer({ id: '1', ownerUserId: 'm1', name: ' ', now })).toThrow();
    expect(() => createMerchantCustomer({ id: '1', ownerUserId: 'm1', name: 'x'.repeat(121), now })).toThrow();
  });

  it('preserves identity and creation date when customer data is updated', () => {
    const original = createMerchantCustomer({ id: 'customer-1', ownerUserId: 'merchant-1', name: 'Maria', now });
    const changed = updateMerchantCustomer(original, { name: 'Maria Silva', status: 'archived' }, new Date(now.getTime() + 1000));
    expect(changed).toMatchObject({ id: original.id, ownerUserId: original.ownerUserId, createdAt: now, name: 'Maria Silva', status: 'archived' });
    expect(changed.updatedAt).toEqual(new Date(now.getTime() + 1000));
  });
});
