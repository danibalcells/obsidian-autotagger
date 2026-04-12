import type { App, TFile } from "obsidian";
import type { LLMResponse } from "./types";
import type { EntityRegistry } from "./registry/entity-registry";

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
  resolveCanonical: (name: string) => string | null
): void {
  mergeTags(frontmatter, patch.tags, allowNewTags ? patch.new_tags : []);
  mergeEntityLinks(frontmatter, "people", patch.people, resolveCanonical);
  mergeEntityLinks(frontmatter, "organizations", patch.organizations, resolveCanonical);
  mergeEntityLinks(frontmatter, "places", patch.places, resolveCanonical);
}

export async function mergeFrontmatter(
  app: App,
  file: TFile,
  response: LLMResponse,
  entityRegistry: EntityRegistry,
  allowNewTags: boolean
): Promise<void> {
  const patch: FrontmatterPatch = {
    tags: response.tags,
    new_tags: response.new_tags,
    people: response.people,
    organizations: response.organizations,
    places: response.places,
  };

  await app.fileManager.processFrontMatter(file, (frontmatter) => {
    applyPatchToFrontmatter(
      frontmatter,
      patch,
      allowNewTags,
      (name) => entityRegistry.resolveCanonicalName(name)
    );
  });
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
