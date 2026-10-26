import { ReadingSync, type SyncState } from '../src/features/reader/sync';
import { ApiError } from '../src/lib/errors';
import { comicPosition, novelPosition, textBlocks } from '../src/features/reader/positions';
import { novel } from './catalog-fixtures';
import { deferred } from './fixtures';
import { emptyProgress, position, savedProgress } from './reader-fixtures';
import type { ProgressSnapshot } from '../src/features/reader/api';

function setup(allowed = () => true) {
  const transport = {
    progress: jest.fn().mockResolvedValue(emptyProgress),
    save: jest.fn().mockImplementation(async (_id, p) => ({
      data: { storyId: novel.id, ...p },
      version: savedProgress.version,
    })),
  };
  const changed = jest.fn<void, [SyncState]>();
  const sync = new ReadingSync(novel.id, transport, allowed, changed);
  return { sync, transport, changed };
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-10-18T00:00:00Z'));
});
afterEach(() => jest.useRealTimers());
test('Guest/disallowed sessions never call private APIs', async () => {
  const { sync, transport } = setup(() => false);
  await sync.start();
  sync.offer(position);
  await sync.flush();
  expect(transport.progress).not.toHaveBeenCalled();
  expect(transport.save).not.toHaveBeenCalled();
});
test('does not save without a successfully read version', async () => {
  const { sync, transport } = setup();
  sync.offer(position);
  await sync.flush();
  expect(transport.save).not.toHaveBeenCalled();
});
test('reads once, uses null only for a confirmed first position and debounces scroll events', async () => {
  const { sync, transport } = setup();
  await sync.start();
  await sync.start();
  for (let textOffset = 1; textOffset <= 50; textOffset++) sync.offer({ ...position, textOffset });
  await jest.advanceTimersByTimeAsync(1499);
  expect(transport.save).not.toHaveBeenCalled();
  await jest.advanceTimersByTimeAsync(1);
  expect(transport.save).toHaveBeenCalledTimes(1);
  expect(transport.save).toHaveBeenCalledWith(novel.id, { ...position, textOffset: 50 }, null);
  expect(transport.progress).toHaveBeenCalledTimes(1);
});
test('enforces minimum interval and skips an identical position', async () => {
  const { sync, transport } = setup();
  await sync.start();
  sync.offer(position);
  await jest.advanceTimersByTimeAsync(1500);
  sync.offer(position);
  await jest.advanceTimersByTimeAsync(6000);
  expect(transport.save).toHaveBeenCalledTimes(1);
  sync.offer({ ...position, textOffset: 12 });
  await jest.advanceTimersByTimeAsync(1500);
  expect(transport.save).toHaveBeenCalledTimes(2);
});
test('next write carries the acknowledged version', async () => {
  const { sync, transport } = setup();
  await sync.start();
  sync.offer(position);
  await sync.flush();
  sync.offer({ ...position, textOffset: 20 });
  await sync.flush();
  expect(transport.save.mock.calls[1][2]).toBe(savedProgress.version);
});
test('writes remain serial across chapter changes and close drains the latest queued position', async () => {
  const first = deferred<ProgressSnapshot>();
  const { sync, transport } = setup();
  transport.save.mockReturnValueOnce(first.promise);
  await sync.start();
  sync.offer(position);
  const running = sync.flush();
  const next = { ...position, chapterId: '30000000-0000-4000-8000-000000000002' };
  sync.offer(next);
  const closed = sync.close();
  expect(transport.save).toHaveBeenCalledTimes(1);
  first.resolve(savedProgress);
  await running;
  await closed;
  expect(transport.save).toHaveBeenCalledTimes(2);
  expect(transport.save.mock.calls[1]).toEqual([novel.id, next, savedProgress.version]);
});
test('409 reloads once, pauses and never overwrites remote progress', async () => {
  const { sync, transport, changed } = setup();
  transport.save.mockRejectedValue(new ApiError(409, 'conflict'));
  await sync.start();
  transport.progress.mockResolvedValue(savedProgress);
  sync.offer(position);
  await sync.flush();
  expect(transport.progress).toHaveBeenCalledTimes(2);
  expect(changed.mock.calls.at(-1)?.[0]).toMatchObject({ paused: true, snapshot: savedProgress });
  sync.offer({ ...position, textOffset: 40 });
  await jest.advanceTimersByTimeAsync(60_000);
  await sync.flush();
  expect(transport.save).toHaveBeenCalledTimes(1);
});
test('unknown write outcome pauses without replaying the mutation', async () => {
  const { sync, transport } = setup();
  transport.save.mockRejectedValue(new ApiError(0, 'network'));
  await sync.start();
  sync.offer(position);
  await sync.flush();
  sync.offer({ ...position, textOffset: 15 });
  await jest.advanceTimersByTimeAsync(60_000);
  expect(transport.save).toHaveBeenCalledTimes(1);
});
test('read failure never falls back to an unverified null version', async () => {
  const { sync, transport, changed } = setup();
  transport.progress.mockRejectedValue(new Error('private detail'));
  await sync.start();
  sync.offer(position);
  await sync.flush();
  expect(transport.save).not.toHaveBeenCalled();
  expect(JSON.stringify(changed.mock.calls)).not.toContain('private detail');
});
test('session change discards pending writes instead of writing as another user', async () => {
  let active = true;
  const { sync, transport } = setup(() => active);
  await sync.start();
  sync.offer(position);
  active = false;
  await sync.close();
  await jest.advanceTimersByTimeAsync(60_000);
  expect(transport.save).not.toHaveBeenCalled();
});
test('late response after logout never updates UI or sends the next write', async () => {
  let active = true;
  const wait = deferred<ProgressSnapshot>();
  const { sync, transport, changed } = setup(() => active);
  transport.save.mockReturnValueOnce(wait.promise);
  await sync.start();
  sync.offer(position);
  const running = sync.flush();
  sync.offer({ ...position, textOffset: 50 });
  active = false;
  const before = changed.mock.calls.length;
  wait.resolve(savedProgress);
  await running;
  await jest.advanceTimersByTimeAsync(60_000);
  expect(changed).toHaveBeenCalledTimes(before);
  expect(transport.save).toHaveBeenCalledTimes(1);
});
test('text anchors retain all original UTF-16 data without splitting emoji pairs', () => {
  const content = 'Tiếng Việt\n\n' + 'a'.repeat(787) + '😀' + 'b'.repeat(1600);
  const blocks = textBlocks(content);
  expect(blocks.map((b) => b.text).join('')).toBe(content);
  for (const block of blocks) {
    expect(content.slice(block.start, block.start + block.text.length)).toBe(block.text);
    expect(block.text).not.toMatch(/[\uD800-\uDBFF]$/);
  }
});
test('NOVEL position is a character anchor, never a pixel offset', () => {
  expect(novelPosition(position.chapterId, 800, 1600)).toEqual({
    ...position,
    textOffset: 800,
    progressPercent: 50,
  });
  expect(novelPosition(position.chapterId, 1700, 1600).textOffset).toBe(1600);
});
test('COMIC saves actual pageNumber, null text and a safe page-start scroll offset', () => {
  expect(comicPosition(position.chapterId, 7, 1, 3)).toEqual({
    chapterId: position.chapterId,
    textOffset: null,
    pageNumber: 7,
    scrollOffset: 0,
    progressPercent: 33.33,
  });
  expect(comicPosition(position.chapterId, 7, 2, 3, true).progressPercent).toBe(100);
});
test('returning to the previously saved position while a newer write is in flight queues the return position', async () => {
  const { sync, transport } = setup();
  transport.progress.mockResolvedValue(savedProgress);
  const pending = deferred<ProgressSnapshot>();
  transport.save.mockReturnValueOnce(pending.promise);
  await sync.start();
  const newer = { ...position, textOffset: 30 };
  sync.offer(newer);
  const running = sync.flush();
  sync.offer(position);
  pending.resolve({ ...savedProgress, data: { storyId: novel.id, ...newer } });
  await running;
  await sync.close();
  expect(transport.save.mock.calls[1][1]).toEqual(position);
});
