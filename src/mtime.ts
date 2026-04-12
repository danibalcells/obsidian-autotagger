import { Platform } from "obsidian";
import type { App, TFile } from "obsidian";

type NodeFS = {
  statSync(path: string): { mtime: Date; atime: Date };
  utimesSync(path: string, atime: Date, mtime: Date): void;
};

type FileSystemAdapter = {
  getFullPath(path: string): string;
};

export async function withPreservedMtime<T>(
  app: App,
  file: TFile,
  preserveMtime: boolean,
  fn: () => Promise<T>
): Promise<T> {
  if (!preserveMtime || !Platform.isDesktopApp) {
    return fn();
  }

  const adapter = app.vault.adapter as Partial<FileSystemAdapter>;
  if (typeof adapter.getFullPath !== "function") {
    return fn();
  }

  // Dynamic require — only runs on desktop (Electron/Node.js)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fs = (globalThis as any)["require"]("fs") as NodeFS;
  const fullPath = adapter.getFullPath(file.path);

  let stat: { mtime: Date; atime: Date } | null = null;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    return fn();
  }

  const result = await fn();

  try {
    if (stat) fs.utimesSync(fullPath, stat.atime, stat.mtime);
  } catch {
    // Non-critical: ignore mtime restoration failure
  }

  return result;
}
