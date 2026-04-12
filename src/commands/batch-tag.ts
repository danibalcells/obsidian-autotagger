import { Notice } from "obsidian";
import type { App, TFile } from "obsidian";
import type { AutoTaggerSettings, BatchScope } from "../types";
import type { EntityRegistry } from "../registry/entity-registry";
import type { TagRegistry } from "../registry/tag-registry";
import { createLLMAdapter } from "../llm";
import { mergeFrontmatter } from "../frontmatter";
import { withPreservedMtime } from "../mtime";
import { BatchProgressModal } from "../ui/batch-progress-modal";

export async function batchTag(
  app: App,
  settings: AutoTaggerSettings,
  entityRegistry: EntityRegistry,
  tagRegistry: TagRegistry,
  scope: BatchScope,
  onSettingsUpdate: (lastRun: number) => Promise<void>
): Promise<void> {
  const files = getFilesForScope(app, settings, scope);
  if (files.length === 0) {
    new Notice("AutoTagger: No files to process.");
    return;
  }

  let cancelled = false;
  const modal = new BatchProgressModal(app, files.length, () => {
    cancelled = true;
  });
  modal.open();

  const context = {
    entities: entityRegistry.getEntries(),
    tags: tagRegistry.getEntries(),
  };
  const adapter = createLLMAdapter(settings);
  const allowNewTags = settings.newTagsPolicy === "allow-suggestions";

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < files.length; i++) {
    if (cancelled) {
      skipped += files.length - i;
      break;
    }

    const file = files[i];
    modal.update(i + 1, file.name);

    try {
      const content = await app.vault.read(file);
      const response = await adapter.tag(content, context);

      await withPreservedMtime(app, file, settings.preserveMtime, async () => {
        await mergeFrontmatter(app, file, response, entityRegistry, allowNewTags);
      });
      processed++;
    } catch (err) {
      console.error(`AutoTagger: error on ${file.path}`, err);
      errors++;
    }
  }

  await onSettingsUpdate(Date.now());
  modal.showSummary(processed, skipped, errors);
}

function getFilesForScope(
  app: App,
  settings: AutoTaggerSettings,
  scope: BatchScope
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
    return true;
  };

  const filtered = allFiles.filter(inScope);

  switch (scope) {
    case "untagged": {
      return filtered.filter((f) => {
        const cache = app.metadataCache.getFileCache(f);
        const tags = cache?.frontmatter?.tags;
        return !tags || (Array.isArray(tags) && tags.length === 0);
      });
    }
    case "modified": {
      const last = settings.lastBatchRun;
      return filtered.filter((f) => f.stat.mtime > last);
    }
    case "all":
      return filtered;
  }
}
