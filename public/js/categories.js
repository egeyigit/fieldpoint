import { api } from './api.js';
import { CATEGORIES as FALLBACK } from './constants.js';

// Mutable live map of slug -> { label, color }. Starts as the built-in fallback
// so the first paint (and the map, if a slug is missing) always has something to
// show, then is replaced by the database-backed list once loaded.
let active = { ...FALLBACK };

export function getCategories() {
  return active;
}

/** Colour for a slug, falling back to the built-in "other" colour. */
export function categoryColor(slug) {
  return active[slug]?.color ?? FALLBACK.other.color;
}

/** Label for a slug, falling back to the raw slug so unknown values still read. */
export function categoryLabel(slug) {
  return active[slug]?.label ?? slug;
}

/** Loads the active categories from the API; keeps the fallback on failure. */
export async function loadCategories() {
  try {
    const { categories } = await api.listSiteCategories();
    active = Object.fromEntries(
      categories.map((category) => [category.slug, { label: category.label, color: category.color }]),
    );
  } catch {
    // Network hiccup: keep whatever we already have rather than blanking pins.
  }
  return active;
}
