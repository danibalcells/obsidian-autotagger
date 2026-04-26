import { Notice } from "obsidian";
import type { App, TFile } from "obsidian";
import type { AutoTaggerSettings, BatchScope } from "../types";
import type { EntityRegistry } from "../registry/entity-registry";
import type { TagRegistry } from "../registry/tag-registry";
import { createLLMAdapter } from "../llm";
import { mergeFrontmatter, splitFrontmatter } from "../frontmatter";
import { withPreservedMtime } from "../mtime";
import { BatchProgressModal } from "../ui/batch-progress-modal";
import { scanBody } from "../entity-scanner";
import { injectWikilinks, resolvedEntitiesToSpanMatches } from "../wikilink-injector";
import { resolveAndAssembleEntities } from "./entity-pipeline";

export async function batchTag(
  app: App,
  settings: AutoTaggerSettings,
  entityRegistry: EntityRegistry,
  tagRegistry: TagRegistry,
  scope: BatchScope,
  tagCache: Record<string, number>,
  onComplete: (
    lastRun: number,
    cacheUpdates: Record<string, number>
  ) => Promise<void>,
  getApiKey: () => string
): Promise<void> {
  const files = getFilesForScope(app, settings, scope, tagCache);
  if (files.length === 0) {
    new Notice("AutoTagger: No files to process.");
    return;
  }

  let cancelled = false;
  const modal = new BatchProgressModal(app, files.length, () => {
    cancelled = true;
  });
  modal.open();

  const adapter = createLLMAdapter(settings, getApiKey());
  const allowNewTags = settings.newTagsPolicy === "allow-suggestions";
  const excludePrefixes = settings.excludeTagPrefixes ?? [];

  let processed = 0;
  let skipped = 0;
  let errors = 0;
  const cacheUpdates: Record<string, number> = {};

  for (let i = 0; i < files.length; i++) {
    if (cancelled) {
      skipped += files.length - i;
      break;
    }

    const file = files[i];
    modal.update(i + 1, file.name);

    try {
      const fullContent = await app.vault.read(file);
      const { body } = splitFrontmatter(fullContent);
      const fileCache = app.metadataCache.getFileCache(file);
      const existingTags: string[] = fileCache?.frontmatter?.tags ?? [];

      const entries = entityRegistry.getEntries();
      const scan = scanBody(body, entries, settings.entityAliasStrictCaseMinLength);

      const tags = tagRegistry
        .getEntries()
        .filter((t) => !excludePrefixes.some((p) => t.tag.startsWith(p)));

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

      cacheUpdates[file.path] = Date.now();
      processed++;
    } catch (err) {
      console.error(`AutoTagger: error on ${file.path}`, err);
      errors++;
    }
  }

  await onComplete(Date.now(), cacheUpdates);
  modal.showSummary(processed, skipped, errors);
}

function getFilesForScope(
  app: App,
  settings: AutoTaggerSettings,
  scope: BatchScope,
  tagCache: Record<string, number>
): TFile[] {
  const allFiles = app.vault.getMarkdownFiles();
  const { includeFolders, excludeFolders } = settings.autoTag;

  const inScope = (file: TFile): boolean => {
    if (excludeFolders.some((f) => file.path.startsWith(f + "/"))) return false;
    if (
      includeFolders.length > 0 &&
      !includeFolders.some((f) => file.path.startsWith(f + "/"))
    )
      return false;
    if (settings.excludeTagPrefixes?.length > 0) {
      const cache = app.metadataCache.getFileCache(file);
      const tags: string[] = cache?.frontmatter?.tags ?? [];
      if (
        tags.some((tag) =>
          settings.excludeTagPrefixes.some((prefix) => tag.startsWith(prefix))
        )
      )
        return false;
    }
    return true;
  };

  const filtered = allFiles.filter(inScope);

  switch (scope) {
    case "never-autotagged":
      return filtered.filter((f) => !(f.path in tagCache));

    case "needs-tagging":
      return filtered.filter((f) => {
        const lastTagged = tagCache[f.path];
        return lastTagged === undefined || f.stat.mtime > lastTagged;
      });

    case "untagged":
      return filtered.filter((f) => {
        const cache = app.metadataCache.getFileCache(f);
        const tags = cache?.frontmatter?.tags;
        return !tags || (Array.isArray(tags) && tags.length === 0);
      });

    case "modified": {
      const last = settings.lastBatchRun;
      return filtered.filter((f) => f.stat.mtime > last);
    }

    case "all":
      return filtered;
  }
}
