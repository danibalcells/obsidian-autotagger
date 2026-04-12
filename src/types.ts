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
  people: string[];
  organizations: string[];
  places: string[];
  tags: string[];
  new_tags: string[];
}

export type LLMProvider = "openai" | "anthropic" | "google" | "ollama";

export type NewTagsPolicy = "existing-only" | "allow-suggestions";

export type BatchScope = "untagged" | "modified" | "all";

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
  apiKey: string;
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
  apiKey: "",
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
  lastBatchRun: 0,
};
