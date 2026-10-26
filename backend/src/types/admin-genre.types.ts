export interface GenreInput { name: string; slug: string; }
export interface GenreRow extends GenreInput { id: string; createdAt: Date; }
export interface AdminGenreTransaction {
  adminIsActive(id: string): Promise<boolean>;
  find(id: string): Promise<GenreRow | null>;
  create(input: GenreInput): Promise<GenreRow>;
  update(id: string, input: Partial<GenreInput>): Promise<GenreRow>;
  usage(id: string): Promise<number>;
  remove(id: string): Promise<void>;
}
export interface AdminGenreStore {
  transaction<T>(work: (tx: AdminGenreTransaction) => Promise<T>): Promise<T>;
}
