import { requestUrl } from "obsidian";
import type { LLMAdapter } from "./types";
import type { AutoTaggerSettings, LLMResponse, RegistryContext } from "../types";
import { buildSystemPrompt, buildUserMessage } from "./prompt-builder";
import { parseLLMResponse } from "./parser";

export class OllamaAdapter implements LLMAdapter {
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
