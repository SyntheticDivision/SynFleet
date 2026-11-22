import { readdir } from "node:fs/promises";
import { join } from "node:path";

const EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

function safeName(file: string): string | null {
  const base = file.split(/[/\\]/).pop() ?? "";
  if (base !== file || base.startsWith(".")) return null;
  const dot = base.lastIndexOf(".");
  if (dot < 1 || !EXT.has(base.slice(dot).toLowerCase())) return null;
  return base;
}

export async function listIdleImageFiles(): Promise<string[]> {
  const dirs = [join(process.cwd(), "public", "idle"), join(process.cwd(), ".output", "public", "idle")];
  const names = new Set<string>();
  for (const dir of dirs) {
    const files = await readdir(dir).catch(() => [] as string[]);
    for (const file of files) {
      const name = safeName(file);
      if (name) names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
