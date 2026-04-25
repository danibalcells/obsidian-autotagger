import type { LLMAdapter } from "./types";
import type { AutoTaggerSettings } from "../types";
import { OpenAIAdapter } from "./openai";
import { AnthropicAdapter } from "./anthropic";
import { GoogleAdapter } from "./google";
import { OllamaAdapter } from "./ollama";

export function createLLMAdapter(settings: AutoTaggerSettings, apiKey: string): LLMAdapter {
  switch (settings.provider) {
    case "openai":
      return new OpenAIAdapter(settings, apiKey);
    case "anthropic":
      return new AnthropicAdapter(settings, apiKey);
    case "google":
      return new GoogleAdapter(settings, apiKey);
    case "ollama":
      return new OllamaAdapter(settings);
  }
}
