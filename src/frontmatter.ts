import type { App, TFile } from "obsidian";
import type { LLMResponse, ResolvedEntity } from "./types";

export interface FrontmatterPatch {
  tags: string[];
  new_tags: string[];
  people: string[];
  organizations: string[];
  places: string[];
}

export function applyPatchToFrontmatter(
  frontmatter: Record<string, unknown>,
  patch: FrontmatterPatch,
  allowNewTags: boolean,
  resolveCanonical: (name: string) => string | null = () => null
): void {
  mergeTags(frontmatter, patch.tags, allowNewTags ? patch.new_tags : []);
  mergeEntityLinks(frontmatter, "people", patch.people, resolveCanonical);
  mergeEntityLinks(frontmatter, "organizations", patch.organizations, resolveCanonical);
  mergeEntityLinks(frontmatter, "places", patch.places, resolveCanonical);
}

export async function mergeFrontmatter(
  app: App,
  file: TFile,
  llmResponse: LLMResponse,
  resolvedEntities: ResolvedEntity[],
  allowNewTags: boolean
): Promise<void> {
  const people = resolvedEntities
    .filter((e) => e.type === "person")
    .map((e) => e.canonical);
  const organizations = resolvedEntities
    .filter((e) => e.type === "organization")
    .map((e) => e.canonical);
  const places = resolvedEntities
    .filter((e) => e.type === "place")
    .map((e) => e.canonical);

  const patch: FrontmatterPatch = {
    tags: llmResponse.tags,
    new_tags: llmResponse.new_tags,
    people,
    organizations,
    places,
  };

  await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    applyPatchToFrontmatter(frontmatter, patch, allowNewTags);
  });
}

/** Splits file content into the YAML frontmatter header and the body. */
export function splitFrontmatter(content: string): {
  header: string;
  body: string;
} {
  if (!content.startsWith("---")) return { header: "", body: content };
  const end = content.indexOf("\n---", 3);
  if (end === -1) return { header: "", body: content };
  const headerEnd = end + 4; // include closing `---`
  // consume the newline immediately after closing ---
  const bodyStart =
    headerEnd < content.length && content[headerEnd] === "\n"
      ? headerEnd + 1
      : headerEnd;
  return {
    header: content.slice(0, bodyStart),
    body: content.slice(bodyStart),
  };
}

function mergeTags(
  frontmatter: Record<string, unknown>,
  tags: string[],
  newTags: string[]
): void {
  const all = [...tags, ...newTags];
  if (all.length === 0) return;

  if (!Array.isArray(frontmatter.tags)) {
    frontmatter.tags = [];
  }

  const existing = new Set(
    (frontmatter.tags as string[]).map((t) => t.toLowerCase())
  );
  for (const tag of all) {
    if (!existing.has(tag.toLowerCase())) {
      (frontmatter.tags as string[]).push(tag);
      existing.add(tag.toLowerCase());
    }
  }
}

function mergeEntityLinks(
  frontmatter: Record<string, unknown>,
  property: string,
  names: string[],
  resolveCanonical: (name: string) => string | null
): void {
  if (names.length === 0) return;

  if (!Array.isArray(frontmatter[property])) {
    frontmatter[property] = [];
  }

  const existing = new Set(
    (frontmatter[property] as string[]).map((l) =>
      stripWikilink(l).toLowerCase()
    )
  );

  for (const name of names) {
    const canonical = resolveCanonical(name) ?? name;
    if (!existing.has(canonical.toLowerCase())) {
      (frontmatter[property] as string[]).push(`[[${canonical}]]`);
      existing.add(canonical.toLowerCase());
    }
  }
}

function stripWikilink(s: string): string {
  return s.replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0].trim();
}
