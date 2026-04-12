import { describe, it, expect } from "vitest";
import { applyPatchToFrontmatter } from "../src/frontmatter";

const noResolve = (_name: string) => null;
const resolveAlias = (name: string) =>
  name === "A. Flores" ? "Alex Flores" : null;

describe("applyPatchToFrontmatter", () => {
  it("adds tags to an empty frontmatter", () => {
    const fm: Record<string, unknown> = {};
    applyPatchToFrontmatter(
      fm,
      { tags: ["tech/ai"], new_tags: [], people: [], organizations: [], places: [] },
      false,
      noResolve
    );
    expect(fm.tags).toEqual(["tech/ai"]);
  });

  it("merges tags without duplicating", () => {
    const fm: Record<string, unknown> = { tags: ["tech/ai"] };
    applyPatchToFrontmatter(
      fm,
      { tags: ["tech/ai", "topic/llm"], new_tags: [], people: [], organizations: [], places: [] },
      false,
      noResolve
    );
    expect(fm.tags).toEqual(["tech/ai", "topic/llm"]);
  });

  it("ignores new_tags when policy is existing-only", () => {
    const fm: Record<string, unknown> = {};
    applyPatchToFrontmatter(
      fm,
      { tags: [], new_tags: ["topic/novel"], people: [], organizations: [], places: [] },
      false,
      noResolve
    );
    expect(fm.tags).toBeUndefined();
  });

  it("includes new_tags when allowNewTags is true", () => {
    const fm: Record<string, unknown> = {};
    applyPatchToFrontmatter(
      fm,
      { tags: [], new_tags: ["topic/novel"], people: [], organizations: [], places: [] },
      true,
      noResolve
    );
    expect(fm.tags).toEqual(["topic/novel"]);
  });

  it("adds entity wikilinks for people", () => {
    const fm: Record<string, unknown> = {};
    applyPatchToFrontmatter(
      fm,
      { tags: [], new_tags: [], people: ["Alice"], organizations: [], places: [] },
      false,
      noResolve
    );
    expect(fm.people).toEqual(["[[Alice]]"]);
  });

  it("resolves entity aliases to canonical names", () => {
    const fm: Record<string, unknown> = {};
    applyPatchToFrontmatter(
      fm,
      { tags: [], new_tags: [], people: ["A. Flores"], organizations: [], places: [] },
      false,
      resolveAlias
    );
    expect(fm.people).toEqual(["[[Alex Flores]]"]);
  });

  it("does not duplicate existing entity wikilinks", () => {
    const fm: Record<string, unknown> = { people: ["[[Alice]]"] };
    applyPatchToFrontmatter(
      fm,
      { tags: [], new_tags: [], people: ["Alice"], organizations: [], places: [] },
      false,
      noResolve
    );
    expect(fm.people).toEqual(["[[Alice]]"]);
  });

  it("is case-insensitive when deduplicating tags", () => {
    const fm: Record<string, unknown> = { tags: ["Tech/AI"] };
    applyPatchToFrontmatter(
      fm,
      { tags: ["tech/ai"], new_tags: [], people: [], organizations: [], places: [] },
      false,
      noResolve
    );
    expect(fm.tags).toEqual(["Tech/AI"]);
  });
});
