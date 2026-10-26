import { afterEach, describe, expect, it, vi } from 'vitest';
import { Session } from '../src/features/auth/session';
import { ApiError } from '../src/lib/api/errors';
import { admin, deferred, initial, input, rotated, transport } from './fixtures';
import type { TokenResponse } from '../src/types/auth';

afterEach(() => vi.restoreAllMocks());
describe('memory-only ADMIN session', () => {
  it('authenticates with /me and publishes only public profile data', async () => {
    const api = transport();
    const session = new Session(api);
    await session.login(input);
    expect(api.me).toHaveBeenCalledWith(initial.accessToken);
    expect(session.snapshot().status).toBe('authenticated');
    expect(JSON.stringify(session.snapshot())).not.toContain(initial.accessToken);
    expect(JSON.stringify(session.snapshot())).not.toContain(initial.refreshToken);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
  it.each(['USER', 'BANNED'] as const)(
    'blocks %s accounts and revokes their issued session',
    async (kind) => {
      const api = transport();
      api.me.mockResolvedValue(
        kind === 'USER' ? { ...admin, role: 'USER' } : { ...admin, status: 'BANNED' },
      );
      const session = new Session(api);
      await expect(session.login(input)).rejects.toMatchObject({ status: 403 });
      expect(session.snapshot().status).toBe('anonymous');
      expect(session.peek()).toBeNull();
      expect(api.logout).toHaveBeenCalledWith(initial.refreshToken);
    },
  );
  it('single-flights refresh and uses the rotated token in the next refresh', async () => {
    const api = transport();
    const wait = deferred<TokenResponse>();
    api.refresh.mockReturnValueOnce(wait.promise);
    const session = new Session(api);
    await session.login(input);
    const one = session.refresh();
    const two = session.refresh();
    expect(one).toBe(two);
    wait.resolve(rotated);
    await Promise.all([one, two]);
    expect(api.refresh).toHaveBeenCalledTimes(1);
    await session.refresh();
    expect(api.refresh).toHaveBeenLastCalledWith(rotated.refreshToken);
  });
  it('refreshes when access expiry approaches', async () => {
    const api = transport();
    const session = new Session(api);
    await session.login(input);
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 880_000);
    expect(await session.token()).toBe(rotated.accessToken);
    expect(api.refresh).toHaveBeenCalledTimes(1);
  });
  it('does not retry expired refresh tokens or reuse one after an uncertain network result', async () => {
    for (const error of [new ApiError(401, 'Expired'), new ApiError(0, 'Network')]) {
      const api = transport();
      const session = new Session(api);
      await session.login(input);
      api.refresh.mockRejectedValue(error);
      await expect(session.refresh()).rejects.toBeInstanceOf(ApiError);
      await expect(session.refresh()).rejects.toMatchObject({ status: 401 });
      expect(api.refresh).toHaveBeenCalledTimes(1);
      expect(session.snapshot().status).toBe('anonymous');
    }
  });
  it('rechecks role from the server and ends a demoted ADMIN session', async () => {
    const api = transport();
    const session = new Session(api);
    await session.login(input);
    api.me.mockResolvedValue({ ...admin, role: 'USER' });
    await expect(session.verify()).rejects.toMatchObject({ status: 403 });
    expect(session.snapshot().status).toBe('anonymous');
  });
  it('retries /me only once after 401, then ends the session', async () => {
    const api = transport();
    const session = new Session(api);
    await session.login(input);
    api.me.mockRejectedValue(new ApiError(401, 'Unauthorized'));
    await expect(session.verify()).rejects.toMatchObject({ status: 401 });
    expect(api.refresh).toHaveBeenCalledTimes(1);
    expect(api.me).toHaveBeenCalledTimes(3);
  });
  it('clears local state immediately when logout is offline and reports unconfirmed revocation', async () => {
    const api = transport();
    const session = new Session(api);
    await session.login(input);
    const wait = deferred<void>();
    api.logout.mockReturnValue(wait.promise);
    const operation = session.logout();
    expect(session.snapshot().status).toBe('anonymous');
    expect(session.peek()).toBeNull();
    wait.reject(new ApiError(0, 'Network'));
    expect(await operation).toBe(false);
    expect(session.snapshot().notice).toContain('Chưa thể xác nhận');
  });
  it('does not resurrect a session when refresh completes after logout', async () => {
    const api = transport();
    const session = new Session(api);
    await session.login(input);
    const wait = deferred<TokenResponse>();
    api.refresh.mockReturnValue(wait.promise);
    const operation = session.refresh();
    const rejection = expect(operation).rejects.toMatchObject({ status: 401 });
    await session.logout();
    wait.resolve(rotated);
    await rejection;
    expect(session.snapshot().status).toBe('anonymous');
    expect(api.logout).toHaveBeenCalledWith(rotated.refreshToken);
  });
  it('does not resurrect a late login after logout', async () => {
    const api = transport();
    const session = new Session(api);
    const wait = deferred<TokenResponse>();
    api.login.mockReturnValue(wait.promise);
    const login = session.login(input);
    const rejection = expect(login).rejects.toMatchObject({ status: 401 });
    await session.logout();
    wait.resolve(initial);
    await rejection;
    expect(session.peek()).toBeNull();
    expect(api.logout).toHaveBeenCalledWith(initial.refreshToken);
  });
});
