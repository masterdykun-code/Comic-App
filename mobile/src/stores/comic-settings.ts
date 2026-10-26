import AsyncStorage from '@react-native-async-storage/async-storage';
import { createStore } from 'zustand/vanilla';

export type ComicMode = 'vertical' | 'paged';
export const COMIC_SETTINGS_KEY = 'webnovel.reader.comic-settings.v1';
type Storage = Pick<typeof AsyncStorage, 'getItem' | 'setItem'>;
export function createComicSettings(storage: Storage = AsyncStorage) {
  const store = createStore<{ mode: ComicMode; hydrated: boolean; notice: string | null }>(() => ({
    mode: 'vertical',
    hydrated: false,
    notice: null,
  }));
  let hydration: Promise<void> | undefined;
  let queue = Promise.resolve();
  function hydrate() {
    return (hydration ??= (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const raw = await Promise.race([
          storage.getItem(COMIC_SETTINGS_KEY),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Timeout')), 4000);
          }),
        ]);
        if (raw !== null) {
          const data = JSON.parse(raw);
          if (!data || data.version !== 1 || !['vertical', 'paged'].includes(data.mode))
            throw new Error('Invalid mode');
          store.setState({ mode: data.mode });
        }
      } catch {
        store.setState({ notice: 'Chưa đọc được chế độ đã lưu. Đang dùng cuộn dọc.' });
      } finally {
        clearTimeout(timer);
        if (!store.getState().hydrated) store.setState({ hydrated: true });
      }
    })());
  }
  function setMode(mode: ComicMode) {
    if (!store.getState().hydrated || !['vertical', 'paged'].includes(mode)) return;
    store.setState({ mode });
    queue = queue.then(async () => {
      try {
        await storage.setItem(COMIC_SETTINGS_KEY, JSON.stringify({ version: 1, mode }));
        if (store.getState().notice !== null) store.setState({ notice: null });
      } catch {
        store.setState({
          notice: 'Chưa lưu được chế độ trên thiết bị. Bạn vẫn có thể đọc bình thường.',
        });
      }
    });
  }
  return { store, hydrate, setMode, flush: () => queue };
}
export const comicSettings = createComicSettings();
