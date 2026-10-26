import type { PublicUser } from "./auth.types";
export type AdminUserQuery = {
  page: number;
  limit: number;
  search?: string;
  status?: "ACTIVE" | "BANNED";
};
export type AdminUserStatusInput = {
  status: "ACTIVE" | "BANNED";
  confirm: true;
  expectedUpdatedAt: string;
};
export type DashboardStats = {
  users: { total: number; active: number; banned: number };
  stories: { total: number; novels: number; comics: number; published: number };
  totalChapters: number;
  readingEvents: number;
  readingMetric: "STORED_AUTHENTICATED_HISTORY";
  popularStories: Array<{
    id: string;
    title: string;
    type: "NOVEL" | "COMIC";
    publishStatus: "DRAFT" | "PUBLISHED";
    readCount: number;
  }>;
};
export interface AdminUsersTransaction {
  adminIsActive(id: string): Promise<boolean>;
  list(query: AdminUserQuery): Promise<{ data: PublicUser[]; total: number }>;
  user(id: string, lock?: boolean): Promise<PublicUser | null>;
  setStatus(
    id: string,
    status: "ACTIVE" | "BANNED",
    now: Date,
  ): Promise<PublicUser>;
  stats(): Promise<DashboardStats>;
}
export interface AdminUsersStore {
  transaction<T>(
    mode: "read" | "write",
    work: (tx: AdminUsersTransaction) => Promise<T>,
  ): Promise<T>;
}
