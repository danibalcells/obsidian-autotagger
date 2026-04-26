import { describe, it, expect } from "vitest";
import { scanBody } from "../src/entity-scanner";
import type { EntityEntry } from "../src/types";

const person = (canonicalName: string, aliases: string[] = []): EntityEntry => ({
  canonicalName,
  aliases,
  type: "person",
  description: "",
  filePath: "",
});

const org = (canonicalName: string, aliases: string[] = []): EntityEntry => ({
  canonicalName,
  aliases,
  type: "organization",
  description: "",
  filePath: "",
});

describe("scanBody", () => {
  it("returns empty result for empty entries", () => {
    const result = scanBody("Alice was here", [], 0);
    expect(result.unambiguous).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(0);
  });

  it("detects a canonical name", () => {
    const entries = [person("Alice")];
    const result = scanBody("I talked to Alice yesterday.", entries, 0);
    expect(result.unambiguous).toHaveLength(1);
    expect(result.unambiguous[0].surface).toBe("Alice");
    expect(result.unambiguous[0].candidates[0].canonicalName).toBe("Alice");
  });

  it("detects an alias and resolves to entry", () => {
    const entries = [person("Antonio Rodríguez", ["Anto"])];
    const result = scanBody("Anto came by.", entries, 0);
    expect(result.unambiguous).toHaveLength(1);
    expect(result.unambiguous[0].surface).toBe("Anto");
    expect(result.unambiguous[0].candidates[0].canonicalName).toBe("Antonio Rodríguez");
  });

  it("preserves original surface casing in match", () => {
    const entries = [person("Luis Socas", ["Luiso"])];
    const result = scanBody("I saw luiso at the café.", entries, 0);
    expect(result.unambiguous).toHaveLength(1);
    expect(result.unambiguous[0].surface).toBe("luiso");
  });

  it("buckets ambiguous matches (two entities share alias)", () => {
    const entries = [
      person("John Smith", ["John"]),
      person("John Doe", ["John"]),
    ];
    const result = scanBody("I spoke with John today.", entries, 0);
    expect(result.unambiguous).toHaveLength(0);
    expect(result.ambiguous).toHaveLength(1);
    expect(result.ambiguous[0].candidates).toHaveLength(2);
  });

  it("does not match partial words (word boundaries)", () => {
    const entries = [org("Apple")];
    const result = scanBody("I bought an apple pie.", entries, 0);
    // "apple" is lowercase; if strictCaseMinLength = 0 it matches case-insensitively
    // but "apple" must still be a standalone word — "apple pie" matches "apple" at boundary
    expect(result.unambiguous).toHaveLength(1);
    expect(result.unambiguous[0].surface).toBe("apple");
  });

  it("does not match 'apple' inside 'ApplePay' (word boundary)", () => {
    const entries = [org("Apple")];
    const result = scanBody("I use ApplePay.", entries, 0);
    expect(result.unambiguous).toHaveLength(0);
  });

  it("skips matches inside code blocks", () => {
    const entries = [person("Alice")];
    const body = "```\nAlice was here\n```";
    const result = scanBody(body, entries, 0);
    expect(result.unambiguous).toHaveLength(0);
  });

  it("skips matches inside inline code", () => {
    const entries = [person("Alice")];
    const result = scanBody("See `Alice` for details.", entries, 0);
    expect(result.unambiguous).toHaveLength(0);
  });

  it("skips matches inside existing wikilinks", () => {
    const entries = [person("Alice")];
    const result = scanBody("[[Alice]] was there.", entries, 0);
    expect(result.unambiguous).toHaveLength(0);
  });

  it("skips matches inside markdown links", () => {
    const entries = [person("Alice")];
    const result = scanBody("[Alice](https://example.com) was there.", entries, 0);
    expect(result.unambiguous).toHaveLength(0);
  });

  it("respects strictCaseMinLength — short alias in lowercase is ignored", () => {
    const entries = [person("Antonio Rodríguez", ["Anto"])];
    // "anto" lowercase, alias "Anto" (4 chars), threshold 5 → strict case required
    const result = scanBody("I heard anto mention it.", entries, 5);
    expect(result.unambiguous).toHaveLength(0);
  });

  it("respects strictCaseMinLength — short alias in correct case matches", () => {
    const entries = [person("Antonio Rodríguez", ["Anto"])];
    const result = scanBody("I heard Anto mention it.", entries, 5);
    expect(result.unambiguous).toHaveLength(1);
    expect(result.unambiguous[0].surface).toBe("Anto");
  });

  it("long alias is always case-insensitive regardless of threshold", () => {
    const entries = [person("Luis Socas", ["Luiso"])];
    // "luiso" lowercase, alias "Luiso" (5 chars), threshold 5 → 5 < 5 is false, no strict case
    const result = scanBody("luiso was here.", entries, 5);
    expect(result.unambiguous).toHaveLength(1);
    expect(result.unambiguous[0].surface).toBe("luiso");
  });

  it("does not double-match overlapping spans", () => {
    const entries = [
      person("John", []),
      person("John Smith", []),
    ];
    const result = scanBody("I met John Smith.", entries, 0);
    // "John Smith" is longer and should win
    const allMatches = [...result.unambiguous, ...result.ambiguous];
    expect(allMatches).toHaveLength(1);
    expect(allMatches[0].surface).toBe("John Smith");
  });

  it("detects multiple entities in one body", () => {
    const entries = [person("Alice"), person("Bob")];
    const result = scanBody("Alice and Bob met.", entries, 0);
    expect(result.unambiguous).toHaveLength(2);
  });

  it("returns correct byte offsets", () => {
    const entries = [person("Alice")];
    const body = "Hello Alice!";
    const result = scanBody(body, entries, 0);
    expect(result.unambiguous[0].spanStart).toBe(6);
    expect(result.unambiguous[0].spanEnd).toBe(11);
    expect(body.slice(6, 11)).toBe("Alice");
  });
});
