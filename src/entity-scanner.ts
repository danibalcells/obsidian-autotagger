import type { EntityEntry } from "./types";

export interface EntityMatch {
  spanStart: number;
  spanEnd: number;
  surface: string;
  candidates: EntityEntry[];
}

export interface ScanResult {
  unambiguous: EntityMatch[];
  ambiguous: EntityMatch[];
}

function buildExclusionIntervals(body: string): [number, number][] {
  const intervals: [number, number][] = [];

  const patterns = [
    /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1/gm,
    /`[^`\n]+`/g,
    /\[\[[^\]]+\]\]/g,
    /\[[^\]]*\]\([^)]*\)/g,
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      intervals.push([m.index, m.index + m[0].length]);
    }
  }

  intervals.sort((a, b) => a[0] - b[0]);

  const merged: [number, number][] = [];
  for (const [s, e] of intervals) {
    if (merged.length === 0 || merged[merged.length - 1][1] < s) {
      merged.push([s, e]);
    } else {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], e);
    }
  }
  return merged;
}

function isExcluded(
  start: number,
  end: number,
  intervals: [number, number][]
): boolean {
  for (const [s, e] of intervals) {
    if (start < e && end > s) return true;
    if (s > end) break;
  }
  return false;
}

function buildAliasIndex(entries: EntityEntry[]): Map<string, EntityEntry[]> {
  const index = new Map<string, EntityEntry[]>();
  const add = (term: string, entry: EntityEntry) => {
    const key = term.toLowerCase();
    const existing = index.get(key);
    if (existing) {
      if (!existing.includes(entry)) existing.push(entry);
    } else {
      index.set(key, [entry]);
    }
  };
  for (const entry of entries) {
    add(entry.canonicalName, entry);
    for (const alias of entry.aliases) add(alias, entry);
  }
  return index;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word boundary that handles accented/Unicode Latin characters
const WORD_CHAR = "a-zA-ZÀ-ÖØ-öø-ÿ\\d_";
const LB = `(?<![${WORD_CHAR}])`;
const RB = `(?![${WORD_CHAR}])`;

export function scanBody(
  body: string,
  entries: EntityEntry[],
  strictCaseMinLength: number
): ScanResult {
  if (entries.length === 0) return { unambiguous: [], ambiguous: [] };

  const aliasIndex = buildAliasIndex(entries);

  // Collect unique terms (original case), sorted longest-first for greedy matching
  const seenLower = new Set<string>();
  const terms: string[] = [];
  for (const entry of entries) {
    for (const term of [entry.canonicalName, ...entry.aliases]) {
      if (!seenLower.has(term.toLowerCase())) {
        seenLower.add(term.toLowerCase());
        terms.push(term);
      }
    }
  }
  terms.sort((a, b) => b.length - a.length);

  const pattern = terms
    .map((t) => `${LB}${escapeRegex(t)}${RB}`)
    .join("|");
  const re = new RegExp(pattern, "gi");

  const exclusions = buildExclusionIntervals(body);
  const unambiguous: EntityMatch[] = [];
  const ambiguous: EntityMatch[] = [];
  let lastEnd = -1;

  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const start = m.index;
    const surface = m[0];
    const end = start + surface.length;

    if (isExcluded(start, end, exclusions)) continue;
    if (start < lastEnd) continue;

    let candidates = aliasIndex.get(surface.toLowerCase()) ?? [];

    // Strict case: for short aliases, require the surface to exactly match
    // the alias as registered (respects configured threshold)
    if (strictCaseMinLength > 0 && surface.length < strictCaseMinLength) {
      candidates = candidates.filter(
        (e) =>
          e.canonicalName === surface ||
          e.aliases.some((a) => a === surface)
      );
      if (candidates.length === 0) continue;
    }

    lastEnd = end;
    const match: EntityMatch = { spanStart: start, spanEnd: end, surface, candidates };
    if (candidates.length === 1) {
      unambiguous.push(match);
    } else {
      ambiguous.push(match);
    }
  }

  return { unambiguous, ambiguous };
}
