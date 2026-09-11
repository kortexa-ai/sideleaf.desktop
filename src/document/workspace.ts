import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, opendirSync, realpathSync, statSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname, extname, isAbsolute, join, relative, sep } from "node:path";
import { DocumentFile } from "./files.ts";
import { SaveTransfer } from "./save-transfer.ts";
import type { FolderListing, OpenResult, WorkspaceInfo } from "../shared/contracts.ts";

const extensions = new Set([".md", ".markdown", ".mdown", ".txt"]);
const hiddenDirectories = new Set(["node_modules", "$RECYCLE.BIN", "System Volume Information"]);
const order = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
export const MAX_DIRECTORY_ENTRIES = 10_000;
export const MAX_WATCHED_DIRECTORIES = 64;
export type DocumentSession = { file: DocumentFile; transfer: SaveTransfer; dirty: boolean; recoveredFrom?: { path: string | null; revision: string | null } };

/** One user-selected root; no recursive scan or arbitrary renderer filesystem API. */
export class FolderRoot {
  readonly id = randomUUID();
  readonly path: string;
  private readonly identity: string;
  private watchers = new Map<string, FSWatcher>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  constructor(path: string, private changed: (id: string) => void = () => {}) {
    this.path = realpathSync(path);
    const stat = lstatSync(this.path);
    if (!stat.isDirectory()) throw new Error("Choose a folder to open.");
    this.identity = `${stat.dev}:${stat.ino}`;
  }
  resolve(key: string, kind?: "directory" | "file"): string {
    if (typeof key !== "string" || key.length > 32_768 || key.includes("\0") || isAbsolute(key) ||
      key.split(/[\\/]/).some((part) => part === ".." || part === ".")) throw new Error("Invalid folder entry.");
    const rootStat = lstatSync(this.path);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || `${rootStat.dev}:${rootStat.ino}` !== this.identity || realpathSync(this.path) !== this.path) {
      throw new Error("This folder moved or was replaced. Open the folder again.");
    }
    const candidate = join(this.path, key);
    const canonical = realpathSync(candidate);
    const rel = relative(this.path, canonical);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) throw new Error("This entry points outside the open folder.");
    // Do not traverse directory links/junctions. This prevents cycles and keeps
    // the visible hierarchy stable even when a link changes between requests.
    let parent = this.path;
    for (const part of key.split(/[\\/]/).filter(Boolean)) {
      parent = join(parent, part);
      if (lstatSync(parent).isSymbolicLink()) throw new Error("Links are not browsed in the folder tree. Open the target directly.");
    }
    const stat = lstatSync(canonical);
    if (kind === "directory" && !stat.isDirectory()) throw new Error("This folder is no longer available.");
    if (kind === "file" && (!stat.isFile() || !extensions.has(extname(canonical).toLowerCase()))) throw new Error("Choose a supported text document.");
    return canonical;
  }
  list(key: string): FolderListing {
    const result: FolderListing = { workspaceId: this.id, key, entries: [], error: null, truncated: false };
    try {
      const path = this.resolve(key, "directory");
      const directory = opendirSync(path);
      try {
        let count = 0;
        for (let item = directory.readSync(); item; item = directory.readSync()) {
          if (++count > MAX_DIRECTORY_ENTRIES) { result.truncated = true; break; }
          if (item.name.startsWith(".") || item.isSymbolicLink()) continue;
          const kind = item.isDirectory() ? "directory" : item.isFile() && extensions.has(extname(item.name).toLowerCase()) ? "file" : null;
          if (!kind || (kind === "directory" && hiddenDirectories.has(item.name))) continue;
          result.entries.push({ key: key ? `${key}/${item.name}` : item.name, name: item.name, kind, path: join(path, item.name) });
        }
      } finally { directory.closeSync(); }
      result.entries.sort((a, b) => Number(b.kind === "directory") - Number(a.kind === "directory") || order.compare(a.name, b.name) || a.name.localeCompare(b.name));
    } catch (error) { result.error = (error as Error).message; }
    return result;
  }
  watch(keys: string[]) {
    if (!Array.isArray(keys) || keys.length > MAX_WATCHED_DIRECTORIES || keys.some((key) => typeof key !== "string")) throw new Error("Too many watched folders.");
    const wanted = new Set(keys);
    for (const [key, watcher] of this.watchers) if (!wanted.has(key)) { watcher.close(); this.watchers.delete(key); }
    for (const key of wanted) if (!this.watchers.has(key)) {
      try {
        const watcher = watch(this.resolve(key, "directory"), { persistent: false }, () => this.notify());
        watcher.on("error", () => { watcher.close(); this.watchers.delete(key); this.notify(); });
        this.watchers.set(key, watcher);
      } catch { /* Visible-directory refresh also covers unavailable native/WSL watches. */ }
    }
  }
  notify() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.changed(this.id), 180);
  }
  close() { clearTimeout(this.timer); for (const watcher of this.watchers.values()) watcher.close(); this.watchers.clear(); }
}

