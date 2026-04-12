import { describe, it, expect } from "vitest";
import { parseLLMResponse } from "../src/llm/parser";

describe("parseLLMResponse", () => {
  it("parses a valid flat JSON response", () => {
    const json = JSON.stringify({
      people: ["Alice", "Bob"],
      organizations: ["Acme Corp"],
      places: ["Zurich"],
      tags: ["tech/ai"],
      new_tags: [],
    });
    const result = parseLLMResponse(json);
    expect(result.people).toEqual(["Alice", "Bob"]);
    expect(result.organizations).toEqual(["Acme Corp"]);
    expect(result.places).toEqual(["Zurich"]);
    expect(result.tags).toEqual(["tech/ai"]);
    expect(result.new_tags).toEqual([]);
  });

  it("returns empty arrays for invalid JSON", () => {
    const result = parseLLMResponse("not valid json at all");
    expect(result.people).toEqual([]);
    expect(result.organizations).toEqual([]);
    expect(result.places).toEqual([]);
    expect(result.tags).toEqual([]);
    expect(result.new_tags).toEqual([]);
  });

  it("strips markdown code fences", () => {
    const json = "```json\n" + JSON.stringify({ people: ["Alice"], organizations: [], places: [], tags: [], new_tags: [] }) + "\n```";
    const result = parseLLMResponse(json);
    expect(result.people).toEqual(["Alice"]);
  });

  it("filters non-string items from arrays", () => {
    const json = JSON.stringify({
      people: ["Alice", 42, null, true],
      organizations: [],
      places: [],
      tags: [],
      new_tags: [],
    });
    const result = parseLLMResponse(json);
    expect(result.people).toEqual(["Alice"]);
  });

  it("handles missing fields gracefully", () => {
    const json = JSON.stringify({ tags: ["topic/ai"] });
    const result = parseLLMResponse(json);
    expect(result.people).toEqual([]);
    expect(result.tags).toEqual(["topic/ai"]);
  });
});
