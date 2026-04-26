import type { LLMResponse, ResolvedEntity } from "../types";
import type { EntityRegistry } from "../registry/entity-registry";
import type { ScanResult } from "../entity-scanner";

const FUZZY_HIGH = 0.92;
const WORD_CHAR = "a-zA-ZÀ-ÖØ-öø-ÿ\\d_";
const LB = `(?<![${WORD_CHAR}])`;
const RB = `(?![${WORD_CHAR}])`;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findSpanInBody(
  body: string,
  surface: string,
  canonical: string
): { spanStart: number; spanEnd: number; surface: string } {
  for (const term of [surface, canonical]) {
    if (!term) continue;
    const re = new RegExp(`${LB}${escapeRegex(term)}${RB}`, "i");
    const m = re.exec(body);
    if (m)
      return {
        spanStart: m.index,
        spanEnd: m.index + m[0].length,
        surface: m[0],
      };
  }
  return { spanStart: -1, spanEnd: -1, surface: "" };
}

/**
 * Assembles the final list of resolved entities from:
 *  1. Unambiguous rule-based scanner matches
 *  2. LLM-resolved disambiguation choices
 *  3. LLM extra_candidates, fuzzy-matched against the registry
 */
export function resolveAndAssembleEntities(
  scan: ScanResult,
  llmResponse: LLMResponse,
  entityRegistry: EntityRegistry,
  body: string
): ResolvedEntity[] {
  const resolved: ResolvedEntity[] = [];
  const seen = new Set<string>();

  const add = (e: ResolvedEntity) => {
    if (!seen.has(e.canonical.toLowerCase())) {
      seen.add(e.canonical.toLowerCase());
      resolved.push(e);
    }
  };

  for (const m of scan.unambiguous) {
    const entry = m.candidates[0];
    add({
      canonical: entry.canonicalName,
      type: entry.type,
      spanStart: m.spanStart,
      spanEnd: m.spanEnd,
      surface: m.surface,
    });
  }

  for (const d of llmResponse.disambiguations) {
    if (!d.chosen) continue;
    const ambig = scan.ambiguous.find(
      (m) => m.surface.toLowerCase() === d.surface.toLowerCase()
    );
    if (!ambig) continue;
    const entry = ambig.candidates.find(
      (c) => c.canonicalName.toLowerCase() === d.chosen!.toLowerCase()
    );
    if (!entry) continue;
    add({
      canonical: entry.canonicalName,
      type: entry.type,
      spanStart: ambig.spanStart,
      spanEnd: ambig.spanEnd,
      surface: ambig.surface,
    });
  }

  const extras = [
    ...llmResponse.extra_candidates.people.map((n) => ({
      name: n,
      type: "person" as const,
    })),
    ...llmResponse.extra_candidates.organizations.map((n) => ({
      name: n,
      type: "organization" as const,
    })),
    ...llmResponse.extra_candidates.places.map((n) => ({
      name: n,
      type: "place" as const,
    })),
  ];

  for (const { name, type } of extras) {
    const exact = entityRegistry.resolveCanonicalName(name);
    if (exact) {
      const span = findSpanInBody(body, name, exact);
      add({ canonical: exact, type, ...span });
      continue;
    }

    const fuzzy = entityRegistry.fuzzyMatch(name, FUZZY_HIGH);
    if (fuzzy) {
      const span = findSpanInBody(body, name, fuzzy.canonicalName);
      add({ canonical: fuzzy.canonicalName, type: fuzzy.type, ...span });
      continue;
    }

    const span = findSpanInBody(body, name, name);
    add({ canonical: name, type, ...span });
  }

  return resolved;
}
