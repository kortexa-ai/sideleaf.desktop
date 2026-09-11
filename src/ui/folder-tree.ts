import type { FolderEntry, FolderListing, WorkspaceInfo } from "../shared/contracts.ts";

export type OpenDocumentItem = { id: string; name: string; path: string | null; dirty: boolean; conflict: boolean; active: boolean };
type Actions = {
  list: (workspaceId: string, key: string) => Promise<FolderListing>;
  watch: (workspaceId: string, keys: string[]) => Promise<unknown>;
  open: (key: string) => void;
  activate: (id: string) => void;
  close: (id: string) => void;
  fileAction: (target: { key: string } | { id: string }, action: "rename" | "trash") => void;
};

export class FolderTree {
  private workspace: WorkspaceInfo | null = null;
  private expanded = new Set([""]);
  private listings = new Map<string, FolderListing>();
  private pending = new Set<string>();
  private visible = false;
  private documents: OpenDocumentItem[] = [];
  private activePath: string | null = null;
  private focusKey = "";
  private typeAhead = "";
  private typeAt = 0;
  private revision = 0;
  private documentKey = "";
  selectedDirectory = "";
  constructor(private tree: HTMLElement, private openDocuments: HTMLElement, private actions: Actions) {
    tree.setAttribute("role", "tree"); tree.setAttribute("aria-label", "Folder files");
    tree.addEventListener("keydown", (event) => this.keydown(event));
  }
  setWorkspace(workspace: WorkspaceInfo) {
    if (this.workspace?.id === workspace.id && this.workspace.root === workspace.root) { this.workspace = workspace; return; }
    if (workspace.id !== this.workspace?.id) {
      this.revision++; this.expanded = new Set([""]); this.listings.clear(); this.pending.clear();
      this.selectedDirectory = ""; this.focusKey = ""; this.tree.scrollTop = 0;
    }
    this.workspace = workspace;
    this.render(); if (this.visible) void this.refresh();
  }
  setVisible(visible: boolean) {
    if (this.visible === visible) return;
    this.visible = visible;
    if (visible) void this.refresh();
    else if (this.workspace?.root) void this.actions.watch(this.workspace.id, []).catch(() => {});
  }
  setDocuments(documents: OpenDocumentItem[]) {
    const key = JSON.stringify(documents);
    if (key === this.documentKey) return;
    this.documentKey = key;
    this.documents = documents; this.activePath = documents.find((item) => item.active)?.path ?? null;
    this.renderOpenDocuments(); this.render();
  }
  async reveal(path: string | null) {
    if (!path || !this.workspace?.root) return;
    const root = this.workspace.root.replaceAll("\\", "/").replace(/\/$/, "") + "/";
    const normalized = path.replaceAll("\\", "/");
    if (!normalized.startsWith(root)) return;
    const parts = normalized.slice(root.length).split("/");
    let key = "";
    for (const part of parts.slice(0, -1)) { key = key ? `${key}/${part}` : part; this.expanded.add(key); }
    if (this.visible) await this.refresh();
  }
  async refresh() {
    if (!this.visible || !this.workspace?.root) return;
    const id = this.workspace.id, revision = this.revision;
    let changed = false;
    const keys = [...this.expanded].filter((key) => !key || this.ancestorsExpanded(key));
    for (const key of keys) {
      if (this.pending.has(key)) continue;
      this.pending.add(key);
      try {
        const listing = await this.actions.list(id, key);
        if (this.workspace?.id === id && this.revision === revision && JSON.stringify(this.listings.get(key)) !== JSON.stringify(listing)) { this.listings.set(key, listing); changed = true; }
      } catch (error) {
        if (this.workspace?.id === id && this.revision === revision) { this.listings.set(key, { workspaceId: id, key, entries: [], truncated: false, error: (error as Error).message }); changed = true; }
      } finally { if (this.revision === revision) this.pending.delete(key); }
    }
    if (this.workspace?.id !== id || this.revision !== revision) return;
    if (changed) this.render();
    void this.actions.watch(id, this.visible ? keys.slice(0, 64) : []).catch(() => {});
  }
  private ancestorsExpanded(key: string) {
    const parts = key.split("/"); parts.pop(); let ancestor = "";
    for (const part of parts) { ancestor = ancestor ? `${ancestor}/${part}` : part; if (!this.expanded.has(ancestor)) return false; }
    return true;
  }
  private rows(): { entry: FolderEntry; level: number }[] {
    const rows: { entry: FolderEntry; level: number }[] = [];
    const append = (key: string, level: number) => {
      for (const entry of this.listings.get(key)?.entries ?? []) {
        rows.push({ entry, level });
        if (entry.kind === "directory" && this.expanded.has(entry.key)) append(entry.key, level + 1);
      }
    };
    append("", 1); return rows;
  }
  private render() {
    const focused = this.tree.contains(document.activeElement);
    const rows = this.rows(), fragment = document.createDocumentFragment();
    for (const { entry, level } of rows) {
      const button = document.createElement("button"); button.className = "folder-entry";
      button.dataset.key = entry.key; button.dataset.kind = entry.kind;
      button.setAttribute("role", "treeitem"); button.setAttribute("aria-level", String(level));
      button.style.paddingInlineStart = `${8 + (level - 1) * 16}px`;
      const opened = this.documents.find((item) => item.path === entry.path);
      button.setAttribute("aria-selected", String(entry.path === this.activePath));
      if (entry.kind === "directory") button.setAttribute("aria-expanded", String(this.expanded.has(entry.key)));
      button.tabIndex = entry.key === this.focusKey || !this.focusKey && entry === rows[0]?.entry ? 0 : -1;
      const icon = document.createElement("span"); icon.className = "folder-entry-icon"; icon.setAttribute("aria-hidden", "true");
      icon.textContent = entry.kind === "directory" ? this.expanded.has(entry.key) ? "▾" : "▸" : "¶";
      const label = document.createElement("span"); label.className = "folder-entry-name"; label.textContent = entry.name;
      button.append(icon, label);
      if (opened?.dirty || opened?.conflict) { const status = document.createElement("span"); status.textContent = opened.conflict ? "!" : "●"; status.className = "folder-state"; status.setAttribute("aria-label", opened.conflict ? "Changed on disk" : "Unsaved changes"); button.append(status); }
      button.title = entry.path;
      button.onfocus = () => { this.focusKey = entry.key; this.tree.querySelectorAll<HTMLElement>("[role=treeitem]").forEach((item) => { item.tabIndex = item === button ? 0 : -1; }); };
      button.onclick = () => { this.focusKey = entry.key; if (entry.kind === "directory") void this.toggle(entry.key); else { this.selectedDirectory = entry.key.split("/").slice(0, -1).join("/"); this.actions.open(entry.key); } };
      if (entry.kind === "file") button.oncontextmenu = (event) => { event.preventDefault(); this.contextMenu(button, { key: entry.key }); };
      fragment.append(button);
      if (entry.kind === "directory" && this.expanded.has(entry.key)) {
        const listing = this.listings.get(entry.key);
        if (listing?.error || listing?.truncated || listing && !listing.entries.length) fragment.append(this.message(listing.error ?? (listing.truncated ? "Large folder: showing the first entries." : "No supported documents"), level + 1));
      }
    }
    const root = this.listings.get("");
    if (root?.error) { fragment.prepend(this.message(root.error)); const retry = document.createElement("button"); retry.textContent = "Retry"; retry.onclick = () => { void this.refresh(); }; fragment.append(retry); }
    else if (!rows.length) fragment.append(this.message(root ? "No Markdown or text files in this folder." : "Loading folder…"));
    if (root?.truncated) fragment.append(this.message("Large folder: showing the first entries."));
    this.tree.replaceChildren(fragment);
    if (focused) this.tree.querySelector<HTMLElement>("[tabindex='0']")?.focus({ preventScroll: true });
  }
  private message(text: string, level = 1) { const p = document.createElement("p"); p.className = "folder-message"; p.style.paddingInlineStart = `${10 + (level - 1) * 16}px`; p.textContent = text; return p; }
  private renderOpenDocuments() {
    this.openDocuments.replaceChildren();
    for (const item of this.documents) {
      const row = document.createElement("div"); row.className = "open-document";
      const button = document.createElement("button"); button.className = "open-document-name";
      button.textContent = `${item.conflict ? "! " : item.dirty ? "● " : ""}${item.name}`;
      button.setAttribute("aria-current", String(item.active)); button.title = item.path ?? "Untitled document";
      button.onclick = () => this.actions.activate(item.id);
      if (item.path) button.oncontextmenu = (event) => { event.preventDefault(); this.contextMenu(button, { id: item.id }); };
      const close = document.createElement("button"); close.textContent = "×"; close.title = `Close ${item.name}`; close.setAttribute("aria-label", close.title); close.onclick = () => this.actions.close(item.id);
      row.append(button, close); this.openDocuments.append(row);
    }
    this.openDocuments.parentElement!.hidden = !this.documents.length;
  }
  private contextMenu(button: HTMLElement, target: { key: string } | { id: string }) {
    document.getElementById("folder-context-menu")?.remove();
    const menu = document.createElement("div"); menu.id = "folder-context-menu"; menu.className = "folder-context-menu"; menu.setAttribute("role", "menu");
    const rect = button.getBoundingClientRect(); menu.style.left = `${Math.min(rect.left + 15, innerWidth - 180)}px`; menu.style.top = `${Math.min(rect.bottom, innerHeight - 90)}px`;
    const dismiss = () => { menu.remove(); document.removeEventListener("pointerdown", outside, true); };
    const outside = (event: PointerEvent) => { if (!menu.contains(event.target as Node)) dismiss(); };
    for (const action of ["rename", "trash"] as const) { const item = document.createElement("button"); item.setAttribute("role", "menuitem"); item.textContent = action === "rename" ? "Rename…" : "Move to Trash…"; item.onclick = () => { dismiss(); this.actions.fileAction(target, action); }; menu.append(item); }
    menu.onkeydown = (event) => { if (event.key === "Escape") { event.preventDefault(); dismiss(); button.focus(); } if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const items = [...menu.querySelectorAll("button")]; items[(items.indexOf(document.activeElement as HTMLButtonElement) + 1) % items.length]?.focus(); } if (event.key === "Tab") dismiss(); };
    document.body.append(menu); menu.querySelector("button")!.focus(); document.addEventListener("pointerdown", outside, true);
  }
  private async toggle(key: string, expanded = !this.expanded.has(key)) {
    this.selectedDirectory = key;
    if (expanded) this.expanded.add(key); else this.expanded.delete(key);
    this.render(); await this.refresh();
  }
  private keydown(event: KeyboardEvent) {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const rows = this.rows(), index = rows.findIndex(({ entry }) => entry.key === this.focusKey), item = rows[index];
    if (!item) return;
    let next = index;
    if (event.key === "ArrowDown") next++;
    else if (event.key === "ArrowUp") next--;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = rows.length - 1;
    else if (event.key === "ArrowRight") { if (item.entry.kind === "directory" && !this.expanded.has(item.entry.key)) { event.preventDefault(); void this.toggle(item.entry.key, true); return; } else if (item.entry.kind === "directory") next++; }
    else if (event.key === "ArrowLeft") { if (item.entry.kind === "directory" && this.expanded.has(item.entry.key)) { event.preventDefault(); void this.toggle(item.entry.key, false); return; } next = rows.findIndex(({ entry }) => entry.key === item.entry.key.split("/").slice(0, -1).join("/")); }
    else if (event.key.length === 1 && event.key !== " ") {
      this.typeAhead = performance.now() - this.typeAt > 700 ? event.key : this.typeAhead + event.key; this.typeAt = performance.now();
      const match = rows.findIndex(({ entry }) => entry.name.toLocaleLowerCase().startsWith(this.typeAhead.toLocaleLowerCase())); if (match >= 0) next = match;
    } else return;
    event.preventDefault();
    const key = rows[Math.max(0, Math.min(rows.length - 1, next))]?.entry.key;
    if (key) { this.focusKey = key; [...this.tree.querySelectorAll<HTMLElement>("[role=treeitem]")].find((button) => button.dataset.key === key)?.focus(); }
  }
}
