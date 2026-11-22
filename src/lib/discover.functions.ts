import { createServerFn } from "@tanstack/react-start";
import { probeGreenbit } from "@/lib/miner-link.functions";
import { isPrivateIPv4, isTnaOsText, parseScanSubnet, subnet24, type DiscoverResult, type FoundMiner } from "@/lib/discover";
import { hammerBoardName, type LinkKind } from "@/lib/miner-link";

const CG_MS = 450;
const HTTP_MS = 700;
const HAMMER_MS = 2200;

function collect(groups: (import("node:os").NetworkInterfaceInfo[] | undefined)[]): { label: string; hosts: string[] }[] {
  const nets = new Map<string, { label: string; hosts: string[] }>();
  for (const addrs of groups) {
    for (const addr of addrs ?? []) {
      if (addr.internal || addr.family !== "IPv4" || !isPrivateIPv4(addr.address)) continue;
      const net = subnet24(addr.address);
      if (net && !nets.has(net.label)) nets.set(net.label, net);
    }
  }
  return [...nets.values()].slice(0, 2);
}

async function loadSubnets() {
  const { networkInterfaces } = await import("node:os");
  return collect(Object.values(networkInterfaces()));
}

function isFarmFirmware(blob: string): boolean {
  return /whatsminer|btminer|microbt|luxos|luxor|braiins|bosminer|vnish|antminer|bmminer|minertype|bitmain|s19|s21|t21/.test(blob.toLowerCase());
}

function classifyApi(blob: string): LinkKind | null {
  if (isFarmFirmware(blob)) return null;
  if (/avalon/.test(blob.toLowerCase())) return "avalon";
  return "cgminer";
}

function tcpProbe(host: string, port: number, payload: string, ms: number): Promise<string | null> {
  return new Promise((resolve) => {
    void import("node:net").then(({ connect }) => {
      const socket = connect({ host, port });
      let buf = "";
      let settled = false;
      const done = (text: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(text);
      };
      const timer = setTimeout(() => done(buf ? buf : null), ms);
      socket.on("error", () => done(null));
      socket.on("timeout", () => done(buf ? buf : null));
      socket.setTimeout(ms);
      socket.on("data", (chunk) => {
        buf += chunk.toString("utf8");
        if (buf.includes("\0") || buf.includes("}") || buf.length > 400) done(buf);
      });
      socket.on("connect", () => {
        socket.write(payload);
      });
    }).catch(() => resolve(null));
  });
}

async function cgminerProbe(host: string): Promise<FoundMiner | null> {
  const raw = await tcpProbe(host, 4028, '{"command":"summary"}\0', CG_MS);
  if (!raw || (!raw.includes("SUMMARY") && !raw.includes("STATUS"))) return null;
  if (isTnaOsText(raw)) {
    return { host, port: 80, kind: "tna-canaan", name: "Avalon", firmware: "TNA-OS" };
  }
  const kind = classifyApi(raw);
  if (!kind) return null;
  return { host, port: 4028, kind, name: kind === "avalon" ? "Avalon Nano" : "cgminer", firmware: kind === "avalon" ? "Avalon Nano" : "cgminer" };
}

async function httpGet(url: string, ms = HTTP_MS): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(ms) });
    if (!res.ok) return null;
    return (await res.text()).slice(0, 8000);
  } catch {
    return null;
  }
}

function tnaFound(host: string, blob: string): FoundMiner {
  let hostName = "Avalon";
  let firmware = "TNA-OS";
  try {
    const info = JSON.parse(blob) as Record<string, unknown>;
    const model = info.deviceModel || info.minerModel;
    if (typeof info.hostname === "string" && info.hostname.trim()) hostName = info.hostname.replace(/\s+/g, "-").slice(0, 24);
    else if (typeof model === "string" && model.trim()) hostName = model.replace(/\s+/g, "-").slice(0, 24);
    if (typeof info.version === "string") firmware = `TNA-OS ${info.version}`;
  } catch {
    // the text match is enough
  }
  return { host, port: 80, kind: "tna-canaan", name: hostName, firmware };
}

