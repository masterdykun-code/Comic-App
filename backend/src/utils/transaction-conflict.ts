// Prisma 7 may surface serialization/deadlock failures from $queryRaw locks as
// P2010 + SQLSTATE rather than P2034. Only aborted, retryable transactions match.
export function isTransactionConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { code?: string; meta?: { code?: string; driverAdapterError?: { cause?: { originalCode?: string } } } };
  if (e.code === 'P2034' || e.code === '40001' || e.code === '40P01') return true;
  if (e.code !== 'P2010') return false;
  return [e.meta?.code, e.meta?.driverAdapterError?.cause?.originalCode].some((state) => state === '40001' || state === '40P01');
}
