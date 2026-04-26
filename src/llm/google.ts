import { requestUrl } from "obsidian";
import type { LLMAdapter, LLMTagRequest } from "./types";
import type { AutoTaggerSettings, LLMResponse } from "../types";
import { buildSystemPrompt, buildUserMessage } from "./prompt-builder";
import { parseLLMResponse } from "./parser";

export class GoogleAdapter implements LLMAdapter {
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

    const model = this.settings.modelName || "gemini-1.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;

    const response = await requestUrl({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: userMessage }] }],
        generationConfig: {
          maxOutputTokens: this.settings.maxOutputTokens,
          responseMimeType: "application/json",
        },
      }),
    });

    const text: string =
      response.json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    return parseLLMResponse(text);
  }
}
