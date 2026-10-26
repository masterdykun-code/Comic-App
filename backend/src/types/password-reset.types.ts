export interface ResetMailer {
  assertConfigured(): void;
  send(to: string, code: string): Promise<void>;
}
export interface PasswordResetStore {
  issue(
    email: string,
    hash: (userId: string) => string,
    now: Date,
  ): Promise<{ email: string } | null>;
  consume(
    email: string,
    hash: (userId: string) => string,
    newPasswordHash: string,
    now: Date,
  ): Promise<boolean>;
}
export type ResetPasswordInput = {
  email: string;
  code: string;
  newPassword: string;
  confirmPassword: string;
};
