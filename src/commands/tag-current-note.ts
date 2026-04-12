import { Notice } from "obsidian";
import type { App } from "obsidian";
import type { AutoTaggerSettings } from "../types";
import type { EntityRegistry } from "../registry/entity-registry";
import type { TagRegistry } from "../registry/tag-registry";
import { createLLMAdapter } from "../llm";
import { mergeFrontmatter } from "../frontmatter";
import { withPreservedMtime } from "../mtime";
import { PreviewModal } from "../ui/preview-modal";

export async function tagCurrentNote(
  app: App,
  settings: AutoTaggerSettings,
  entityRegistry: EntityRegistry,
  tagRegistry: TagRegistry
): Promise<void> {
  const file = app.workspace.getActiveFile();
  if (!file) {
    new Notice("AutoTagger: No active file.");
    return;
  }

  new Notice("AutoTagger: Analyzing note…");

  try {
    const content = await app.vault.read(file);
    const context = {
      entities: entityRegistry.getEntries(),
      tags: tagRegistry.getEntries(),
    };

    const adapter = createLLMAdapter(settings);
    const response = await adapter.tag(content, context);

    new PreviewModal(app, response, async () => {
      await withPreservedMtime(app, file, settings.preserveMtime, async () => {
        await mergeFrontmatter(
          app,
          file,
          response,
          entityRegistry,
          settings.newTagsPolicy === "allow-suggestions"
        );
      });
      new Notice("AutoTagger: Tags applied.");
    }).open();
  } catch (err) {
    console.error("AutoTagger error:", err);
    new Notice(
      `AutoTagger: Error — ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
