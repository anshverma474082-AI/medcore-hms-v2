import { stockLevels } from './stock-levels';

describe('pharmacy stock levels', () => {
  const today = new Date('2026-11-26T00:00:00.000Z');

  it('excludes expired batches from usable stock and reports them separately', () => {
    expect(stockLevels([
      { expiryDate: new Date('2026-11-25T23:59:59.000Z'), quantityRemaining: 4 },
      { expiryDate: new Date('2026-11-27T00:00:00.000Z'), quantityRemaining: 8 },
    ], 3, today)).toEqual({ available: 8, expiredQuantity: 4, lowStock: false });
  });

  it('flags stock at or below its reorder level', () => {
    expect(stockLevels([{ expiryDate: new Date('2026-12-01T00:00:00.000Z'), quantityRemaining: 3 }], 3, today).lowStock).toBe(true);
  });

  it('treats a batch expiring now as expired', () => {
    expect(stockLevels([{ expiryDate: today, quantityRemaining: 2 }], 1, today)).toEqual({ available: 0, expiredQuantity: 2, lowStock: true });
  });
});