function tnaKind(info: Record<string, unknown>, raw: string): LinkKind | null {
  if (isTnaOsText(raw) || isTnaOsText(String(info.ASICModel ?? "")) || isTnaOsText(String(info.deviceModel ?? "")) || isTnaOsText(String(info.minerModel ?? ""))) {
    return "tna-canaan";
  }
  const stratum = info.stratum && typeof info.stratum === "object";
  if (!("hashRate_1m" in info) && !("usingFallback" in info) && !stratum) return null;
  const text = `${raw} ${JSON.stringify(info.deviceModel ?? "")} ${JSON.stringify(info.minerModel ?? "")}`.toLowerCase();
  if (/bitmain|antminer|bm136|bm137|tna-os hybrid|s19|s21|t21/.test(text)) return null;
  if (/avalon|canaan|nano3|nano 3/.test(text)) return "tna-canaan";
  const boards = Array.isArray(info.boards) ? info.boards.length : 0;
  return boards > 1 ? null : "tna-canaan";
}

async function httpProbe(host: string): Promise<FoundMiner | null> {
  const [esp, espAlt, asic] = await Promise.all([
    httpGet(`http://${host}/api/system/info`, 1500),
    httpGet(`http://${host}/api/v1/system/info`),
    httpGet(`http://${host}/api/system/asic`, 1500),
  ]);

  const tnaBlob = [asic, esp, espAlt].find((blob) => blob && isTnaOsText(blob));
  if (tnaBlob) return tnaFound(host, tnaBlob);

  const espBody = esp ?? espAlt;
  if (espBody && /hashRate|ASICModel|hostname|stratumURL/i.test(espBody)) {
    let hostName = "miner";
    let firmware: string | undefined;
    let info: Record<string, unknown> = {};
    try {
      info = JSON.parse(espBody) as Record<string, unknown>;
      if (typeof info.hostname === "string") hostName = info.hostname.replace(/\s+/g, "-").slice(0, 24);
      if (typeof info.version === "string") firmware = info.version;
    } catch {
      info = {};
    }
    const tna = tnaKind(info, espBody);
    if (tna === "tna-canaan") {
      return { host, port: 80, kind: tna, name: hostName, firmware: firmware ? `Avalon TNA ${firmware}` : "Avalon TNA" };
    }
    if (isFarmFirmware(espBody)) return null;
    return { host, port: 80, kind: "esp-miner", name: hostName, firmware };
  }
  return null;
}

async function httpRead(url: string, ms: number): Promise<{ status: number; body: string } | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(ms),
      headers: { accept: "application/json, text/html;q=0.9" },
    });
    return { status: res.status, body: (await res.text()).slice(0, 8000) };
  } catch {
    return null;
  }
}

function tcpOpen(host: string, port: number, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    void import("node:net").then(({ connect }) => {
      let settled = false;
      const socket = connect({ host, port });
      const done = (open: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(open);
      };
      const timer = setTimeout(() => done(false), ms);
      socket.setTimeout(ms);
      socket.on("connect", () => done(true));
      socket.on("error", () => done(false));
      socket.on("timeout", () => done(false));
    }).catch(() => resolve(false));
  });
}

function hammerFound(host: string, model: string, version: string, fallback = "hammer"): FoundMiner {
  const label = model ? hammerBoardName(model) : "Hammer";
  const name = (model ? label : fallback).toLowerCase().replace(/\s+/g, "-").slice(0, 24);
  return { host, port: 80, kind: "hammer", name, firmware: [label, version].filter(Boolean).join(" ") };
}

function hammerFromJson(host: string, body: string): FoundMiner | null {
  if (!/device_model|firmware_version|chip_type|current_hashrate|mac_address/i.test(body)) return null;
  try {
    const parsed = JSON.parse(body) as { data?: Record<string, unknown> } & Record<string, unknown>;
    const info = parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
    const model = typeof info.device_model === "string" ? info.device_model : "";
    const version = typeof info.firmware_version === "string" ? info.firmware_version : "";
    const hostName = typeof info.hostname === "string" ? info.hostname : "";
    if (!model && !version && !hostName && !/device_model|firmware_version|chip_type|current_hashrate/i.test(body)) return null;
    return hammerFound(host, model, version, hostName || "thor");
  } catch {
    return null;
  }
}

function hammerFromPage(host: string, body: string): FoundMiner | null {
  if (!/thor\s*os|hammer\s*miner|hammerminer|thor\s*x1/i.test(body)) return null;
  const model = body.match(/\b(Thor\s*X1|Thor\s*P2|BC0?[1248]|DC0?[246])\b/i);
  return hammerFound(host, model?.[1] ?? "", "", "thor");
}