/** Host sessions remain addressable while their editor is inactive. */
export class DocumentWorkspace {
  readonly sessions = new Map<string, DocumentSession>();
  root: FolderRoot | null = null;
  explicit = false;
  activeId: string | null = null;
  private emptyId = randomUUID();
  constructor(private changed: (id: string) => void = () => {}) {}
  info(): WorkspaceInfo { return { id: this.root?.id ?? this.emptyId, root: this.root?.path ?? null, name: this.root ? basename(this.root.path) : "Sideleaf", explicit: this.explicit, activeId: this.activeId }; }
  result(): OpenResult { return { workspace: this.info(), document: this.activeId ? this.get(this.activeId).file.snapshot() : null }; }
  get(id: string): DocumentSession {
    const session = this.sessions.get(id);
    if (typeof id !== "string" || !session) throw new Error("This document was closed. Please try again.");
    return session;
  }
  folder(id: string): FolderRoot {
    if (!this.root || id !== this.root.id) throw new Error("This request belongs to an earlier folder.");
    return this.root;
  }
  add(file: DocumentFile) {
    if (file.path) {
      const existing = [...this.sessions.values()].find((session) => session.file.path === file.path);
      if (existing) { this.activeId = existing.file.id; return existing; }
    }
    if (this.sessions.size >= 64) throw new Error("64 documents are already open. Close a document before opening another; all edits have been retained.");
    const session: DocumentSession = { file, transfer: new SaveTransfer(), dirty: false };
    this.sessions.set(file.id, session); this.activeId = file.id; return session;
  }
  open(path: string): OpenResult {
    if (statSync(path).isDirectory()) return this.openFolder(path);
    const canonical = realpathSync(path);
    const existing = this.explicit && [...this.sessions.values()].find((session) => session.file.path === canonical);
    if (existing) { this.activeId = existing.file.id; return this.result(); }
    const file = DocumentFile.open(canonical);
    if (!this.explicit) { const root = new FolderRoot(dirname(canonical), this.changed); this.reset(); this.root = root; }
    this.add(file); return this.result();
  }
  openFolder(path: string): OpenResult {
    const root = new FolderRoot(path, this.changed);
    this.reset(); this.root = root; this.explicit = true; return this.result();
  }
  openEntry(workspaceId: string, key: string): OpenResult {
    const path = this.folder(workspaceId).resolve(key, "file");
    const existing = [...this.sessions.values()].find((session) => session.file.path === path);
    const file = existing?.file ?? DocumentFile.open(path);
    this.explicit = true; this.add(file); return this.result();
  }
  newDocument(): OpenResult { if (!this.explicit) this.reset(); this.add(new DocumentFile()); return this.result(); }
  activate(id: string) { this.get(id); this.activeId = id; return this.info(); }
  closeDocument(id: string): OpenResult {
    this.get(id).transfer.clear(); this.sessions.delete(id);
    if (this.activeId === id) this.activeId = [...this.sessions.keys()].at(-1) ?? null;
    if (!this.sessions.size && !this.explicit) return this.newDocument();
    return this.result();
  }
  refreshRootAfterSave(id: string) {
    const path = this.get(id).file.path;
    if (!this.explicit && path && this.root?.path !== dirname(path)) {
      const root = new FolderRoot(dirname(path), this.changed); this.root?.close(); this.root = root;
    }
    this.root?.notify();
  }
  assertSaveTarget(id: string, target: string) {
    const canonical = existsSync(target) ? realpathSync(target) : join(realpathSync(dirname(target)), basename(target));
    if ([...this.sessions.values()].some((session) => session.file.id !== id && session.file.path === canonical)) throw new Error("That file is already open. Switch to its document before saving it.");
  }
  get dirty() { return [...this.sessions.values()].some((session) => session.dirty); }
  reset() {
    this.root?.close(); this.root = null; this.explicit = false; this.activeId = null; this.emptyId = randomUUID();
    for (const session of this.sessions.values()) session.transfer.clear(); this.sessions.clear();
  }
}
