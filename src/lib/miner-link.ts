export type LinkKind =
  | "cgminer"
  | "esp-miner"
  | "avalon"
  | "tna-canaan"
  | "hammer"
  | "harlo"
  | "greenbit";

export const LINK_KINDS: LinkKind[] = [
  "esp-miner",
  "cgminer",
  "avalon",
  "tna-canaan",
  "hammer",
  "harlo",
  "greenbit",
];

export const KIND_LABEL: Record<LinkKind, string> = {
  "esp-miner": "ESP",
  cgminer: "CG",
  avalon: "NANO",
  "tna-canaan": "TNA",
  hammer: "THOR",
  harlo: "HARLO",
  greenbit: "SATBOY",
};

export function defaultPort(kind: LinkKind): number {
  if (kind === "cgminer" || kind === "avalon") return 4028;
  if (kind === "greenbit") return 30110;
  return 80;
}

export function isLinkKind(value: string): value is LinkKind {
  return (LINK_KINDS as string[]).includes(value);
}

export type MinerTarget = {
  id: string;
  host: string;
  port: number;
  kind: LinkKind;
  token?: string;
};

export type LiveRead = {
  id: string;
  ok: boolean;
  error?: string;
  hashrateGhs?: number;
  tempC?: number;
  vrTempC?: number;
  powerW?: number;
  accepted?: number;
  rejected?: number;
  uptimeSec?: number;
  pingMs?: number;
  fanPct?: number;
  fanRpm?: number;
  fanAuto?: boolean;
  frequencyMhz?: number;
  coreVoltageMv?: number;
  asicVoltageMv?: number;
  asicCount?: number;
  bestDiffN?: number;
  bestSessionN?: number;
  pool?: string;
  pools?: string[];
  onFallback?: boolean;
  wifiRssi?: number;
  overheat?: boolean;
  logs?: string[];
  deviceLog?: string;
  worker?: string;
  firmware?: string;
  kind?: LinkKind;
  port?: number;
};

export type MinerCommand =
  | { action: "fan"; fanPct: number; fanAuto: boolean }
  | { action: "frequency"; frequencyMhz: number; coreVoltageMv?: number }
  | { action: "voltage"; coreVoltageMv: number; frequencyMhz?: number }
  | { action: "restart" }
  | { action: "pool"; host: string; port: number; user: string };

export function safeHost(host: string): string | null {
  const clean = host.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!clean || clean.length > 253 || !/^[a-zA-Z0-9._:-]+$/.test(clean)) return null;
  return clean;
}

export function safePort(port: number): number | null {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return port;
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return 0;
}

const HASHRATE_KEYS = [
  "hashRate",
  "hashRate_1m",
  "hashRate1m",
  "hashRate_10m",
  "hashRate10m",
  "hashRate_1h",
  "hashRate1h",
  "hashRate_1d",
  "hashRate1d",
  "hashRate_5m",
  "hashrate",
] as const;

/** GH/s from an AxeOS number, or from a string that includes TH/s, GH/s, or MH/s. */
function rateGhs(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return undefined;
  const match = v.trim().match(/^(-?[\d.]+)\s*(th\/s|ths|gh\/s|ghs|mh\/s|mhs|h\/s)?$/i);
  if (!match) return undefined;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return undefined;
  const unit = (match[2] || "").toLowerCase();
  if (unit.startsWith("th")) return n * 1000;
  if (unit.startsWith("mh")) return n / 1000;
  if (unit === "h/s") return n / 1e9;
  return n;
}

