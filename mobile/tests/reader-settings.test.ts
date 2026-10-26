import {
  createReaderSettings,
  DEFAULT_NOVEL_SETTINGS,
  normalizeNovelSettings,
  READER_SETTINGS_KEY,
} from '../src/stores/reader-settings';
import { readerFontFamily } from '../src/features/reader/fonts';
import { deferred } from './fixtures';

function memory(initial: string | null = null) {
  let value = initial;
  return {
    getItem: jest.fn(async () => value),
    setItem: jest.fn(async (_key: string, next: string) => {
      value = next;
    }),
    value: () => value,
  };
}
test('first install hydrates defaults without writing credentials or preferences', async () => {
  const disk = memory(),
    settings = createReaderSettings(disk);
  await Promise.all([settings.hydrate(), settings.hydrate()]);
  expect(settings.store.getState()).toEqual({
    preferences: DEFAULT_NOVEL_SETTINGS,
    hydrated: true,
    notice: null,
  });
  expect(disk.getItem).toHaveBeenCalledTimes(1);
  expect(disk.getItem).toHaveBeenCalledWith(READER_SETTINGS_KEY);
  expect(disk.setItem).not.toHaveBeenCalled();
});
test('font, size, spacing and theme survive a new store (application restart)', async () => {
  const disk = memory(),
    first = createReaderSettings(disk);
  await first.hydrate();
  first.update({ font: 'serif', fontSize: 26, lineSpacing: 2.1, theme: 'dark' });
  await first.flush();
  const reopened = createReaderSettings(disk);
  await reopened.hydrate();
  expect(reopened.store.getState().preferences).toEqual(first.store.getState().preferences);
  expect(JSON.parse(disk.value()!)).toEqual({
    version: 1,
    preferences: { font: 'serif', fontSize: 26, lineSpacing: 2.1, theme: 'dark' },
  });
});
test.each(['broken JSON', 'null', '{"version":99}', '{"version":1,"preferences":null}'])(
  'corrupt/unsupported stored data falls back safely: %s',
  async (raw) => {
    const settings = createReaderSettings(memory(raw));
    await settings.hydrate();
    expect(settings.store.getState().preferences).toEqual(DEFAULT_NOVEL_SETTINGS);
    expect(settings.store.getState().hydrated).toBe(true);
  },
);
test('untrusted ranges and font names are normalized; arbitrary fields are discarded', () => {
  expect(
    normalizeNovelSettings({
      fontSize: 10000,
      lineSpacing: 99,
      theme: 'javascript',
      font: 'remote-font',
      token: 'never-persist',
    }),
  ).toEqual({ ...DEFAULT_NOVEL_SETTINGS, fontSize: 30 });
  expect(normalizeNovelSettings({ fontSize: -4 }).fontSize).toBe(14);
  expect(normalizeNovelSettings({ fontSize: NaN }).fontSize).toBe(20);
});
test('slow hydration cannot be overwritten by controls before settings are ready', async () => {
  const pending = deferred<string | null>();
  const disk = { getItem: jest.fn(() => pending.promise), setItem: jest.fn(async () => {}) };
  const settings = createReaderSettings(disk);
  const hydration = settings.hydrate();
  settings.update({ font: 'mono' });
  pending.resolve(JSON.stringify({ version: 1, preferences: { font: 'serif', fontSize: 24 } }));
  await hydration;
  expect(settings.store.getState().preferences.font).toBe('serif');
  expect(disk.setItem).not.toHaveBeenCalled();
});
test('concurrent edits serialize writes and persist the last choice', async () => {
  const disk = memory(),
    settings = createReaderSettings(disk);
  await settings.hydrate();
  const pending = deferred<void>();
  disk.setItem.mockImplementationOnce(async () => pending.promise);
  settings.update({ fontSize: 22 });
  settings.update({ font: 'mono' });
  settings.update({ theme: 'sepia' });
  await Promise.resolve();
  expect(disk.setItem).toHaveBeenCalledTimes(1);
  pending.resolve();
  await settings.flush();
  expect(JSON.parse(disk.value()!).preferences).toEqual({
    ...DEFAULT_NOVEL_SETTINGS,
    fontSize: 22,
    font: 'mono',
    theme: 'sepia',
  });
});
test('read/write failure never prevents reading; a later successful save clears notice', async () => {
  const disk = memory();
  disk.getItem.mockRejectedValueOnce(new Error('disk'));
  const settings = createReaderSettings(disk);
  await settings.hydrate();
  expect(settings.store.getState().notice).not.toBeNull();
  disk.setItem.mockRejectedValueOnce(new Error('full'));
  settings.update({ font: 'mono' });
  await settings.flush();
  expect(settings.store.getState().preferences.font).toBe('mono');
  expect(settings.store.getState().notice).toContain('Chưa lưu');
  settings.update({ fontSize: 24 });
  await settings.flush();
  expect(settings.store.getState().notice).toBeNull();
});
test('storage timeout unblocks Reader and ignores a late stale storage result', async () => {
  jest.useFakeTimers();
  try {
    const pending = deferred<string | null>();
    const settings = createReaderSettings({
      getItem: () => pending.promise,
      setItem: async () => {},
    });
    const hydration = settings.hydrate();
    await jest.advanceTimersByTimeAsync(4000);
    await hydration;
    expect(settings.store.getState().hydrated).toBe(true);
    settings.update({ font: 'mono' });
    pending.resolve(JSON.stringify({ version: 1, preferences: { font: 'serif' } }));
    await Promise.resolve();
    expect(settings.store.getState().preferences.font).toBe('mono');
  } finally {
    jest.useRealTimers();
  }
});
test('reset persists defaults and fonts resolve to local platform font families only', async () => {
  const disk = memory(),
    settings = createReaderSettings(disk);
  await settings.hydrate();
  settings.update({ font: 'mono' });
  settings.reset();
  await settings.flush();
  expect(JSON.parse(disk.value()!).preferences).toEqual(DEFAULT_NOVEL_SETTINGS);
  expect(readerFontFamily('system', 'android')).toBeUndefined();
  expect(readerFontFamily('serif', 'android')).toBe('serif');
  expect(readerFontFamily('mono', 'android')).toBe('monospace');
  expect(readerFontFamily('serif', 'ios')).toBe('Georgia');
  expect(readerFontFamily('mono', 'ios')).toBe('Menlo');
});
