import type { LLMResponse } from "../types";

const EMPTY: LLMResponse = {
  people: [],
  organizations: [],
  places: [],
  tags: [],
  new_tags: [],
};

export function parseLLMResponse(text: string): LLMResponse {
  try {
    const raw = text.trim();
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonText = fenceMatch ? fenceMatch[1] : raw;
    const json = JSON.parse(jsonText);
    return {
      people: toStringArray(json.people),
      organizations: toStringArray(json.organizations),
      places: toStringArray(json.places),
      tags: toStringArray(json.tags),
      new_tags: toStringArray(json.new_tags),
    };
  } catch {
    return { ...EMPTY };
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}
