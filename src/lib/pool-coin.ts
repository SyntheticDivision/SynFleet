export type PoolCoin = {
  ticker: string;
  name: string;
  algo: "SHA-256" | "Scrypt";
};

export function parsePoolTitle(title: string): PoolCoin | null {
  const match = title.match(/([A-Z0-9_]+)\s*-\s*(.+?)\s+Mining Pool\s*\[(SHA-?256|Sha256|Scrypt)\]/i);
  if (!match) return null;
  return {
    ticker: match[1].toUpperCase(),
    name: match[2].trim(),
    algo: /scrypt/i.test(match[3]) ? "Scrypt" : "SHA-256",
  };
}

export function parsePoolAddress(pool: string): { host: string; port: number } | null {
  const raw = pool.trim().replace(/^stratum\+(?:tcp|ssl):\/\//i, "").replace(/^https?:\/\//i, "").split("/")[0] ?? "";
  if (!raw) return null;
  const [host, portText] = raw.split(":");
  const port = Number(portText);
  if (!host || !Number.isInteger(port)) return null;
  return { host: host.toLowerCase(), port };
}

const BTC: PoolCoin = { ticker: "BTC", name: "Bitcoin", algo: "SHA-256" };
const LTC: PoolCoin = { ticker: "LTC", name: "Litecoin", algo: "Scrypt" };
const DOGE: PoolCoin = { ticker: "DOGE", name: "Dogecoin", algo: "Scrypt" };

export function coinFromKnownHost(host: string): PoolCoin | null {
  const name = host.toLowerCase();
  if (/(^|[.])doge([.]|$)|dogecoin/.test(name)) return DOGE;
  if (/(^|[.])ltc([.]|$)|litecoin|scrypt/.test(name)) return LTC;
  if (/(^|[.])btc([.]|$)|bitcoin|ckpool|public-pool|braiins|slush|foundry|luxor|antpool|kano\.is|ocean\.xyz/.test(name)) return BTC;
  if (/viabtc|f2pool|nicehash|btc\.com|binance/.test(name)) return BTC;
  return null;
}

export function pickEndpoint(
  ports: Map<number, { ticker: string }[]>,
  ticker: string,
  currentHost: string,
): { host: string; port: number; shared: boolean } | null {
  const mine = [...ports.entries()].filter(([, coins]) => coins.some((coin) => coin.ticker === ticker));
  if (mine.length === 0) return null;
  const unique = mine.find(([, coins]) => coins.length === 1 && coins[0]?.ticker === ticker);
  const chosen = unique ?? mine[0]!;
  const region = currentHost.toLowerCase();
  const host = region.endsWith("mining-dutch.nl") ? region : "europe.mining-dutch.nl";
  return { host, port: chosen[0], shared: !unique };
}

export function accountName(worker: string): string {
  const clean = worker.trim();
  const dot = clean.indexOf(".");
  return (dot > 0 ? clean.slice(0, dot) : clean).slice(0, 64);
}

export function workerCount(body: unknown): number {
  const text = JSON.stringify(body);
  if (/unauthorized|invalid api|access denied|api key/i.test(text)) return -1;
  const data = body as {
    getuserworkers?: { data?: { worker?: unknown; workers?: unknown } };
    getuserstatus?: { data?: { worker?: unknown; workers?: unknown } };
  };
  const block = data?.getuserworkers?.data ?? data?.getuserstatus?.data;
  const list = block?.worker ?? block?.workers;
  return Array.isArray(list) ? list.length : 0;
}
