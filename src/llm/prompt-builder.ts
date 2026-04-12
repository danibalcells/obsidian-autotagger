import type { RegistryContext } from "../types";

export function buildSystemPrompt(
  basePrompt: string,
  context: RegistryContext,
  allowNewTags: boolean,
  newTagsNamespace: string
): string {
  const entityLines = context.entities
    .map((e) => {
      const aliasStr =
        e.aliases.length > 0 ? ` (aliases: ${e.aliases.join(", ")})` : "";
      const descStr = e.description ? ` — ${e.description}` : "";
      return `  - [${e.type}] ${e.canonicalName}${aliasStr}${descStr}`;
    })
    .join("\n");

  const tagLines = context.tags
    .map((t) => {
      const descStr = t.description ? ` — ${t.description}` : "";
      return `  - ${t.tag}${descStr}`;
    })
    .join("\n");

  const newTagsInstruction = allowNewTags
    ? `You MAY suggest new tags, but they must follow the namespace convention: start with "${newTagsNamespace}". Place them in "new_tags".`
    : 'Do NOT suggest new tags. Leave "new_tags" as an empty array.';

  return `${basePrompt}

${newTagsInstruction}

Known entities:
${entityLines || "  (none)"}

Known tags:
${tagLines || "  (none)"}

Respond with JSON matching exactly this schema:
{
  "people": ["canonical name of person"],
  "organizations": ["canonical name of organization"],
  "places": ["canonical name of place"],
  "tags": ["existing-tag"],
  "new_tags": ["topic/new-tag"]
}`;
}

export function buildUserMessage(content: string, maxInputTokens: number): string {
  const charLimit = maxInputTokens * 4;
  const truncated =
    content.length > charLimit
      ? content.slice(0, charLimit) + "\n[... content truncated ...]"
      : content;
  return `Note content:\n\n${truncated}`;
}
