import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, fireEvent, screen, waitFor, act } from '@testing-library/react-native';
import { Text } from 'react-native';
import { Stack } from 'expo-router';
import { renderRouter } from 'expo-router/testing-library';
import Wallet from '../src/app/wallet';
import { UnlockChapter } from '../src/features/coins/UnlockChapter';
import { coinsApi } from '../src/features/coins/api';
import { authSession } from '../src/services/runtime';
import { user, deferred } from './fixtures';
import { ApiError } from '../src/lib/errors';
jest.mock('../src/services/runtime', () => ({
  api: jest.requireActual('axios').default.create(),
  authSession: {
    store: jest
      .requireActual('zustand/vanilla')
      .createStore(() => ({ status: 'guest', user: null, notice: null })),
    generation: jest.fn(() => 0),
  },
}));
jest.mock('../src/features/coins/api', () => ({
  coinsApi: {
    wallet: jest.fn(),
    tasks: jest.fn(),
    claim: jest.fn(),
    access: jest.fn(),
    unlock: jest.fn(),
  },
}));
const api = jest.mocked(coinsApi),
  chapterId = '20000000-0000-4000-8000-000000000001',
  storyId = '30000000-0000-4000-8000-000000000001';
const empty = {
  balance: 0,
  transactions: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
};
const tasks = {
  day: '2026-10-24',
  timeZone: 'Asia/Ho_Chi_Minh' as const,
  checkedIn: false,
  checkInReward: 10 as const,
  missions: [
    {
      kind: 'READ_THREE' as const,
      title: 'Đọc 3 chương khác nhau',
      progress: 2,
      target: 3,
      reward: 20,
      claimed: false,
    },
    {
      kind: 'FAVORITE' as const,
      title: 'Thêm một truyện vào yêu thích',
      progress: 1,
      target: 1,
      reward: 5,
      claimed: false,
    },
  ],
};
beforeEach(() => {
  jest.clearAllMocks();
  authSession.store.setState({ status: 'authenticated', user, notice: null });
  api.wallet.mockResolvedValue(empty);
  api.tasks.mockResolvedValue(tasks);
  api.claim.mockResolvedValue({ received: true, reward: 10, balance: 10 });
  api.access.mockResolvedValue({
    id: chapterId,
    storyId,
    title: 'Chương riêng',
    type: 'NOVEL',
    isVip: true,
    coinPrice: 10,
    canRead: false,
  });
  api.unlock.mockResolvedValue({ unlocked: true, charged: 10, balance: 0 });
});
function openWallet() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  function Layout() {
    return (
      <QueryClientProvider client={client}>
        <Stack />
      </QueryClientProvider>
    );
  }
  renderRouter(
    { _layout: Layout, wallet: Wallet, login: () => <Text>Màn đăng nhập</Text> },
    { initialUrl: '/wallet' },
  );
  return client;
}
function openUnlock() {
  const opened = jest.fn(),
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <UnlockChapter chapterId={chapterId} storyId={storyId} onOpened={opened} />
    </QueryClientProvider>,
  );
  return opened;
}
test('guest wallet offers login and does not query private data', () => {
  authSession.store.setState({ status: 'guest', user: null });
  openWallet();
  expect(screen.getByText('Đăng nhập')).toBeTruthy();
  expect(api.wallet).not.toHaveBeenCalled();
  expect(api.claim).not.toHaveBeenCalled();
});
test('wallet shows balance/tasks and disables incomplete mission', async () => {
  openWallet();
  expect(await screen.findByText('Điểm danh +10 Coin')).toBeTruthy();
  expect(screen.getByText('2/3 · Mỗi ngày một lần')).toBeTruthy();
  fireEvent.press(screen.getByText('Đang thực hiện'));
  expect(api.claim).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Nhận 5 Coin'));
  await waitFor(() => expect(api.claim).toHaveBeenCalledWith('FAVORITE', expect.anything()));
});
test('pending check-in prevents duplicate taps, then displays reward and completed state', async () => {
  const pending = deferred<Awaited<ReturnType<typeof coinsApi.claim>>>();
  api.claim.mockReturnValue(pending.promise);
  openWallet();
  const button = await screen.findByText('Điểm danh +10 Coin');
  fireEvent.press(button);
  fireEvent.press(button);
  await waitFor(() => expect(api.claim).toHaveBeenCalledTimes(1));
  api.tasks.mockResolvedValue({ ...tasks, checkedIn: true });
  api.wallet.mockResolvedValue({ ...empty, balance: 10 });
  await act(async () => pending.resolve({ received: true, reward: 10, balance: 10 }));
  expect(await screen.findByText('Đã nhận 10 Coin!')).toBeTruthy();
  expect(screen.getByText('Đã điểm danh hôm nay')).toBeTruthy();
});
test('wallet shows sanitized failure and allows explicit refresh', async () => {
  api.tasks.mockRejectedValue(new ApiError(0, 'Không thể kết nối máy chủ.'));
  openWallet();
  expect(await screen.findByText('Không thể kết nối máy chủ.')).toBeTruthy();
  expect(api.claim).not.toHaveBeenCalled();
});
test('unlock guest cannot purchase; insufficient coins shows clear message', async () => {
  openUnlock();
  expect(
    await screen.findByText('Bạn chưa đủ Coin. Điểm danh hoặc hoàn thành nhiệm vụ để nhận thêm.'),
  ).toBeTruthy();
  fireEvent.press(screen.getByText('Mở khóa với 10 Coin'));
  expect(api.unlock).not.toHaveBeenCalled();
});
test('VIP unlock requires confirmation and cancellation never buys', async () => {
  api.wallet.mockResolvedValue({ ...empty, balance: 10 });
  const opened = openUnlock();
  await screen.findByText('Số dư: 10 Coin');
  fireEvent.press(screen.getByText('Mở khóa với 10 Coin'));
  fireEvent.press(screen.getByText('Hủy'));
  expect(api.unlock).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Mở khóa với 10 Coin'));
  fireEvent.press(screen.getByText('Xác nhận'));
  await waitFor(() => expect(opened).toHaveBeenCalledTimes(1));
  expect(api.unlock).toHaveBeenCalledWith(chapterId, 10, expect.anything());
});
test('VIP guest sees login instead of a purchase request', async () => {
  authSession.store.setState({ status: 'guest', user: null });
  openUnlock();
  expect(await screen.findByText('Đăng nhập để mở khóa')).toBeTruthy();
  expect(api.wallet).not.toHaveBeenCalled();
  expect(api.unlock).not.toHaveBeenCalled();
});
test('already-unlocked response offers read without another debit', async () => {
  api.access.mockResolvedValue({
    id: chapterId,
    storyId,
    title: 'Chương riêng',
    type: 'COMIC',
    isVip: true,
    coinPrice: 10,
    canRead: true,
  });
  const opened = openUnlock();
  fireEvent.press(await screen.findByText('Đọc chương đã mở khóa'));
  expect(opened).toHaveBeenCalledTimes(1);
  expect(api.unlock).not.toHaveBeenCalled();
});