/** First real hashrate. AxeOS and NerdQAxe use different names, and newer NerdOS nests it. */
export function pickHashrateGhs(info: Record<string, unknown>): number | undefined {
  let saw = false;
  for (const key of HASHRATE_KEYS) {
    if (info[key] == null || info[key] === "") continue;
    const n = rateGhs(info[key]);
    if (n == null) continue;
    saw = true;
    if (n > 0) return n;
  }
  const chips = info.chips;
  if (Array.isArray(chips)) {
    let sum = 0;
    let chipSaw = false;
    for (const chip of chips) {
      if (!chip || typeof chip !== "object") continue;
      const n = rateGhs((chip as Record<string, unknown>).hashRate);
      if (n == null) continue;
      chipSaw = true;
      if (n > 0) sum += n;
    }
    if (chipSaw && sum > 0) return sum;
    if (chipSaw) saw = true;
  }
  const history = asRecord(info.history);
  for (const key of ["hashrate_10s", "hashrate_1m", "hashrate_10m", "hashrate_1h", "hashrate", "hashRate"]) {
    const series = history[key];
    if (!Array.isArray(series)) continue;
    for (let i = series.length - 1; i >= 0 && i >= series.length - 6; i--) {
      const n = rateGhs(series[i]);
      if (n == null) continue;
      saw = true;
      if (n > 0) return n;
    }
  }
  return saw ? 0 : undefined;
}

function diff(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v !== "string") return 0;
  const match = v.trim().match(/^([\d.]+)\s*([kmg])?$/i);
  if (!match) return 0;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return 0;
  const unit = (match[2] || "").toUpperCase();
  const mul = unit === "G" ? 1e9 : unit === "M" ? 1e6 : unit === "K" ? 1e3 : 1;
  return n * mul;
}

export function ghsFromCgminer(summary: Record<string, unknown>): number {
  const ths = num(summary["THS av"] ?? summary["THS 5s"]);
  if (ths > 0) return ths * 1000;
  const ghs = num(summary["GHS av"] ?? summary["GHS 5s"] ?? summary["GHS 1m"]);
  if (ghs > 0) return ghs;
  const mhs = num(summary["MHS av"] ?? summary["MHS 5s"] ?? summary["MHS 1m"]);
  return mhs > 0 ? mhs / 1000 : 0;
}

export function parseCgminer(id: string, body: Record<string, unknown>): LiveRead {
  const summary = (Array.isArray(body.SUMMARY) ? body.SUMMARY[0] : {}) as Record<string, unknown>;
  const devs = (Array.isArray(body.DEVS) ? body.DEVS : []) as Record<string, unknown>[];
  const pools = (Array.isArray(body.POOLS) ? body.POOLS : []) as Record<string, unknown>[];
  const listed = pools
    .map((entry, index) => ({ entry, index, url: String(entry.URL ?? entry.Stratum ?? "").trim() }))
    .filter((row) => row.url && row.url !== "0");
  const stratumOn = (entry: Record<string, unknown>) => {
    const flag = entry["Stratum Active"] ?? entry.StratumActive;
    return flag === true || flag === 1 || String(flag).toLowerCase() === "true";
  };
  const current = listed.find((row) => stratumOn(row.entry)) ?? listed.find((row) => String(row.entry.Status ?? "").toLowerCase() === "alive") ?? listed[0];
  const priority = current ? num(current.entry.Priority ?? current.index) : 0;
  const onFallback = Boolean(current && (priority > 0 || current.index > 0) && !stratumOn(listed[0]?.entry ?? {}));
  const url = current?.url ?? "";
  const worker = current ? String(current.entry.User ?? "") : "";
  const temps = devs
    .map((d) => num(d.Temperature ?? d["Chip Temp"] ?? d["Chip Temp Avg"]))
    .filter((t) => t > 0);
  const fanSpeeds = devs.map((d) => num(d["Fan Speed"] ?? d["Fan Percent"])).filter((n) => n > 0);
  const fan = fanSpeeds[0] ?? 0;
  const fanIsRpm = fan > 100;
  return {
    id,
    ok: true,
    hashrateGhs: ghsFromCgminer(summary),
    tempC: temps.length ? Math.max(...temps) : undefined,
    powerW: num(summary.Power) || undefined,
    accepted: num(summary.Accepted),
    rejected: num(summary.Rejected),
    uptimeSec: num(summary.Elapsed),
    bestDiffN: diff(summary["Best Share"]),
    fanPct: fan === 0 ? undefined : fanIsRpm ? undefined : Math.round(fan),
    fanRpm: fanIsRpm ? Math.round(fan) : undefined,
    pool: url || undefined,
    pools: url ? [url] : [],
    onFallback,
    worker: worker && worker !== "0" ? worker : undefined,
    firmware: typeof body.VERSION === "object" && body.VERSION ? String((body.VERSION as Record<string, unknown>).CGMiner ?? "") : undefined,
  };
}

