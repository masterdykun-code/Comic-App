import { renderRouter, screen, fireEvent, waitFor } from 'expo-router/testing-library';
import RootLayout from '../src/app/_layout';
import Tabs from '../src/app/(tabs)/_layout';
import Home from '../src/app/(tabs)/index';
import Explore from '../src/app/(tabs)/explore';
import Library from '../src/app/(tabs)/library';
import Profile from '../src/app/(tabs)/profile';
import Login from '../src/app/login';
import Register from '../src/app/register';
import ForgotPassword from '../src/app/forgot-password';
import Story from '../src/app/story/[id]';
import Reader from '../src/app/reader/[id]';
import Account from '../src/app/account';
import Search from '../src/app/search';
import Rankings from '../src/app/rankings';
import { rankingsApi } from '../src/features/rankings/api';
import History from '../src/app/history';
import Bookmarks from '../src/app/bookmarks';
import Feedback from '../src/app/feedback/[id]';
import { catalogApi } from '../src/features/stories/api';
import { novel, result } from './catalog-fixtures';
import { authSession } from '../src/services/runtime';
import { user } from './fixtures';
import { readerApi } from '../src/features/reader/api';
import { novelChapter } from './reader-fixtures';

jest.mock('../src/services/runtime', () => {
  const { createStore } = jest.requireActual('zustand/vanilla');
  return {
    authSession: {
      store: createStore(() => ({ status: 'guest', user: null, notice: null })),
      restore: jest.fn(async () => {}),
      peek: jest.fn(() => null),
      generation: jest.fn(() => 0),
      refresh: jest.fn(async () => 'test'),
    },
  };
});
jest.mock('../src/features/stories/api', () => ({
  ...jest.requireActual('../src/features/stories/api'),
  catalogApi: { stories: jest.fn(), story: jest.fn(), chapters: jest.fn(), genres: jest.fn() },
}));
jest.mock('../src/features/reader/api', () => ({
  ...jest.requireActual('../src/features/reader/api'),
  readerApi: { chapter: jest.fn(), progress: jest.fn(), save: jest.fn(), history: jest.fn() },
}));
const routes = {
  _layout: RootLayout,
  '(tabs)/_layout': Tabs,
  '(tabs)/index': Home,
  '(tabs)/explore': Explore,
  '(tabs)/library': Library,
  '(tabs)/profile': Profile,
  login: Login,
  register: Register,
  'forgot-password': ForgotPassword,
  'story/[id]': Story,
  'reader/[id]': Reader,
  account: Account,
  search: Search,
  rankings: Rankings,
  history: History,
  bookmarks: Bookmarks,
  'feedback/[id]': Feedback,
};
jest.mock('../src/features/rankings/api', () => ({
  ...jest.requireActual('../src/features/rankings/api'),
  rankingsApi: { list: jest.fn() },
}));
beforeEach(() => {
  jest.mocked(rankingsApi.list).mockResolvedValue({
    success: true,
    data: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    ranking: { kind: 'reads', readMetric: 'STORED_AUTHENTICATED_HISTORY' },
  });
  authSession.store.setState({ status: 'guest', user: null, notice: null });
  jest.mocked(readerApi.chapter).mockResolvedValue(novelChapter);
  jest.mocked(catalogApi.stories).mockResolvedValue(result([]));
  jest.mocked(catalogApi.genres).mockResolvedValue([]);
  jest.mocked(catalogApi.story).mockResolvedValue(novel);
  jest.mocked(catalogApi.chapters).mockResolvedValue(result([], 1, 0, 20));
});
test('initializes the real Router layouts and all four bottom tabs for a Guest', async () => {
  renderRouter(routes, { initialUrl: '/' });
  expect(await screen.findByText('Câu chuyện tiếp theo của bạn.')).toBeVisible();
  for (const label of ['Home', 'Explore', 'Library', 'Profile'])
    expect(screen.getByLabelText(label)).toBeVisible();
  expect((await screen.findAllByText('Chưa có truyện được xuất bản')).length).toBe(3);
});
test('Guest can navigate all bottom tabs and browse public content', async () => {
  renderRouter(routes, { initialUrl: '/' });
  fireEvent.press(await screen.findByLabelText('Explore'));
  await waitFor(() => expect(screen).toHavePathname('/explore'));
  expect(await screen.findByText('Chưa có truyện phù hợp')).toBeVisible();
  fireEvent.press(screen.getByLabelText('Library'));
  await waitFor(() => expect(screen).toHavePathname('/library'));
  expect(screen.getByText('Giữ lại câu chuyện yêu thích')).toBeVisible();
  fireEvent.press(screen.getByLabelText('Profile'));
  await waitFor(() => expect(screen).toHavePathname('/profile'));
  expect(screen.getByText('Chào bạn đọc')).toBeVisible();
});
test('login/register show forms and navigation without submitting an account request', async () => {
  renderRouter(routes, { initialUrl: '/login' });
  expect(await screen.findByLabelText('Email')).toBeVisible();
  expect(screen.getByLabelText('Mật khẩu')).toBeVisible();
  fireEvent.press(screen.getByText('Chưa có tài khoản? Đăng ký'));
  await waitFor(() => expect(screen).toHavePathname('/register'));
  expect(screen.getByText('Tạo tài khoản độc giả')).toBeVisible();
});
test('Guest protected deep link redirects to Login without hiding public tabs', async () => {
  renderRouter(routes, { initialUrl: '/account' });
  await waitFor(() => expect(screen).toHavePathname('/login'));
  expect(await screen.findByLabelText('Email')).toBeVisible();
});
test.each(['USER', 'ADMIN'] as const)(
  'active %s can open the protected reader account without admin controls',
  async (role) => {
    authSession.store.setState({ status: 'authenticated', user: { ...user, role }, notice: null });
    renderRouter(routes, { initialUrl: '/account' });
    expect(await screen.findByText(user.displayName)).toBeVisible();
    expect(screen.queryByText('Tạo truyện')).toBeNull();
  },
);
test('BANNED session cannot render protected account', async () => {
  authSession.store.setState({
    status: 'authenticated',
    user: { ...user, status: 'BANNED' },
    notice: null,
  });
  renderRouter(routes, { initialUrl: '/account' });
  await waitFor(() => expect(screen).toHavePathname('/login'));
});
test('Guest can open a public NOVEL Reader without signing in', async () => {
  renderRouter(routes, { initialUrl: `/reader/${novelChapter.id}?storyId=${novel.id}` });
  expect(await screen.findByText(novelChapter.title)).toBeVisible();
});
test('invalid Story deep links show a safe error instead of fetching data', async () => {
  renderRouter(routes, { initialUrl: '/story/invalid' });
  expect(await screen.findByText('Liên kết không hợp lệ. ID cần có định dạng UUID.')).toBeVisible();
});

test('Home ranking shortcut opens the real public Ranking screen and returns with Back', async () => {
  renderRouter(routes, { initialUrl: '/' });
  fireEvent.press(await screen.findByLabelText('Bảng xếp hạng truyện'));
  await waitFor(() => expect(screen).toHavePathname('/rankings'));
  expect(await screen.findByText('Chưa có truyện trong bảng này')).toBeVisible();
  fireEvent.press(screen.getByRole('button', { name: 'Quay lại' }));
  await waitFor(() => expect(screen).toHavePathname('/'));
});
