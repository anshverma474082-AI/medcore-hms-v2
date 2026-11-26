type StockBatch = { expiryDate: Date; quantityRemaining: number };

export function stockLevels(batches: StockBatch[], reorderLevel: number, now = new Date()) {
  const available = batches.reduce((total, batch) => batch.expiryDate > now ? total + batch.quantityRemaining : total, 0);
  const expiredQuantity = batches.reduce((total, batch) => batch.expiryDate <= now ? total + batch.quantityRemaining : total, 0);
  return { available, expiredQuantity, lowStock: available <= reorderLevel };
}
