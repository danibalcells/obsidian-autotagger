import { requestUrl } from "obsidian";
import type { LLMAdapter, LLMTagRequest } from "./types";
import type { AutoTaggerSettings, LLMResponse } from "../types";
import { buildSystemPrompt, buildUserMessage } from "./prompt-builder";
import { parseLLMResponse } from "./parser";

export class OpenAIAdapter implements LLMAdapter {
  constructor(private settings: AutoTaggerSettings, private apiKey: string) {}

  async tag(request: LLMTagRequest): Promise<LLMResponse> {
    const systemPrompt = buildSystemPrompt(
      this.settings.systemPrompt,
      request.tags,
      request.allowNewTags,
      request.newTagsNamespace,
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
      url: "https://api.openai.com/v1/chat/completions",
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.settings.modelName,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        max_tokens: this.settings.maxOutputTokens,
        response_format: { type: "json_object" },
      }),
    });

    const text: string = response.json.choices?.[0]?.message?.content ?? "";
    return parseLLMResponse(text);
  }
}
