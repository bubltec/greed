/** URL-safe slug, capped so ids stay readable in links. */
export function slugify(input: string, maxLength = 60): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, maxLength).replace(/-+$/g, '') || 'untitled';
}

/** Short random id for child rows (references, perspectives, relations, sections). */
export function newId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

/** A slug that doesn't collide with `taken`, suffixing -2, -3, ... when needed. */
export function uniqueSlug(title: string, taken: ReadonlySet<string>): string {
  const base = slugify(title);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}
