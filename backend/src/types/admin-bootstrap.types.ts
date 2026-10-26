export interface AdminInput { username: string; email: string; displayName: string; password: string; }
export interface AdminCreated { id: string; role: 'ADMIN'; status: 'ACTIVE'; }
export interface AdminBootstrapTransaction {
  hasAdmin(): Promise<boolean>;
  identityExists(username: string, email: string): Promise<boolean>;
  create(data: Omit<AdminInput, 'password'> & { passwordHash: string }): Promise<AdminCreated>;
}
export interface AdminBootstrapStore {
  hasAdmin(): Promise<boolean>;
  // Implementation must acquire the shared bootstrap lock before calling work.
  transaction<T>(work: (tx: AdminBootstrapTransaction) => Promise<T>): Promise<T>;
}
export interface AdminTerminal {
  assertInteractive(): void;
  ask(label: string): Promise<string>;
  secret(label: string): Promise<string>;
  write(message: string): void;
  close(): void;
}
