/**
 * Shared helper for reading/writing the vault plugin's data.json.
 *
 * Requires PLUGIN_DATA_PATH in the environment (set in .env.eval).
 * All scripts that were previously reading tests/fixtures/tag-descriptions.json
 * should use loadTagDescriptions() / saveTagDescriptions() instead.
 */

import * as fs from "fs";
import { configDotenv } from "dotenv";
import type { AutoTaggerSettings, PluginData } from "../src/types";

configDotenv({ path: ".env.eval" });

export function getPluginDataPath(): string {
  const p = process.env.PLUGIN_DATA_PATH;
  if (!p) {
    throw new Error(
      "PLUGIN_DATA_PATH is not set. Add it to .env.eval pointing to your vault's " +
      ".obsidian/plugins/<plugin-id>/data.json"
    );
  }
  return p;
}

export function loadPluginData(): PluginData {
  const p = getPluginDataPath();
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as Partial<PluginData>;
    if (!raw.settings) {
      throw new Error(`data.json at ${p} has no 'settings' key`);
    }
    return raw as PluginData;
  } catch (err) {
    throw new Error(`Failed to read plugin data from ${p}: ${err}`);
  }
}

export function savePluginData(data: PluginData): void {
  const p = getPluginDataPath();
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

export function loadTagDescriptions(): Record<string, string> {
  const data = loadPluginData();
  return (data.settings as AutoTaggerSettings).tagDescriptions ?? {};
}

export function saveTagDescriptions(descs: Record<string, string>): void {
  const data = loadPluginData();
  (data.settings as AutoTaggerSettings).tagDescriptions = descs;
  savePluginData(data);
}
