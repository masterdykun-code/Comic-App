import { createStore } from 'zustand/vanilla';
import { ApiError, safeError } from '../lib/errors';
import { diagnostic, failureDetails } from '../lib/diagnostics';
import type {
  AuthTransport,
  AuthUser,
  LoginInput,
  RefreshVault,
  TokenResponse,
} from '../types/auth';
export interface AuthState {
  status: 'restoring' | 'guest' | 'signing-in' | 'authenticated';
  user: AuthUser | null;
  notice: string | null;
}
const ended = 'Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại.';
function publicUser(raw: AuthUser): AuthUser {
  if (
    !raw ||
    !['USER', 'ADMIN'].includes(raw.role) ||
    raw.status !== 'ACTIVE' ||
    typeof raw.id !== 'string' ||
    typeof raw.username !== 'string'
  )
    throw new ApiError(401, ended);
  const { id, username, email, displayName, avatarUrl, role, status, createdAt, updatedAt } = raw;
  return { id, username, email, displayName, avatarUrl, role, status, createdAt, updatedAt };
}
export function createAuthSession(transport: AuthTransport, vault: RefreshVault, now = Date.now) {
  const store = createStore<AuthState>(() => ({ status: 'restoring', user: null, notice: null }));
  let access: string | null = null;
  let refreshToken: string | null = null;
  let expiresAt = 0;
  let epoch = 0;
  let refreshFlight: Promise<string> | null = null;
  let restoreFlight: Promise<void> | null = null;
  let restored = false;
  let storageQueue: Promise<unknown> = Promise.resolve();
  function storage<T>(work: () => Promise<T>): Promise<T> {
    const next = storageQueue.catch(() => {}).then(work);
    storageQueue = next.catch(() => {});
    return next;
  }
  const current = (generation: number) => {
    if (generation !== epoch) throw new ApiError(401, ended);
  };
  const erase = () => {
    access = refreshToken = null;
    expiresAt = 0;
    refreshFlight = null;
  };
  const revoke = async (token: string | null) => {
    if (token) {
      try {
        await transport.logout(token);
        return true;
      } catch {
        /* Never log credentials or raw transport errors. */
        return false;
      }
    }
    return true;
  };
  async function accept(response: TokenResponse, generation: number) {
    current(generation);
    const user = publicUser(response.user);
    if (
      response.tokenType !== 'Bearer' ||
      !Number.isFinite(response.expiresIn) ||
      response.expiresIn <= 0 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(response.accessToken) ||
      !/^[A-Za-z0-9_-]{64}$/.test(response.refreshToken)
    )
      throw new ApiError(502, 'Phản hồi phiên không hợp lệ.');
    await storage(async () => {
      current(generation);
      await vault.set(response.refreshToken);
    });
    current(generation);
    access = response.accessToken;
    refreshToken = response.refreshToken;
    expiresAt = now() + response.expiresIn * 1000;
    store.setState({ status: 'authenticated', user, notice: null }, true);
  }
  async function invalidate(notice: string | null = ended, revokeRemote = true) {
    const generation = ++epoch;
    const previous = refreshToken;
    erase();
    store.setState({ status: 'guest', user: null, notice }, true);
    const local = await storage(() => vault.remove()).then(
      () => true,
      () => false,
    );
    const remote = !revokeRemote || (await revoke(previous));
    if (generation === epoch && (!local || !remote))
      store.setState({
        notice:
          'Đã đóng phiên trên ứng dụng. Chưa xác nhận xóa phiên lưu hoặc thu hồi trên máy chủ; hãy kiểm tra kết nối và kho lưu an toàn.',
      });
  }
  function refresh(): Promise<string> {
    if (refreshFlight) {
      diagnostic('session.refresh.join');
      return refreshFlight;
    }
    const token = refreshToken;
    const generation = epoch;
    if (!token) return Promise.reject(new ApiError(401, ended));
    const flight = (async () => {
      diagnostic('session.refresh.start');
      let response: TokenResponse | undefined;
      try {
        response = await transport.refresh(token);
        current(generation);
        const user = await transport.me(response.accessToken);
        current(generation);
        await accept({ ...response, user }, generation);
        diagnostic('session.refresh.complete');
        return access!;
      } catch (error) {
        diagnostic('session.refresh.fail', failureDetails(error));
        if (generation === epoch) await invalidate();
        if (response) await revoke(response.refreshToken);
        throw safeError(error);
      }
    })();
    refreshFlight = flight;
    void flight
      .finally(() => {
        if (refreshFlight === flight) refreshFlight = null;
      })
      .catch(() => {});
    return flight;
  }
  return {
    store,
    generation: () => epoch,
    peek: () => access,
    refresh,
    invalidate,
    async token(): Promise<string | null> {
      if (!access) return null;
      return now() < expiresAt - 30000 ? access : refresh();
    },
    async login(input: LoginInput) {
      const previous = refreshToken;
      const generation = ++epoch;
      erase();
      restored = true;
      store.setState({ status: 'signing-in', user: null, notice: null }, true);
      let response: TokenResponse | undefined;
      try {
        await storage(() => vault.remove());
        current(generation);
        await revoke(previous);
        current(generation);
        response = await transport.login(input);
        current(generation);
        const user = await transport.me(response.accessToken);
        await accept({ ...response, user }, generation);
      } catch (error) {
        if (generation === epoch) await invalidate(safeError(error).message);
        if (response) await revoke(response.refreshToken);
        throw safeError(error);
      }
    },
    restore(): Promise<void> {
      if (restoreFlight) return restoreFlight;
      if (restored) return Promise.resolve();
      restored = true;
      const generation = epoch;
      restoreFlight = (async () => {
        diagnostic('session.restore.start');
        try {
          const stored = await storage(() => vault.get());
          current(generation);
          if (!stored) {
            diagnostic('session.restore.empty');
            store.setState({ status: 'guest', user: null, notice: null }, true);
            return;
          }
          if (!/^[A-Za-z0-9_-]{64}$/.test(stored)) {
            await invalidate();
            return;
          }
          refreshToken = stored;
          diagnostic('session.restore.stored');
          await refresh();
          diagnostic('session.restore.complete');
        } catch (error) {
          diagnostic('session.restore.fail', failureDetails(error));
          if (generation === epoch) await invalidate(ended);
        }
      })();
      return restoreFlight;
    },
    async logout() {
      await invalidate(null);
    },
    async passwordChanged(expectedGeneration: number) {
      if (expectedGeneration !== epoch) return;
      // The server already revoked every session in the password-change transaction.
      await invalidate('Đổi mật khẩu thành công. Vui lòng đăng nhập lại.', false);
    },
  };
}
export type AuthSession = ReturnType<typeof createAuthSession>;
