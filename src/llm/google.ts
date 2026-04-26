import { requestUrl } from "obsidian";
import type { LLMAdapter } from "./types";
import type { AutoTaggerSettings, LLMResponse, RegistryContext } from "../types";
import { buildSystemPrompt, buildUserMessage } from "./prompt-builder";
import { parseLLMResponse } from "./parser";

export class GoogleAdapter implements LLMAdapter {
  constructor(private settings: AutoTaggerSettings, private apiKey: string) {}

  async tag(content: string, context: RegistryContext, existingTags: string[], title?: string): Promise<LLMResponse> {
    const allowNew = this.settings.newTagsPolicy === "allow-suggestions";
    const systemPrompt = buildSystemPrompt(
      this.settings.systemPrompt,
      context,
      allowNew,
      this.settings.newTagsNamespace
    );
    const userMessage = buildUserMessage(content, this.settings.maxInputTokens, existingTags, title);

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
