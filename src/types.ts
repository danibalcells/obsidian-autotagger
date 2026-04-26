export interface EntityEntry {
  canonicalName: string;
  aliases: string[];
  type: "person" | "organization" | "place";
  description: string;
  filePath: string;
}

export interface TagEntry {
  tag: string;
  description: string;
  count: number;
}

export interface RegistryContext {
  entities: EntityEntry[];
  tags: TagEntry[];
}

export interface LLMResponse {
  tags: string[];
  new_tags: string[];
  disambiguations: { surface: string; chosen: string | null }[];
  extra_candidates: {
    people: string[];
    organizations: string[];
    places: string[];
  };
}

/**
 * A single fully-resolved entity ready for frontmatter and wikilink injection.
 * spanStart/spanEnd are -1 when the entity has no body match (e.g. came from
 * extra_candidates but had no text span to anchor to).
 */
export interface ResolvedEntity {
  canonical: string;
  type: "person" | "organization" | "place";
  spanStart: number;
  spanEnd: number;
  surface: string;
}

export type LLMProvider = "openai" | "anthropic" | "google" | "ollama";

export type NewTagsPolicy = "existing-only" | "allow-suggestions";

export type BatchScope =
  | "never-autotagged"
  | "needs-tagging"
  | "untagged"
  | "modified"
  | "all";

export interface AutoTagSettings {
  enabled: boolean;
  gracePeriodMinutes: number;
  checkIntervalMinutes: number;
  includeFolders: string[];
  excludeFolders: string[];
}

export interface AutoTaggerSettings {
  provider: LLMProvider;
  modelName: string;
  apiKeys: Partial<Record<LLMProvider, string>>;
  ollamaUrl: string;
  systemPrompt: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  autoTag: AutoTagSettings;
  preserveMtime: boolean;
  newTagsPolicy: NewTagsPolicy;
  newTagsNamespace: string;
  entityDescriptions: Record<string, string>;
  tagDescriptions: Record<string, string>;
  excludeTagPrefixes: string[];
  /**
   * Aliases shorter than this length require an exact case-sensitive match in
   * the note text before they are linked. Set to 0 to disable (always
   * case-insensitive). Default 5 protects common short aliases like "Anto",
   * "John", "Luis" from matching lowercase occurrences.
   */
  entityAliasStrictCaseMinLength: number;
  lastBatchRun: number;
}

export const DEFAULT_SYSTEM_PROMPT = `You are an intelligent tagging assistant for an Obsidian knowledge base. Analyze the provided note content and return a JSON object with suggested tags and entity links.

You will be given:
- The note content
- Known entities (people, organizations, places) with their aliases
- Known tags with optional descriptions

Rules:
- Only suggest entities that are clearly mentioned or strongly implied in the note
- Only suggest tags from the provided list (unless new tags are explicitly allowed)
- Be conservative: quality over quantity
- Match entities using their canonical name or any alias
- Return only valid JSON, no other text`;

export const DEFAULT_SETTINGS: AutoTaggerSettings = {
  provider: "openai",
  modelName: "gpt-4o-mini",
  apiKeys: {},
  ollamaUrl: "http://localhost:11434",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  maxInputTokens: 8000,
  maxOutputTokens: 1000,
  autoTag: {
    enabled: false,
    gracePeriodMinutes: 10,
    checkIntervalMinutes: 5,
    includeFolders: [],
    excludeFolders: [],
  },
  preserveMtime: true,
  newTagsPolicy: "existing-only",
  newTagsNamespace: "topic/",
  entityDescriptions: {},
  tagDescriptions: {},
  excludeTagPrefixes: ["type/"],
  entityAliasStrictCaseMinLength: 5,
  lastBatchRun: 0,
};

export interface PluginData {
  settings: AutoTaggerSettings;
  tagCache: Record<string, number>;
}
