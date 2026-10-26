import { COMIC_SETTINGS_KEY, createComicSettings } from '../src/stores/comic-settings';
import { deferred } from './fixtures';
function memory(raw: string | null = null) {
  let value = raw;
  return {
    getItem: jest.fn(async () => value),
    setItem: jest.fn(async (_key: string, next: string) => {
      value = next;
    }),
    value: () => value,
  };
}
test('COMIC defaults to vertical; hydration reads only its own storage key once', async () => {
  const disk = memory(),
    settings = createComicSettings(disk);
  await Promise.all([settings.hydrate(), settings.hydrate()]);
  expect(settings.store.getState()).toEqual({ mode: 'vertical', hydrated: true, notice: null });
  expect(disk.getItem).toHaveBeenCalledTimes(1);
  expect(disk.getItem).toHaveBeenCalledWith(COMIC_SETTINGS_KEY);
  expect(disk.setItem).not.toHaveBeenCalled();
});
test('paged mode persists across application restart without changing NOVEL settings', async () => {
  const disk = memory(),
    settings = createComicSettings(disk);
  await settings.hydrate();
  settings.setMode('paged');
  await settings.flush();
  const restarted = createComicSettings(disk);
  await restarted.hydrate();
  expect(restarted.store.getState().mode).toBe('paged');
  expect(disk.setItem).toHaveBeenCalledWith(
    COMIC_SETTINGS_KEY,
    JSON.stringify({ version: 1, mode: 'paged' }),
  );
});
test.each(['not json', 'null', '{"version":99,"mode":"paged"}', '{"version":1,"mode":"unknown"}'])(
  'corrupt storage falls back to vertical and does not block reading: %s',
  async (raw) => {
    const settings = createComicSettings(memory(raw));
    await settings.hydrate();
    expect(settings.store.getState()).toEqual({
      mode: 'vertical',
      hydrated: true,
      notice: expect.any(String),
    });
  },
);
test('read failure and write failure stay usable; later writes recover', async () => {
  const disk = memory();
  disk.getItem.mockRejectedValueOnce(new Error('disk'));
  const settings = createComicSettings(disk);
  await settings.hydrate();
  disk.setItem.mockRejectedValueOnce(new Error('full'));
  settings.setMode('paged');
  await settings.flush();
  expect(settings.store.getState().mode).toBe('paged');
  expect(settings.store.getState().notice).toContain('Chưa lưu');
  settings.setMode('vertical');
  await settings.flush();
  expect(settings.store.getState().notice).toBeNull();
});
test('writes are serialized, last selection wins, and pre-hydration changes are ignored', async () => {
  const disk = memory(),
    settings = createComicSettings(disk);
  settings.setMode('paged');
  expect(disk.setItem).not.toHaveBeenCalled();
  await settings.hydrate();
  const slow = deferred<void>();
  disk.setItem.mockImplementationOnce(async () => slow.promise);
  settings.setMode('paged');
  settings.setMode('vertical');
  settings.setMode('paged');
  await Promise.resolve();
  expect(disk.setItem).toHaveBeenCalledTimes(1);
  slow.resolve();
  await settings.flush();
  expect(JSON.parse(disk.value()!).mode).toBe('paged');
});
test('storage timeout allows reading and ignores a late stored mode', async () => {
  jest.useFakeTimers();
  try {
    const slow = deferred<string | null>();
    const settings = createComicSettings({ getItem: () => slow.promise, setItem: async () => {} });
    const ready = settings.hydrate();
    await jest.advanceTimersByTimeAsync(4000);
    await ready;
    expect(settings.store.getState().hydrated).toBe(true);
    slow.resolve(JSON.stringify({ version: 1, mode: 'paged' }));
    await Promise.resolve();
    expect(settings.store.getState().mode).toBe('vertical');
  } finally {
    jest.useRealTimers();
  }
});
