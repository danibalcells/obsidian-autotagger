import { describe, it, expect } from "vitest";
import { parseLLMResponse } from "../src/llm/parser";

describe("parseLLMResponse", () => {
  it("parses a valid new-schema JSON response", () => {
    const json = JSON.stringify({
      tags: ["tech/ai"],
      new_tags: [],
      disambiguations: [{ surface: "John", chosen: "John Smith" }],
      extra_candidates: {
        people: ["María González"],
        organizations: ["Anthropic"],
        places: [],
      },
    });
    const result = parseLLMResponse(json);
    expect(result.tags).toEqual(["tech/ai"]);
    expect(result.new_tags).toEqual([]);
    expect(result.disambiguations).toEqual([{ surface: "John", chosen: "John Smith" }]);
    expect(result.extra_candidates.people).toEqual(["María González"]);
    expect(result.extra_candidates.organizations).toEqual(["Anthropic"]);
    expect(result.extra_candidates.places).toEqual([]);
  });

  it("returns empty arrays for invalid JSON", () => {
    const result = parseLLMResponse("not valid json at all");
    expect(result.tags).toEqual([]);
    expect(result.new_tags).toEqual([]);
    expect(result.disambiguations).toEqual([]);
    expect(result.extra_candidates.people).toEqual([]);
  });

  it("strips markdown code fences", () => {
    const json =
      "```json\n" +
      JSON.stringify({
        tags: ["tech/ai"],
        new_tags: [],
        disambiguations: [],
        extra_candidates: { people: [], organizations: [], places: [] },
      }) +
      "\n```";
    const result = parseLLMResponse(json);
    expect(result.tags).toEqual(["tech/ai"]);
  });

  it("handles missing fields gracefully", () => {
    const json = JSON.stringify({ tags: ["topic/ai"] });
    const result = parseLLMResponse(json);
    expect(result.tags).toEqual(["topic/ai"]);
    expect(result.disambiguations).toEqual([]);
    expect(result.extra_candidates.people).toEqual([]);
  });

  it("sets chosen to null when disambiguation has null value", () => {
    const json = JSON.stringify({
      tags: [],
      new_tags: [],
      disambiguations: [{ surface: "John", chosen: null }],
      extra_candidates: { people: [], organizations: [], places: [] },
    });
    const result = parseLLMResponse(json);
    expect(result.disambiguations[0].chosen).toBeNull();
  });

  it("filters out malformed disambiguation entries", () => {
    const json = JSON.stringify({
      tags: [],
      new_tags: [],
      disambiguations: [
        { surface: "John", chosen: "John Smith" },
        { chosen: "orphan" },
        42,
      ],
      extra_candidates: { people: [], organizations: [], places: [] },
    });
    const result = parseLLMResponse(json);
    expect(result.disambiguations).toHaveLength(1);
    expect(result.disambiguations[0].surface).toBe("John");
  });
});
