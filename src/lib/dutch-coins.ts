import { createServerFn } from "@tanstack/react-start";
import { DUTCH_COINS, type DutchCoin } from "@/lib/coins";

const POOLS_URL = "https://www.mining-dutch.nl/?page=pools";
const CACHE_MS = 6 * 60 * 60 * 1000;

let memory: { at: number; coins: DutchCoin[] } | null = null;

export function parseDutchPools(html: string): DutchCoin[] {
  const re = /<a href='\/pools\/([^']+)\.php'>([^<]+)<\/a>,\s*(Sha256|Scrypt)\b/gi;
  const coins: DutchCoin[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(re)) {
    const label = match[2].trim();
    const tick = label.match(/\(([^)]+)\)\s*$/);
    const ticker = tick?.[1]?.trim();
    if (!ticker || seen.has(ticker)) continue;
    seen.add(ticker);
    const name = tick ? label.slice(0, tick.index).trim() : label;
    coins.push({
      ticker,
      name: name || ticker,
      algo: match[3].toLowerCase() === "sha256" ? "SHA-256" : "Scrypt",
      slug: match[1],
    });
  }
  return coins;
}

export const refreshDutchCoins = createServerFn({ method: "GET" }).handler(async () => {
  const now = Date.now();
  if (memory && now - memory.at < CACHE_MS) {
    return { coins: memory.coins, updatedAt: memory.at, source: "cache" as const };
  }
  try {
    const res = await fetch(POOLS_URL, {
      headers: { "user-agent": "SynFleet/1.0" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const coins = parseDutchPools(await res.text());
    if (coins.length < 20) throw new Error("short list");
    memory = { at: now, coins };
    return { coins, updatedAt: now, source: "live" as const };
  } catch {
    return {
      coins: memory?.coins ?? DUTCH_COINS,
      updatedAt: memory?.at ?? 0,
      source: "fallback" as const,
    };
  }
});
