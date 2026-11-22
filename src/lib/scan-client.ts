import { useSyncExternalStore } from "react";
import { discoverMiners } from "@/lib/discover.functions";
import type { DiscoverResult } from "@/lib/discover";
import { useFleet } from "@/lib/fleet";

export type ScanState = {
  scanning: boolean;
  result: DiscoverResult | null;
  note: string;
};

let state: ScanState = { scanning: false, result: null, note: "" };
let scannedAt = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function setState(next: ScanState) {
  state = next;
  emit();
}

export function useScanState(): ScanState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}

export function startScan(opts?: { add?: boolean }) {
  if (state.scanning) return;
  const add = opts?.add !== false;
  if (!add && state.result && Date.now() - scannedAt < 20000) return;
  setState({ ...state, scanning: true, note: "Searching the network" });
  void discoverMiners({ data: { subnet: useFleet.getState().scanSubnet } })
    .then((result) => {
      scannedAt = Date.now();
      const added = add ? useFleet.getState().addDiscovered(result.miners) : 0;
      const note = result.error
        ? result.error
        : result.miners.length === 0
          ? `No miners on ${result.subnet}`
          : add
            ? `Found ${result.miners.length} on ${result.subnet}, added ${added}`
            : `Found ${result.miners.length} on ${result.subnet}`;
      setState({ scanning: false, result, note });
    })
    .catch(() => {
      setState({ scanning: false, result: state.result, note: "Scan failed" });
    });
}
