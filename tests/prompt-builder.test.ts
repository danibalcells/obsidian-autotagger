import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildUserMessage } from "../src/llm/prompt-builder";
import type { TagEntry } from "../src/types";

const tags: TagEntry[] = [
  { tag: "tech/ai", description: "Artificial intelligence topics", count: 5 },
];

describe("buildSystemPrompt", () => {
  it("includes tag names and descriptions", () => {
    const prompt = buildSystemPrompt("Base prompt.\n", tags, false, "topic/", false);
    expect(prompt).toContain("tech/ai");
    expect(prompt).toContain("Artificial intelligence topics");
  });

  it("forbids new tags when allowNewTags is false", () => {
    const prompt = buildSystemPrompt("Base prompt.\n", tags, false, "topic/", false);
    expect(prompt).toContain("Do NOT suggest new tags");
  });

  it("allows new tags with namespace when allowNewTags is true", () => {
    const prompt = buildSystemPrompt("Base prompt.\n", tags, true, "topic/", false);
    expect(prompt).toContain("topic/");
    expect(prompt).not.toContain("Do NOT suggest new tags");
  });

  it("does not include disambiguation instruction when no ambiguities", () => {
    const prompt = buildSystemPrompt("Base prompt.\n", tags, false, "topic/", false);
    expect(prompt).not.toContain("ambiguities");
  });

  it("includes disambiguation instruction when hasAmbiguities is true", () => {
    const prompt = buildSystemPrompt("Base prompt.\n", tags, false, "topic/", true);
    expect(prompt).toContain("disambiguations");
  });

  it("does NOT list entities in the system prompt", () => {
    const prompt = buildSystemPrompt("Base prompt.\n", tags, false, "topic/", false);
    expect(prompt).not.toContain("Known entities");
    expect(prompt).not.toContain("[person]");
  });
});

describe("buildUserMessage", () => {
  it("returns content wrapped in note content header", () => {
    const msg = buildUserMessage("Hello world", undefined, 8000, [], [], []);
    expect(msg).toContain("Note content:");
    expect(msg).toContain("Hello world");
  });

  it("truncates very long content", () => {
    const longContent = "x".repeat(100000);
    const msg = buildUserMessage(longContent, undefined, 100, [], [], []);
    expect(msg).toContain("[... content truncated ...]");
  });

  it("appends existing tags when provided", () => {
    const msg = buildUserMessage("Hello world", undefined, 8000, ["tech/ai"], [], []);
    expect(msg).toContain("Already applied tags: tech/ai");
  });

  it("includes detected entities section", () => {
    const msg = buildUserMessage(
      "Hello",
      undefined,
      8000,
      [],
      [{ canonical: "Alice", type: "person" }],
      []
    );
    expect(msg).toContain("Already detected entities");
    expect(msg).toContain("[person] Alice");
  });

  it("includes ambiguities section", () => {
    const msg = buildUserMessage(
      "Hello",
      undefined,
      8000,
      [],
      [],
      [
        {
          surface: "John",
          contextSnippet: "I saw John at work",
          options: [
            { canonical: "John Smith", type: "person", description: "Engineer" },
            { canonical: "John Doe", type: "person", description: "Designer" },
          ],
        },
      ]
    );
    expect(msg).toContain('surface: "John"');
    expect(msg).toContain("John Smith");
    expect(msg).toContain("John Doe");
  });

  it("omits sections when lists are empty", () => {
    const msg = buildUserMessage("Hello", undefined, 8000, [], [], []);
    expect(msg).not.toContain("Already applied tags");
    expect(msg).not.toContain("Already detected entities");
    expect(msg).not.toContain("Ambiguities");
  });
});
