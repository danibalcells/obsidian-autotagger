import { Notice } from "obsidian";
import type { App } from "obsidian";
import type { AutoTaggerSettings } from "../types";
import type { EntityRegistry } from "../registry/entity-registry";
import type { TagRegistry } from "../registry/tag-registry";
import { createLLMAdapter } from "../llm";
import { mergeFrontmatter, splitFrontmatter } from "../frontmatter";
import { withPreservedMtime } from "../mtime";
import { PreviewModal } from "../ui/preview-modal";
import { scanBody } from "../entity-scanner";
import { injectWikilinks, resolvedEntitiesToSpanMatches } from "../wikilink-injector";
import { resolveAndAssembleEntities } from "./entity-pipeline";

export async function tagCurrentNote(
  app: App,
  settings: AutoTaggerSettings,
  entityRegistry: EntityRegistry,
  tagRegistry: TagRegistry,
  getApiKey: () => string
): Promise<void> {
  const file = app.workspace.getActiveFile();
  if (!file) {
    new Notice("AutoTagger: No active file.");
    return;
  }

  new Notice("AutoTagger: Analyzing note…");

  try {
    const fullContent = await app.vault.read(file);
    const { body } = splitFrontmatter(fullContent);
    const fileCache = app.metadataCache.getFileCache(file);
    const existingTags: string[] = fileCache?.frontmatter?.tags ?? [];

    const entries = entityRegistry.getEntries();
    const scan = scanBody(body, entries, settings.entityAliasStrictCaseMinLength);
    const excludePrefixes = settings.excludeTagPrefixes ?? [];

    const tags = tagRegistry
      .getEntries()
      .filter((t) => !excludePrefixes.some((p) => t.tag.startsWith(p)));

    const adapter = createLLMAdapter(settings, getApiKey());
    const allowNewTags = settings.newTagsPolicy === "allow-suggestions";

    const llmResponse = await adapter.tag({
      body,
      title: file.basename,
      existingTags,
      detectedEntities: scan.unambiguous.map((m) => ({
        canonical: m.candidates[0].canonicalName,
        type: m.candidates[0].type,
      })),
      ambiguities: scan.ambiguous.map((m) => ({
        surface: m.surface,
        contextSnippet: body.slice(
          Math.max(0, m.spanStart - 60),
          Math.min(body.length, m.spanEnd + 60)
        ),
        options: m.candidates.map((c) => ({
          canonical: c.canonicalName,
          type: c.type,
          description: c.description,
        })),
      })),
      tags,
      allowNewTags,
      newTagsNamespace: settings.newTagsNamespace,
    });

    const resolved = resolveAndAssembleEntities(scan, llmResponse, entityRegistry, body);

    new PreviewModal(
      app,
      {
        people: resolved.filter((e) => e.type === "person").map((e) => e.canonical),
        organizations: resolved.filter((e) => e.type === "organization").map((e) => e.canonical),
        places: resolved.filter((e) => e.type === "place").map((e) => e.canonical),
        tags: llmResponse.tags,
        new_tags: llmResponse.new_tags,
      },
      async () => {
        await withPreservedMtime(app, file, settings.preserveMtime, async () => {
          await mergeFrontmatter(app, file, llmResponse, resolved, allowNewTags);

          const spanMatches = resolvedEntitiesToSpanMatches(resolved);
          if (spanMatches.length > 0) {
            const updated = await app.vault.read(file);
            const { header, body: currentBody } = splitFrontmatter(updated);
            const newBody = injectWikilinks(currentBody, spanMatches);
            if (newBody !== currentBody) {
              await app.vault.modify(file, header + newBody);
            }
          }
        });
        new Notice("AutoTagger: Tags applied.");
      }
    ).open();
  } catch (err) {
    console.error("AutoTagger error:", err);
    new Notice(
      `AutoTagger: Error — ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
