import { appendFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const FLEET_LOG = join(process.cwd(), "data", "synfleet.log");
const MAX_BYTES = 1_500_000;

export type StoredLine = { ts: number; minerName: string; level: string; text: string };

function row(line: StoredLine): string {
  const text = line.text.replace(/[\t\r\n]+/g, " ").slice(0, 240);
  const name = line.minerName.replace(/[\t\r\n]+/g, " ").slice(0, 40);
  const level = line.level === "fault" || line.level === "warn" ? line.level : "info";
  return `${new Date(line.ts).toISOString()}\t${name}\t${level}\t${text}\n`;
}

async function trim() {
  const info = await stat(FLEET_LOG).catch(() => null);
  if (!info || info.size < MAX_BYTES) return;
  const raw = await readFile(FLEET_LOG, "utf8");
  const kept = raw.split("\n").slice(-4000).join("\n");
  await writeFile(FLEET_LOG, kept.endsWith("\n") ? kept : `${kept}\n`);
}

export async function appendLines(lines: StoredLine[]): Promise<void> {
  if (lines.length === 0) return;
  await mkdir(dirname(FLEET_LOG), { recursive: true });
  await appendFile(FLEET_LOG, lines.slice(0, 80).map(row).join(""));
  await trim();
}

export async function readLines(): Promise<string> {
  return readFile(FLEET_LOG, "utf8").catch(() => "");
}

export async function clearLines(): Promise<void> {
  await mkdir(dirname(FLEET_LOG), { recursive: true });
  await writeFile(FLEET_LOG, "");
}