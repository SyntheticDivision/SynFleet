import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { FoundMiner } from "@/lib/discover";
import { commandMiner } from "@/lib/miner-link.functions";
import type { LiveRead, MinerCommand, LinkKind } from "@/lib/miner-link";
import { defaultPort, isLinkKind } from "@/lib/miner-link";
import type { PoolCoin } from "@/lib/pool-coin";
import { resolvePoolCoins } from "@/lib/pool-coin.functions";

export type MinerKind = LinkKind;
export type LogLevel = "info" | "warn" | "fault";

export type Miner = {
  id: string;
  name: string;
  host: string;
  kind: MinerKind;
  port: number;
  simulated: boolean;
  online: boolean;
  hashrateGhs: number;
  tempC: number;
  vrTempC: number;
  baseTempC: number;
  baseVrC: number;
  asicWarnC: number;
  vrWarnC: number;
  powerW: number;
  accepted: number;
  rejected: number;
  pingMs: number;
  pingWarnMs: number;
  uptimeSec: number;
  pool: string;
  pools: string[];
  onFallback: boolean;
  wifiRssi: number;
  overheat: boolean;
  lastSeenAt: number;
  lowSince: number;
  floorGhs: number;
  deviceLog: string;
  lastLog: string;
  worker: string;
  workerCoins: string[];
  coin: string;
  algo: string;
  fanPct: number;
  fanRpm: number;
  fanAuto: boolean;
  bootSec: number;
  maxFanRpm: number;
  frequencyMhz: number;
  coreVoltageMv: number;
  asicVoltageMv: number;
  asicCount: number;
  baseGhs: number;
  baseFreqMhz: number;
  baseCoreMv: number;
  basePowerW: number;
  bestDiffN: number;
  bestSessionN: number;
  firmware: string;
  apiToken: string;
  note: string | null;
};

export type LogLine = {
  id: string;
  ts: number;
  minerId: string;
  minerName: string;
  level: LogLevel;
  text: string;
};

export type TunePatch = Partial<
  Pick<
    Miner,
    | "fanPct"
    | "fanAuto"
    | "frequencyMhz"
    | "coreVoltageMv"
    | "asicWarnC"
    | "vrWarnC"
    | "pingWarnMs"
    | "coin"
    | "algo"
    | "pool"
    | "pools"
    | "worker"
    | "workerCoins"
    | "apiToken"
    | "floorGhs"
  >
>;

export type NewMiner = {
  name: string;
  host: string;
  kind: MinerKind;
  port: number;
  apiToken?: string;
};

type Sample = { t: number; th: number };

type FleetState = {
  miners: Miner[];
  logs: LogLine[];
  samples: Sample[];
  recording: boolean;
  selectedId: string | null;
  banner: boolean;
  scanSubnet: string;
  rebase: () => void;
  tick: () => void;
  addMiner: (input: NewMiner) => void;
  addDiscovered: (found: FoundMiner[]) => number;
  removeMiner: (id: string) => void;
  removeAll: () => void;
  toggleRecording: () => void;
  select: (id: string | null) => void;
  clearLogs: () => void;
  dismissBanner: () => void;
  setScanSubnet: (subnet: string) => void;
  tune: (id: string, patch: TunePatch, message?: string) => void;
  restart: (id: string) => void;
  applyLive: (reads: LiveRead[]) => void;
};

const showBench = import.meta.env.VITE_FLEET_BENCH === "true";
const showDemo = import.meta.env.DEV && !showBench;

const memoryStorage: Storage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
  key: () => null,
  length: 0,
};

function nid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function miner(partial: Partial<Miner> & Pick<Miner, "id" | "name" | "host" | "kind">): Miner {
  const filled: Miner = {
    simulated: true,
    online: true,
    hashrateGhs: 0,
    tempC: 0,
    vrTempC: 0,
    baseTempC: 0,
    baseVrC: 0,
    asicWarnC: 72,
    vrWarnC: 85,
    powerW: 0,
    accepted: 0,
    rejected: 0,
    pingMs: 0,
    pingWarnMs: 80,
    uptimeSec: 0,
    pool: "",
    pools: [],
    onFallback: false,
    wifiRssi: 0,
    overheat: false,
    lastSeenAt: 0,
    lowSince: 0,
    floorGhs: 0,
    deviceLog: "",
    lastLog: "",
    worker: "",
    workerCoins: [],
    coin: "BTC",
    algo: "SHA-256",
    fanPct: 0,
    fanRpm: 0,
    fanAuto: true,
    bootSec: 0,
    maxFanRpm: 4500,
    frequencyMhz: 500,
    coreVoltageMv: 1200,
    asicVoltageMv: 1180,
    asicCount: 1,
    baseGhs: 0,
    baseFreqMhz: 500,
    baseCoreMv: 1200,
    basePowerW: 0,
    bestDiffN: 0,
    bestSessionN: 0,
    firmware: "",
    apiToken: "",
    note: null,
    port: defaultPort(partial.kind),
    ...partial,
  };
  filled.baseTempC = filled.baseTempC || filled.tempC || 58;
  filled.baseVrC = filled.baseVrC || filled.vrTempC || Math.round(filled.baseTempC * 0.85);
  return filled;
}

