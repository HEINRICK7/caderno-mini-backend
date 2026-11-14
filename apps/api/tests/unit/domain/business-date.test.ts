import { describe, expect, it } from 'vitest';
import { businessDate } from '../../../src/domain/merchant/business-date.js';

describe('businessDate', () => {
  it('uses the billing timezone instead of the server UTC date', () => {
    expect(businessDate(new Date('2026-11-14T02:30:00.000Z'))).toBe('2026-11-13');
    expect(businessDate(new Date('2026-11-14T12:00:00.000Z'))).toBe('2026-11-14');
  });
});