function poolLine(url: unknown, port: unknown): string {
  const host = typeof url === "string" ? url.trim() : "";
  if (!host) return "";
  return num(port) ? `${host}:${num(port)}` : host;
}

export function linesFromLog(payload: string): string[] {
  const trimmed = payload.trim();
  if (!trimmed) return [];
  let text = trimmed;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        text = parsed.map((row) => (typeof row === "string" ? row : JSON.stringify(row))).join("\n");
      } else if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        const blob = record.log ?? record.logs ?? record.LOG ?? record.text;
        if (typeof blob === "string") text = blob;
        else if (Array.isArray(blob)) {
          text = blob
            .map((row) => {
              if (typeof row === "string") return row;
              if (row && typeof row === "object" && "Msg" in row) return String((row as { Msg: unknown }).Msg);
              return "";
            })
            .filter(Boolean)
            .join("\n");
        }
      }
    } catch {
      text = trimmed;
    }
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^STATUS=/i.test(line))
    .slice(-80);
}

export function parseLooseStats(id: string, payload: unknown): LiveRead {
  if (typeof payload === "string") {
    const trimmed = payload.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        payload = JSON.parse(trimmed) as unknown;
      } catch {
        payload = textStats(trimmed);
      }
    } else {
      payload = textStats(trimmed);
    }
  }
  const root = asRecord(payload);
  const summary = asRecord(
    (Array.isArray(root.SUMMARY) ? root.SUMMARY[0] : null) ??
      root.summary ??
      root.miner ??
      root.STATS ??
      root,
  );
  const wrapped = parseCgminer(id, {
    SUMMARY: [summary],
    DEVS: Array.isArray(root.DEVS) ? root.DEVS : [],
    POOLS: Array.isArray(root.POOLS) ? root.POOLS : Array.isArray(summary.pools) ? summary.pools : [],
    VERSION: root.VERSION,
  });
  if (!wrapped.hashrateGhs) {
    const ghs = num(
      summary["GHS 5s"] ??
        summary["GHS av"] ??
        summary.ghs ??
        summary.hashrate ??
        summary.hr_realtime ??
        summary.instant_hashrate ??
        summary.average_hashrate,
    );
    const ths = num(summary["THS av"] ?? summary.ths ?? summary.hashrate_th);
    wrapped.hashrateGhs = ths > 0 ? ths * 1000 : ghs;
  }
  if (wrapped.tempC == null) {
    const chip = asRecord(summary.chip_temp);
    const temp = num(summary.temp ?? summary.temperature ?? chip.max ?? summary.pcb_max);
    if (temp > 0) wrapped.tempC = temp;
  }
  if (wrapped.powerW == null) {
    const power = num(summary.power ?? summary.power_consumption ?? summary.watt);
    if (power > 0) wrapped.powerW = power;
  }
  return wrapped;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function textStats(text: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const part of text.split(/[,\n;]/)) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

export function parseEsp(id: string, info: Record<string, unknown>): LiveRead {
  const primary = poolLine(info.stratumURL, info.stratumPort);
  const fallback = poolLine(info.fallbackStratumURL, info.fallbackStratumPort);
  const onFallback = info.isUsingFallbackStratum === 1 || info.isUsingFallbackStratum === true;
  const pool = (onFallback && fallback) || primary || "";
  return {
    id,
    ok: true,
    hashrateGhs: pickHashrateGhs(info),
    tempC: num(info.temp) || undefined,
    vrTempC: num(info.vrTemp) || undefined,
    powerW: num(info.power) || undefined,
    accepted: num(info.sharesAccepted),
    rejected: num(info.sharesRejected),
    uptimeSec: num(info.uptimeSeconds),
    pingMs: Math.round(num(info.responseTime)) || undefined,
    fanPct: info.fanspeed == null ? undefined : Math.round(num(info.fanspeed)),
    fanRpm: Math.round(num(info.fanrpm)) || undefined,
    fanAuto: info.autofanspeed === 1 || info.autofanspeed === true,
    frequencyMhz: num(info.frequency) || undefined,
    coreVoltageMv: num(info.coreVoltage) || undefined,
    asicVoltageMv: num(info.coreVoltageActual) || undefined,
    asicCount: num(info.asicCount) || undefined,
    bestDiffN: diff(info.bestDiff),
    bestSessionN: diff(info.bestSessionDiff),
    pool: pool || undefined,
    pools: pool ? [pool] : [],
    onFallback,
    worker: info.stratumUser ? String(info.stratumUser) : undefined,
    firmware: info.version ? String(info.version) : undefined,
  };
}

