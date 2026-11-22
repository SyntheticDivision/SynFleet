import type { LinkKind } from "@/lib/miner-link";

export type FoundMiner = {
  host: string;
  port: number;
  kind: LinkKind;
  name: string;
  firmware?: string;
};

export type DiscoverResult = {
  subnet: string;
  miners: FoundMiner[];
  error?: string;
};

export function isPrivateIPv4(address: string): boolean {
  const [a, b] = address.split(".").map(Number);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

/** Avalon Nano 3s and Avalon Q running TNA-OS. Not stock cgminer. */
export function isTnaOsText(text: string): boolean {
  return /a3197s|tna-os|avalon nano|avalon q|nano 3s|nano3s/i.test(text);
}

export function subnet24(address: string): { label: string; hosts: string[] } | null {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  const prefix = parts.slice(0, 3).join(".");
  const hosts: string[] = [];
  for (let i = 1; i <= 254; i++) {
    if (i === parts[3]) continue;
    hosts.push(`${prefix}.${i}`);
  }
  return { label: `${prefix}.0/24`, hosts };
}

/** One private /24. Blank means "use this machine's own network". */
export function parseScanSubnet(text: string): { label: string; hosts: string[] } | null {
  const trimmed = text.trim();
  if (!trimmed) return { label: "", hosts: [] };
  const match = trimmed.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\.(\d{1,3}))?(?:\/24)?$/);
  if (!match) return null;
  const nums = [match[1], match[2], match[3], match[4] ?? "1"].map(Number);
  if (nums.some((n) => n > 255)) return null;
  const ip = nums.join(".");
  if (!isPrivateIPv4(ip)) return null;
  const prefix = nums.slice(0, 3).join(".");
  const hosts: string[] = [];
  for (let i = 1; i <= 254; i++) hosts.push(`${prefix}.${i}`);
  return { label: `${prefix}.0/24`, hosts };
}
