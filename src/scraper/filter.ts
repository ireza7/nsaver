import type { Gallery, FilterOptions } from "../types/index.js";

/** Filter galleries based on filter options */
export function filterGalleries(
  galleries: Gallery[],
  options: FilterOptions
): Gallery[] {
  let filtered = [...galleries];

  // Filter by required tags (gallery must have ALL specified tags)
  if (options.tags && options.tags.length > 0) {
    const requiredTags = options.tags.map((t) => t.toLowerCase());
    filtered = filtered.filter((g) => {
      const gTags = g.tags.map((t) => t.toLowerCase());
      return requiredTags.every((rt) => gTags.includes(rt));
    });
  }

  // Exclude galleries that have any of the excluded tags
  if (options.excludeTags && options.excludeTags.length > 0) {
    const excluded = options.excludeTags.map((t) => t.toLowerCase());
    filtered = filtered.filter((g) => {
      const gTags = g.tags.map((t) => t.toLowerCase());
      return !excluded.some((et) => gTags.includes(et));
    });
  }

  // Filter by language
  if (options.language) {
    const lang = options.language.toLowerCase();
    filtered = filtered.filter(
      (g) => g.language.toLowerCase() === lang
    );
  }

  // Limit count
  if (options.maxCount && options.maxCount > 0) {
    filtered = filtered.slice(0, options.maxCount);
  }

  return filtered;
}

/** Extract all unique tags from a list of galleries */
export function extractUniqueTags(galleries: Gallery[]): string[] {
  const tagSet = new Set<string>();
  for (const g of galleries) {
    for (const t of g.tags) {
      tagSet.add(t.toLowerCase());
    }
  }
  return Array.from(tagSet).sort();
}

/** Get tag frequency map */
export function getTagFrequency(
  galleries: Gallery[]
): Map<string, number> {
  const freq = new Map<string, number>();
  for (const g of galleries) {
    for (const t of g.tags) {
      const key = t.toLowerCase();
      freq.set(key, (freq.get(key) || 0) + 1);
    }
  }
  return freq;
}

/** Get the top N most common tags */
export function getTopTags(galleries: Gallery[], n: number): string[] {
  const freq = getTagFrequency(galleries);
  return Array.from(freq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([tag]) => tag);
}
