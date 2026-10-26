export class UploadCapacity {
  private active = 0;
  constructor(private readonly maximum = 2) {}
  acquire(): (() => void) | null {
    if (this.active >= this.maximum) return null;
    this.active++;
    let released = false;
    return () => { if (!released) { released = true; this.active--; } };
  }
}

// Shared across all router/service instances in this process.
export const uploadRequests = new UploadCapacity(2);
let activeTransfers = 0;
const transferWaiters: Array<() => void> = [];
export async function withUploadSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activeTransfers >= 2) await new Promise<void>((resolve) => transferWaiters.push(resolve));
  else activeTransfers++;
  try { return await work(); }
  finally {
    const next = transferWaiters.shift();
    if (next) next();
    else activeTransfers--;
  }
}
