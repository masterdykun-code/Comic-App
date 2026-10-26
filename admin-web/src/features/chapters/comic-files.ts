const names = new Intl.Collator('en', { numeric: true });
export function sortComicFiles(files: File[]): File[] {
  return [...files].sort(
    (a, b) => names.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  );
}

export function reorder<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || to < 0 || from >= items.length || to >= items.length || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}
