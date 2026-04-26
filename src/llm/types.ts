import type { LLMResponse, TagEntry } from "../types";

export interface AmbiguityOption {
  canonical: string;
  type: string;
  description: string;
}

export interface Ambiguity {
  surface: string;
  contextSnippet: string;
  options: AmbiguityOption[];
}

export interface DetectedEntity {
  canonical: string;
  type: "person" | "organization" | "place";
}

export interface LLMTagRequest {
  body: string;
  title?: string;
  existingTags: string[];
  detectedEntities: DetectedEntity[];
  ambiguities: Ambiguity[];
  tags: TagEntry[];
  allowNewTags: boolean;
  newTagsNamespace: string;
}

export interface LLMAdapter {
  tag(request: LLMTagRequest): Promise<LLMResponse>;
}