async function hammerProbe(host: string): Promise<FoundMiner | null> {
  const info = await httpRead(`http://${host}/v2/device/info`, HAMMER_MS);
  if (!info) return null;
  const fromInfo = hammerFromJson(host, info.body);
  if (fromInfo) return fromInfo;
  const page = /<(?:!doctype|html)/i.test(info.body);
  if (info.status !== 404 && !page && info.status !== 401) return null;

  const legacy = await httpRead(`http://${host}/api/v1/miner/summary`, 1200);
  if (legacy && /HAMMER|THOR|miner_type|device_model/i.test(legacy.body)) {
    const parsed = hammerFromJson(host, legacy.body);
    if (parsed) return parsed;
    return hammerFound(host, "", "", "hammer");
  }
  if (legacy?.status === 401 && /token|unauthorized|hammer|thor/i.test(legacy.body)) {
    return { host, port: 80, kind: "hammer", name: "hammer", firmware: "THOR (token required)" };
  }
  if (page) return hammerFromPage(host, info.body);
  if (info.status === 404) {
    const home = await httpRead(`http://${host}/`, 900);
    if (home) return hammerFromPage(host, home.body);
  }
  return null;
}

async function harloProbe(host: string): Promise<FoundMiner | null> {
  const [info, tele] = await Promise.all([httpGet(`http://${host}/api/info`), httpGet(`http://${host}/api/telemetry`)]);
  if (!tele || !/hashrate|hashRate|ghs|ths/i.test(tele)) return null;
  if (info && !/harlo|hostname|firmware|model|device/i.test(info)) return null;
  if (!info && !/harlo/i.test(tele)) return null;
  let name = "harlo";
  let firmware = "Harlo OS";
  try {
    const parsed = JSON.parse(info || tele) as Record<string, unknown>;
    const hostName = parsed.hostname ?? parsed.name;
    if (typeof hostName === "string") name = hostName.replace(/\s+/g, "-").slice(0, 24);
    if (typeof parsed.firmware === "string") firmware = `Harlo ${parsed.firmware}`;
    else if (typeof parsed.version === "string") firmware = `Harlo ${parsed.version}`;
  } catch {
    // keep the generic name
  }
  return { host, port: 80, kind: "harlo", name, firmware };
}

function prefer(found: (FoundMiner | null)[]): FoundMiner | null {
  const hits = found.filter((row): row is FoundMiner => Boolean(row));
  if (hits.length === 0) return null;
  const harlo = hits.find((row) => row.kind === "harlo");
  if (harlo) return harlo;
  const hammer = hits.find((row) => row.kind === "hammer");
  if (hammer) return hammer;
  const greenbit = hits.find((row) => row.kind === "greenbit");
  if (greenbit) return greenbit;
  const http = hits.find((row) => row.port === 80);
  if (http) return http;
  return hits.find((row) => row.port === 4028) ?? null;
}

async function probe(host: string): Promise<FoundMiner | null> {
  const [open, cg] = await Promise.all([tcpOpen(host, 80, 800), cgminerProbe(host)]);
  if (!open) return cg;
  const hammer = await hammerProbe(host);
  if (hammer) return hammer;
  const hits = await Promise.all([httpProbe(host), harloProbe(host), probeGreenbit(host)]);
  return prefer([cg, ...hits]);
}

async function pool(hosts: string[], limit: number): Promise<FoundMiner[]> {
  const found: FoundMiner[] = [];
  let cursor = 0;
  async function worker() {
    while (cursor < hosts.length) {
      const host = hosts[cursor];
      cursor += 1;
      const miner = await probe(host!);
      if (miner) found.push(miner);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, hosts.length) }, () => worker()));
  found.sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true }));
  return found;
}

export const discoverMiners = createServerFn({ method: "POST" })
  .validator((data: { subnet?: string }) => data)
  .handler(async ({ data }): Promise<DiscoverResult> => {
    const asked = typeof data?.subnet === "string" ? data.subnet.trim() : "";
    const custom = asked ? parseScanSubnet(asked) : null;
    if (asked && !custom) return { subnet: asked, miners: [], error: "Subnet must be a private /24" };
    const nets = custom && custom.hosts.length > 0 ? [custom] : await loadSubnets();
    if (nets.length === 0) return { subnet: "", miners: [], error: "No local network" };
    const hosts = nets.flatMap((net) => net.hosts);
    const miners = await pool(hosts, 24);
    return { subnet: nets.map((net) => net.label).join(", "), miners };
  });
