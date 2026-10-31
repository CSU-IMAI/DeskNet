import Fuse from "fuse.js";
import type { Category, Item, SortKey } from "../types";

export interface SearchDocument extends Item {
  categoryText: string;
  categoryNames: string[];
  cleanExtension: string;
}

export function createSearchIndex(
  items: Item[],
  categories: Category[],
): Fuse<SearchDocument> {
  const names = new Map(categories.map((category) => [category.id, category.name]));
  const documents: SearchDocument[] = items.map((item) => {
    const categoryNames = item.categories
      .map((id) => names.get(id))
      .filter((name): name is string => Boolean(name));
    return {
      ...item,
      categoryNames,
      categoryText: categoryNames.join(" "),
      cleanExtension: item.extension.replace(/^\./, ""),
    };
  });
  return new Fuse(documents, {
    keys: [
      { name: "name", weight: 0.62 },
      { name: "categoryText", weight: 0.16 },
      { name: "target", weight: 0.12 },
      { name: "cleanExtension", weight: 0.1 },
    ],
    threshold: 0.32,
    distance: 300,
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 1,
    shouldSort: true,
    findAllMatches: true,
  });
}

export function searchItems(
  index: Fuse<SearchDocument>,
  query: string,
): Item[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return [];
  const results = index.search(trimmed);
  if (results.length === 0) return [];

  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const matchesStrictly = (document: SearchDocument) => {
    const haystack = [
      document.name,
      document.cleanExtension,
      document.target ?? "",
      document.categoryText,
    ]
      .join(" ")
      .toLowerCase();
    return tokens.every((token) => {
      if (token.length <= 2) {
        return Array.from(token).every((character) => haystack.includes(character));
      }
      return haystack.includes(token);
    });
  };

  const strict = results.filter((result) => matchesStrictly(result.item));
  const pool = strict.length > 0 ? strict : results;
  return pool
    .map((result) => {
      const document = result.item;
      const haystack = [
        document.name,
        document.cleanExtension,
        document.target ?? "",
        document.categoryText,
      ]
        .join(" ")
        .toLowerCase();
      return {
        item: document,
        exact: haystack.includes(trimmed),
        score: result.score ?? 1,
      };
    })
    .sort((a, b) => {
      if (a.exact !== b.exact) return a.exact ? -1 : 1;
      return a.score - b.score;
    })
    .map((entry) => entry.item);
}

export function sortItems(items: Item[], sort: SortKey): Item[] {
  const copy = [...items];
  switch (sort) {
    case "name":
      return copy.sort((a, b) =>
        a.name.localeCompare(b.name, "zh-CN", { numeric: true, sensitivity: "base" }),
      );
    case "size":
      return copy.sort((a, b) => b.size - a.size);
    case "opened":
      return copy.sort((a, b) => (b.lastOpened ?? 0) - (a.lastOpened ?? 0));
    case "modified":
    default:
      return copy.sort((a, b) => b.modified - a.modified);
  }
}
