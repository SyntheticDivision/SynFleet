import { createServerFn } from "@tanstack/react-start";
import { isTnaOsText, type FoundMiner } from "@/lib/discover";
import {
  isLinkKind,
  parseCgminer,
  parseEsp,
  parseGreenbit,
  parseHammer,
  parseHarlo,
  parseThorV2,
  parseTna,
  pickHashrateGhs,
  parseLooseStats,
  safeHost,
  safePort,
  type LinkKind,
  type LiveRead,
  type MinerCommand,
  type MinerTarget,
} from "@/lib/miner-link";

const TIMEOUT_MS = 5000;
const GB_LISTEN = 30110;
const GB_REPLY = 30109;

type GbSocket = {
  send: (msg: string, port: number, host: string, cb?: (err: Error | null) => void) => void;
  on: (ev: string, cb: (buf: Buffer, rinfo: { address: string }) => void) => void;
  once: (ev: string, cb: (err: Error) => void) => void;
  bind: (port: number, cb?: () => void) => void;
  setBroadcast: (on: boolean) => void;
};

const gbWaiters = new Map<string, (json: Record<string, unknown>) => void>();
let gbOpening: Promise<GbSocket> | null = null;

function gbSocket(): Promise<GbSocket> {
  if (gbOpening) return gbOpening;
  gbOpening = import("node:dgram").then(
    ({ createSocket }) =>
      new Promise<GbSocket>((resolve, reject) => {
        const sock = createSocket({ type: "udp4", reuseAddr: true }) as GbSocket;
        const timer = setTimeout(() => reject(new Error("satboy bind")), 2000);
        sock.once("error", () => {
          clearTimeout(timer);
          gbOpening = null;
          reject(new Error("satboy bind"));
        });
        sock.on("message", (buf, rinfo) => {
          const text = buf.toString("utf8").replace(/\0/g, "").trim();
          if (!text.startsWith("{")) return;
          let json: Record<string, unknown>;
          try {
            json = JSON.parse(text) as Record<string, unknown>;
          } catch {
            return;
          }
          const ip = typeof json.ipaddress === "string" ? json.ipaddress : rinfo.address;
          const deliver = gbWaiters.get(ip) || gbWaiters.get(rinfo.address);
          if (!deliver) return;
          gbWaiters.delete(ip);
          gbWaiters.delete(rinfo.address);
          deliver(json);
        });
        sock.bind(GB_REPLY, () => {
          clearTimeout(timer);
          try {
            sock.setBroadcast(true);
          } catch {
            // broadcast is only needed for a subnet-wide refresh
          }
          resolve(sock);
        });
      }),
  );
  return gbOpening;
}

function gbAsk(host: string, ms: number): Promise<Record<string, unknown> | null> {
  return gbSocket()
    .then(
      (sock) =>
        new Promise<Record<string, unknown> | null>((resolve) => {
          const timer = setTimeout(() => {
            gbWaiters.delete(host);
            resolve(null);
          }, ms);
          gbWaiters.set(host, (json) => {
            clearTimeout(timer);
            resolve(json);
          });
          sock.send("gbrefresh", GB_LISTEN, host, (err) => {
            if (!err) return;
            clearTimeout(timer);
            gbWaiters.delete(host);
            resolve(null);
          });
        }),
    )
    .catch(() => null);
}

function gbSend(host: string, message: string): Promise<boolean> {
  return gbSocket()
    .then(
      (sock) =>
        new Promise<boolean>((resolve) => {
          sock.send(message, GB_LISTEN, host, (err) => resolve(!err));
        }),
    )
    .catch(() => false);
}

export async function probeGreenbit(host: string): Promise<FoundMiner | null> {
  const info = await gbAsk(host, 700);
  if (!info || (info.hashrateCurrent == null && typeof info.name !== "string")) return null;
  const rawName = typeof info.name === "string" && info.name.trim() ? info.name.trim() : "Satboy";
  const version = typeof info.version === "string" ? info.version : "";
  return {
    host,
    port: GB_LISTEN,
    kind: "greenbit",
    name: rawName.replace(/\s+/g, "-").slice(0, 24),
    firmware: version ? `Satboy ${version}` : "GreenBit Satboy",
  };
}