function tidyPool(url: string, port: number): string {
  const bare = url.replace(/^[a-z0-9+]+:\/\//i, "").replace(/\/$/, "").trim();
  if (!bare) return "";
  if (port > 0 && !bare.includes(":")) return `${bare}:${port}`;
  return bare;
}

export function parseTna(id: string, info: Record<string, unknown>): LiveRead {
  const stratum = info.stratum && typeof info.stratum === "object" ? (info.stratum as Record<string, unknown>) : {};
  const listed = Array.isArray(stratum.pools) ? (stratum.pools as Record<string, unknown>[]) : [];
  const aliveIndex = listed.findIndex((pool) => pool.connected === true || String(pool.status ?? "").toLowerCase() === "alive");
  const current = listed[aliveIndex] ?? listed[0];
  const usingFallback = info.usingFallback === true || stratum.usingFallback === true || info.isUsingFallbackStratum === true || info.isUsingFallbackStratum === 1;
  const fallback = tidyPool(String(info.fallbackStratumURL ?? ""), num(info.fallbackStratumPort));
  const fromPool = current ? tidyPool(String(current.url ?? current.host ?? ""), num(current.port)) : "";
  const primary = tidyPool(String(info.stratumURL ?? ""), num(info.stratumPort));
  const pool = (usingFallback && fallback) || fromPool || primary;
  const onFallback = usingFallback || (num(stratum.poolMode) === 0 && aliveIndex > 0);
  const fanList = Array.isArray(info.fanRpms) ? info.fanRpms : Array.isArray(info.fanRpm) ? info.fanRpm : [];
  const fanRpm = fanList.map((n) => num(n)).find((n) => n > 0) || num(info.fanRpm) || undefined;
  const board = Array.isArray(info.boards) ? asRecord(info.boards[0]) : {};
  const boardRate = num(board.hashrate);
  const model = info.deviceModel || info.minerModel;
  const version = info.version ? String(info.version) : "";
  const firmware = [model ? String(model) : "", version].filter(Boolean).join(" ");
  const worker = current && current.user ? String(current.user) : info.stratumUser ? String(info.stratumUser) : "";
  return {
    id,
    ok: true,
    hashrateGhs: pickHashrateGhs(info) || boardRate || undefined,
    tempC: num(info.temp) || undefined,
    vrTempC: num(info.vrTemp) || undefined,
    powerW: num(info.power) || undefined,
    accepted: num(info.sharesAccepted),
    rejected: num(info.sharesRejected),
    uptimeSec: num(info.uptimeSeconds),
    bestDiffN: diff(info.bestDiff),
    bestSessionN: diff(info.bestSessionDiff ?? info.bestDiff),
    fanPct: info.fanspeed == null ? undefined : Math.round(num(info.fanspeed)),
    fanRpm: fanRpm ? Math.round(fanRpm) : undefined,
    fanAuto: info.autofanspeed === 1 || info.autofanspeed === true,
    frequencyMhz: num(info.targetFrequency) || num(info.frequency) || undefined,
    coreVoltageMv: num(info.coreVoltage) || undefined,
    asicVoltageMv: num(info.coreVoltageActual) || num(board.voltageActual) || undefined,
    asicCount: num(info.asicCount) || undefined,
    pool: pool || undefined,
    pools: pool ? [pool] : [],
    onFallback,
    worker: worker || undefined,
    firmware: firmware || undefined,
  };
}

/** Satboy reports GH/s as an integer. A reading above 100,000 is MH/s. */
function satboyGhs(v: unknown): number | undefined {
  const n = num(v);
  if (!(n > 0)) return n === 0 ? 0 : undefined;
  return n >= 100_000 ? n / 1000 : n;
}

export function parseGreenbit(id: string, info: Record<string, unknown>): LiveRead {
  const poolHost = tidyPool(String(info.poolURL ?? ""), num(info.poolPort));
  const version = info.version ? String(info.version) : "";
  const name = info.name ? String(info.name) : "";
  return {
    id,
    ok: true,
    hashrateGhs: satboyGhs(info.hashrateCurrent),
    tempC: num(info.temperature) || undefined,
    accepted: num(info.sharesAccepted),
    bestDiffN: diff(info.bestdiff),
    fanPct: 0,
    fanRpm: undefined,
    frequencyMhz: undefined,
    asicCount: 1,
    pool: poolHost || undefined,
    pools: poolHost ? [poolHost] : [],
    worker: info.poolWallet ? String(info.poolWallet) : undefined,
    firmware: [name, version].filter(Boolean).join(" ") || "GreenBit Satboy",
    powerW: num(info.power) || undefined,
  };
}

export function hammerBoardName(model: string): string {
  const m = model.trim();
  if (/thor\s*x1|^x1$/i.test(m)) return "Thor X1";
  if (/dc0?2/i.test(m)) return "DC02";
  if (/bc0?4/i.test(m)) return "BC04";
  if (/bc0?1/i.test(m)) return "BC01";
  return m || "Hammer";
}

function thorData(payload: unknown): Record<string, unknown> {
  const root = asRecord(payload);
  return asRecord(root.data ?? root);
}

function thorGhs(raw: number): number {
  if (!(raw > 0)) return 0;
  if (raw >= 1e6) return raw / 1e9;
  if (raw < 50) return raw * 1000;
  return raw;
}

function thorCoreMv(actualVolts: number, coded: number): number {
  if (actualVolts > 0.4 && actualVolts < 20) return Math.round(actualVolts * 1000);
  if (coded >= 80 && coded <= 250) return coded * 10;
  if (coded > 250 && coded < 20000) return Math.round(coded);
  return 0;
}

export function parseThorV2(id: string, infoRaw: unknown, statusRaw: unknown, deviceRaw: unknown): LiveRead {
  const info = thorData(infoRaw);
  const status = thorData(statusRaw);
  const device = thorData(deviceRaw);
  const model = hammerBoardName(String(info.device_model ?? info.model ?? ""));
  const version = info.firmware_version ? String(info.firmware_version) : "";
  const primary = tidyPool(String(status.pool_url ?? ""), num(status.pool_port));
  const backup = tidyPool(String(status.fallback_pool_url ?? ""), num(status.fallback_pool_port));
  const onFallback = status.isUsingFallbackStratum === true;
  const pool = onFallback && backup ? backup : primary;
  const pools = [primary, backup].filter((row, index, all) => row && all.indexOf(row) === index);
  const board = Math.max(num(status.temp_board), num(status.temp_board_1));
  const rpm = Math.max(num(status.fan_speed_rpm), num(status.fan_speed_rpm_1));
  const chips = num(info.detected_chips_count) || num(status.domains_count) * num(status.chips_per_domain);
  const coreMv = thorCoreMv(num(status.core_voltage_actual), num(status.coreVoltage) || num(status.core_voltage));
  const wifi = asRecord(device.wifi);
  const rssi = num(device.wifi_rssi) || num(wifi.rssi);
  return {
    id,
    ok: true,
    hashrateGhs: thorGhs(num(status.current_hashrate)),
    tempC: board || undefined,
    vrTempC: num(status.temp_vcore) || undefined,
    powerW: num(status.power_consumption) || undefined,
    accepted: num(status.shares_accepted),
    rejected: num(status.shares_rejected),
    uptimeSec: num(device.uptime_seconds) || undefined,
    bestDiffN: diff(status.bestDiff),
    bestSessionN: diff(status.bestSessionDiff),
    fanPct: status.fan_target_speed == null ? undefined : Math.round(num(status.fan_target_speed)),
    fanRpm: Math.round(rpm) || undefined,
    fanAuto: status.fan_mode == null ? undefined : num(status.fan_mode) === 0,
    frequencyMhz: num(status.frequency) || undefined,
    coreVoltageMv: coreMv || undefined,
    asicVoltageMv: coreMv || undefined,
    asicCount: chips || undefined,
    pool: pool || undefined,
    pools,
    onFallback,
    wifiRssi: rssi < 0 ? Math.round(rssi) : undefined,
    overheat: status.overheat_mode === true || status.overheat_mode === 1 || status.overheat_mode === "1",
    worker: status.pool_worker ? String(status.pool_worker) : undefined,
    firmware: [model, version].filter(Boolean).join(" ") || "THOR",
  };
}

export function parseHammer(id: string, summaryRaw: unknown, poolsRaw: unknown): LiveRead {
  const summary = asRecord(summaryRaw);
  const listed = Array.isArray(asRecord(poolsRaw).pools) ? (asRecord(poolsRaw).pools as Record<string, unknown>[]) : [];
  const active =
    listed.find((pool) => pool.active === true) ??
    listed.find((pool) => String(pool.status ?? "").toLowerCase() === "active") ??
    listed[0];
  const pool = active ? tidyPool(String(active.url ?? ""), num(active.port)) : "";
  const volts = num(summary.voltage);
  const firmware = [summary.miner_type, summary.firmware].filter(Boolean).map(String).join(" ");
  const worker = active && active.user ? String(active.user) : summary.worker ? String(summary.worker) : "";
  return {
    id,
    ok: true,
    hashrateGhs: num(summary.hashrate),
    tempC: num(summary.temp_max) || num(summary.temp_avg) || undefined,
    powerW: num(summary.power_w) || undefined,
    accepted: num(summary.accepted_shares),
    rejected: num(summary.rejected_shares),
    uptimeSec: num(summary.uptime),
    bestDiffN: diff(summary.best_share),
    fanPct: summary.fan_pwm == null ? undefined : Math.round(num(summary.fan_pwm)),
    fanRpm: Math.round(num(summary.fan_rpm)) || undefined,
    frequencyMhz: num(summary.frequency) || undefined,
    coreVoltageMv: volts > 0 ? Math.round(volts * 1000) : undefined,
    asicCount: num(summary.asic_count) || undefined,
    pool: pool || undefined,
    pools: pool ? [pool] : [],
    onFallback: Boolean(active && num(active.priority) > 0),
    worker: worker || undefined,
    firmware: firmware || "THOR",
  };
}

function pickNum(record: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = num(record[key]);
    if (value > 0) return value;
  }
  return 0;
}

