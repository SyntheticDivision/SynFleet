import { useContext, useEffect, useRef, useState, createContext, type FormEvent, type ReactNode } from "react";
import { format } from "date-fns";
import * as Dialog from "@radix-ui/react-dialog";
import { Activity, ExternalLink, Fan, Plus, Settings, Thermometer, TriangleAlert, X, Zap } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import { DUTCH_COINS, findDutchCoin, type DutchCoin } from "@/lib/coins";
import { parsePoolAddress } from "@/lib/pool-coin";
import { refreshDutchCoins } from "@/lib/dutch-coins";
import { pollMiners } from "@/lib/miner-link.functions";
import { resolvePoolCoin, resolvePoolCoins, coinEndpoint } from "@/lib/pool-coin.functions";
import { commandMiner } from "@/lib/miner-link.functions";
import { listIdleImages } from "@/lib/idle-images.functions";
import { startScan, useScanState } from "@/lib/scan-client";
import { parseScanSubnet } from "@/lib/discover";
import { KIND_LABEL, defaultPort } from "@/lib/miner-link";
import {
  asicWarn,
  formatDiff,
  formatEff,
  formatPower,
  formatRate,
  formatUptime,
  hashIsLow,
  minerTone,
  minerUrl,
  pingWarn,
  poolUrls,
  seenAgo,
  fallbackPool,
  expectedGhs,
  useFleet,
  vrWarn,
  type Miner,
  type MinerKind,
} from "@/lib/fleet";

const COIN_KEY = "synfleet-dutch-coins";
const COIN_REFRESH_MS = 6 * 60 * 60 * 1000;

type CoinListState = { coins: DutchCoin[]; updatedAt: number; source: "bundled" | "saved" | "live" | "cache" | "fallback" };

const CoinListContext = createContext<CoinListState>({ coins: DUTCH_COINS, updatedAt: 0, source: "bundled" });

function useCoinList(): CoinListState {
  return useContext(CoinListContext);
}

function readSavedCoins(): CoinListState | null {
  try {
    const raw = JSON.parse(localStorage.getItem(COIN_KEY) || "");
    if (!Array.isArray(raw.coins) || raw.coins.length < 20) return null;
    const coins = raw.coins
      .filter(
        (c: DutchCoin) => c && (c.algo === "SHA-256" || c.algo === "Scrypt") && typeof c.ticker === "string" && typeof c.name === "string",
      )
      .map((c: DutchCoin) => ({
        ...c,
        slug: c.slug || DUTCH_COINS.find((row) => row.ticker === c.ticker)?.slug || c.ticker.toLowerCase(),
      }));
    if (coins.length < 20) return null;
    return { coins, updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0, source: "saved" };
  } catch {
    return null;
  }
}

let kioskTouch = false;

function useFingerScroll(ref: { current: HTMLElement | null }) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let pointerId = -1;
    let startY = 0;
    let origin = 0;
    let dragging = false;
    let blockClick = false;

    const down = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !el.contains(target)) return;
      if (target.closest("input, textarea, select, [role='slider']")) return;
      kioskTouch = true;
      pointerId = event.pointerId;
      startY = event.clientY;
      origin = el.scrollTop;
      dragging = false;
    };
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      const dy = event.clientY - startY;
      if (!dragging) {
        if (Math.abs(dy) < 8) return;
        dragging = true;
      }
      el.scrollTop = origin - dy;
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== pointerId) return;
      if (dragging) blockClick = true;
      pointerId = -1;
      dragging = false;
      kioskTouch = false;
    };
    const click = (event: MouseEvent) => {
      if (!blockClick) return;
      blockClick = false;
      event.preventDefault();
      event.stopPropagation();
    };

    el.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    el.addEventListener("click", click, true);
    return () => {
      el.removeEventListener("pointerdown", down);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      el.removeEventListener("click", click, true);
    };
  }, [ref]);
}

const IDLE_MS = 30_000;
const IDLE_SCROLL_PX_PER_SEC = 18;
const IDLE_SCROLL_END_PAUSE_MS = 900;
const IDLE_SLIDE_MS = 8_000;

function useKioskIdle(ms: number): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let timer = 0;
    const arm = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), ms);
    };
    const down = () => {
      kioskTouch = true;
      arm();
    };
    const up = () => {
      kioskTouch = false;
    };
    arm();
    const opts = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", down, opts);
    window.addEventListener("touchstart", down, opts);
    window.addEventListener("pointerup", up, opts);
    window.addEventListener("pointercancel", up, opts);
    window.addEventListener("wheel", arm, opts);
    window.addEventListener("keydown", arm, opts);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", down, opts);
      window.removeEventListener("touchstart", down, opts);
      window.removeEventListener("pointerup", up, opts);
      window.removeEventListener("pointercancel", up, opts);
      window.removeEventListener("wheel", arm, opts);
      window.removeEventListener("keydown", arm, opts);
    };
  }, [ms]);
  return idle;
}

function useIdleMinerScroll(ref: { current: HTMLElement | null }, enabled: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    let running = true;
    let last = 0;
    let dir = 1;
    let pos = el.scrollTop;
    let pauseUntil = 0;
    const maxNow = Math.max(0, el.scrollHeight - el.clientHeight);
    if (pos >= maxNow - 1) dir = -1;

    const frame = (now: number) => {
      if (!running || kioskTouch) {
        running = false;
        return;
      }
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      if (max > 1 && now >= pauseUntil) {
        pos += dir * IDLE_SCROLL_PX_PER_SEC * dt;
        if (dir > 0 && pos >= max) {
          pos = max;
          dir = -1;
          pauseUntil = now + IDLE_SCROLL_END_PAUSE_MS;
        } else if (dir < 0 && pos <= 0) {
          pos = 0;
          dir = 1;
          pauseUntil = now + IDLE_SCROLL_END_PAUSE_MS;
        }
        el.scrollTop = pos;
      }
      raf = requestAnimationFrame(frame);
    };

    raf = requestAnimationFrame(frame);
    return () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref, enabled]);
}