async function setGreenbitPool(deviceHost: string, host: string, port: number, user: string) {
  const poolHost = safeHost(host);
  const poolPort = safePort(port);
  if (!poolHost || !poolPort || !user.trim()) return { ok: false, error: "bad pool" };
  const info = await gbAsk(deviceHost, 1500);
  const name = info && typeof info.name === "string" ? info.name : "";
  if (!name) return { ok: false, error: "satboy did not answer" };
  const poolID = typeof info?.poolID === "number" && info.poolID > 0 ? info.poolID : 1;
  const sent = await gbSend(
    deviceHost,
    JSON.stringify({
      name,
      primaryPool: {
        poolID,
        poolDomain: poolHost,
        poolPort,
        wallet: user.trim().slice(0, 120),
        poolPassword: "x",
      },
    }),
  );
  if (!sent) return { ok: false, error: "no answer" };
  return { ok: true };
}

function targets(data: { miners?: MinerTarget[] }): MinerTarget[] {
  const list = Array.isArray(data?.miners) ? data.miners : [];
  return list.slice(0, 64).flatMap((m) => {
    const host = safeHost(String(m.host ?? ""));
    const port = safePort(Number(m.port));
    if (!host || !port || !isLinkKind(String(m.kind)) || !m.id) return [];
    const token = typeof m.token === "string" ? m.token.trim().slice(0, 200) : "";
    return [{ id: String(m.id), host, port, kind: m.kind as LinkKind, ...(token ? { token } : {}) }];
  });
}

function cgminerCall(host: string, port: number, command: string, parameter?: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    void import("node:net").then(({ connect }) => {
      const socket = connect({ host, port });
      let buf = "";
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.destroy();
        reject(new Error("timeout"));
      }, TIMEOUT_MS);
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        const clean = buf.replace(/\0/g, "").trim();
        try {
          resolve(JSON.parse(clean) as Record<string, unknown>);
        } catch {
          reject(new Error("bad reply"));
        }
      };
      socket.setTimeout(TIMEOUT_MS);
      socket.on("timeout", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        reject(new Error("timeout"));
      });
      socket.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
      socket.on("end", finish);
      socket.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        if (buf.includes("\0")) finish();
      });
      socket.on("connect", () => {
        const body = parameter ? { command, parameter } : { command };
        socket.write(`${JSON.stringify(body)}\0`);
      });
    }).catch(reject);
  });
}

async function espInfo(host: string, port: number): Promise<Record<string, unknown>> {
  const res = await fetch(`http://${host}:${port}/api/system/info`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as Record<string, unknown>;
}

async function httpText(url: string, init?: RequestInit, timeoutMs = TIMEOUT_MS): Promise<string> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(String(res.status));
  return res.text();
}

const thorDialect = new Map<string, "v2" | "v1">();

function hammerKey(target: MinerTarget): string {
  return `${target.host}:${target.port}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function looksThorV2(body: unknown): boolean {
  const root = asRecord(body);
  const data = asRecord(root.data ?? root);
  return Boolean(
    data.device_model ||
      data.firmware_version ||
      data.current_hashrate ||
      data.core_frequency ||
      data.pool_url ||
      (root.ok === true && root.data),
  );
}

async function hammerFetch(
  target: MinerTarget,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const token = target.token?.trim() ?? "";
  const res = await fetch(`http://${target.host}:${target.port}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body };
}

async function hammerUsesV2(target: MinerTarget): Promise<boolean> {
  const key = hammerKey(target);
  const known = thorDialect.get(key);
  if (known) return known === "v2";
  try {
    const info = await hammerFetch(target, "/v2/device/info");
    const v2 = info.status === 200 && looksThorV2(info.body);
    thorDialect.set(key, v2 ? "v2" : "v1");
    return v2;
  } catch {
    return false;
  }
}

function thorCoreCode(mv: number): number {
  const clamped = Math.min(1600, Math.max(800, Math.round(mv)));
  return Math.round(clamped / 10);
}

async function thorPut(target: MinerTarget, patch: Record<string, unknown>): Promise<void> {
  const current = await hammerFetch(target, "/v2/miner/config");
  if (current.status === 401) throw new Error("API token rejected");
  if (current.status >= 400) throw new Error(String(current.status));
  const root = asRecord(current.body);
  const data = asRecord(root.data ?? root);
  const res = await hammerFetch(target, "/v2/miner/config", {
    method: "PUT",
    body: JSON.stringify({ ...data, ...patch }),
  });
  if (res.status === 401) throw new Error("API token rejected");
  if (res.status >= 400) throw new Error(String(res.status));
  const reply = asRecord(res.body);
  if (reply.ok === false) throw new Error(String(reply.message || "miner refused the change"));
}

