import { createServerFn } from "@tanstack/react-start";
import { DUTCH_COINS } from "@/lib/coins";
import { parseDutchPools } from "@/lib/dutch-coins";
import { coinFromKnownHost, parsePoolAddress, parsePoolTitle, pickEndpoint, accountName, workerCount, type PoolCoin } from "@/lib/pool-coin";

const PAGE = "https://www.mining-dutch.nl";
let portMap: { at: number; ports: Map<number, PoolCoin[]> } | null = null;
let portMapJob: Promise<Map<number, PoolCoin[]>> | null = null;

async function text(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "user-agent": "SynFleet/1.0" }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(String(res.status));
  return res.text();
}

async function dutchPorts(): Promise<Map<number, PoolCoin[]>> {
  if (portMap && Date.now() - portMap.at < 6 * 60 * 60 * 1000) return portMap.ports;
  if (!portMapJob) portMapJob = buildPortMap().finally(() => { portMapJob = null; });
  return portMapJob;
}

async function buildPortMap(): Promise<Map<number, PoolCoin[]>> {
  const listed = parseDutchPools(await text(`${PAGE}/?page=pools`));
  const coins = listed.length >= 20 ? listed : DUTCH_COINS;
  const ports = new Map<number, PoolCoin[]>();
  let cursor = 0;
  async function worker() {
    while (cursor < coins.length) {
      const coin = coins[cursor];
      cursor += 1;
      if (!coin?.slug) continue;
      try {
        const html = await text(`${PAGE}/pools/${coin.slug}.php`);
        const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "";
        const live = parsePoolTitle(title) ?? { ticker: coin.ticker, name: coin.name, algo: coin.algo };
        const found = new Set<number>();
        for (const match of html.matchAll(/mining-dutch\.nl:(\d+)/g)) {
          const port = Number(match[1]);
          if (port >= 100) found.add(port);
        }
        for (const port of found) {
          const rows = ports.get(port) ?? [];
          if (!rows.some((row) => row.ticker === live.ticker)) rows.push(live);
          ports.set(port, rows);
        }
      } catch {
        // one pool page failing should not blank the map
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(6, coins.length) }, () => worker()));
  portMap = { at: Date.now(), ports };
  return ports;
}

export async function lookupPool(pool: string): Promise<PoolCoin | null> {
  const parsed = parsePoolAddress(pool);
  if (!parsed) return null;
  const known = coinFromKnownHost(parsed.host);
  if (known) return known;
  if (!parsed.host.endsWith("mining-dutch.nl")) return null;
  const ports = await dutchPorts();
  const hits = ports.get(parsed.port) ?? [];
  return hits.length === 1 ? hits[0]! : null;
}

export const resolvePoolCoin = createServerFn({ method: "POST" })
  .validator((data: { pool?: string; slug?: string }) => data)
  .handler(async ({ data }): Promise<PoolCoin | null> => {
    if (data.slug) {
      try {
        const html = await text(`${PAGE}/pools/${data.slug.replace(/[^a-z0-9_-]/gi, "")}.php`);
        const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "";
        return parsePoolTitle(title);
      } catch {
        return null;
      }
    }
    if (!data.pool) return null;
    try {
      return await lookupPool(data.pool);
    } catch {
      return null;
    }
  });

export const resolvePoolCoins = createServerFn({ method: "POST" })
  .validator((data: { pools?: string[] }) => data)
  .handler(async ({ data }): Promise<{ pool: string; coin: PoolCoin | null }[]> => {
    const pools = [...new Set((data.pools ?? []).filter((pool) => typeof pool === "string" && pool.trim()))].slice(0, 64);
    const rows = await Promise.all(pools.map(async (pool) => ({ pool, coin: await lookupPool(pool).catch(() => null) })));
    return rows;
  });

export const coinEndpoint = createServerFn({ method: "POST" })
  .validator((data: { ticker?: string; pool?: string }) => data)
  .handler(async ({ data }): Promise<{ host: string; port: number; shared: boolean } | null> => {
    const ticker = (data.ticker ?? "").toUpperCase();
    if (!ticker) return null;
    const current = parsePoolAddress(data.pool ?? "");
    if (current && !current.host.endsWith("mining-dutch.nl")) return null;
    const ports = await dutchPorts();
    return pickEndpoint(ports, ticker, current?.host ?? "");
  });

const workerCache = new Map<string, { at: number; coins: PoolCoin[]; error?: string }>();

export const lookupDutchWorker = createServerFn({ method: "POST" })
  .validator((data: { worker?: string; apiKey?: string }) => data)
  .handler(async ({ data }): Promise<{ coins: PoolCoin[]; error?: string }> => {
    const account = accountName(data.worker ?? "");
    const apiKey = (data.apiKey ?? "").trim();
    if (!account || !/^[a-zA-Z0-9_-]+$/.test(account)) return { coins: [], error: "Set the pool worker name" };
    if (!/^[a-fA-F0-9]{16,128}$/.test(apiKey)) return { coins: [], error: "Mining Dutch key looks wrong" };
    const cached = workerCache.get(account);
    if (cached && Date.now() - cached.at < 10 * 60 * 1000) return { coins: cached.coins, error: cached.error };
    const listed = parseDutchPools(await text(`${PAGE}/?page=pools`).catch(() => ""));
    const coins = listed.length >= 20 ? listed : DUTCH_COINS;
    const found: PoolCoin[] = [];
    let cursor = 0;
    let refused = false;
    async function worker() {
      while (cursor < coins.length && !refused) {
        const coin = coins[cursor];
        cursor += 1;
        if (!coin?.slug) continue;
        try {
          const res = await fetch(
            `${PAGE}/pools/${coin.slug}.php?page=api&action=getuserworkers&id=${encodeURIComponent(account)}&api_key=${encodeURIComponent(apiKey)}`,
            { headers: { "user-agent": "SynFleet/1.0" }, signal: AbortSignal.timeout(12000) },
          );
          if (res.status === 401) {
            refused = true;
            return;
          }
          if (!res.ok) continue;
          const count = workerCount(await res.json());
          if (count < 0) {
            refused = true;
            return;
          }
          if (count > 0) found.push({ ticker: coin.ticker, name: coin.name, algo: coin.algo });
        } catch {
          // one coin failing does not stop the rest
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, coins.length) }, () => worker()));
    const error = refused ? "Mining Dutch refused the key" : undefined;
    const result = { coins: found, error };
    if (!refused) workerCache.set(account, { at: Date.now(), ...result });
    return result;
  });
