import type { AuthTransport, AuthUser, LoginInput, TokenResponse } from '../../types/auth';
import { ApiError, safeError } from '../../lib/api/errors';

export interface SessionView {
  status: 'anonymous' | 'authenticating' | 'authenticated';
  user: AuthUser | null;
  notice: string | null;
}
const expired = 'Phiên đăng nhập đã kết thúc. Vui lòng đăng nhập lại.';
export class Session {
  private view: SessionView = { status: 'anonymous', user: null, notice: null };
  private access: string | null = null;
  private refreshToken: string | null = null;
  private expiresAt = 0;
  private epoch = 0;
  private flight: Promise<string> | null = null;
  private listeners = new Set<() => void>();
  private transport: AuthTransport;
  constructor(transport: AuthTransport) {
    this.transport = transport;
  }
  snapshot = (): SessionView => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  generation = () => this.epoch;
  peek = () => this.access;
  private publish(value: SessionView) {
    this.view = value;
    this.listeners.forEach((fn) => fn());
  }
  private accept(data: TokenResponse) {
    if (data.user.role !== 'ADMIN' || data.user.status !== 'ACTIVE')
      throw new ApiError(403, 'Tài khoản không có quyền truy cập trang quản trị.');
    this.access = data.accessToken;
    this.refreshToken = data.refreshToken;
    this.expiresAt = Date.now() + data.expiresIn * 1000;
    this.publish({ status: 'authenticated', user: data.user, notice: null });
  }
  private clear(notice: string | null) {
    this.epoch++;
    this.access = null;
    this.refreshToken = null;
    this.expiresAt = 0;
    this.flight = null;
    this.publish({ status: 'anonymous', user: null, notice });
  }
  private async revoke(token: string | null) {
    if (token) {
      try {
        await this.transport.logout(token);
      } catch {
        /* No secret-bearing errors/logs; report by caller when needed. */
      }
    }
  }
  async login(input: LoginInput) {
    if (this.view.status === 'authenticating')
      throw new ApiError(409, 'Yêu cầu đăng nhập đang được xử lý.');
    const generation = ++this.epoch;
    this.access = null;
    this.refreshToken = null;
    this.flight = null;
    this.publish({ status: 'authenticating', user: null, notice: null });
    let data: TokenResponse | undefined;
    try {
      data = await this.transport.login(input);
      const user = await this.transport.me(data.accessToken);
      if (generation !== this.epoch) throw new ApiError(401, expired);
      this.accept({ ...data, user });
    } catch (error) {
      await this.revoke(data?.refreshToken ?? null);
      if (generation === this.epoch) this.clear(null);
      throw safeError(error);
    }
  }
  async token(): Promise<string> {
    if (!this.access) throw new ApiError(401, expired);
    if (Date.now() < this.expiresAt - 30_000) return this.access;
    return this.refresh();
  }
  refresh(): Promise<string> {
    if (this.flight) return this.flight;
    const token = this.refreshToken;
    const generation = this.epoch;
    if (!token) return Promise.reject(new ApiError(401, expired));
    const flight = (async () => {
      let replacement: TokenResponse | undefined;
      try {
        replacement = await this.transport.refresh(token);
        if (generation !== this.epoch) throw new ApiError(401, expired);
        this.accept(replacement);
        return replacement.accessToken;
      } catch (error) {
        // A network timeout may have consumed the refresh token. Never replay it.
        if (generation === this.epoch)
          this.clear(
            safeError(error).status === 403 ? 'Quyền quản trị không còn hiệu lực.' : expired,
          );
        // Backend logout accepts an older rotated token and revokes its session.
        void this.revoke(replacement?.refreshToken ?? token);
        throw safeError(error);
      }
    })();
    this.flight = flight;
    void flight
      .finally(() => {
        if (this.flight === flight) this.flight = null;
      })
      .catch(() => {});
    return flight;
  }
  async verify(): Promise<AuthUser> {
    const generation = this.epoch;
    try {
      let token = await this.token();
      let user: AuthUser;
      try {
        user = await this.transport.me(token);
      } catch (error) {
        if (safeError(error).status !== 401) throw error;
        token = this.peek() !== token ? await this.token() : await this.refresh();
        user = await this.transport.me(token); // Exactly one retry.
      }
      if (generation !== this.epoch) throw new ApiError(401, expired);
      if (user.role !== 'ADMIN' || user.status !== 'ACTIVE')
        throw new ApiError(403, 'Quyền quản trị không còn hiệu lực.');
      this.publish({ ...this.view, user });
      return user;
    } catch (error) {
      if (generation === this.epoch) {
        const refresh = this.refreshToken;
        this.clear(
          safeError(error).status === 403 ? 'Quyền quản trị không còn hiệu lực.' : expired,
        );
        void this.revoke(refresh);
      }
      throw safeError(error);
    }
  }
  invalidate(generation: number) {
    if (generation === this.epoch) this.clear(expired);
  }
  async logout(): Promise<boolean> {
    const token = this.refreshToken;
    this.clear(null); // Local state disappears before network I/O.
    const generation = this.epoch;
    if (!token) return true;
    try {
      await this.transport.logout(token);
      return true;
    } catch {
      if (generation === this.epoch)
        this.publish({
          ...this.view,
          notice:
            'Đã đăng xuất trên tab này. Chưa thể xác nhận thu hồi phiên trên máy chủ do lỗi kết nối.',
        });
      return false;
    }
  }
}