async function hammerJson(target: MinerTarget, path: string, init?: RequestInit): Promise<unknown> {
  const token = target.token?.trim() ?? "";
  if (!token) throw new Error("API token required");
  const res = await fetch(`http://${target.host}:${target.port}${path}`, {
    ...init,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401) throw new Error("API token rejected");
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

async function harloSend(target: MinerTarget, path: string, method: string, body?: unknown): Promise<void> {
  const res = await fetch(`http://${target.host}:${target.port}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 120);
    throw new Error(detail || String(res.status));
  }
}

async function readHarlo(target: MinerTarget, started: number): Promise<LiveRead> {
  const get = async (path: string) => {
    const res = await fetch(`http://${target.host}:${target.port}${path}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(String(res.status));
    return res.json() as Promise<unknown>;
  };
  const [telemetry, poolsBody, info] = await Promise.all([
    get("/api/telemetry"),
    get("/api/pools").catch(() => null),
    get("/api/info").catch(() => null),
  ]);
  const read = parseHarlo(target.id, telemetry, poolsBody, info);
  read.pingMs = Date.now() - started;
  return read;
}

async function harloCommand(target: MinerTarget, command: MinerCommand): Promise<{ ok: boolean; error?: string }> {
  if (command.action === "restart") {
    await harloSend(target, "/api/reboot", "POST");
    return { ok: true };
  }
  if (command.action === "fan") {
    await harloSend(target, "/api/fans/1", "PUT", {
      speed: command.fanPct,
      percent: command.fanPct,
      auto: command.fanAuto,
      mode: command.fanAuto ? "auto" : "manual",
    });
    return { ok: true };
  }
  if (command.action === "frequency" || command.action === "voltage") {
    const frequency_mhz = "frequencyMhz" in command ? command.frequencyMhz : undefined;
    const core_mv = "coreVoltageMv" in command ? command.coreVoltageMv : undefined;
    if (!frequency_mhz || !core_mv) return { ok: false, error: "need frequency and voltage" };
    await harloSend(target, "/api/tuning", "PUT", {
      frequency_mhz: Math.round(frequency_mhz),
      core_mv: Math.round(core_mv),
    });
    return { ok: true };
  }
  const poolHost = safeHost(command.host);
  const poolPort = safePort(command.port);
  if (!poolHost || !poolPort || !command.user.trim()) return { ok: false, error: "bad pool" };
  await harloSend(target, "/api/pools/1", "PUT", {
    url: `stratum+tcp://${poolHost}:${poolPort}`,
    host: poolHost,
    port: poolPort,
    user: command.user.trim().slice(0, 120),
    password: "x",
  });
  return { ok: true };
}

async function thorCommand(target: MinerTarget, command: MinerCommand): Promise<{ ok: boolean; error?: string }> {
  if (command.action === "restart") {
    const res = await hammerFetch(target, "/v2/device/reboot", { method: "POST" });
    if (res.status === 401) return { ok: false, error: "API token rejected" };
    if (res.status >= 400) return { ok: false, error: String(res.status) };
    return { ok: true };
  }
  if (command.action === "fan") {
    await thorPut(
      target,
      command.fanAuto ? { fan_mode: 0 } : { fan_mode: 1, fan_target_speed: Math.round(command.fanPct) },
    );
    return { ok: true };
  }
  if (command.action === "frequency") {
    await thorPut(target, { core_frequency: Math.round(command.frequencyMhz) });
    return { ok: true };
  }
  if (command.action === "voltage") {
    await thorPut(target, { core_voltage: thorCoreCode(command.coreVoltageMv) });
    return { ok: true };
  }
  const poolHost = safeHost(command.host);
  const poolPort = safePort(command.port);
  if (!poolHost || !poolPort || !command.user.trim()) return { ok: false, error: "bad pool" };
  await thorPut(target, {
    pool_url: poolHost,
    pool_port: poolPort,
    worker_name: command.user.trim().slice(0, 120),
    worker_password: "x",
  });
  return { ok: true };
}

async function readHammer(target: MinerTarget, started: number): Promise<LiveRead> {
  if (thorDialect.get(hammerKey(target)) !== "v1") {
    try {
      const info = await hammerFetch(target, "/v2/device/info");
      if (info.status === 200 && looksThorV2(info.body)) {
        thorDialect.set(hammerKey(target), "v2");
        const [status, device] = await Promise.all([
          hammerFetch(target, "/v2/miner/status"),
          hammerFetch(target, "/v2/device/status"),
        ]);
        if (status.status === 401) throw new Error("API token rejected");
        if (status.status >= 400) throw new Error(String(status.status));
        const read = parseThorV2(target.id, info.body, status.body, device.status < 400 ? device.body : null);
        read.pingMs = Date.now() - started;
        return read;
      }
      if (info.status !== 404) thorDialect.set(hammerKey(target), "v1");
    } catch (err) {
      if (thorDialect.get(hammerKey(target)) === "v2") throw err;
    }
  }
  const [summary, poolsBody] = await Promise.all([
    hammerJson(target, "/api/v1/miner/summary"),
    hammerJson(target, "/api/v1/miner/pools").catch(() => null),
  ]);
  thorDialect.set(hammerKey(target), "v1");
  const read = parseHammer(target.id, summary, poolsBody);
  read.pingMs = Date.now() - started;
  return read;
}

async function hammerCommand(target: MinerTarget, command: MinerCommand): Promise<{ ok: boolean; error?: string }> {
  if (await hammerUsesV2(target)) return thorCommand(target, command);
  if (command.action === "restart") {
    await hammerJson(target, "/api/v1/miner/command", { method: "POST", body: JSON.stringify({ command: "restart" }) });
    return { ok: true };
  }
  if (command.action === "fan") {
    await hammerJson(target, "/api/v1/cooling/mode", {
      method: "POST",
      body: JSON.stringify(command.fanAuto ? { mode: "auto" } : { mode: "manual", pwm: command.fanPct }),
    });
    return { ok: true };
  }
  if (command.action === "frequency") {
    await hammerJson(target, "/api/v1/tuning/frequency", {
      method: "POST",
      body: JSON.stringify({ frequency: command.frequencyMhz }),
    });
    return { ok: true };
  }
  if (command.action === "voltage") {
    const volts = command.coreVoltageMv > 100 ? command.coreVoltageMv / 1000 : command.coreVoltageMv;
    await hammerJson(target, "/api/v1/tuning/voltage", {
      method: "POST",
      body: JSON.stringify({ voltage: Math.round(volts * 10) / 10 }),
    });
    return { ok: true };
  }
  const poolHost = safeHost(command.host);
  const poolPort = safePort(command.port);
  if (!poolHost || !poolPort || !command.user.trim()) return { ok: false, error: "bad pool" };
  const url = `stratum+tcp://${poolHost}:${poolPort}`;
  const listed = asPools(await hammerJson(target, "/api/v1/miner/pools").catch(() => null));
  const current = listed.find((pool) => pool.active === true) ?? listed[0];
  if (current && current.id != null) {
    await hammerJson(target, `/api/v1/pools/${current.id}`, {
      method: "PATCH",
      body: JSON.stringify({ url, user: command.user.trim().slice(0, 120) }),
    });
    return { ok: true };
  }
  await hammerJson(target, "/api/v1/pools", {
    method: "POST",
    body: JSON.stringify({
      pools: [{ url, user: command.user.trim().slice(0, 120), pass: "x", priority: 0 }],
    }),
  });
  return { ok: true };
}

function asPools(payload: unknown): Record<string, unknown>[] {
  const rows = payload && typeof payload === "object" && "pools" in payload ? (payload as { pools?: unknown }).pools : [];
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

const noDashboard = new Set<string>();

async function v2Performance(host: string, port: number): Promise<Record<string, unknown> | null> {
  const key = `${host}:${port}`;
  if (noDashboard.has(key)) return null;
  try {
    const res = await fetch(`http://${host}:${port}/api/v2/dashboard`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 404 || res.status === 400) {
      noDashboard.add(key);
      return null;
    }
    if (!res.ok) return null;
    const body = (await res.json()) as Record<string, unknown>;
    const perf = body.performance;
    if (perf && typeof perf === "object" && !Array.isArray(perf)) return perf as Record<string, unknown>;
    return body;
  } catch {
    return null;
  }
}

function overlayHashrate(info: Record<string, unknown>, perf: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = { ...info };
  for (const [key, value] of Object.entries(perf)) {
    if (value == null || value === "") continue;
    if (key === "chips" || key === "history" || /hashrate|hashRate/i.test(key)) next[key] = value;
  }
  return next;
}

async function readEspLike(target: MinerTarget, started: number): Promise<LiveRead> {
  let info: Record<string, unknown> | null = null;
  try {
    info = await espInfo(target.host, target.port);
  } catch {
    info = null;
  }
  if (!info || !((pickHashrateGhs(info) ?? 0) > 0)) {
    const perf = await v2Performance(target.host, target.port);
    if (perf) info = info ? overlayHashrate(info, perf) : perf;
  }
  if (!info) throw new Error("no answer");
  const read = target.kind === "tna-canaan" ? parseTna(target.id, info) : parseEsp(target.id, info);
  if (!read.pingMs) read.pingMs = Date.now() - started;
  return read;
}

async function tnaSnapshot(host: string): Promise<Record<string, unknown> | null> {
  try {
    const asic = await fetch(`http://${host}/api/system/asic`, { signal: AbortSignal.timeout(1200) });
    const asicText = asic.ok ? await asic.text() : "";
    const infoRes = await fetch(`http://${host}/api/system/info`, { signal: AbortSignal.timeout(2000) });
    if (!infoRes.ok) return null;
    const infoText = await infoRes.text();
    if (!isTnaOsText(asicText) && !isTnaOsText(infoText)) return null;
    return JSON.parse(infoText) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readHttp(target: MinerTarget): Promise<LiveRead> {
  const started = Date.now();
  if (target.kind === "greenbit") {
    const info = await gbAsk(target.host, 1500);
    if (!info) return { id: target.id, ok: false, error: "no answer" };
    const read = parseGreenbit(target.id, info);
    read.pingMs = Date.now() - started;
    return read;
  }
  if (target.kind === "cgminer" || target.kind === "avalon") {
    const info = await tnaSnapshot(target.host);
    if (info) {
      const read = parseTna(target.id, info);
      read.pingMs = Date.now() - started;
      read.kind = "tna-canaan";
      read.port = 80;
      return read;
    }
  }
  if (target.kind === "esp-miner" || target.kind === "tna-canaan") {
    return readEspLike(target, started);
  }
  if (target.kind === "hammer") {
    return readHammer(target, started);
  }
  if (target.kind === "harlo") {
    return readHarlo(target, started);
  }
  const body = await cgminerCall(target.host, target.port, "summary+devs+pools");
  const read = parseCgminer(target.id, body);
  read.pingMs = Date.now() - started;
  return read;
}

async function readOne(target: MinerTarget): Promise<LiveRead> {
  try {
    return await readHttp(target);
  } catch (err) {
    const message = err instanceof Error ? err.message : "no answer";
    const friendly = /ECONNREFUSED/i.test(message) ? "connection refused" : /timeout|timed out/i.test(message) ? "timeout" : message;
    return { id: target.id, ok: false, error: friendly.slice(0, 80) };
  }
}

async function pool<T>(items: T[], limit: number, job: (item: T) => Promise<LiveRead>): Promise<LiveRead[]> {
  const out: LiveRead[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await job(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

async function setEspPool(deviceHost: string, devicePort: number, host: string, port: number, user: string) {
  const poolHost = safeHost(host);
  const poolPort = safePort(port);
  if (!poolHost || !poolPort || !user.trim()) return { ok: false, error: "bad pool" };
  const body = {
    stratumProtocol: "SV1",
    stratumURL: poolHost,
    stratumPort: poolPort,
    stratumUser: user.trim().slice(0, 120),
    stratumPassword: "x",
    stratumSuggestedDifficulty: 0,
    stratumExtranonceSubscribe: true,
    stratumTLS: 0,
    stratumDecodeCoinbase: true,
  };
  const put = await fetch(`http://${deviceHost}:${devicePort}/api/system/pools/0`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (put.ok) return { ok: true };
  const patch = await fetch(`http://${deviceHost}:${devicePort}/api/system`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      stratumURL: poolHost,
      stratumPort: poolPort,
      stratumUser: user.trim().slice(0, 120),
      stratumPassword: "x",
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!patch.ok) return { ok: false, error: String(patch.status) };
  return { ok: true };
}

async function setTnaPool(deviceHost: string, devicePort: number, host: string, port: number, user: string) {
  const poolHost = safeHost(host);
  const poolPort = safePort(port);
  if (!poolHost || !poolPort || !user.trim()) return { ok: false, error: "bad pool" };
  const worker = user.trim().slice(0, 120);
  const patch = await fetch(`http://${deviceHost}:${devicePort}/api/system`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      stratumURL: `stratum+tcp://${poolHost}:${poolPort}`,
      stratumPort: poolPort,
      stratumUser: worker,
      pools: [{ url: poolHost, port: poolPort, user: worker, pass: "x", quota: 1, protocol: "v1" }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!patch.ok) return { ok: false, error: String(patch.status) };
  return { ok: true };
}

async function setCgPool(deviceHost: string, devicePort: number, host: string, port: number, user: string) {
  const poolHost = safeHost(host);
  const poolPort = safePort(port);
  if (!poolHost || !poolPort || !user.trim()) return { ok: false, error: "bad pool" };
  const url = `stratum+tcp://${poolHost}:${poolPort}`;
  const listed = await cgminerCall(deviceHost, devicePort, "pools").catch(() => null);
  const pools = Array.isArray(listed?.POOLS) ? (listed.POOLS as Record<string, unknown>[]) : [];
  const index = pools.findIndex((pool) => String(pool.URL ?? "").includes(`${poolHost}:${poolPort}`));
  const reply =
    index >= 0
      ? await cgminerCall(deviceHost, devicePort, "switchpool", String(index))
      : await cgminerCall(deviceHost, devicePort, "addpool", `${url},${user.trim().slice(0, 120)},x`);
  const status = Array.isArray(reply.STATUS) ? (reply.STATUS[0] as Record<string, unknown>) : undefined;
  if (status && String(status.STATUS) === "E") {
    return { ok: false, error: String(status.Msg ?? "miner refused the pool").slice(0, 120) };
  }
  return { ok: true };
}

export const pollMiners = createServerFn({ method: "POST" })
  .validator((data: { miners?: MinerTarget[] }) => data)
  .handler(async ({ data }): Promise<LiveRead[]> => {
    const list = targets(data);
    if (list.length === 0) return [];
    return pool(list, 6, readOne);
  });

export const commandMiner = createServerFn({ method: "POST" })
  .validator((data: { target?: MinerTarget; command?: MinerCommand }) => data)
  .handler(async ({ data }): Promise<{ ok: boolean; error?: string }> => {
    const list = targets({ miners: data.target ? [data.target] : [] });
    const target = list[0];
    const command = data.command;
    if (!target || !command) return { ok: false, error: "bad target" };
    const speaksCg = target.port === 4028 || target.kind === "cgminer" || target.kind === "avalon";
    try {
      if (target.kind === "greenbit") {
        if (command.action === "pool") {
          return setGreenbitPool(target.host, command.host, command.port, command.user);
        }
        return { ok: false, error: "Satboy only accepts a pool change, and that reboots it" };
      }
      if (target.kind === "hammer") return await hammerCommand(target, command);
      if (target.kind === "harlo") return await harloCommand(target, command);
      if (target.kind === "esp-miner" || target.kind === "tna-canaan") {
        if (command.action === "restart") {
          const res = await fetch(`http://${target.host}:${target.port}/api/system/restart`, {
            method: "POST",
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          if (!res.ok) throw new Error(String(res.status));
          return { ok: true };
        }
        if (command.action === "pool") {
          return target.kind === "esp-miner"
            ? setEspPool(target.host, target.port, command.host, command.port, command.user)
            : setTnaPool(target.host, target.port, command.host, command.port, command.user);
        }
        const body =
          command.action === "fan"
            ? { fanspeed: command.fanPct, autofanspeed: command.fanAuto ? 1 : 0 }
            : command.action === "frequency"
              ? { frequency: command.frequencyMhz }
              : { coreVoltage: command.coreVoltageMv };
        const res = await fetch(`http://${target.host}:${target.port}/api/system`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(String(res.status));
        return { ok: true };
      }
      if (!speaksCg) return { ok: false, error: "This firmware is read-only here" };
      if (command.action === "restart") {
        await cgminerCall(target.host, target.port, "restart");
        return { ok: true };
      }
      if (command.action === "pool") {
        return setCgPool(target.host, target.port, command.host, command.port, command.user);
      }
      const parameter =
        command.action === "fan"
          ? `0,fan,${command.fanPct}`
          : command.action === "frequency"
            ? `0,freq,${command.frequencyMhz}`
            : `0,volt,${command.coreVoltageMv}`;
      const reply = await cgminerCall(target.host, target.port, "ascset", parameter);
      const status = Array.isArray(reply.STATUS) ? (reply.STATUS[0] as Record<string, unknown>) : undefined;
      if (status && String(status.STATUS) === "E") {
        return { ok: false, error: String(status.Msg ?? "miner refused the command").slice(0, 120) };
      }
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "no answer";
      return { ok: false, error: message.slice(0, 120) };
    }
  });