function demoMiners(): Miner[] {
  return [
    miner({
      id: "gamma",
      name: "gamma-01",
      host: "192.168.4.21",
      kind: "esp-miner",
      hashrateGhs: 1480,
      tempC: 58,
      vrTempC: 47,
      powerW: 17.6,
      accepted: 842,
      rejected: 3,
      pingMs: 8,
      uptimeSec: 18420,
      pool: "public-pool.local:21496",
      pools: ["public-pool.local:21496", "solo.ckpool.org:3333"],
      worker: "demo.gamma",
      fanPct: 42,
      fanRpm: 1890,
      maxFanRpm: 4500,
      frequencyMhz: 525,
      coreVoltageMv: 1200,
      asicVoltageMv: 1184,
      asicCount: 1,
      baseGhs: 1480,
      baseFreqMhz: 525,
      baseCoreMv: 1200,
      basePowerW: 17.6,
      bestDiffN: 482e5,
      bestSessionN: 124e5,
      firmware: "ESP-Miner 2.15.0",
    }),
    miner({
      id: "qaxe",
      name: "qaxe-02",
      host: "192.168.4.22",
      kind: "esp-miner",
      hashrateGhs: 5240,
      tempC: 64,
      vrTempC: 53,
      powerW: 79,
      accepted: 3104,
      rejected: 11,
      pingMs: 11,
      uptimeSec: 54100,
      pool: "public-pool.local:21496",
      worker: "demo.qaxe",
      fanPct: 55,
      fanRpm: 3300,
      maxFanRpm: 6000,
      frequencyMhz: 600,
      coreVoltageMv: 1150,
      asicVoltageMv: 1132,
      asicCount: 4,
      baseGhs: 5240,
      baseFreqMhz: 600,
      baseCoreMv: 1150,
      basePowerW: 79,
      bestDiffN: 186e6,
      bestSessionN: 421e5,
      firmware: "ESP-Miner 2.15.0",
    }),
    miner({
      id: "nano",
      name: "nano-3s",
      host: "192.168.4.30",
      kind: "avalon",
      hashrateGhs: 6120,
      tempC: 67,
      vrTempC: 58,
      powerW: 140,
      accepted: 1902,
      rejected: 22,
      pingMs: 14,
      uptimeSec: 86400,
      pool: "solo.ckpool.org:3333",
      worker: "demo.nano",
      fanPct: 61,
      fanRpm: 2560,
      maxFanRpm: 4200,
      frequencyMhz: 625,
      coreVoltageMv: 1250,
      asicVoltageMv: 1238,
      asicCount: 1,
      baseGhs: 6120,
      baseFreqMhz: 625,
      baseCoreMv: 1250,
      basePowerW: 140,
      bestDiffN: 92e6,
      bestSessionN: 186e5,
      firmware: "Avalon Nano",
    }),
    miner({
      id: "tna",
      name: "tna-01",
      host: "192.168.4.31",
      kind: "tna-canaan",
      hashrateGhs: 4200,
      tempC: 61,
      vrTempC: 52,
      powerW: 96,
      accepted: 1408,
      rejected: 6,
      pingMs: 9,
      uptimeSec: 22600,
      pool: "public-pool.local:21496",
      worker: "demo.tna",
      fanPct: 48,
      fanRpm: 2100,
      maxFanRpm: 4500,
      frequencyMhz: 575,
      coreVoltageMv: 3650,
      asicVoltageMv: 3580,
      asicCount: 1,
      baseGhs: 4200,
      baseFreqMhz: 575,
      baseCoreMv: 3650,
      basePowerW: 96,
      bestDiffN: 64e6,
      bestSessionN: 15e6,
      firmware: "TNA",
    }),
    miner({
      id: "hammer",
      name: "thor-01",
      host: "192.168.4.40",
      kind: "hammer",
      hashrateGhs: 2860,
      tempC: 62,
      vrTempC: 54,
      powerW: 84,
      accepted: 966,
      rejected: 4,
      pingMs: 18,
      uptimeSec: 43200,
      pool: "public-pool.local:21496",
      worker: "demo.thor",
      fanPct: 70,
      fanRpm: 3150,
      maxFanRpm: 4500,
      frequencyMhz: 525,
      coreVoltageMv: 1200,
      asicVoltageMv: 1188,
      asicCount: 1,
      baseGhs: 2860,
      baseFreqMhz: 525,
      baseCoreMv: 1200,
      basePowerW: 84,
      bestDiffN: 28e6,
      bestSessionN: 9e6,
      firmware: "Hammer",
    }),
    miner({
      id: "harlo",
      name: "harlo-01",
      host: "192.168.4.41",
      kind: "harlo",
      hashrateGhs: 980,
      tempC: 54,
      vrTempC: 46,
      powerW: 22,
      accepted: 410,
      rejected: 1,
      pingMs: 7,
      uptimeSec: 9600,
      pool: "public-pool.local:21496",
      worker: "demo.harlo",
      fanPct: 36,
      fanRpm: 1600,
      maxFanRpm: 4500,
      frequencyMhz: 500,
      coreVoltageMv: 1100,
      asicVoltageMv: 1086,
      asicCount: 1,
      baseGhs: 980,
      baseFreqMhz: 500,
      baseCoreMv: 1100,
      basePowerW: 22,
      bestDiffN: 8e6,
      bestSessionN: 2e6,
      firmware: "Harlo",
    }),
    miner({
      id: "satboy",
      name: "satboy-01",
      host: "192.168.4.50",
      kind: "greenbit",
      online: false,
      hashrateGhs: 0,
      tempC: 0,
      vrTempC: 0,
      powerW: 0,
      pingMs: 0,
      pool: "",
      worker: "demo.satboy",
      fanPct: 0,
      fanRpm: 0,
      baseGhs: 720,
      basePowerW: 16,
      firmware: "Satboy",
      note: "No answer on the network.",
    }),
  ];
}

function seedMiners(): Miner[] {
  return [
    miner({
      id: "gamma",
      name: "gamma-01",
      host: "192.168.4.21",
      kind: "esp-miner",
      port: 80,
      hashrateGhs: 1480,
      tempC: 58,
      vrTempC: 47,
      powerW: 17.6,
      accepted: 842,
      rejected: 3,
      uptimeSec: 18420,
      pool: "public-pool.local:21496",
      pools: ["public-pool.local:21496", "solo.ckpool.org:3333"],
      worker: "demo.gamma",
      fanPct: 42,
      fanRpm: 1890,
      fanAuto: true,
      maxFanRpm: 4500,
      frequencyMhz: 525,
      coreVoltageMv: 1200,
      asicVoltageMv: 1184,
      asicCount: 1,
      baseGhs: 1480,
      baseFreqMhz: 525,
      baseCoreMv: 1200,
      basePowerW: 17.6,
      bestDiffN: 482e5,
      bestSessionN: 124e5,
      firmware: "ESP-Miner 2.15.0",
    }),
    miner({
      id: "qaxe",
      name: "qaxe-02",
      host: "192.168.4.22",
      kind: "esp-miner",
      port: 80,
      hashrateGhs: 5240,
      tempC: 64,
      vrTempC: 53,
      powerW: 79,
      accepted: 3104,
      rejected: 11,
      uptimeSec: 54100,
      pool: "public-pool.local:21496",
      fanPct: 55,
      fanRpm: 3300,
      fanAuto: true,
      maxFanRpm: 6e3,
      frequencyMhz: 600,
      coreVoltageMv: 1150,
      asicVoltageMv: 1132,
      asicCount: 4,
      baseGhs: 5240,
      baseFreqMhz: 600,
      baseCoreMv: 1150,
      basePowerW: 79,
      bestDiffN: 186e6,
      bestSessionN: 421e5,
      firmware: "ESP-Miner 2.15.0",
    }),
    miner({
      id: "nano",
      name: "nano-3s",
      host: "192.168.4.30",
      kind: "cgminer",
      port: 4028,
      hashrateGhs: 3680,
      tempC: 67,
      vrTempC: 58,
      powerW: 138,
      accepted: 1902,
      rejected: 22,
      uptimeSec: 86400,
      pool: "ckpool.org:3333",
      fanPct: 61,
      fanRpm: 2560,
      fanAuto: true,
      maxFanRpm: 4200,
      frequencyMhz: 625,
      coreVoltageMv: 1250,
      asicVoltageMv: 1238,
      asicCount: 1,
      baseGhs: 3680,
      baseFreqMhz: 625,
      baseCoreMv: 1250,
      basePowerW: 138,
      bestDiffN: 92e6,
      bestSessionN: 186e5,
      firmware: "cgminer 4.11.1",
    }),
    miner({
      id: "s19",
      name: "s19-rack",
      host: "192.168.4.10",
      kind: "cgminer",
      port: 4028,
      hashrateGhs: 104200,
      tempC: 76,
      vrTempC: 81,
      powerW: 3060,
      accepted: 48220,
      rejected: 140,
      uptimeSec: 24e4,
      pool: "viabtc.com:3333",
      fanPct: 78,
      fanRpm: 4680,
      fanAuto: false,
      maxFanRpm: 6e3,
      frequencyMhz: 650,
      coreVoltageMv: 1400,
      asicVoltageMv: 1388,
      asicCount: 126,
      baseGhs: 104200,
      baseFreqMhz: 650,
      baseCoreMv: 1400,
      basePowerW: 3060,
      bestDiffN: 41e8,
      bestSessionN: 82e7,
      firmware: "cgminer 4.11.1",
    }),
    ...Array.from({ length: 36 }, (_, i) => benchUnit(i + 1)),
  ];
}

