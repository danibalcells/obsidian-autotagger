import type { ResolvedEntity } from "./types";

export interface SpanMatch {
  spanStart: number;
  spanEnd: number;
  surface: string;
  canonical: string;
}

/**
 * Splits body into H1 sections. Returns the 0-based start index of each H1 heading
 * (the `# ` line), so we know when a new span begins. Notes with no H1 are one span
 * starting at 0.
 */
function getH1Boundaries(body: string): number[] {
  const boundaries: number[] = [0];
  // Fenced code exclusions so we don't pick up # inside code blocks
  const fenceRe = /^(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\1/gm;
  const excluded: [number, number][] = [];
  let fm: RegExpExecArray | null;
  while ((fm = fenceRe.exec(body)) !== null) {
    excluded.push([fm.index, fm.index + fm[0].length]);
  }

  const h1Re = /^# /gm;
  let hm: RegExpExecArray | null;
  while ((hm = h1Re.exec(body)) !== null) {
    const pos = hm.index;
    const inCode = excluded.some(([s, e]) => pos >= s && pos < e);
    if (!inCode && pos > 0) boundaries.push(pos);
  }

  return boundaries;
}

/**
 * For each canonical name, find the set of span indices where it already
 * appears as a wikilink, so we can skip those.
 */
function buildExistingWikilinkSet(
  body: string,
  h1Starts: number[]
): Map<string, Set<number>> {
  const result = new Map<string, Set<number>>();
  const wlRe = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  let wm: RegExpExecArray | null;
  while ((wm = wlRe.exec(body)) !== null) {
    const canonical = wm[1].trim().toLowerCase();
    const spanIdx = getSpanIndex(wm.index, h1Starts);
    if (!result.has(canonical)) result.set(canonical, new Set());
    result.get(canonical)!.add(spanIdx);
  }
  return result;
}

function getSpanIndex(pos: number, h1Starts: number[]): number {
  let idx = 0;
  for (let i = 1; i < h1Starts.length; i++) {
    if (pos >= h1Starts[i]) idx = i;
    else break;
  }
  return idx;
}

/**
 * Injects wikilinks into `body` for each resolved entity that has a body span.
 * Rules:
 * - One wikilink per (H1 span, canonical entity).
 * - Skips spans where a wikilink to that canonical already exists.
 * - Preserves the original surface text: [[Canonical|surface]] if surface ≠ canonical,
 *   otherwise [[Canonical]].
 * - Applies substitutions from end to start to preserve offsets.
 */
export function injectWikilinks(
  body: string,
  matches: SpanMatch[]
): string {
  if (matches.length === 0) return body;

  const h1Starts = getH1Boundaries(body);
  const existingLinks = buildExistingWikilinkSet(body, h1Starts);

  // Track which (spanIdx, canonical) pairs we've already scheduled for injection
  const scheduled = new Map<string, Set<number>>();

  const injections: { start: number; end: number; replacement: string }[] = [];

  for (const match of matches) {
    const spanIdx = getSpanIndex(match.spanStart, h1Starts);
    const canonLower = match.canonical.toLowerCase();

    // Skip if a wikilink for this canonical already exists in this span
    if (existingLinks.get(canonLower)?.has(spanIdx)) continue;

    // Skip if we already scheduled an injection for this (span, canonical) pair
    if (!scheduled.has(canonLower)) scheduled.set(canonLower, new Set());
    if (scheduled.get(canonLower)!.has(spanIdx)) continue;

    const link =
      match.surface === match.canonical
        ? `[[${match.canonical}]]`
        : `[[${match.canonical}|${match.surface}]]`;

    injections.push({ start: match.spanStart, end: match.spanEnd, replacement: link });
    scheduled.get(canonLower)!.add(spanIdx);
  }

  // Sort end-to-start so earlier offsets remain valid after each splice
  injections.sort((a, b) => b.start - a.start);

  let result = body;
  for (const { start, end, replacement } of injections) {
    result = result.slice(0, start) + replacement + result.slice(end);
  }

  return result;
}

/**
 * Converts resolved entities (those with body spans) into SpanMatch objects
 * suitable for wikilink injection.
 */
export function resolvedEntitiesToSpanMatches(
  entities: ResolvedEntity[]
): SpanMatch[] {
  return entities
    .filter((e) => e.spanStart >= 0)
    .map((e) => ({
      spanStart: e.spanStart,
      spanEnd: e.spanEnd,
      surface: e.surface,
      canonical: e.canonical,
    }));
}
