import type { LLMAdapter } from "./types";
import type { AutoTaggerSettings } from "../types";
import { OpenAIAdapter } from "./openai";
import { AnthropicAdapter } from "./anthropic";
import { GoogleAdapter } from "./google";
import { OllamaAdapter } from "./ollama";

export function createLLMAdapter(settings: AutoTaggerSettings): LLMAdapter {
  switch (settings.provider) {
    case "openai":
      return new OpenAIAdapter(settings);
    case "anthropic":
      return new AnthropicAdapter(settings);
    case "google":
      return new GoogleAdapter(settings);
    case "ollama":
      return new OllamaAdapter(settings);
  }
}
