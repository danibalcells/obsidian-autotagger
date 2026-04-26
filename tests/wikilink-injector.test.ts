import { describe, it, expect } from "vitest";
import { injectWikilinks } from "../src/wikilink-injector";
import type { SpanMatch } from "../src/wikilink-injector";

const match = (
  canonical: string,
  surface: string,
  spanStart: number
): SpanMatch => ({
  canonical,
  surface,
  spanStart,
  spanEnd: spanStart + surface.length,
});

describe("injectWikilinks", () => {
  it("injects [[Canonical]] when surface equals canonical", () => {
    const body = "I met Alice today.";
    const result = injectWikilinks(body, [match("Alice", "Alice", 6)]);
    expect(result).toBe("I met [[Alice]] today.");
  });

  it("injects [[Canonical|surface]] when surface differs", () => {
    const body = "I met luiso today.";
    const result = injectWikilinks(body, [match("Luis Socas", "luiso", 6)]);
    expect(result).toBe("I met [[Luis Socas|luiso]] today.");
  });

  it("only injects once per H1 span per canonical", () => {
    const body = "Alice and Alice again.";
    const result = injectWikilinks(body, [
      match("Alice", "Alice", 0),
      match("Alice", "Alice", 10),
    ]);
    expect(result).toBe("[[Alice]] and Alice again.");
  });

  it("injects again after a new H1 heading", () => {
    const body = "Alice was here.\n\n# New section\n\nAlice came back.";
    const alicePos = body.lastIndexOf("Alice");
    const result = injectWikilinks(body, [
      match("Alice", "Alice", 0),
      match("Alice", "Alice", alicePos),
    ]);
    expect(result).toContain("[[Alice]] was here.");
    expect(result).toContain("# New section\n\n[[Alice]] came back.");
  });

  it("skips spans where the wikilink already exists", () => {
    const body = "[[Alice]] is great.";
    const result = injectWikilinks(body, [match("Alice", "Alice", 2)]);
    expect(result).toBe("[[Alice]] is great.");
  });

  it("returns body unchanged if no matches", () => {
    const body = "No entities here.";
    expect(injectWikilinks(body, [])).toBe(body);
  });

  it("handles multiple distinct entities in same span", () => {
    const body = "Alice and Bob work together.";
    const result = injectWikilinks(body, [
      match("Alice", "Alice", 0),
      match("Bob", "Bob", 10),
    ]);
    expect(result).toBe("[[Alice]] and [[Bob]] work together.");
  });

  it("does not inject inside existing wikilinks (offset already excluded from input)", () => {
    // scanner would not produce a match inside an existing wikilink,
    // but test that injector respects existing [[Alice]] via dedup
    const body = "See [[Alice]] and Alice for details.";
    const aliceIdx = body.lastIndexOf("Alice");
    const result = injectWikilinks(body, [match("Alice", "Alice", aliceIdx)]);
    // existing [[Alice]] counts for this span → second occurrence is skipped
    expect(result).toBe("See [[Alice]] and Alice for details.");
  });

  it("handles aliased wikilink [[Canonical|alias]] as existing link", () => {
    const body = "See [[Alice Smith|Alice]] and Alice.";
    const aliceIdx = body.lastIndexOf("Alice");
    const result = injectWikilinks(body, [match("Alice Smith", "Alice", aliceIdx)]);
    expect(result).toBe("See [[Alice Smith|Alice]] and Alice.");
  });
});
