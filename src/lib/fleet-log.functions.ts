import { createServerFn } from "@tanstack/react-start";
import { appendLines, clearLines, readLines, type StoredLine } from "@/lib/fleet-log";

export const appendFleetLog = createServerFn({ method: "POST" })
  .validator((data: { lines?: StoredLine[] }) => data)
  .handler(async ({ data }) => {
    const lines = (data.lines ?? []).filter((line) => line && typeof line.text === "string" && typeof line.ts === "number").slice(0, 80);
    await appendLines(lines);
    return { ok: true };
  });

export const readFleetLog = createServerFn({ method: "GET" }).handler(async () => readLines());

export const clearFleetLog = createServerFn({ method: "POST" }).handler(async () => {
  await clearLines();
  return { ok: true };
});
