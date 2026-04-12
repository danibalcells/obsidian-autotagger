import { describe, it, expect } from "vitest";
import { resolveCanonicalName } from "../src/registry/entity-registry";
import type { EntityEntry } from "../src/types";

const entries: EntityEntry[] = [
  {
    canonicalName: "Alex Flores",
    aliases: ["A. Flores", "Flores"],
    type: "person",
    description: "",
    filePath: "Resources/People/Alex Flores.md",
  },
  {
    canonicalName: "Granola",
    aliases: ["Granola Inc"],
    type: "organization",
    description: "Meeting notes app",
    filePath: "Resources/Organizations/Granola.md",
  },
  {
    canonicalName: "Zurich",
    aliases: ["Zürich"],
    type: "place",
    description: "",
    filePath: "Resources/Places/Zurich.md",
  },
];

describe("resolveCanonicalName", () => {
  it("resolves by canonical name (exact)", () => {
    expect(resolveCanonicalName(entries, "Alex Flores")).toBe("Alex Flores");
  });

  it("resolves by canonical name (case-insensitive)", () => {
    expect(resolveCanonicalName(entries, "alex flores")).toBe("Alex Flores");
  });

  it("resolves by alias", () => {
    expect(resolveCanonicalName(entries, "A. Flores")).toBe("Alex Flores");
  });

  it("resolves by alias (case-insensitive)", () => {
    expect(resolveCanonicalName(entries, "flores")).toBe("Alex Flores");
  });

  it("resolves unicode alias", () => {
    expect(resolveCanonicalName(entries, "Zürich")).toBe("Zurich");
  });

  it("returns null for unknown names", () => {
    expect(resolveCanonicalName(entries, "Nobody")).toBeNull();
  });
});
