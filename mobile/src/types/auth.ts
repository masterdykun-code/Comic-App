export interface AuthUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: 'USER' | 'ADMIN';
  status: 'ACTIVE' | 'BANNED';
  createdAt: string;
  updatedAt: string;
}
export interface LoginInput {
  email: string;
  password: string;
}
export interface RegisterInput extends LoginInput {
  username: string;
}
export interface TokenResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}
export interface AuthTransport {
  login(input: LoginInput): Promise<TokenResponse>;
  register(input: RegisterInput): Promise<AuthUser>;
  refresh(refreshToken: string): Promise<TokenResponse>;
  logout(refreshToken: string): Promise<void>;
  me(accessToken: string): Promise<AuthUser>;
}
export interface RefreshVault {
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
}