function benchUnit(n: number): Miner {
  const esp = n % 3 !== 0;
  const tempC = 50 + ((n * 5) % 34);
  const vrTempC = Math.min(102, tempC - 10 + (n % 7));
  const hashrateGhs = esp ? 1100 + (n % 8) * 380 : 2400 + (n % 6) * 700;
  const powerW = esp ? 12 + (n % 5) * 4.2 : 90 + (n % 4) * 18;
  const fanPct = 35 + (n % 50);
  const maxFanRpm = esp ? 4500 : 4200;
  const frequencyMhz = esp ? 475 + (n % 5) * 25 : 550 + (n % 4) * 25;
  const coreVoltageMv = 1100 + (n % 6) * 50;
  return miner({
    id: `u${String(n).padStart(2, "0")}`,
    name: esp ? `bitaxe-${String(n).padStart(2, "0")}` : `nano-${String(n).padStart(2, "0")}`,
    host: `192.168.4.${39 + n}`,
    kind: esp ? "esp-miner" : "cgminer",
    port: esp ? 80 : 4028,
    hashrateGhs,
    tempC,
    vrTempC,
    powerW,
    accepted: 200 + n * 37,
    rejected: n % 9,
    uptimeSec: 3600 * (1 + (n % 20)),
    pool: esp ? "public-pool.local:21496" : "ckpool.org:3333",
    fanPct,
    fanRpm: Math.round((fanPct / 100) * maxFanRpm),
    fanAuto: n % 4 !== 0,
    maxFanRpm,
    frequencyMhz,
    coreVoltageMv,
    asicVoltageMv: Math.round(coreVoltageMv * 0.985),
    asicCount: esp ? 1 + (n % 4) : 1,
    baseGhs: hashrateGhs,
    baseFreqMhz: frequencyMhz,
    baseCoreMv: coreVoltageMv,
    basePowerW: powerW,
    bestDiffN: (8 + n) * 1e6,
    bestSessionN: (2 + (n % 6)) * 1e6,
    firmware: esp ? "ESP-Miner 2.15.0" : "cgminer 4.11.1",
  });
}

function fleetTh(miners: Miner[]): number {
  return miners.reduce((sum, m) => sum + (m.online ? m.hashrateGhs : 0), 0) / 1e3;
}

const ORIGIN = 17e11;

function seedSamples(miners: Miner[]): Sample[] {
  const th = fleetTh(miners);
  return Array.from({ length: 28 }, (_, i) => ({
    t: ORIGIN - (28 - i) * 2e3,
    th: th * (0.975 + ((i * 17) % 7) * 0.006),
  }));
}

