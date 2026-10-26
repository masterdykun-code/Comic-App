import AsyncStorage from '@react-native-async-storage/async-storage';
import { createStore } from 'zustand/vanilla';
import type { ThemeName } from '../features/reader/theme';

export const READER_SETTINGS_KEY = 'webnovel.reader.novel-settings.v1';
export type ReaderFont = 'system' | 'serif' | 'mono';
export interface NovelSettings {
  fontSize: number;
  lineSpacing: number;
  font: ReaderFont;
  theme: ThemeName;
}
export const DEFAULT_NOVEL_SETTINGS: NovelSettings = {
  fontSize: 20,
  lineSpacing: 1.8,
  font: 'system',
  theme: 'light',
};
type Storage = Pick<typeof AsyncStorage, 'getItem' | 'setItem'>;
interface State {
  preferences: NovelSettings;
  hydrated: boolean;
  notice: string | null;
}
export function normalizeNovelSettings(raw: unknown): NovelSettings {
  const value = raw && typeof raw === 'object' ? (raw as Partial<NovelSettings>) : {};
  return {
    fontSize:
      typeof value.fontSize === 'number' && Number.isFinite(value.fontSize)
        ? Math.min(30, Math.max(14, Math.round(value.fontSize / 2) * 2))
        : 20,
    lineSpacing: [1.5, 1.8, 2.1].includes(value.lineSpacing ?? 0) ? value.lineSpacing! : 1.8,
    font: ['system', 'serif', 'mono'].includes(value.font ?? '') ? value.font! : 'system',
    theme: ['light', 'sepia', 'dark'].includes(value.theme ?? '') ? value.theme! : 'light',
  };
}
// Device preferences only. Never read or write the authentication SecureStore key.
export function createReaderSettings(storage: Storage = AsyncStorage) {
  const store = createStore<State>(() => ({
    preferences: { ...DEFAULT_NOVEL_SETTINGS },
    hydrated: false,
    notice: null,
  }));
  let hydration: Promise<void> | undefined;
  let queue = Promise.resolve();
  function hydrate(): Promise<void> {
    return (hydration ??= (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const raw = await Promise.race([
          storage.getItem(READER_SETTINGS_KEY),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Storage timeout')), 4000);
          }),
        ]);
        if (raw !== null) {
          const data = JSON.parse(raw) as { version?: number; preferences?: unknown };
          if (!data || data.version !== 1) throw new Error('Unsupported settings');
          store.setState({ preferences: normalizeNovelSettings(data.preferences) });
        }
      } catch {
        store.setState({
          notice: 'Chưa đọc được cài đặt đã lưu. Đang dùng mặc định; bạn vẫn có thể đọc.',
        });
      } finally {
        clearTimeout(timer);
        if (!store.getState().hydrated) store.setState({ hydrated: true });
      }
    })());
  }
  function update(patch: Partial<NovelSettings>) {
    if (!store.getState().hydrated) return;
    const preferences = normalizeNovelSettings({ ...store.getState().preferences, ...patch });
    store.setState({ preferences });
    const value = JSON.stringify({ version: 1, preferences });
    // Serialize writes: the last selection must win even on slow native storage.
    queue = queue.then(async () => {
      try {
        await storage.setItem(READER_SETTINGS_KEY, value);
        if (store.getState().notice !== null) store.setState({ notice: null });
      } catch {
        store.setState({
          notice: 'Chưa lưu được cài đặt trên thiết bị. Lựa chọn vẫn áp dụng cho lần đọc này.',
        });
      }
    });
  }
  return {
    store,
    hydrate,
    update,
    reset: () => update(DEFAULT_NOVEL_SETTINGS),
    flush: () => queue,
  };
}
export const readerSettings = createReaderSettings();
