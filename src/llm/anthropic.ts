import { requestUrl } from "obsidian";
import type { LLMAdapter, LLMTagRequest } from "./types";
import type { AutoTaggerSettings, LLMResponse } from "../types";
import { buildSystemPrompt, buildUserMessage } from "./prompt-builder";
import { parseLLMResponse } from "./parser";

export class AnthropicAdapter implements LLMAdapter {
  constructor(private settings: AutoTaggerSettings, private apiKey: string) {}

  async tag(request: LLMTagRequest): Promise<LLMResponse> {
    const systemPrompt = buildSystemPrompt(
      this.settings.systemPrompt,
      request.tags,
      request.allowNewTags,
      request.newTagsNamespace,
      request.ambiguities.length > 0
    );
    const userMessage = buildUserMessage(
      request.body,
      request.title,
      this.settings.maxInputTokens,
      request.existingTags,
      request.detectedEntities,
      request.ambiguities
    );

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