function seedLogs(miners: Miner[]): LogLine[] {
  const byId = Object.fromEntries(miners.map((m) => [m.id, m]));
  const rows: [string, number, LogLevel, string][] = [
    ["gamma", 48, "info", "display attached  HDMI local  recording on"],
    ["gamma", 40, "info", "stratum connected  public-pool.local:21496"],
    ["qaxe", 32, "info", "system  5.24 TH/s  79 W  64°C"],
    ["nano", 26, "info", "API summary  port 4028  pool 0 alive"],
    ["s19", 18, "warn", "devs  board temp 76°C  fan 78%"],
    ["gamma", 10, "info", "share accepted  diff 1.2M"],
  ];
  return rows.flatMap(([id, ago, level, text], i) => {
    const m = byId[id];
    if (!m) return [];
    return [
      {
        id: `seed-${i}`,
        ts: ORIGIN - ago * 1e3,
        minerId: m.id,
        minerName: m.name,
        level,
        text,
      },
    ];
  });
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function basePing(m: Miner): number {
  let n = 0;
  for (const c of m.id) n = (n + c.charCodeAt(0)) % 37;
  return 8 + n;
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export function parseDiff(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return 0;
  const match = v.trim().match(/^([\d.]+)\s*([kmg])?$/i);
  if (!match) return 0;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return 0;
  const unit = (match[2] || "").toUpperCase();
  return n * (unit === "G" ? 1e9 : unit === "M" ? 1e6 : unit === "K" ? 1e3 : 1);
}

export function formatDiff(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}G`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e8 ? 1 : 2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

function coinFromPool(pool: string): { coin: string; algo: string } {
  const p = pool.toLowerCase();
  if (/kaspa|kheavyhash|\bkas\b/.test(p)) return { coin: "KAS", algo: "kHeavyHash" };
  if (/dogecoin|\bdoge\b/.test(p)) return { coin: "DOGE", algo: "Scrypt" };
  if (/scrypt|litecoin|\bltc\b/.test(p)) return { coin: "LTC", algo: "Scrypt" };
  if (/monero|randomx|\bxmr\b/.test(p)) return { coin: "XMR", algo: "RandomX" };
  return { coin: "BTC", algo: "SHA-256" };
}

type RawMiner = Partial<Miner> & { id?: string; bestDiff?: unknown };

function hydrateMiner(raw: RawMiner): Miner {
  const seed = raw.id ? seedMiners().find((s) => s.id === raw.id) : undefined;
  const m = miner({
    id: raw.id || nid(),
    name: raw.name || seed?.name || "miner",
    host: raw.host || seed?.host || "",
    kind: raw.kind && isLinkKind(raw.kind) ? raw.kind : seed?.kind || "esp-miner",
    ...raw,
  });
  const hammer = m.kind === "hammer";
  const tna = m.kind === "tna-canaan";
  const harlo = m.kind === "harlo";
  const frequencyMhz = clamp(
    num(raw.frequencyMhz, seed?.frequencyMhz ?? (tna ? 300 : 525)),
    hammer ? 100 : tna ? 100 : 200,
    hammer ? 1200 : tna ? 600 : harlo ? 4000 : 900,
  );
  const coreVoltageMv = clamp(
    num(raw.coreVoltageMv, seed?.coreVoltageMv ?? (tna ? 3650 : 1200)),
    hammer ? 800 : tna ? 3100 : 800,
    hammer ? 1600 : tna ? 3900 : 1600,
  );
  const hashrateGhs = num(raw.hashrateGhs, seed?.hashrateGhs ?? 0);
  const powerW = num(raw.powerW, seed?.powerW ?? 0);
  const tempC = num(raw.tempC, seed?.tempC ?? 55);
  const vrFallback = seed?.vrTempC ?? Math.round(tempC * 0.84);
  const vrTempC = num(raw.vrTempC, vrFallback);
  const baseTempC =
    seed?.tempC ?? (num(raw.baseTempC, 0) >= 40 ? num(raw.baseTempC, 0) : tempC || 58);
  const baseVrC =
    seed?.vrTempC ?? (num(raw.baseVrC, 0) >= 30 ? num(raw.baseVrC, 0) : Math.round(baseTempC * 0.85));
  const shownTemp = seed && tempC < seed.tempC - 6 ? seed.tempC : tempC;
  const shownVr = seed && vrTempC < baseVrC - 6 ? baseVrC : vrTempC;
  const fanPct = clamp(num(raw.fanPct, seed?.fanPct ?? 40), 0, 100);
  const maxFanRpm = num(raw.maxFanRpm, seed?.maxFanRpm ?? 4500);
  const asicCount = Math.max(1, Math.round(num(raw.asicCount, seed?.asicCount ?? 1)));
  const baseGhs = num(raw.baseGhs, seed?.baseGhs ?? hashrateGhs);
  const basePowerW = num(raw.basePowerW, seed?.basePowerW ?? powerW);
  const baseFreqMhz = num(raw.baseFreqMhz, seed?.baseFreqMhz ?? frequencyMhz);
  const baseCoreMv = num(raw.baseCoreMv, seed?.baseCoreMv ?? coreVoltageMv);
  const asicVoltageMv = num(raw.asicVoltageMv, Math.round(coreVoltageMv * 0.985));
  const fanAuto = typeof raw.fanAuto === "boolean" ? raw.fanAuto : (seed?.fanAuto ?? true);
  const parsedBest = parseDiff(raw.bestDiff);
  const bestFallback = seed?.bestDiffN ?? parsedBest;
  let bestDiffN = num(raw.bestDiffN, 0) > 0 ? num(raw.bestDiffN, 0) : bestFallback;
  const sessionFallback = seed?.bestSessionN ?? (bestDiffN > 0 ? bestDiffN * 0.3 : 0);
  let bestSessionN = num(raw.bestSessionN, 0) > 0 ? num(raw.bestSessionN, 0) : sessionFallback;
  if (bestSessionN > bestDiffN) bestDiffN = bestSessionN;
  const asicWarnC = clamp(
    num(raw.asicWarnC, 0) >= 45 ? num(raw.asicWarnC, 0) : (seed?.asicWarnC ?? 72),
    45,
    100,
  );
  const vrWarnC = clamp(
    num(raw.vrWarnC, 0) >= 45 ? num(raw.vrWarnC, 0) : (seed?.vrWarnC ?? 85),
    45,
    115,
  );
  const guessed = coinFromPool(raw.pool || seed?.pool || "");
  return {
    ...m,
    frequencyMhz,
    coreVoltageMv,
    hashrateGhs,
    powerW,
    tempC: shownTemp,
    vrTempC: shownVr,
    baseTempC,
    baseVrC,
    asicWarnC,
    vrWarnC,
    fanPct,
    fanRpm: Math.round((fanPct / 100) * maxFanRpm),
    fanAuto,
    bootSec: clamp(Math.round(num(raw.bootSec, 0)), 0, 60),
    maxFanRpm,
    asicCount,
    asicVoltageMv,
    pingMs: num(raw.pingMs, 0) > 0 ? num(raw.pingMs, 0) : basePing(m),
    pingWarnMs: clamp(num(raw.pingWarnMs, -1) >= 0 ? num(raw.pingWarnMs, 80) : (seed?.pingWarnMs ?? 80), 0, 250),
    coin: raw.coin || seed?.coin || guessed.coin,
    algo: raw.algo || seed?.algo || guessed.algo,
    pools: Array.isArray(raw.pools) && raw.pools.length > 0 ? raw.pools.map(String) : (seed?.pools ?? []),
    worker: raw.worker || seed?.worker || "",
    workerCoins: Array.isArray(raw.workerCoins) ? raw.workerCoins.map(String) : [],
    bestDiffN,
    bestSessionN,
    baseGhs,
    basePowerW,
    baseFreqMhz,
    baseCoreMv,
    apiToken: typeof raw.apiToken === "string" ? raw.apiToken : "",
    wifiRssi: num(raw.wifiRssi, 0) < 0 ? Math.round(num(raw.wifiRssi, 0)) : 0,
    overheat: raw.overheat === true,
    lastSeenAt: num(raw.lastSeenAt, 0) > 0 ? num(raw.lastSeenAt, 0) : 0,
    lowSince: num(raw.lowSince, 0) > 0 ? num(raw.lowSince, 0) : 0,
    floorGhs: num(raw.floorGhs, 0) > 0 ? num(raw.floorGhs, 0) : 0,
  };
}

function applyPatch(m: Miner, patch: TunePatch): Miner {
  const next = hydrateMiner({ ...m, ...patch });
  const hammer = m.kind === "hammer";
  const tna = m.kind === "tna-canaan";
  const harlo = m.kind === "harlo";
  next.fanPct = clamp(Math.round(next.fanPct), 0, 100);
  next.frequencyMhz = clamp(Math.round(next.frequencyMhz), hammer ? 100 : tna ? 100 : 200, hammer ? 1200 : tna ? 600 : harlo ? 4000 : 900);
  next.coreVoltageMv = clamp(Math.round(next.coreVoltageMv), hammer ? 800 : tna ? 3100 : 800, hammer ? 1600 : tna ? 3900 : 1600);
  next.asicWarnC = clamp(Math.round(next.asicWarnC), 45, 100);
  next.vrWarnC = clamp(Math.round(next.vrWarnC), 45, 115);
  next.pingWarnMs = clamp(Math.round(next.pingWarnMs), 0, 250);
  next.floorGhs = next.floorGhs > 0 ? next.floorGhs : 0;
  next.fanRpm = Math.round((next.fanPct / 100) * (next.maxFanRpm || 4500));
  if (patch.coreVoltageMv != null && m.simulated) next.asicVoltageMv = Math.round(next.coreVoltageMv * (0.978 + Math.random() * 0.012));
  return next;
}

function commandFor(m: Miner, patch: TunePatch): MinerCommand | null {
  if (patch.fanPct != null || patch.fanAuto != null) {
    return { action: "fan", fanPct: patch.fanPct ?? m.fanPct, fanAuto: patch.fanAuto ?? m.fanAuto };
  }
  if (m.kind === "harlo" && (patch.frequencyMhz != null || patch.coreVoltageMv != null)) {
    return {
      action: "frequency",
      frequencyMhz: patch.frequencyMhz ?? m.frequencyMhz,
      coreVoltageMv: patch.coreVoltageMv ?? m.coreVoltageMv,
    };
  }
  if (patch.frequencyMhz != null) return { action: "frequency", frequencyMhz: patch.frequencyMhz };
  if (patch.coreVoltageMv != null) return { action: "voltage", coreVoltageMv: patch.coreVoltageMv };
  return null;
}

function sendCommand(m: Miner, command: MinerCommand) {
  commandMiner({
    data: { target: { id: m.id, host: m.host, port: m.port, kind: m.kind, token: m.apiToken }, command },
  })
    .then((result) => {
      if (result.ok) return;
      useFleet.setState((s) => ({
        logs: s.recording
          ? [
              ...s.logs,
              {
                id: nid(),
                ts: Date.now(),
                minerId: m.id,
                minerName: m.name,
                level: "fault" as const,
                text: `command failed  ${result.error || "no answer"}`,
              },
            ].slice(-400)
          : s.logs,
      }));
    })
    .catch(() => {});
}

export function poolUrls(m: { pool: string; pools: string[] }): string[] {
  const urls: string[] = [];
  const add = (url: string) => {
    const clean = url.trim();
    if (clean && !urls.includes(clean)) urls.push(clean);
  };
  add(m.pool);
  for (const url of m.pools) add(url);
  return urls;
}

function watchPools(id: string) {
  const row = useFleet.getState().miners.find((item) => item.id === id);
  if (!row) return;
  const urls = poolUrls(row);
  if (urls.length === 0) return;
  void resolvePoolCoins({ data: { pools: urls } })
    .then((found) => {
      const current = useFleet.getState().miners.find((item) => item.id === id);
      if (!current) return;
      const list = poolUrls(current);
      const coins: PoolCoin[] = [];
      for (const url of list) {
        const coin = found.find((hit) => hit.pool === url)?.coin;
        if (!coin || coins.some((known) => known.ticker === coin.ticker)) continue;
        coins.push(coin);
      }
      if (coins.length === 0) return;
      if (coins.length === 1) {
        const coin = coins[0]!;
        if (current.coin === coin.ticker && current.algo === coin.algo && current.workerCoins.length === 0) return;
        useFleet.getState().tune(
          id,
          { coin: coin.ticker, algo: coin.algo, workerCoins: [] },
          current.coin === coin.ticker ? undefined : `pool  ${coin.ticker}  ${coin.algo}`,
        );
        return;
      }
      const tickers = coins.map((coin) => coin.ticker);
      if (tickers.join() === current.workerCoins.join()) return;
      useFleet.getState().tune(id, { workerCoins: tickers }, `pools on  ${tickers.join("  ")}`);
    })
    .catch(() => {});
}

function stepSim(m: Miner): { miner: Miner; line: LogLine | null; alert: LogLine | null; urgent: boolean } {
  const baseFreq = m.baseFreqMhz || m.frequencyMhz || 500;
  const baseMv = m.baseCoreMv || m.coreVoltageMv || 1200;
  const baseGhs = m.baseGhs || m.hashrateGhs || 1;
  const basePower = m.basePowerW || m.powerW || 1;
  const f = m.frequencyMhz / baseFreq;
  const v = m.coreVoltageMv / baseMv;
  const hashrateGhs = Math.max(1, baseGhs * f * v * (1 + (Math.random() * 2 - 1) * 0.012));
  const powerW = Math.max(1, basePower * f * v * v * (1 + (Math.random() * 2 - 1) * 0.01));
  const fanPct = m.fanAuto ? clamp(Math.round(25 + Math.max(0, m.tempC - 45) * 2.2), 20, 100) : m.fanPct;
  const fanRpm = Math.round((fanPct / 100) * (m.maxFanRpm || 4500));
  const asicSet = m.baseTempC >= 40 ? m.baseTempC : 58;
  const vrSet = m.baseVrC >= 30 ? m.baseVrC : asicSet * 0.85;
  const target = asicSet + (f * v - 1) * 12 - (fanPct - 45) * 0.05 + (Math.random() * 2 - 1) * 0.3;
  const tempC = clamp(m.tempC + (target - m.tempC) * 0.28, 40, 96);
  const vrTarget = vrSet + (tempC - asicSet) * 0.55 + (v - 1) * 6;
  const vrTempC = clamp((m.vrTempC || vrTarget) + (vrTarget - (m.vrTempC || vrTarget)) * 0.28, 30, 110);
  const asicVoltageMv = Math.round(m.coreVoltageMv * (0.978 + Math.random() * 0.016));
  const gotShare = Math.random() < 0.55;
  const rejected = m.rejected + (Math.random() < 0.04 ? 1 : 0);
  let bestSessionN = num(m.bestSessionN, 0);
  let bestDiffN = Math.max(num(m.bestDiffN, 0), bestSessionN);
  let newBest = false;
  if (gotShare && bestSessionN > 0 && Math.random() < 0.1) {
    const roll = bestSessionN * (0.35 + Math.random() * 1.15);
    if (roll > bestSessionN) {
      bestSessionN = roll;
      newBest = true;
      if (bestSessionN > bestDiffN) bestDiffN = bestSessionN;
    }
  }
  const pingMs = clamp(
    Math.round(basePing(m) + (Math.random() * 8 - 4) + (tempC >= (m.asicWarnC || 72) ? 14 : 0)),
    4,
    250,
  );
  const next: Miner = {
    ...m,
    hashrateGhs,
    tempC,
    vrTempC,
    powerW,
    fanPct,
    fanRpm,
    asicVoltageMv,
    bestDiffN,
    bestSessionN,
    accepted: m.accepted + (gotShare ? 1 : 0),
    rejected,
    pingMs: m.online ? pingMs : 0,
    uptimeSec: m.uptimeSec + 2,
  };
  let line: LogLine | null = null;
  let alert: LogLine | null = null;
  const asicLimit = m.asicWarnC >= 45 ? m.asicWarnC : 72;
  const vrLimit = m.vrWarnC >= 45 ? m.vrWarnC : 85;
  const wasHot = m.tempC >= asicLimit || m.vrTempC >= vrLimit;
  const hot = tempC >= asicLimit || vrTempC >= vrLimit;
  const severe = tempC >= asicLimit + 8 || vrTempC >= vrLimit + 8;
  if (hot) {
    const which = [tempC >= asicLimit ? `asic ${tempC.toFixed(1)}°C` : null, vrTempC >= vrLimit ? `vreg ${vrTempC.toFixed(1)}°C` : null]
      .filter(Boolean)
      .join("  ");
    alert = {
      id: nid(),
      ts: Date.now(),
      minerId: m.id,
      minerName: m.name,
      level: severe ? "fault" : "warn",
      text: `heat warning  ${which}  fan ${fanRpm} rpm`,
    };
  }
  if (!alert && newBest) {
    line = {
      id: nid(),
      ts: Date.now(),
      minerId: m.id,
      minerName: m.name,
      level: "info",
      text: `best share ${formatDiff(bestSessionN)} since power on`,
    };
  } else if (!alert && Math.random() < 0.7) {
    const rate = hashrateGhs >= 1e3 ? `${(hashrateGhs / 1e3).toFixed(2)} TH/s` : `${hashrateGhs.toFixed(0)} GH/s`;
    const text =
      m.kind === "esp-miner"
        ? gotShare
          ? `share accepted  ${rate}  ${powerW.toFixed(1)} W`
          : `ws live  ${rate}  ${tempC.toFixed(1)}°C  fan ${fanPct}%`
        : gotShare
          ? `Accepted  diff share  ${rate}  pool ${m.pool}`
          : `summary  ${rate}  A=${next.accepted}  R=${rejected}`;
    line = { id: nid(), ts: Date.now(), minerId: m.id, minerName: m.name, level: "info", text };
  }
  return { miner: next, line, alert, urgent: hot && !wasHot };
}

const seeded = showBench ? seedMiners() : showDemo ? demoMiners() : [];

export const useFleet = create<FleetState>()(
  persist(
    (set, get) => ({
      miners: seeded,
      logs: showBench ? seedLogs(seeded) : showDemo ? seedLogs(seeded) : [],
      samples: showBench || showDemo ? seedSamples(seeded) : [],
      recording: true,
      selectedId: null,
      banner: true,
      scanSubnet: "",
      rebase: () => {
        const now = Date.now();
        set((s) => ({
          logs: s.logs.map((l) => (l.ts < ORIGIN ? { ...l, ts: now - (ORIGIN - l.ts) } : l)),
          samples: s.samples.map((p) => (p.t < ORIGIN ? { ...p, t: now - (ORIGIN - p.t) } : p)),
        }));
      },
      tick: () => {
        const state = get();
        const now = Date.now();
        const fresh: LogLine[] = [];
        const pick = state.miners.filter((m) => m.simulated && m.online);
        const speakers = new Set<string>();
        if (state.selectedId && pick.some((m) => m.id === state.selectedId)) speakers.add(state.selectedId);
        while (pick.length > 0 && speakers.size < Math.min(4, pick.length)) {
          speakers.add(pick[Math.floor(Math.random() * pick.length)]!.id);
        }
        const miners = state.miners.map((m) => {
          if (m.bootSec > 0) {
            const left = m.bootSec - 2;
            if (!m.simulated) {
              return { ...m, bootSec: Math.max(0, left), online: false, hashrateGhs: 0, powerW: 0 };
            }
            if (left > 0) return { ...m, bootSec: left, online: false, hashrateGhs: 0, powerW: 0 };
            fresh.push({
              id: nid(),
              ts: now,
              minerId: m.id,
              minerName: m.name,
              level: "info",
              text: "restart complete",
            });
            return { ...m, bootSec: 0, online: true, uptimeSec: 0, hashrateGhs: m.baseGhs || m.hashrateGhs || 1 };
          }
          if (!m.simulated || !m.online) return m;
          const stepped = stepSim(m);
          if (stepped.alert && (stepped.urgent || speakers.has(m.id))) fresh.push(stepped.alert);
          else if (speakers.has(m.id) && stepped.line) fresh.push(stepped.line);
          return stepped.miner;
        });
        set({
          miners,
          logs: state.recording ? [...state.logs, ...fresh].slice(-400) : state.logs,
          samples: [...state.samples, { t: now, th: fleetTh(miners) }].slice(-90),
        });
      },
      addMiner: (input) => {
        const id = nid();
        const created = miner({
          id,
          name: input.name.trim(),
          host: input.host.trim(),
          kind: input.kind,
          port: input.port,
          apiToken: input.apiToken?.trim() ?? "",
          simulated: false,
          online: false,
          firmware: input.kind,
          note: "Waiting for this miner on the network.",
        });
        const line: LogLine = {
          id: nid(),
          ts: Date.now(),
          minerId: id,
          minerName: created.name,
          level: "info",
          text: `added  ${created.kind}  ${created.host}:${created.port}`,
        };
        set((s) => ({
          miners: [...s.miners, created],
          logs: s.recording ? [...s.logs, line].slice(-400) : s.logs,
        }));
      },
      addDiscovered: (found) => {
        const have = new Set(get().miners.map((m) => m.host));
        const fresh = found.filter((f) => f.host && !have.has(f.host));
        if (fresh.length === 0) return 0;
        const now = Date.now();
        const created = fresh.map((f) =>
          miner({
            id: nid(),
            name: f.name,
            host: f.host,
            kind: f.kind,
            port: f.port,
            simulated: false,
            online: false,
            firmware: f.firmware || f.kind,
            note: "Found on the network.",
            ...(/dc0?2/i.test(`${f.name} ${f.firmware ?? ""}`) ? { coin: "LTC", algo: "Scrypt" } : {}),
          }),
        );
        const line: LogLine = {
          id: nid(),
          ts: now,
          minerId: created[0]!.id,
          minerName: "scan",
          level: "info",
          text: `added ${created.length} from the network`,
        };
        set((s) => ({
          miners: [...s.miners, ...created],
          logs: s.recording ? [...s.logs, line].slice(-400) : s.logs,
        }));
        return created.length;
      },
      removeMiner: (id) =>
        set((s) => ({
          miners: s.miners.filter((m) => m.id !== id),
          selectedId: s.selectedId === id ? null : s.selectedId,
        })),
      removeAll: () => set({ miners: [], selectedId: null, samples: [] }),
      toggleRecording: () => set((s) => ({ recording: !s.recording })),
      select: (id) => set({ selectedId: id }),
      clearLogs: () => set({ logs: [] }),
      dismissBanner: () => set({ banner: false }),
      setScanSubnet: (subnet) => set({ scanSubnet: subnet.trim() }),
      tune: (id, patch, message) => {
        const current = get().miners.find((m) => m.id === id);
        if (!current) return;
        const next = applyPatch(current, patch);
        const line: LogLine | null = message
          ? { id: nid(), ts: Date.now(), minerId: next.id, minerName: next.name, level: "info", text: message }
          : null;
        set((s) => ({
          miners: s.miners.map((m) => (m.id === id ? next : m)),
          logs: line && s.recording ? [...s.logs, line].slice(-400) : s.logs,
        }));
        if (!current.simulated && message) {
          const command = commandFor(current, patch);
          if (command) sendCommand(current, command);
        }
        if (patch.pool != null || patch.pools != null) watchPools(id);
      },
      restart: (id) => {
        const current = get().miners.find((m) => m.id === id);
        if (!current || current.bootSec > 0) return;
        const line: LogLine = {
          id: nid(),
          ts: Date.now(),
          minerId: current.id,
          minerName: current.name,
          level: "warn",
          text: current.simulated ? "restart  fans apply on boot" : "restart sent",
        };
        set((s) => ({
          miners: s.miners.map((m) =>
            m.id === id ? { ...m, bootSec: current.simulated ? 8 : 40, online: false, hashrateGhs: 0, powerW: 0 } : m,
          ),
          logs: s.recording ? [...s.logs, line].slice(-400) : s.logs,
        }));
        if (!current.simulated) sendCommand(current, { action: "restart" });
      },
      applyLive: (reads) => {
        const byId = new Map(reads.map((read) => [read.id, read]));
        const fresh: LogLine[] = [];
        const watched: string[] = [];
        const now = Date.now();
        const miners = get().miners.map((m) => {
          const read = byId.get(m.id);
          if (!read || m.simulated) return m;
          if (!read.ok) {
            if (m.online) {
              fresh.push({
                id: nid(),
                ts: now,
                minerId: m.id,
                minerName: m.name,
                level: "fault",
                text: `offline  ${read.error || "no answer"}`,
              });
            }
            return { ...m, online: false, hashrateGhs: 0, powerW: 0, overheat: false, lowSince: 0, note: read.error || "No answer" };
          }
          const asicLimit = m.asicWarnC >= 45 ? m.asicWarnC : 72;
          const vrLimit = m.vrWarnC >= 45 ? m.vrWarnC : 85;
          const tempC = read.tempC ?? m.tempC;
          const vrTempC = read.vrTempC ?? m.vrTempC;
          const wasHot = m.online && (m.tempC >= asicLimit || (m.vrTempC > 0 && m.vrTempC >= vrLimit));
          const hot = tempC >= asicLimit || (vrTempC > 0 && vrTempC >= vrLimit);
          if (!m.online) {
            fresh.push({ id: nid(), ts: now, minerId: m.id, minerName: m.name, level: "info", text: "connected" });
          } else if (hot && !wasHot) {
            fresh.push({
              id: nid(),
              ts: now,
              minerId: m.id,
              minerName: m.name,
              level: "fault",
              text: `heat warning  asic ${tempC.toFixed(0)}°C  limit ${asicLimit}°C  vreg ${vrTempC.toFixed(0)}°C`,
            });
          }
          const nextPool = read.pool || m.pool;
          if (nextPool && nextPool !== m.pool) watched.push(m.id);
          const rate = read.hashrateGhs ?? m.hashrateGhs;
          const uptime = read.uptimeSec ?? m.uptimeSec;
          const floor = expectedGhs({ ...m, floorGhs: m.floorGhs });
          let lowSince = m.lowSince;
          if (!(floor > 0) || uptime < 180 || rate >= floor * 0.8) lowSince = 0;
          else if (!lowSince) lowSince = now;
          const wasLow = m.lowSince > 0 && now - m.lowSince >= LOW_HASH_MS + 8000;
          const nowLow = lowSince > 0 && now - lowSince >= LOW_HASH_MS;
          if (nowLow && !wasLow) {
            const seen = formatRate(rate);
            const want = formatRate(floor);
            fresh.push({
              id: nid(),
              ts: now,
              minerId: m.id,
              minerName: m.name,
              level: "warn",
              text: `low hashrate  ${seen.n} ${seen.u}  floor ${want.n} ${want.u}`,
            });
          }
          return {
            ...m,
            online: true,
            bootSec: 0,
            note: null,
            hashrateGhs: read.hashrateGhs ?? m.hashrateGhs,
            tempC,
            vrTempC,
            powerW: read.powerW ?? m.powerW,
            accepted: read.accepted ?? m.accepted,
            rejected: read.rejected ?? m.rejected,
            uptimeSec: read.uptimeSec ?? m.uptimeSec,
            pingMs: read.pingMs ?? m.pingMs,
            fanPct: read.fanPct ?? m.fanPct,
            fanRpm: read.fanRpm ?? m.fanRpm,
            fanAuto: read.fanAuto ?? m.fanAuto,
            frequencyMhz: read.frequencyMhz ?? m.frequencyMhz,
            coreVoltageMv: read.coreVoltageMv ?? m.coreVoltageMv,
            asicVoltageMv: read.asicVoltageMv ?? m.asicVoltageMv,
            asicCount: read.asicCount ?? m.asicCount,
            bestDiffN: read.bestDiffN || m.bestDiffN,
            bestSessionN: read.bestSessionN || m.bestSessionN,
            pool: nextPool,
            pools: read.pools && read.pools.length > 0 ? read.pools : nextPool ? [nextPool] : [],
            onFallback: Boolean(read.onFallback),
            wifiRssi: typeof read.wifiRssi === "number" && read.wifiRssi < 0 ? Math.round(read.wifiRssi) : m.wifiRssi,
            overheat: Boolean(read.overheat),
            lastSeenAt: now,
            lowSince,
            worker: read.worker || m.worker,
            firmware: read.firmware || m.firmware,
            kind: read.kind && isLinkKind(read.kind) ? read.kind : m.kind,
            port: read.port && read.port > 0 ? read.port : m.port,
          };
        });
        set((s) => ({
          miners,
          logs: fresh.length && s.recording ? [...s.logs, ...fresh].slice(-400) : s.logs,
        }));
        watched.forEach(watchPools);
      },
    }),
    {
      name: "faceplate-v1",
      skipHydration: true,
      storage: createJSONStorage(() => (typeof window === "undefined" ? memoryStorage : localStorage)),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<FleetState>;
        const incoming = saved.miners ?? current.miners;
        const custom = incoming.filter((m) => !m.simulated);
        const savedBench = incoming.filter((m) => m.simulated);
        const bench = showBench ? (savedBench.length >= 40 ? savedBench : seedMiners()) : [];
        const demo = showDemo && custom.length === 0 ? demoMiners() : [];
        const miners = [...bench, ...demo, ...custom].map((m) => hydrateMiner(m));
        if (!showBench) {
          const ids = new Set(miners.map((m) => m.id));
          const logs = demo.length > 0 ? seedLogs(demo) : (saved.logs ?? []).filter((l) => ids.has(l.minerId));
          return {
            ...current,
            ...saved,
            miners,
            logs,
            samples: demo.length > 0 ? seedSamples(demo) : miners.length > 0 ? (saved.samples ?? []) : [],
          };
        }
        return {
          ...current,
          ...saved,
          miners,
        };
      },
      partialize: (s) => ({
        miners: s.miners,
        logs: s.logs,
        samples: s.samples,
        recording: s.recording,
        selectedId: s.selectedId,
        banner: s.banner,
        scanSubnet: s.scanSubnet,
      }),
    },
  ),
);

export function minerUrl(m: Miner): string {
  const host = m.host.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const web = m.port === 80 || m.port === 443 || m.port === 8080 ? m.port : 80;
  return `http://${host}${web === 80 ? "" : `:${web}`}/`;
}

export function formatRate(ghs: number): { n: string; u: string } {
  if (!Number.isFinite(ghs) || ghs <= 0) return { n: "—", u: "" };
  if (ghs >= 1e3) return { n: (ghs / 1e3).toFixed(2), u: "TH/s" };
  if (ghs < 1) return { n: (ghs * 1e3).toFixed(ghs >= 0.1 ? 0 : 1), u: "MH/s" };
  return { n: ghs.toFixed(ghs >= 100 ? 0 : 1), u: "GH/s" };
}

export function formatUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function formatEff(powerW: number, ghs: number): string {
  if (ghs > 0 && ghs < 1) {
    const mhs = ghs * 1e3;
    return `${(powerW / mhs).toFixed(2)} J/MH`;
  }
  const th = ghs / 1e3;
  if (th <= 0.01) return "—";
  return `${(powerW / th).toFixed(1)} J/TH`;
}

export function formatPower(w: number): string {
  if (!Number.isFinite(w) || w <= 0) return "—";
  if (w >= 1e3) return `${(w / 1e3).toFixed(2)} kW`;
  return `${w.toFixed(w >= 100 ? 0 : 1)} W`;
}

export function asicWarn(m: Miner): number {
  return m.asicWarnC >= 45 && m.asicWarnC <= 100 ? m.asicWarnC : 72;
}

export function vrWarn(m: Miner): number {
  return m.vrWarnC >= 45 && m.vrWarnC <= 115 ? m.vrWarnC : 85;
}

export function pingWarn(m: Miner): number {
  return m.pingWarnMs >= 0 && m.pingWarnMs <= 250 ? m.pingWarnMs : 80;
}

export const LOW_HASH_MS = 3 * 60 * 1000;

/** GH/s this board should hold. A set floor wins. Known Hammer models use their low mode. */
export function expectedGhs(m: Pick<Miner, "floorGhs" | "name" | "firmware">): number {
  if (m.floorGhs > 0) return m.floorGhs;
  const blob = `${m.name} ${m.firmware}`.toLowerCase();
  if (/thor\s*x\s*1|\bx1\b/.test(blob)) return 2100;
  if (/thor\s*p\s*2|\bp2\b/.test(blob)) return 4800;
  if (/bc0?8/.test(blob)) return 9600;
  if (/bc0?4/.test(blob)) return 4800;
  if (/bc0?1/.test(blob)) return 1200;
  if (/dc0?2/.test(blob)) return 0.105;
  return 0;
}

export function hashIsLow(m: Miner, now = Date.now()): boolean {
  if (!m.online || m.bootSec > 0 || m.uptimeSec < 180) return false;
  const floor = expectedGhs(m);
  if (!(floor > 0) || !(m.lowSince > 0)) return false;
  if (m.hashrateGhs >= floor * 0.8) return false;
  return now - m.lowSince >= LOW_HASH_MS;
}

export function fallbackPool(m: Pick<Miner, "pool" | "pools">): string {
  return m.pools.find((row) => row && row !== m.pool) ?? "";
}

export function seenAgo(m: Miner, now: number): string {
  if (!m.lastSeenAt) return "Not seen yet";
  const sec = Math.max(0, Math.round((now - m.lastSeenAt) / 1000));
  if (sec < 45) return "Last seen just now";
  return `Last seen ${formatUptime(sec)} ago`;
}

export function minerTone(m: Miner): "idle" | "down" | "hot" | "warm" | "live" {
  if (!m.simulated && !m.online) return "idle";
  if (!m.online) return "down";
  const asic = asicWarn(m);
  const vr = vrWarn(m);
  if (m.overheat || m.tempC >= asic + 8 || m.vrTempC >= vr + 8) return "hot";
  if (hashIsLow(m)) return "hot";
  if (m.tempC >= asic || m.vrTempC >= vr) return "warm";
  return "live";
}

export function logsToText(logs: LogLine[]): string {
  return logs
    .map((l) => `${new Date(l.ts).toISOString()}\t${l.level}\t${l.minerName}\t${l.text}`)
    .join("\n");
}
