import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildUserMessage } from "../src/llm/prompt-builder";
import type { RegistryContext } from "../src/types";

const context: RegistryContext = {
  entities: [
    {
      canonicalName: "Alice",
      aliases: ["Al"],
      type: "person",
      description: "Engineer",
      filePath: "Resources/People/Alice.md",
    },
  ],
  tags: [
    { tag: "tech/ai", description: "Artificial intelligence topics", count: 5 },
  ],
};

describe("buildSystemPrompt", () => {
  it("includes entity names and aliases", () => {
    const prompt = buildSystemPrompt("Base prompt.\n", context, false, "topic/");
    expect(prompt).toContain("Alice");
    expect(prompt).toContain("Al");
    expect(prompt).toContain("[person]");
  });

  it("includes tag names and descriptions", () => {
    const prompt = buildSystemPrompt("Base prompt.\n", context, false, "topic/");
    expect(prompt).toContain("tech/ai");
    expect(prompt).toContain("Artificial intelligence topics");
  });

  it("forbids new tags when allowNewTags is false", () => {
    const prompt = buildSystemPrompt("Base prompt.\n", context, false, "topic/");
    expect(prompt).toContain("Do NOT suggest new tags");
  });

  it("allows new tags with namespace when allowNewTags is true", () => {
    const prompt = buildSystemPrompt("Base prompt.\n", context, true, "topic/");
    expect(prompt).toContain("topic/");
    expect(prompt).not.toContain("Do NOT suggest new tags");
  });
});

describe("buildUserMessage", () => {
  it("returns content wrapped in note content header", () => {
    const msg = buildUserMessage("Hello world", 8000);
    expect(msg).toContain("Note content:");
    expect(msg).toContain("Hello world");
  });

  it("truncates very long content", () => {
    const longContent = "x".repeat(100000);
    const msg = buildUserMessage(longContent, 100);
    expect(msg).toContain("[... content truncated ...]");
  });

  it("does not truncate content within limits", () => {
    const content = "Short note.";
    const msg = buildUserMessage(content, 8000);
    expect(msg).not.toContain("truncated");
    expect(msg).toContain("Short note.");
  });
});
