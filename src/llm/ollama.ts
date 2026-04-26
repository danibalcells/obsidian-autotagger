import { requestUrl } from "obsidian";
import type { LLMAdapter, LLMTagRequest } from "./types";
import type { AutoTaggerSettings, LLMResponse } from "../types";
import { buildSystemPrompt, buildUserMessage } from "./prompt-builder";
import { parseLLMResponse } from "./parser";

export class OllamaAdapter implements LLMAdapter {
  constructor(private settings: AutoTaggerSettings) {}

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

    const baseUrl = this.settings.ollamaUrl.replace(/\/$/, "");

    const response = await requestUrl({
      url: `${baseUrl}/api/chat`,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.settings.modelName,
        stream: false,
        format: "json",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        options: { num_predict: this.settings.maxOutputTokens },
      }),
    });

    const text: string = response.json.message?.content ?? "";
    return parseLLMResponse(text);
  }
}
