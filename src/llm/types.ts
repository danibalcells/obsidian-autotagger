import type { LLMResponse, RegistryContext } from "../types";

export interface LLMAdapter {
  tag(content: string, context: RegistryContext, existingTags: string[], title?: string): Promise<LLMResponse>;
}
