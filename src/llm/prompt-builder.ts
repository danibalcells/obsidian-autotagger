import type { TagEntry } from "../types";
import type { Ambiguity, DetectedEntity } from "./types";

export function buildSystemPrompt(
  basePrompt: string,
  tags: TagEntry[],
  allowNewTags: boolean,
  newTagsNamespace: string,
): string {
  const tagLines = tags
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

For each entry in "ambiguities" below (if any), pick exactly one of the listed canonical names and place it in "disambiguations" as { "surface": "...", "chosen": "..." }. If none of the options fit the context, use null.

You will also receive a list of entities already detected in the note. Do NOT repeat these in "extra_candidates".
For any people, organizations, or places that are clearly named in the note text and NOT already detected, output them in "extra_candidates" using the name exactly as it appears in the text. Only include proper nouns — specific named individuals, organizations, or locations. Never include generic words like "person", "place", "organization", "someone", "people", "somewhere", etc.

Known tags:
${tagLines || "  (none)"}

Respond with JSON matching exactly this schema:
{
  "tags": ["existing-tag"],
  "new_tags": ["topic/new-tag"],
  "disambiguations": [{ "surface": "...", "chosen": "canonical name or null" }],
  "extra_candidates": {
    "people": ["Name as written"],
    "organizations": ["Name as written"],
    "places": ["Name as written"]
  }
}`;
}

export function buildUserMessage(
  body: string,
  title: string | undefined,
  maxInputTokens: number,
  existingTags: string[],
  detectedEntities: DetectedEntity[],
  ambiguities: Ambiguity[]
): string {
  const charLimit = maxInputTokens * 4;
  const truncated =
    body.length > charLimit
      ? body.slice(0, charLimit) + "\n[... content truncated ...]"
      : body;

  const titleLine = title ? `Note title: ${title}\n\n` : "";

  const existingTagsLine =
    existingTags.length > 0
      ? `\nAlready applied tags: ${existingTags.join(", ")}\nOnly suggest tags NOT already listed above.\n`
      : "";

  const detectedLine =
    detectedEntities.length > 0
      ? `\nAlready detected entities:\n${detectedEntities
          .map((e) => `  - [${e.type}] ${e.canonical}`)
          .join("\n")}\n`
      : "";

  const ambiguitiesLine =
    ambiguities.length > 0
      ? `\nAmbiguities to resolve:\n${ambiguities
          .map(
            (a) =>
              `  surface: "${a.surface}"\n  context: "${a.contextSnippet}"\n  options:\n${a.options
                .map(
                  (o) =>
                    `    - ${o.canonical} [${o.type}]${o.description ? `: ${o.description}` : ""}`
                )
                .join("\n")}`
          )
          .join("\n\n")}\n`
      : "";

  return `${titleLine}Note content:\n\n${truncated}${existingTagsLine}${detectedLine}${ambiguitiesLine}`;
}
