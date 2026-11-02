import Fuse from "fuse.js";
import type { Category, FolderContent, Item, SortKey } from "../types";

export interface SearchDocument extends Item {
  categoryText: string;
  categoryNames: string[];
  contentText: string;
  parentText: string;
  cleanExtension: string;
}

function folderContentItem(folder: Item, content: FolderContent): Item {
  const separator = folder.path.includes("\\") ? "\\" : "/";
  return {
    id: `folderfile:${folder.key}/${content.relative}`,
    key: `${folder.key}/${content.relative}`,
    kind: "file",
    name: content.name,
    path: `${folder.path}${separator}${content.relative}`,
    target: null,
    extension: content.extension,
    size: content.size,
    modified: content.modified,
    categories: folder.categories,
    favorite: folder.favorite,
    lastOpened: null,
    missing: false,
    source: `位于「${folder.name}」`,
    createdAt: null,
    encrypted: folder.encrypted,
    originalSize: content.size,
    icon: null,
    contents: [],
    contentCount: 0,
  };
}

export function createSearchIndex(
  items: Item[],
  categories: Category[],
): Fuse<SearchDocument> {
  const names = new Map(categories.map((category) => [category.id, category.name]));
  const documents: SearchDocument[] = [];
  const addDocument = (item: Item, parentText = "") => {
    const categoryNames = item.categories
      .map((id) => names.get(id))
      .filter((name): name is string => Boolean(name));
    documents.push({
      ...item,
      categoryNames,
      categoryText: categoryNames.join(" "),
      contentText: item.contents.map((entry) => entry.name).join(" "),
      parentText,
      cleanExtension: item.extension.replace(/^\./, ""),
    });
  };

  for (const item of items) {
    if (item.kind === "folder" && item.contents.length > 0) {
      // The library keeps one folder card, but search must return concrete
      // files so the user can open an individual target.
      for (const content of item.contents) {
        addDocument(folderContentItem(item, content), item.name);
      }
    } else {
      addDocument(item);
    }
  }
  return new Fuse(documents, {
    keys: [
      { name: "name", weight: 0.58 },
      { name: "parentText", weight: 0.16 },
      { name: "categoryText", weight: 0.12 },
      { name: "target", weight: 0.08 },
      { name: "cleanExtension", weight: 0.06 },
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
      document.contentText,
      document.parentText,
      document.source ?? "",
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
        document.contentText,
        document.parentText,
        document.source ?? "",
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
