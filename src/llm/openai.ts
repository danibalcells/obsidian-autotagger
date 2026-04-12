import { requestUrl } from "obsidian";
import type { LLMAdapter } from "./types";
import type { AutoTaggerSettings, LLMResponse, RegistryContext } from "../types";
import { buildSystemPrompt, buildUserMessage } from "./prompt-builder";
import { parseLLMResponse } from "./parser";

export class OpenAIAdapter implements LLMAdapter {
  constructor(private settings: AutoTaggerSettings) {}

  async tag(content: string, context: RegistryContext): Promise<LLMResponse> {
    const allowNew = this.settings.newTagsPolicy === "allow-suggestions";
    const systemPrompt = buildSystemPrompt(
      this.settings.systemPrompt,
      context,
      allowNew,
      this.settings.newTagsNamespace
    );
    const userMessage = buildUserMessage(content, this.settings.maxInputTokens);

    const response = await requestUrl({
      url: "https://api.openai.com/v1/chat/completions",
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.settings.apiKey}`,
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
