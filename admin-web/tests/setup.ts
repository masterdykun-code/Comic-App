import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
// jsdom has no top-layer dialog or object URL implementation; browser tests cover them.
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
};
URL.createObjectURL = vi.fn(() => 'blob:synthetic-preview');
URL.revokeObjectURL = vi.fn();
// Node 25's native Web Storage must not shadow or persist jsdom test storage.
class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value));
  }
}
for (const key of ['localStorage', 'sessionStorage'] as const) {
  const storage = new MemoryStorage();
  Object.defineProperty(window, key, { value: storage, configurable: true });
  vi.stubGlobal(key, storage);
}
afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});