function harloGhs(telemetry: Record<string, unknown>, info: Record<string, unknown>): number {
  const unit = String(telemetry.hashrateUnit ?? telemetry.hashUnit ?? telemetry.unit ?? info.hashUnit ?? "").toLowerCase();
  const th = pickNum(telemetry, ["hashrateTh", "hashrate_th", "ths", "hashRateTH", "terahash"]);
  if (th) return th * 1000;
  const gh = pickNum(telemetry, ["hashrateGh", "hashrate_gh", "ghs", "hashRateGH", "hashrate_1m", "hashrate_5s"]);
  if (gh) return gh;
  const raw = pickNum(telemetry, ["hashrate", "hashRate", "hashrate_avg", "current_hashrate"]);
  if (!raw) return 0;
  if (raw > 1e9) return raw / 1e9;
  if (unit.includes("th")) return raw * 1000;
  if (unit.includes("mh")) return raw / 1000;
  if (unit.includes("gh") || unit.includes("h/s")) return unit.includes("h/s") && !unit.includes("gh") ? raw / 1e9 : raw;
  const algo = String(info.algo ?? info.algorithm ?? telemetry.algo ?? "").toLowerCase();
  if (/scrypt|kheavy|randomx/.test(algo)) return raw;
  return raw < 80 ? raw * 1000 : raw;
}

