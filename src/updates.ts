import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { UpdateState } from "./shared/contracts.ts";
import { RELEASES_URL } from "./shared/version.ts";

export const UPDATE_INTERVAL = 24 * 60 * 60 * 1000;
const API_URL = "https://api.github.com/repos/kortexa-ai/sideleaf.desktop/releases/latest";
const MAX_RESPONSE = 1024 * 1024;
type Cache = { checkedAt: number; version?: string; dismissed?: string };
export type ReleaseFetch = (url: string, options: RequestInit) => Promise<Response>;

function versionParts(value: unknown): number[] | null {
  if (typeof value !== "string" || !/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return null;
  const parts = value.replace(/^v/, "").split(".").map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}

export function isNewerVersion(candidate: unknown, installed: string): boolean {
  const next = versionParts(candidate), current = versionParts(installed);
  if (!next || !current) return false;
  for (let index = 0; index < 3; index++) {
    if (next[index] !== current[index]) return next[index]! > current[index]!;
  }
  return false;
}

export function releaseVersion(value: unknown): string {
  if (!value || typeof value !== "object") throw new Error("Invalid release response.");
  const release = value as { tag_name?: unknown; draft?: unknown; prerelease?: unknown; html_url?: unknown };
  if (release.draft !== false || release.prerelease !== false || typeof release.tag_name !== "string" ||
      !release.tag_name.startsWith("v") || !versionParts(release.tag_name) ||
      release.html_url !== `${RELEASES_URL}/tag/${release.tag_name}`) throw new Error("Invalid stable release.");
  return release.tag_name.slice(1);
}

export class UpdateChecker {
  private cache: Cache = { checkedAt: 0 };
  private state: UpdateState = { status: "idle" };
  private pending: Promise<UpdateState> | null = null;
  private manualRequested = false;
  private lastAttempt = 0;
  private lastAttemptSucceeded = false;
  private readonly options: {
    installedVersion: string;
    cachePath: string;
    onChange: (state: UpdateState) => void;
    fetch?: ReleaseFetch;
    now?: () => number;
  };

  constructor(options: UpdateChecker["options"]) {
    this.options = options;
    try {
      const text = readFileSync(options.cachePath, "utf8");
      if (text.length > 4096) throw new Error("Invalid update cache.");
      const value = JSON.parse(text) as Cache;
      if (Number.isFinite(value.checkedAt) && value.checkedAt >= 0) {
        this.cache = { checkedAt: value.checkedAt };
        if (versionParts(value.version)) this.cache.version = value.version;
        if (versionParts(value.dismissed)) this.cache.dismissed = value.dismissed;
      }
    } catch { /* Missing or damaged update preferences must not affect documents. */ }
    this.state = this.available() ?? { status: "idle" };
  }

  snapshot(): UpdateState { return this.state; }

  private available(manual = false): UpdateState | null {
    const { version, dismissed } = this.cache;
    return version && isNewerVersion(version, this.options.installedVersion) && (manual || version !== dismissed)
      ? { status: "available", version, url: `${RELEASES_URL}/tag/v${version}` } : null;
  }

  private publish(state: UpdateState): UpdateState {
    this.state = state;
    this.options.onChange(state);
    return state;
  }

  private saveCache() {
    const temporary = `${this.options.cachePath}.${process.pid}.tmp`;
    try {
      mkdirSync(dirname(this.options.cachePath), { recursive: true });
      writeFileSync(temporary, JSON.stringify(this.cache) + "\n", { mode: 0o600, flag: "wx" });
      renameSync(temporary, this.options.cachePath);
    } catch { /* Update preferences are optional; document saves use their own protocol. */ }
    finally { try { unlinkSync(temporary); } catch { /* The rename normally removed it. */ } }
  }

  dismiss(): boolean {
    if (this.state.status === "available") { this.cache.dismissed = this.state.version; this.saveCache(); }
    this.publish({ status: "idle" });
    return true;
  }

  check(manual = false): Promise<UpdateState> {
    if (this.pending) {
      if (manual) { this.manualRequested = true; this.publish({ status: "checking" }); }
      return this.pending;
    }
    const now = (this.options.now ?? Date.now)();
    const age = now - this.cache.checkedAt;
    if (!manual && this.cache.checkedAt && age >= 0 && age < UPDATE_INTERVAL) return Promise.resolve(this.state);
    // Coalesce rapid menu/bridge requests as well as scheduled checks.
    if (this.lastAttempt && now - this.lastAttempt >= 0 && now - this.lastAttempt < 60_000) {
      return Promise.resolve(this.publish(this.available(manual) ?? (manual
        ? { status: this.lastAttemptSucceeded ? "current" : "error" } : this.state)));
    }
    this.lastAttempt = now;
    this.lastAttemptSucceeded = false;
    this.cache.checkedAt = now;
    this.saveCache();
    this.manualRequested = manual;
    if (manual) this.publish({ status: "checking" });
    this.pending = this.request().finally(() => { this.pending = null; this.manualRequested = false; });
    return this.pending;
  }

  private async request(): Promise<UpdateState> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      // The pinned Cottontail runtime can fail to decode GitHub's gzip body.
      // This small metadata response can bypass that decoder with identity encoding.
      const response = await (this.options.fetch ?? globalThis.fetch)(API_URL, {
        headers: { Accept: "application/vnd.github+json", "Accept-Encoding": "identity", "User-Agent": "Sideleaf", "X-GitHub-Api-Version": "2022-11-28" },
        redirect: "error", signal: controller.signal,
      });
      if (!response.ok) throw new Error("Release service unavailable.");
      if (Number(response.headers.get("content-length")) > MAX_RESPONSE) throw new Error("Release response too large.");
      const text = await response.text();
      if (text.length > MAX_RESPONSE) throw new Error("Release response too large.");
      this.cache.version = releaseVersion(JSON.parse(text));
      this.lastAttemptSucceeded = true;
      this.saveCache();
      return this.publish(this.available(this.manualRequested) ?? { status: this.manualRequested ? "current" : "idle" });
    } catch {
      return this.publish(this.available(this.manualRequested) ?? { status: this.manualRequested ? "error" : "idle" });
    } finally { clearTimeout(timeout); }
  }
}
