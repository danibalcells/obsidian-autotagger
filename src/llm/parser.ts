import type { LLMResponse } from "../types";

const EMPTY: LLMResponse = {
  tags: [],
  new_tags: [],
  disambiguations: [],
  extra_candidates: { people: [], organizations: [], places: [] },
};

export function parseLLMResponse(text: string): LLMResponse {
  try {
    const raw = text.trim();
    const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const jsonText = fenceMatch ? fenceMatch[1] : raw;
    const json = JSON.parse(jsonText);

    const disambiguations: LLMResponse["disambiguations"] = [];
    if (Array.isArray(json.disambiguations)) {
      for (const d of json.disambiguations) {
        if (typeof d === "object" && d !== null && typeof d.surface === "string") {
          disambiguations.push({
            surface: d.surface,
            chosen: typeof d.chosen === "string" ? d.chosen : null,
          });
        }
      }
    }

    const ec = json.extra_candidates ?? {};
    return {
      tags: toStringArray(json.tags),
      new_tags: toStringArray(json.new_tags),
      disambiguations,
      extra_candidates: {
        people: toStringArray(ec.people),
        organizations: toStringArray(ec.organizations),
        places: toStringArray(ec.places),
      },
    };
  } catch {
    return { ...EMPTY, extra_candidates: { ...EMPTY.extra_candidates } };
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}