export function Console() {
  const miners = useFleet((s) => s.miners);
  const samples = useFleet((s) => s.samples);
  const selectedId = useFleet((s) => s.selectedId);
  const banner = useFleet((s) => s.banner);
  const tick = useFleet((s) => s.tick);
  const select = useFleet((s) => s.select);
  const dismissBanner = useFleet((s) => s.dismissBanner);
  const removeMiner = useFleet((s) => s.removeMiner);

  const [now, setNow] = useState<Date | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [fleetOpen, setFleetOpen] = useState(false);
  const [coinList, setCoinList] = useState<CoinListState>({ coins: DUTCH_COINS, updatedAt: 0, source: "bundled" });
  const sideRef = useRef<HTMLElement>(null);
  const minersRef = useRef<HTMLElement>(null);
  const idle = useKioskIdle(IDLE_MS);
  const [idleImages, setIdleImages] = useState<string[]>([]);
  useFingerScroll(sideRef);
  useFingerScroll(minersRef);
  useIdleMinerScroll(minersRef, idle);
  const followLog = useRef(true);

  useEffect(() => {
    let timer = 0;
    let clock = 0;
    let stop = false;
    void Promise.resolve(useFleet.persist.rehydrate()).then(() => {
      if (stop) return;
      useFleet.getState().rebase();
      setNow(new Date());
      tick();
      timer = window.setInterval(tick, 2000);
      clock = window.setInterval(() => setNow(new Date()), 1000);
    });
    return () => {
      stop = true;
      window.clearInterval(timer);
      window.clearInterval(clock);
    };
  }, [tick]);

  useEffect(() => {
    let stop = false;
    void listIdleImages()
      .then((files) => {
        if (!stop) setIdleImages(files.map((file) => `/idle/${encodeURIComponent(file)}`));
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, []);

  useEffect(() => {
    let stop = false;
    let busy = false;
    const poll = () => {
      if (busy || stop) return;
      const live = useFleet.getState().miners.filter((m) => !m.simulated);
      if (live.length === 0) return;
      busy = true;
      void pollMiners({
        data: { miners: live.map((m) => ({ id: m.id, host: m.host, port: m.port, kind: m.kind, token: m.apiToken })) },
      })
        .then((reads) => {
          if (!stop) useFleet.getState().applyLive(reads);
        })
        .catch(() => {})
        .finally(() => {
          busy = false;
        });
    };
    poll();
    const timer = window.setInterval(poll, 5000);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  const poolKey = miners.map((m) => `${m.id}:${poolUrls(m).join(",")}`).join("|");
  useEffect(() => {
    const rows = useFleet.getState().miners;
    const urls = [...new Set(rows.flatMap((m) => poolUrls(m)))];
    if (urls.length === 0) return;
    let stop = false;
    void resolvePoolCoins({ data: { pools: urls } })
      .then((found) => {
        if (stop) return;
        const byPool = new Map(found.map((row) => [row.pool, row.coin]));
        for (const miner of useFleet.getState().miners) {
          const list = poolUrls(miner);
          const coins: { ticker: string; algo: string }[] = [];
          for (const url of list) {
            const coin = byPool.get(url);
            if (!coin || coins.some((row) => row.ticker === coin.ticker)) continue;
            coins.push(coin);
          }
          if (coins.length === 0) continue;
          if (coins.length === 1) {
            const coin = coins[0]!;
            if (miner.coin === coin.ticker && miner.algo === coin.algo && miner.workerCoins.length === 0) continue;
            useFleet.getState().tune(miner.id, { coin: coin.ticker, algo: coin.algo, workerCoins: [] }, miner.coin === coin.ticker ? undefined : `pool  ${coin.ticker}  ${coin.algo}`);
            continue;
          }
          const tickers = coins.map((coin) => coin.ticker);
          if (tickers.join() === miner.workerCoins.join()) continue;
          useFleet.getState().tune(miner.id, { workerCoins: tickers }, `pools on  ${tickers.join("  ")}`);
        }
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [poolKey]);

  const online = miners.filter((m) => m.online);
  const totalGhs = online.reduce((sum, m) => sum + m.hashrateGhs, 0);
  const totalW = online.reduce((sum, m) => sum + m.powerW, 0);
  const hottest = online.reduce<Miner | null>(
    (best, m) => (!best || m.tempC > best.tempC ? m : best),
    null,
  );
  const rate = formatRate(totalGhs);
  const selected = miners.find((m) => m.id === selectedId) ?? null;

  useEffect(() => {
    let stop = false;
    const saved = readSavedCoins();
    if (saved) setCoinList(saved);
    const pull = () => {
      refreshDutchCoins()
        .then((result) => {
          if (stop || result.coins.length < 20 || result.source === "fallback") return;
          const next = { coins: result.coins, updatedAt: result.updatedAt, source: result.source };
          setCoinList(next);
          localStorage.setItem(COIN_KEY, JSON.stringify({ coins: result.coins, updatedAt: result.updatedAt }));
        })
        .catch(() => {});
    };
    pull();
    const timer = window.setInterval(pull, COIN_REFRESH_MS);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <CoinListContext.Provider value={coinList}>
    <div className="faceplate relative flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <div className={idle ? "hidden" : "cyber-cycle"} aria-hidden>
        <img src="/cyber/street.jpg" alt="" />
        <img src="/cyber/bay.jpg" alt="" />
        <img src="/cyber/roof.jpg" alt="" />
        <img src="/cyber/panel.jpg" alt="" />
        <div className="cyber-scrim" />
      </div>
      {!idle ? (
      <header className="relative z-10 shrink-0 border-b border-line px-4 py-3 md:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0">
            <img
              src="/synfleet-header.jpg"
              alt="SynFleet, Synthetic Division fleet monitor"
              className="h-12 w-auto max-w-[15rem] object-contain object-left sm:h-14 sm:max-w-[18rem]"
            />
          </h1>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            <p className="hidden font-mono text-sm text-muted tabular-nums sm:block">
              {now ? format(now, "EEE d MMM  HH:mm:ss") : "—"}
            </p>
            <button
              type="button"
              onClick={() => setFleetOpen(true)}
              className="inline-flex h-11 items-center rounded-lg bg-amber px-3 text-sm font-medium text-bg"
            >
              Fleet Status
            </button>
            <ScanNetwork />
            <AddMiner />
            <FleetSettings />
            {import.meta.env.DEV ? (
              <>
                <a
                  href="/synfleet-pi.tar"
                  download="synfleet-pi.tar"
                  className="inline-flex h-11 items-center rounded-lg border border-amber px-3 text-sm font-medium text-amber"
                >
                  Pi update
                </a>
                <a
                  href="/update-pi.bat"
                  download="update-pi.bat"
                  className="inline-flex h-11 items-center rounded-lg border border-line px-3 text-sm text-fg"
                >
                  Update bat
                </a>
              </>
            ) : null}
          </div>
        </div>
        <ScanNote />
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          <Stat icon={<Activity className="size-3.5" />} label="Hashrate" value={rate.n} unit={rate.u} />
          <Stat icon={<Zap className="size-3.5" />} label="Power" value={formatPower(totalW)} />
          <Stat
            icon={<Thermometer className="size-3.5" />}
            label="Hottest"
            value={hottest && Number.isFinite(hottest.tempC) ? `${hottest.tempC.toFixed(0)}°` : "—"}
            unit={hottest?.name}
            warn={hottest != null && hottest.tempC >= asicWarn(hottest)}
          />
          <Stat label="On display" value={`${online.length}/${miners.length}`} unit="miners" />
        </dl>
      </header>
      ) : null}

      {!idle && banner ? (
        <div className="relative z-10 flex shrink-0 items-start gap-3 border-b border-line bg-raised/80 px-4 py-2 text-sm md:px-6">
          <p className="text-muted">
            On the Pi, press Scan. It looks for home solo boards on this network: Bitaxe and other ESP-miners, Avalon Nano, cgminer, Hammer (Thor X1, BC01, BC04, DC02), and Harlo. Farm firmware (Whatsminer, Antminer, Braiins, LuxOS, VNish) is ignored.
            Fan, voltage, save, and restart are sent to that device. Other computers do not need to open this display.
          </p>
          <button
            type="button"
            onClick={dismissBanner}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-muted"
            aria-label="Dismiss"
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      <div className={`kiosk-split relative z-10 grid min-h-0 flex-1 ${idle ? "grid-cols-5" : "grid-cols-1 md:grid-cols-5"}`}>
        <section ref={minersRef} className={`touch-scroll min-h-0 overflow-y-auto px-4 py-3 md:px-6 ${idle ? "col-span-3" : "md:col-span-3"}`} aria-label="Miners">
          <div className="grid gap-3 sm:grid-cols-2">
            {[...miners].sort(byAttention).map((m) => (
              <MinerCard
                key={m.id}
                miner={m}
                selected={m.id === selectedId}
                confirmRemove={confirmRemove === m.id}
                onSelect={() => select(selectedId === m.id ? null : m.id)}
                onRemoveAsk={() => setConfirmRemove(m.id)}
                onRemoveCancel={() => setConfirmRemove(null)}
                onRemove={() => {
                  removeMiner(m.id);
                  setConfirmRemove(null);
                }}
              />
            ))}
          </div>
          {miners.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted">No miners on this display yet.</p>
          ) : null}
        </section>

        <section
          ref={sideRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            followLog.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
          }}
          className={`touch-scroll flex min-h-0 flex-col overflow-y-auto border-t border-line md:border-t-0 md:border-l ${idle ? "col-span-2 border-t-0 border-l" : "md:col-span-2"}`}
        >
          {idle ? (
            <div className="relative min-h-0 flex-1">
              <IdleSlides images={idleImages} />
              <IdleAlert miners={miners} />
            </div>
          ) : (
            <>
          {selected ? <TunePanel miner={selected} /> : null}
          <div className="shrink-0 border-b border-line px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-medium">Fleet hashrate</h2>
              <p className="font-mono text-xs text-muted">{selected ? minerLabel(selected.name) : "All miners"}</p>
            </div>
            <div className="mt-2 h-24 w-full">
              {now ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={samples} margin={{ top: 8, right: 0, left: 0, bottom: 0 }}>
                    <YAxis hide domain={["auto", "auto"]} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-surface)",
                        border: "1px solid var(--color-line)",
                        borderRadius: "8px",
                        fontSize: "12px",
                        color: "var(--color-fg)",
                      }}
                      labelFormatter={(t) => format(Number(t), "HH:mm:ss")}
                      formatter={(v) => [`${Number(v).toFixed(2)} TH/s`, "Hashrate"]}
                    />
                    <Area
                      type="monotone"
                      dataKey="th"
                      stroke="var(--color-amber)"
                      fill="var(--color-amber)"
                      fillOpacity={0.18}
                      strokeWidth={1.5}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : null}
            </div>
          </div>

            </>
          )}
        </section>
      </div>
      {fleetOpen ? <FleetStatus miners={miners} onClose={() => setFleetOpen(false)} /> : null}
    </div>
    </CoinListContext.Provider>
  );
}

function IdleSlides({ images }: { images: string[] }) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (images.length < 2) return;
    const timer = window.setInterval(() => setIndex((n) => (n + 1) % images.length), IDLE_SLIDE_MS);
    return () => window.clearInterval(timer);
  }, [images]);
  return (
    <div className="relative min-h-0 flex-1 bg-bg" aria-label="Idle pictures">
      {images.map((src, n) => (
        <img
          key={src}
          src={src}
          alt=""
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${n === index ? "opacity-100" : "opacity-0"}`}
        />
      ))}
    </div>
  );
}

function IdleAlert({ miners }: { miners: Miner[] }) {
  const now = Date.now();
  const rows = miners.flatMap((m) => {
    if (m.simulated || m.bootSec > 0) return [];
    if (!m.online) {
      const ago = m.lastSeenAt ? seenAgo(m, now).replace("Last seen ", "") : "";
      return [{ id: m.id, text: ago && ago !== "Not seen yet" ? `${minerLabel(m.name)} offline · ${ago}` : `${minerLabel(m.name)} offline` }];
    }
    if (m.overheat || m.tempC >= asicWarn(m) || (m.vrTempC > 0 && m.vrTempC >= vrWarn(m))) {
      return [{ id: m.id, text: `${minerLabel(m.name)} overheat · ${m.tempC.toFixed(0)}°C` }];
    }
    if (hashIsLow(m, now)) {
      const rate = formatRate(m.hashrateGhs);
      return [{ id: m.id, text: `${minerLabel(m.name)} low hashrate · ${rate.n} ${rate.u}` }];
    }
    return [];
  });
  if (rows.length === 0) return null;
  return (
    <div className="absolute inset-0 z-10 flex flex-col justify-end bg-bg/75 p-4" role="alert">
      <p className="text-xs tracking-widest text-fault uppercase">Needs attention</p>
      <ul className="mt-2 space-y-1">
        {rows.map((row) => (
          <li key={row.id} className="font-mono text-sm text-fg">
            {row.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function clampPct(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(100, Math.max(3, n));
}

function FleetStatus({ miners, onClose }: { miners: Miner[]; onClose: () => void }) {
  const online = miners.filter((m) => m.online);
  const temp = online.length ? online.reduce((sum, m) => sum + m.tempC, 0) / online.length : 0;
  const ghs = online.reduce((sum, m) => sum + m.hashrateGhs, 0);
  const submitted = miners.reduce((sum, m) => sum + m.accepted + m.rejected, 0);
  const rejected = miners.reduce((sum, m) => sum + m.rejected, 0);
  const ping = online.length ? online.reduce((sum, m) => sum + m.pingMs, 0) / online.length : 0;
  const shareMax = Math.max(submitted, 1);
  const rate = formatRate(ghs);
  const rows = [
    {
      name: "Temp",
      pct: clampPct(temp),
      value: online.length ? `${temp.toFixed(1)}°C` : "—",
      fill: temp >= 72 ? "#ff003c" : "#fcee0a",
    },
    {
      name: "Hashrate",
      pct: clampPct((ghs / 1000 / 400) * 100),
      value: `${rate.n} ${rate.u}`,
      fill: "#fcee0a",
    },
    {
      name: "Shares rejected",
      pct: clampPct((rejected / shareMax) * 100),
      value: String(rejected),
      fill: "#ff003c",
    },
    {
      name: "Shares submitted",
      pct: clampPct((submitted / shareMax) * 100),
      value: String(submitted),
      fill: "#fcee0a",
    },
    {
      name: "Average ping",
      pct: clampPct((ping / 120) * 100),
      value: online.length ? `${Math.round(ping)} ms` : "—",
      fill: ping > 80 ? "#ff003c" : "#fcee0a",
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex h-dvh w-screen flex-col text-fg" role="dialog" aria-label="Fleet status">
      <div className="cyber-cycle" aria-hidden>
        <img src="/cyber/street.jpg" alt="" />
        <img src="/cyber/bay.jpg" alt="" />
        <img src="/cyber/roof.jpg" alt="" />
        <img src="/cyber/panel.jpg" alt="" />
        <div className="cyber-scrim" />
      </div>
      <div className="relative z-10 flex items-center gap-4 border-b-2 border-amber bg-bg/70 px-4 py-3">
        <button type="button" onClick={onClose} className="h-11 rounded-lg bg-amber px-4 text-sm font-medium text-bg">
          Close
        </button>
        <h2 className="text-lg font-semibold tracking-widest uppercase">Fleet status</h2>
      </div>
      <ul className="relative z-10 flex min-h-0 flex-1 flex-col justify-center gap-5 px-4 py-6 md:px-10">
        {rows.map((row) => (
          <li key={row.name} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2">
            <span className="text-sm tracking-wide uppercase">{row.name}</span>
            <span className="font-mono text-lg tabular-nums">{row.value}</span>
            <span className="col-span-2 block h-8 bg-raised">
              <span className="block h-full" style={{ width: `${row.pct}%`, background: row.fill }} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  unit,
  warn,
}: {
  icon?: ReactNode;
  label: string;
  value: string;
  unit?: string;
  warn?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-xs text-muted">
        {icon}
        {label}
      </dt>
      <dd className={`truncate font-mono text-base tabular-nums ${warn ? "text-fault" : "text-fg"}`}>
        {value}
        {unit ? <span className="ml-1 text-xs text-muted">{unit}</span> : null}
      </dd>
    </div>
  );
}

function CoinBadge({ coin, algo }: { coin: string; algo: string }) {
  const list = useCoinList();
  const known = findDutchCoin(coin, list.coins);
  const name = known?.name ?? coin;
  const shownAlgo = known?.algo ?? algo;
  const mark = coin === "BTC" ? "₿" : coin === "LTC" ? "Ł" : coin === "DOGE" ? "Ð" : coin.replace(/_.*/, "").slice(0, 1);
  return (
    <span className="inline-flex min-w-0 items-center gap-1" title={`${name}, ${shownAlgo}`} aria-label={`Mining ${name}, ${shownAlgo}`}>
      <span
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full border border-amber text-[11px] leading-none text-amber"
        aria-hidden
      >
        {mark}
      </span>
      <span className="max-w-[4.5rem] truncate font-mono text-[11px] leading-none text-amber">{coin}</span>
      <span className="hidden shrink-0 font-mono text-[11px] leading-none text-muted sm:inline">{shownAlgo}</span>
    </span>
  );
}

function minerLabel(name: string): string {
  return name.replace(/-\d+$/, "");
}

function hotMiner(m: Miner): boolean {
  return m.online && (m.tempC >= asicWarn(m) || m.vrTempC >= vrWarn(m));
}

function byAttention(a: Miner, b: Miner): number {
  const rank = (m: Miner) => (hotMiner(m) ? 0 : m.online ? 2 : 1);
  const order = rank(a) - rank(b);
  if (order !== 0) return order;
  return b.hashrateGhs - a.hashrateGhs;
}

function pinned(m: Miner): boolean {
  const tone = minerTone(m);
  return tone === "hot" || tone === "warm" || tone === "down" || tone === "idle";
}

function MinerCard({
  miner: m,
  selected,
  confirmRemove,
  onSelect,
  onRemoveAsk,
  onRemoveCancel,
  onRemove,
}: {
  miner: Miner;
  selected: boolean;
  confirmRemove: boolean;
  onSelect: () => void;
  onRemoveAsk: () => void;
  onRemoveCancel: () => void;
  onRemove: () => void;
}) {
  const asicHot = m.online && m.tempC >= asicWarn(m);
  const vrHot = m.online && m.vrTempC >= vrWarn(m);
  const low = hashIsLow(m);
  const heatLabel = asicHot && vrHot ? "ASIC and V-reg overheat" : asicHot ? "ASIC overheat" : vrHot ? "V-reg overheat" : m.overheat ? "Overheat" : low ? "Low hashrate" : "Check";
  const rate = formatRate(m.online ? m.hashrateGhs : 0);
  const alert = pinned(m);
  const edge = alert ? "border-l-fault" : "border-l-amber";
  const backup = fallbackPool(m);

  return (
    <article
      className={`rounded-lg border border-line border-l-4 bg-surface ${edge} ${alert ? "miner-alert" : ""} ${selected ? "ring-1 ring-amber" : ""}`}
    >
      <button type="button" onClick={onSelect} className="w-full px-3 py-3 text-left">
        <div className="flex items-center gap-2">
          <span className="shrink-0 font-mono text-xs tracking-wider text-muted uppercase">
            {KIND_LABEL[m.kind]}
          </span>
          <h3 className="min-w-0 flex-1 truncate text-base font-medium">{minerLabel(m.name)}</h3>
          {alert ? (
            <span
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-fault text-bg"
              aria-label={m.online ? heatLabel : "Disconnected"}
              title={m.online ? heatLabel : "Disconnected"}
            >
              <TriangleAlert className="size-4" aria-hidden />
            </span>
          ) : null}
        </div>
        <p className="mt-1 flex items-center gap-2 font-mono text-xs text-muted">
          <span className="min-w-0 flex-1 truncate">
            {m.online && m.pool ? m.pool : `${m.host}:${m.port}`}
            {m.simulated ? "  ·  demo" : ""}
          </span>
          <CoinBadge coin={m.coin} algo={m.algo} />
          {m.onFallback ? (
            <span className="shrink-0 font-mono text-[11px] text-fault" title={backup || "Fallback pool"}>
              fallback
            </span>
          ) : null}
          {m.workerCoins.length > 1 ? (
            <span className="shrink-0 font-mono text-[11px] text-fault" title={m.workerCoins.join(", ")}>
              {m.workerCoins.length} coins
            </span>
          ) : null}
        </p>
        <p className="mt-2 font-mono text-3xl leading-none tabular-nums">
          {rate.n}
          <span className="ml-2 text-sm text-muted">{rate.u}</span>
        </p>
        {m.note ? <p className="mt-2 text-xs leading-snug text-muted">{m.note}</p> : null}
        {!m.online && !m.simulated ? <p className="mt-2 text-xs text-fault">{seenAgo(m, Date.now())}</p> : null}
        {low ? (
          <p className="mt-2 text-xs text-fault">
            Under 80% of {formatRate(expectedGhs(m)).n} {formatRate(expectedGhs(m)).u} for 3 min
          </p>
        ) : null}
        <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <Mini label="ASIC" value={m.online && Number.isFinite(m.tempC) ? `${m.tempC.toFixed(0)}°C` : "—"} hot={m.online && m.tempC >= asicWarn(m)} />
          <Mini label="V-reg" value={m.online && Number.isFinite(m.vrTempC) ? `${m.vrTempC.toFixed(0)}°C` : "—"} hot={m.online && m.vrTempC >= vrWarn(m)} />
          <Mini label="Latency" value={m.online ? `${Math.round(m.pingMs)} ms` : "—"} hot={m.online && m.pingMs >= pingWarn(m)} />
          <Mini label="Wi-Fi" value={m.wifiRssi < 0 ? `${m.wifiRssi} dBm` : "—"} hot={m.wifiRssi <= -75} />
          <Mini label="Power" value={m.online ? formatPower(m.powerW) : "—"} />
          <Mini label="Fan" value={m.kind === "greenbit" ? "fanless" : m.online ? `${m.fanPct}%` : "—"} />
          <Mini label="Freq" value={m.kind === "greenbit" ? "—" : `${m.frequencyMhz} MHz`} />
          <Mini label="ASIC mV" value={m.online ? `${m.asicVoltageMv}` : "—"} />
          <Mini label="Eff" value={m.online ? formatEff(m.powerW, m.hashrateGhs) : "—"} />
        </dl>
        <p className="mt-2 truncate text-xs text-muted">
          {m.kind === "greenbit" ? "fanless" : m.online ? `${m.fanRpm} rpm` : "fan —"} · {m.asicCount === 1 ? "1 ASIC" : `${m.asicCount} chips`} · A{" "}
          {m.accepted} / R {m.rejected}
        </p>
      </button>
      <div className="flex items-center justify-between border-t border-line px-2 py-1">
        <a
          href={minerUrl(m)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-11 max-w-[70%] items-center gap-1 px-2 text-xs text-amber"
        >
          <ExternalLink className="size-3.5 shrink-0" />
          <span className="truncate">Open {m.host}</span>
        </a>
        {confirmRemove ? (
          <>
            <button type="button" onClick={onRemoveCancel} className="h-11 px-3 text-xs text-muted">
              Keep
            </button>
            <button type="button" onClick={onRemove} className="h-11 px-3 text-xs text-fault">
              Remove
            </button>
          </>
        ) : (
          <button type="button" onClick={onRemoveAsk} className="h-11 px-3 text-xs text-muted">
            Remove
          </button>
        )}
      </div>
    </article>
  );
}

async function pushPool(miner: Miner, pool: string) {
  const parsed = parsePoolAddress(pool);
  const user = useFleet.getState().miners.find((row) => row.id === miner.id)?.worker ?? "";
  if (!parsed || miner.simulated || !user) return;
  const result = await commandMiner({
    data: {
      target: { id: miner.id, host: miner.host, port: miner.port, kind: miner.kind, token: miner.apiToken },
      command: { action: "pool", host: parsed.host, port: parsed.port, user },
    },
  }).catch(() => ({ ok: false, error: "no answer" }));
  if (!result.ok) useFleet.getState().tune(miner.id, {}, `pool failed  ${result.error || "no answer"}`);
}

function ApplyShaPool({ miner: m }: { miner: Miner }) {
  const miners = useFleet((s) => s.miners);
  const others = miners.filter((row) => row.algo === "SHA-256" && row.id !== m.id);
  return (
    <button
      type="button"
      disabled={!m.pool || others.length === 0}
      onClick={() => {
        for (const row of others) {
          const keep = row.pools.filter((item) => item !== row.pool && item !== m.pool);
          useFleet.getState().tune(row.id, { pool: m.pool, pools: [m.pool, ...keep] }, `pool  ${m.pool}  from ${m.name}`);
          void pushPool(row, m.pool);
        }
      }}
      className="mt-2 h-11 w-full rounded-lg border border-line px-3 text-sm disabled:opacity-50"
    >
      Apply to {others.length === 1 ? "1 other SHA-256 board" : `${others.length} other SHA-256 boards`}
    </button>
  );
}

function FloorField({ miner: m }: { miner: Miner }) {
  const tune = useFleet((s) => s.tune);
  const auto = expectedGhs({ ...m, floorGhs: 0 });
  const hint = auto > 0 ? `${formatRate(auto).n} ${formatRate(auto).u} from the model` : "GH/s. Thor X1 is about 2100, DC02 is 0.105";
  return (
    <label className="mt-3 block text-xs text-muted">
      Hashrate floor, GH/s
      <input
        key={`${m.id}:${m.floorGhs}`}
        defaultValue={m.floorGhs > 0 ? String(m.floorGhs) : ""}
        onBlur={(e) => {
          const raw = e.target.value.trim();
          if (!raw) {
            if (m.floorGhs > 0) tune(m.id, { floorGhs: 0 }, "hashrate floor auto");
            return;
          }
          const next = Number(raw);
          if (!Number.isFinite(next) || next < 0 || next === m.floorGhs) return;
          tune(m.id, { floorGhs: next }, `hashrate floor  ${next} GH/s`);
        }}
        inputMode="decimal"
        className="mt-1 h-11 w-full border border-line bg-bg px-2 font-mono text-sm text-fg outline-none focus:border-amber"
        aria-label="Hashrate floor"
        placeholder={hint}
        autoComplete="off"
      />
      <span className="mt-1 block">Blank uses the model. A board under 80% of this for 3 minutes is marked.</span>
    </label>
  );
}

async function sendCoin(miner: Miner, next: DutchCoin) {
  const current = useFleet.getState().miners.find((row) => row.id === miner.id) ?? miner;
  const onDutch = /mining-dutch\.nl/i.test(current.pool);
  if (!onDutch) return;
  const live = await resolvePoolCoin({ data: { slug: next.slug } }).catch(() => null);
  const ticker = live?.ticker ?? next.ticker;
  const algo = live?.algo ?? next.algo;
  if (current.coin !== ticker || current.algo !== algo) {
    useFleet.getState().tune(miner.id, { coin: ticker, algo }, `pool says  ${ticker}  ${algo}`);
  }
  const end = await coinEndpoint({ data: { ticker, pool: current.pool } }).catch(() => null);
  if (!end) return;
  if (end.shared) {
    useFleet.getState().tune(miner.id, {}, `shared port ${end.port}, set ${ticker} on Mining Dutch`);
    return;
  }
  const user = useFleet.getState().miners.find((row) => row.id === miner.id)?.worker ?? "";
  const address = `${end.host}:${end.port}`;
  if (!user) {
    useFleet.getState().tune(miner.id, { pool: address }, `pool not sent, set a worker name`);
    return;
  }
  if (miner.simulated) {
    useFleet.getState().tune(miner.id, { pool: address, pools: [address] }, `bench pool  ${address}`);
    return;
  }
  const result = await commandMiner({
    data: {
      target: { id: miner.id, host: miner.host, port: miner.port, kind: miner.kind, token: miner.apiToken },
      command: { action: "pool", host: end.host, port: end.port, user },
    },
  }).catch(() => ({ ok: false, error: "no answer" }));
  useFleet.getState().tune(
    miner.id,
    { pool: address },
    result.ok ? `pool sent  ${address}` : `pool failed  ${result.error || "no answer"}`,
  );
}

async function checkWorker(miner: Miner) {
  const current = useFleet.getState().miners.find((row) => row.id === miner.id) ?? miner;
  const urls = poolUrls(current);
  const found = await resolvePoolCoins({ data: { pools: urls } }).catch(() => []);
  const coins = found.flatMap((row) => (row.coin ? [row.coin] : []));
  const unique = coins.filter((coin, index) => coins.findIndex((row) => row.ticker === coin.ticker) === index);
  if (unique.length === 0) {
    useFleet.getState().tune(current.id, {}, `pool not recognized, coin stays  ${current.coin}`);
    return;
  }
  const only = unique.length === 1 ? unique[0] : null;
  useFleet.getState().tune(
    current.id,
    only
      ? { workerCoins: [], coin: only.ticker, algo: only.algo }
      : { workerCoins: unique.map((coin) => coin.ticker) },
    only ? `pool  ${only.ticker}  ${only.algo}` : `pools on  ${unique.map((coin) => coin.ticker).join("  ")}`,
  );
}

function WorkerFields({ miner: m }: { miner: Miner }) {
  const tune = useFleet((s) => s.tune);
  return (
    <>
      <label className="mt-3 block text-xs text-muted">
        Worker
        <input
          key={`${m.id}:${m.worker}`}
          defaultValue={m.worker}
          onBlur={(e) => {
            const worker = e.target.value.trim();
            if (worker === m.worker) return;
            tune(m.id, { worker }, worker ? `worker  ${worker}` : "worker cleared");
          }}
          className="mt-1 h-11 w-full border border-line bg-bg px-2 font-mono text-sm text-fg outline-none focus:border-amber"
          aria-label="Worker"
          placeholder="account.worker"
          autoComplete="off"
        />
      </label>
      <button
        type="button"
        onClick={() => void checkWorker(m)}
        className="mt-2 h-11 rounded-lg border border-line px-3 text-sm"
      >
        Check pools
      </button>
      {m.workerCoins.length > 0 ? (
        <p className="mt-2 font-mono text-xs text-muted">Account coins: {m.workerCoins.join(" · ")}</p>
      ) : null}
    </>
  );
}

function TunePanel({ miner: m }: { miner: Miner }) {
  const tune = useFleet((s) => s.tune);
  const restart = useFleet((s) => s.restart);
  const removeMiner = useFleet((s) => s.removeMiner);
  const coinList = useCoinList();
  const [fan, setFan] = useState(m.fanPct);
  const [saved, setSaved] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const savedTimer = useRef(0);

  useEffect(() => {
    setFan(m.fanPct);
  }, [m.id, m.fanPct, m.fanAuto]);

  useEffect(() => {
    setSaved(false);
    setConfirmRemove(false);
    return () => window.clearTimeout(savedTimer.current);
  }, [m.id]);

  return (
    <div className="shrink-0 border-b border-line px-4 py-3">
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 truncate text-sm font-medium">Tune {m.name}</h2>
        <button
          type="button"
          onClick={() => {
            if (!confirmRemove) {
              setConfirmRemove(true);
              return;
            }
            removeMiner(m.id);
          }}
          className="inline-flex h-11 shrink-0 items-center gap-1 rounded-lg border border-fault px-3 text-sm text-fault"
          aria-label={confirmRemove ? "Confirm remove miner" : "Remove miner"}
        >
          <X className="size-4" />
          {confirmRemove ? "Remove" : null}
        </button>
        <a
          href={minerUrl(m)}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex h-11 shrink-0 items-center gap-1 rounded-lg bg-amber px-3 text-sm font-medium text-bg"
        >
          <ExternalLink className="size-4" />
          Open {m.host}
        </a>
      </div>
      <label className="mt-3 block text-xs text-muted">
        Pool
        <input
          key={`${m.id}:${m.pool}`}
          defaultValue={m.pool}
          onBlur={(e) => {
            const pool = e.target.value.trim();
            if (!pool || pool === m.pool) return;
            const nextPools = [pool, ...m.pools.filter((row) => row !== m.pool && row !== pool)];
            tune(m.id, { pool, pools: nextPools }, `pool  ${pool}`);
            void pushPool(m, pool);
            void resolvePoolCoin({ data: { pool } }).then((live) => {
              if (!live) return;
              const current = useFleet.getState().miners.find((miner) => miner.id === m.id);
              if (!current || current.pool !== pool) return;
              if (current.coin === live.ticker && current.algo === live.algo) return;
              tune(m.id, { coin: live.ticker, algo: live.algo }, `pool says  ${live.ticker}  ${live.algo}`);
            });
          }}
          className="mt-1 h-11 w-full border border-line bg-bg px-2 font-mono text-sm text-fg outline-none focus:border-amber"
          aria-label="Pool"
          placeholder="pool.example.com:3333"
          autoComplete="off"
        />
      </label>
      {fallbackPool(m) ? (
        <p className="mt-2 font-mono text-xs text-muted">
          Fallback {fallbackPool(m)}
          {m.onFallback ? " · in use" : " · standby"}
        </p>
      ) : null}
      {m.algo === "SHA-256" ? <ApplyShaPool miner={m} /> : null}
      {m.onFallback ? (
        <p className="mt-2 border border-fault bg-fault/10 px-2 py-2 text-sm text-fault">
          Warning: this miner is on its fallback pool, not the main pool.
        </p>
      ) : null}
      {m.kind === "hammer" ? (
        <label className="mt-3 block text-xs text-muted">
          API token, optional
          <input
            key={`${m.id}:${m.apiToken ? "set" : "empty"}`}
            type="password"
            defaultValue={m.apiToken}
            onBlur={(e) => {
              const apiToken = e.target.value.trim();
              if (apiToken === m.apiToken) return;
              tune(m.id, { apiToken }, apiToken ? "API token saved" : "API token cleared");
            }}
            className="mt-1 h-11 w-full border border-line bg-bg px-2 font-mono text-sm text-fg outline-none focus:border-amber"
            aria-label="THOR API token"
            placeholder="Leave blank for Thor X1, BC01, BC04, and DC02"
            autoComplete="off"
          />
        </label>
      ) : null}
      <WorkerFields miner={m} />
      <FloorField miner={m} />
      <label className="mt-3 block text-xs text-muted">
        Coin
        <select
          className="mt-1 h-11 w-full border border-line bg-bg px-2 text-sm text-fg outline-none focus:border-amber"
          aria-label="Coin"
          value={m.coin}
          onChange={(e) => {
            const next = findDutchCoin(e.target.value, coinList.coins);
            if (!next) return;
            tune(m.id, { coin: next.ticker, algo: next.algo }, `coin  ${next.ticker}  ${next.algo}`);
            void sendCoin(m, next);
          }}
        >
          {!findDutchCoin(m.coin, coinList.coins) ? (
            <option value={m.coin}>
              {m.coin} · {m.algo}
            </option>
          ) : null}
          <optgroup label="SHA-256">
            {coinList.coins
              .filter((c) => c.algo === "SHA-256")
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <option key={c.ticker} value={c.ticker}>
                  {c.name} ({c.ticker})
                </option>
              ))}
          </optgroup>
          <optgroup label="Scrypt">
            {coinList.coins
              .filter((c) => c.algo === "Scrypt")
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <option key={c.ticker} value={c.ticker}>
                  {c.name} ({c.ticker})
                </option>
              ))}
          </optgroup>
        </select>
        <span className="mt-1 block">
          {coinList.updatedAt > 0
            ? `Mining Dutch · synced ${format(coinList.updatedAt, "d MMM HH:mm")}`
            : "Mining Dutch · saved list"}
        </span>
      </label>
      <dl className="mt-3 grid grid-cols-2 gap-2">
        <Readout label="Best difficulty" value={m.online ? formatDiff(m.bestDiffN) : "—"} />
        <Readout
          label="Best share since power on"
          value={m.online ? formatDiff(m.bestSessionN) : "—"}
          hint={m.online ? formatUptime(m.uptimeSec) : undefined}
        />
        <Readout
          label="ASIC temperature"
          value={m.online && Number.isFinite(m.tempC) ? `${m.tempC.toFixed(1)}°C` : "—"}
          hot={m.online && m.tempC >= asicWarn(m)}
        />
        <Readout
          label="V-reg temperature"
          value={m.online && Number.isFinite(m.vrTempC) ? `${m.vrTempC.toFixed(1)}°C` : "—"}
          hot={m.online && m.vrTempC >= vrWarn(m)}
        />
      </dl>
      <div className="mt-3 grid gap-2">
        <Stepper
          label="ASIC warning"
          value={asicWarn(m)}
          unit="°C"
          step={1}
          min={45}
          max={100}
          onStep={(next) => tune(m.id, { asicWarnC: next }, `warn  asic ${next}°C`)}
        />
        <Stepper
          label="V-reg warning"
          value={vrWarn(m)}
          unit="°C"
          step={1}
          min={45}
          max={115}
          onStep={(next) => tune(m.id, { vrWarnC: next }, `warn  vreg ${next}°C`)}
        />
        <Stepper
          label="Pool latency"
          value={pingWarn(m)}
          unit="ms"
          step={5}
          min={0}
          max={250}
          onStep={(next) => tune(m.id, { pingWarnMs: next }, `warn  latency ${next} ms`)}
        />
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <Mini label="Fan" value={m.online ? `${m.fanRpm} rpm` : "—"} />
        <Mini label="ASIC measured" value={m.online ? `${m.asicVoltageMv} mV` : "—"} />
        <Mini label="Chips" value={m.asicCount === 1 ? "1 ASIC" : String(m.asicCount)} />
      </dl>
      <label className="mt-3 block text-xs text-muted">
        <span className="flex items-center gap-1">
          <Fan className="size-3.5" />
          Fan {fan}% {m.fanAuto ? "auto" : "manual"}
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={fan}
          aria-label="Fan speed"
          className="mt-1 h-11 w-full accent-amber"
          onChange={(e) => {
            const pct = Number(e.target.value);
            setFan(pct);
            tune(m.id, { fanPct: pct, fanAuto: false });
          }}
          onPointerUp={(e) => {
            const pct = Number(e.currentTarget.value);
            tune(m.id, { fanPct: pct, fanAuto: false }, `tune  fan ${pct}%  manual`);
          }}
          onKeyUp={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
            const pct = Number(e.currentTarget.value);
            tune(m.id, { fanPct: pct, fanAuto: false }, `tune  fan ${pct}%  manual`);
          }}
        />
      </label>
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          onClick={() => tune(m.id, { fanAuto: true }, "tune  fan auto")}
          className={`h-11 flex-1 rounded-lg border text-sm ${m.fanAuto ? "border-amber bg-raised text-fg" : "border-line text-muted"}`}
          aria-pressed={m.fanAuto}
        >
          Auto fan
        </button>
      </div>
      <div className="mt-3 grid gap-2">
        <button
          type="button"
          onClick={() => {
            setFan(100);
            tune(m.id, { fanPct: 100, fanAuto: false }, "tune  fan 100%  manual");
          }}
          className="h-11 rounded-lg border border-amber text-sm text-amber"
        >
          100% fan
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              const fanLabel = m.fanAuto ? "auto" : `${fan}%`;
              tune(
                m.id,
                {},
                `saved  fan ${fanLabel}  ${m.frequencyMhz} MHz  ${m.coreVoltageMv} mV`,
              );
              setSaved(true);
              window.clearTimeout(savedTimer.current);
              savedTimer.current = window.setTimeout(() => setSaved(false), 1600);
            }}
            className="h-11 rounded-lg bg-amber text-sm font-medium text-bg"
          >
            {saved ? "Saved" : "Save"}
          </button>
          <button
            type="button"
            disabled={m.bootSec > 0}
            onClick={() => restart(m.id)}
            className="h-11 rounded-lg border border-fault text-sm text-fault disabled:opacity-60"
          >
            {m.bootSec > 0 ? "Restarting" : "Restart"}
          </button>
        </div>
        <p className="text-xs text-muted">ESP-miner applies fan changes after a restart.</p>
      </div>
      <div className="mt-3 grid gap-2">
        {m.kind === "greenbit" ? (
          <p className="text-xs text-muted">Satboy has no frequency or voltage control. A pool change reboots it.</p>
        ) : (
        <Stepper
          label="Frequency"
          value={m.frequencyMhz}
          unit="MHz"
          step={m.kind === "tna-canaan" ? 50 : 25}
          min={m.kind === "hammer" ? 100 : m.kind === "tna-canaan" ? 100 : 200}
          max={m.kind === "hammer" ? 1200 : m.kind === "tna-canaan" ? 600 : m.kind === "harlo" ? 4000 : 900}
          onStep={(next) => tune(m.id, { frequencyMhz: next }, `tune  frequency ${next} MHz`)}
        />
        )}
        {m.kind === "greenbit" ? null : m.kind === "hammer" ? (
          <Stepper
            label="Core voltage"
            value={Math.round(m.coreVoltageMv) / 1000}
            unit="V"
            step={0.01}
            min={0.8}
            max={1.6}
            onStep={(next) => {
              const volts = Math.round(next * 100) / 100;
              tune(m.id, { coreVoltageMv: Math.round(volts * 1000) }, `tune  core ${volts.toFixed(2)} V`);
            }}
          />
        ) : (
          <Stepper
            label="Core voltage"
            value={m.coreVoltageMv}
            unit="mV"
            step={m.kind === "tna-canaan" ? 50 : 10}
            min={m.kind === "tna-canaan" ? 3100 : 800}
            max={m.kind === "tna-canaan" ? 3900 : 1600}
            onStep={(next) => tune(m.id, { coreVoltageMv: next }, `tune  core ${next} mV`)}
          />
        )}
      </div>
    </div>
  );
}

function Readout({
  label,
  value,
  hint,
  hot,
}: {
  label: string;
  value: string;
  hint?: string;
  hot?: boolean;
}) {
  return (
    <div className="rounded-lg border border-line bg-bg px-3 py-2">
      <dt className="text-xs leading-snug text-muted">{label}</dt>
      <dd className={`mt-1 font-mono text-lg tabular-nums ${hot ? "text-fault" : "text-fg"}`}>{value}</dd>
      {hint ? <p className="font-mono text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

function Stepper({
  label,
  value,
  unit,
  step,
  min,
  max,
  onStep,
}: {
  label: string;
  value: number;
  unit: string;
  step: number;
  min: number;
  max: number;
  onStep: (next: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted">{label}</p>
        <p className="font-mono text-base tabular-nums">
          {value} <span className="text-xs text-muted">{unit}</span>
        </p>
      </div>
      <button
        type="button"
        className="h-11 w-11 rounded-lg border border-line text-lg"
        aria-label={`Decrease ${label}`}
        onClick={() => onStep(Math.max(min, value - step))}
      >
        −
      </button>
      <button
        type="button"
        className="h-11 w-11 rounded-lg border border-line text-lg"
        aria-label={`Increase ${label}`}
        onClick={() => onStep(Math.min(max, value + step))}
      >
        +
      </button>
    </div>
  );
}

function Mini({ label, value, hot }: { label: string; value: string; hot?: boolean }) {
  return (
    <div>
      <dt className="text-muted">{label}</dt>
      <dd className={`font-mono tabular-nums ${hot ? "text-fault" : "text-fg"}`}>{value}</dd>
    </div>
  );
}


function ScanNetwork() {
  const scan = useScanState();
  return (
    <button
      type="button"
      onClick={() => startScan({ add: true })}
      disabled={scan.scanning}
      className="inline-flex h-11 items-center rounded-lg bg-amber px-3 text-sm font-medium text-bg disabled:opacity-60"
      aria-busy={scan.scanning}
    >
      {scan.scanning ? "Scanning" : "Scan"}
    </button>
  );
}

function ScanNote() {
  const scan = useScanState();
  if (!scan.note) return null;
  return <p className="mt-2 font-mono text-xs text-muted">{scan.note}</p>;
}

function FleetSettings() {
  const saved = useFleet((s) => s.scanSubnet);
  const setScanSubnet = useFleet((s) => s.setScanSubnet);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(saved);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setValue(saved);
      setError("");
    }
  }, [open, saved]);

  function save(e: FormEvent) {
    e.preventDefault();
    const parsed = parseScanSubnet(value);
    if (!parsed) {
      setError("Use a private /24, like 192.168.1.0/24. Leave it blank to scan this Pi.");
      return;
    }
    setScanSubnet(parsed.label === "" ? "" : parsed.label);
    setOpen(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="inline-flex size-11 items-center justify-center rounded-lg border border-line text-fg"
          aria-label="Settings"
        >
          <Settings className="size-4" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-bg/80" />
        <Dialog.Content className="fixed inset-x-4 top-4 z-50 mx-auto w-full max-w-md rounded-lg border border-line bg-surface p-4 text-fg">
          <Dialog.Title className="text-base font-semibold">Settings</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-muted">
            Blank scans the network this Pi is on. Set a subnet when a board is on another range.
          </Dialog.Description>
          <form onSubmit={save} className="mt-4">
            <label className="block text-sm">
              <span className="text-muted">Scan subnet</span>
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 font-mono outline-none focus:border-amber"
                placeholder="192.168.1.0/24"
                aria-label="Scan subnet"
                autoComplete="off"
              />
            </label>
            {error ? <p className="mt-2 text-sm text-fault">{error}</p> : null}
            <div className="mt-4 flex justify-end gap-2">
              <Dialog.Close className="h-11 rounded-lg border border-line px-3 text-sm">Cancel</Dialog.Close>
              <button type="submit" className="h-11 rounded-lg bg-amber px-3 text-sm font-medium text-bg">
                Save
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function AddMiner() {
  const addMiner = useFleet((s) => s.addMiner);
  const minerCount = useFleet((s) => s.miners.length);
  const removeAll = useFleet((s) => s.removeAll);
  const scan = useScanState();
  const [open, setOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [kind, setKind] = useState<MinerKind>("esp-miner");
  const [port, setPort] = useState("80");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) startScan({ add: false });
    else setConfirmClear(false);
  }, [open]);

  function choose(next: MinerKind) {
    setKind(next);
    setPort(String(defaultPort(next)));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const portNum = Number(port);
    if (!name.trim() || !host.trim()) {
      setError("Name and address are required.");
      return;
    }
    if (!Number.isFinite(portNum) || portNum < 1 || portNum > 65535) {
      setError("Port must be between 1 and 65535.");
      return;
    }
    addMiner({ name, host, kind, port: portNum, apiToken: kind === "hammer" ? token.trim() : "" });
    setName("");
    setHost("");
    setToken("");
    setError("");
    setOpen(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="inline-flex h-11 items-center gap-1 rounded-lg bg-amber px-3 text-sm font-medium text-bg"
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">Add</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-bg/80" />
        <Dialog.Content className="fixed inset-x-4 top-4 z-50 mx-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-lg border border-line bg-surface p-4 text-fg">
          <Dialog.Title className="shrink-0 text-base font-semibold">Add a miner</Dialog.Title>
          <Dialog.Description className="mt-1 shrink-0 text-sm text-muted">
            {scan.scanning
              ? "Searching the network…"
              : scan.note || "Or type an address. The port follows the miner type."}
          </Dialog.Description>
          <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
          {scan.result && scan.result.miners.length > 0 ? (
            <ul className="max-h-32 overflow-y-auto border border-line">
              {scan.result.miners.map((miner) => (
                <li key={`${miner.host}:${miner.port}`}>
                  <button
                    type="button"
                    className="flex h-11 w-full items-center gap-2 px-2 text-left text-sm hover:bg-raised"
                    onClick={() => {
                      setName(minerLabel(miner.name));
                      setHost(miner.host);
                      setKind(miner.kind);
                      setPort(String(miner.port));
                      setError("");
                    }}
                  >
                    <span className="font-mono text-xs text-amber">{KIND_LABEL[miner.kind]}</span>
                    <span className="truncate">{minerLabel(miner.name)}</span>
                    <span className="ml-auto font-mono text-xs text-muted">{miner.host}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
            <label className="text-sm">
              <span className="text-muted">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 outline-none focus:border-amber"
                placeholder="gamma-03"
                autoComplete="off"
              />
            </label>
            <label className="text-sm">
              <span className="text-muted">Address</span>
              <input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 font-mono outline-none focus:border-amber"
                placeholder="192.168.4.23"
                autoComplete="off"
              />
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <KindButton current={kind} value="esp-miner" label="Bitaxe / ESP" onChoose={choose} />
              <KindButton current={kind} value="cgminer" label="cgminer" onChoose={choose} />
              <KindButton current={kind} value="avalon" label="Avalon Nano" onChoose={choose} />
              <KindButton current={kind} value="tna-canaan" label="Avalon TNA" onChoose={choose} />
              <KindButton current={kind} value="hammer" label="Hammer" onChoose={choose} />
              <KindButton current={kind} value="harlo" label="Harlo" onChoose={choose} />
              <KindButton current={kind} value="greenbit" label="Satboy" onChoose={choose} />
            </div>
            <label className="text-sm">
              <span className="text-muted">Port</span>
              <input
                value={port}
                onChange={(e) => setPort(e.target.value)}
                inputMode="numeric"
                className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 font-mono outline-none focus:border-amber"
              />
            </label>
            {kind === "hammer" ? (
              <label className="text-sm">
                <span className="text-muted">API token</span>
                <input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  type="password"
                  className="mt-1 h-11 w-full rounded-lg border border-line bg-bg px-3 font-mono outline-none focus:border-amber"
                  placeholder="Leave blank unless the board asks"
                  autoComplete="off"
                />
              </label>
            ) : null}
            {error ? <p className="text-sm text-fault">{error}</p> : null}
            <div className="flex items-center gap-2 pt-1">
              {minerCount > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (!confirmClear) {
                      setConfirmClear(true);
                      return;
                    }
                    removeAll();
                    setConfirmClear(false);
                    setOpen(false);
                  }}
                  className="h-11 rounded-lg border border-fault px-3 text-sm text-fault"
                >
                  {confirmClear ? "Confirm clear" : "Remove all"}
                </button>
              ) : null}
              <Dialog.Close type="button" className="ml-auto h-11 rounded-lg px-3 text-sm text-muted">
                Cancel
              </Dialog.Close>
              <button type="submit" className="h-11 rounded-lg bg-amber px-4 text-sm font-medium text-bg">
                Save on display
              </button>
            </div>
          </form>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function KindButton({
  current,
  value,
  label,
  onChoose,
}: {
  current: MinerKind;
  value: MinerKind;
  label: string;
  onChoose: (k: MinerKind) => void;
}) {
  const on = current === value;
  return (
    <button
      type="button"
      onClick={() => onChoose(value)}
      className={`h-11 rounded-lg border text-sm ${on ? "border-amber bg-raised text-fg" : "border-line text-muted"}`}
      aria-pressed={on}
    >
      {label}
    </button>
  );
}