function harloPoolRows(payload: unknown): { slot: string; row: Record<string, unknown> }[] {
  if (Array.isArray(payload)) {
    return payload.map((row, index) => ({ slot: String(asRecord(row).id ?? asRecord(row).slot ?? index + 1), row: asRecord(row) }));
  }
  const root = asRecord(payload);
  const listed = Array.isArray(root.pools) ? root.pools : Array.isArray(root.data) ? root.data : null;
  if (listed) return harloPoolRows(listed);
  const out: { slot: string; row: Record<string, unknown> }[] = [];
  for (const [key, value] of Object.entries(root)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    if (!/pool|backup/i.test(key)) continue;
    const row = asRecord(value);
    out.push({ slot: String(row.id ?? row.slot ?? (key.replace(/\D/g, "") || key)), row });
  }
  return out;
}

export function parseHarlo(id: string, telemetryRaw: unknown, poolsRaw: unknown, infoRaw: unknown): LiveRead {
  const telemetry = asRecord(asRecord(telemetryRaw).data ?? telemetryRaw);
  const info = asRecord(asRecord(infoRaw).data ?? infoRaw);
  const listed = harloPoolRows(poolsRaw);
  const active = (row: Record<string, unknown>) =>
    row.active === true || row.connected === true || row.mining === true || /alive|active|mining/i.test(String(row.status ?? ""));
  const current = listed.find((entry) => active(entry.row)) ?? listed[0];
  const url = current ? tidyPool(String(current.row.url ?? current.row.host ?? current.row.stratumURL ?? ""), num(current.row.port ?? current.row.stratumPort)) : "";
  const primary = listed[0];
  const onFallback = Boolean(
    current &&
      (/backup|fallback/i.test(`${current.slot} ${current.row.role ?? ""}`) ||
        num(current.row.priority) > 0 ||
        (primary && primary !== current && !active(primary.row))),
  );
  const fan = pickNum(telemetry, ["fanPct", "fan_pwm", "fan", "fanSpeed", "fanspeed"]);
  const fanRpm = pickNum(telemetry, ["fanRpm", "fan_rpm", "rpm"]);
  const volts = pickNum(telemetry, ["core_mv", "coreVoltage", "voltage", "core_voltage"]);
  const firmware = [info.firmware, info.version, info.model].filter(Boolean).map(String).join(" ") || "Harlo OS";
  const worker = current?.row.user ?? current?.row.worker ?? telemetry.worker ?? info.worker;
  return {
    id,
    ok: true,
    hashrateGhs: harloGhs(telemetry, info),
    tempC: pickNum(telemetry, ["temp", "temperature", "tempC", "temp_max", "asicTemp", "chipTemp"]) || undefined,
    vrTempC: pickNum(telemetry, ["vrTemp", "vregTemp", "temp_vcore"]) || undefined,
    powerW: pickNum(telemetry, ["power", "powerW", "power_w", "watts", "wallPower"]) || undefined,
    accepted: pickNum(telemetry, ["accepted", "sharesAccepted", "accepted_shares"]),
    rejected: pickNum(telemetry, ["rejected", "sharesRejected", "rejected_shares"]),
    uptimeSec: pickNum(telemetry, ["uptime", "uptimeSeconds", "uptime_seconds"]),
    bestDiffN: diff(telemetry.bestDiff ?? telemetry.best_share),
    fanPct: fan > 0 && fan <= 100 ? Math.round(fan) : undefined,
    fanRpm: fanRpm || (fan > 100 ? Math.round(fan) : undefined),
    frequencyMhz: pickNum(telemetry, ["frequency_mhz", "frequency", "freq", "frequencyMhz"]) || undefined,
    coreVoltageMv: volts > 0 ? (volts < 20 ? Math.round(volts * 1000) : Math.round(volts)) : undefined,
    pool: url || undefined,
    pools: url ? [url] : [],
    onFallback,
    worker: worker ? String(worker) : undefined,
    firmware,
  };
}
