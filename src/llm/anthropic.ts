import { requestUrl } from "obsidian";
import type { LLMAdapter } from "./types";
import type { AutoTaggerSettings, LLMResponse, RegistryContext } from "../types";
import { buildSystemPrompt, buildUserMessage } from "./prompt-builder";
import { parseLLMResponse } from "./parser";

export class AnthropicAdapter implements LLMAdapter {
  constructor(private settings: AutoTaggerSettings, private apiKey: string) {}

  async tag(content: string, context: RegistryContext, existingTags: string[]): Promise<LLMResponse> {
    const allowNew = this.settings.newTagsPolicy === "allow-suggestions";
    const systemPrompt = buildSystemPrompt(
      this.settings.systemPrompt,
      context,
      allowNew,
      this.settings.newTagsNamespace
    );
    const userMessage = buildUserMessage(content, this.settings.maxInputTokens, existingTags);

    const response = await requestUrl({
      url: "https://api.anthropic.com/v1/messages",
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.settings.modelName,
        max_tokens: this.settings.maxOutputTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });

    const text: string = response.json.content?.[0]?.text ?? "";
    return parseLLMResponse(text);
  }
}
