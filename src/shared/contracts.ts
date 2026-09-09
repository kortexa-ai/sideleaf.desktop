export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_COMMENTS = 1000;
// Even fully escaped JSON stays well below the runtime's 8 MiB CString limit.
export const SAVE_CHUNK_CHARACTERS = 256_000;
export type SaveChunk = { transferId: string; index: number; total: number; text: string };

export type Anchor = {
  from: number;
  to: number;
  quote: string;
  prefix: string;
  suffix: string;
  state: "attached" | "orphaned";
};
export type Comment = { id: string; body: string; createdAt: string; author?: string; updatedAt?: string; updatedBy?: string; anchor: Anchor };
export type Draft = { text: string; comments: Comment[] };
export type DocumentMetadata = {
  id: string;
  path: string | null;
  name: string;
  lineEnding: "\n" | "\r\n";
  notice: string | null;
};
export type DocumentSnapshot = Draft & DocumentMetadata;
export type InitialDocument = { document: DocumentSnapshot; recoveredScratch: boolean; recoveryError: string | null };
export function documentMetadata(snapshot: DocumentSnapshot): DocumentMetadata {
  const { id, path, name, lineEnding, notice } = snapshot;
  return { id, path, name, lineEnding, notice };
}
export type Command = "new" | "open" | "save" | "saveAs" | "close" | "quit" | "comment" | "find" | "undo" | "redo" | "modeWrite" | "modeSplit" | "modeRead" | "about" | "settings" | "makeDefaultEditor";
export type WindowAction = "minimize" | "toggle-maximize" | "close" | "move" | "system-menu" | "titlebar-double-click";
export type UpdateState = { status: "idle" | "checking" | "current" | "error" } | { status: "available"; version: string; url: string };

export type SideleafRPC = {
  bun: {
    requests: {
      initial: { params: { restoreScratch: boolean }; response: InitialDocument };
      cliAvailability: { params: undefined; response: { wslDistro: string | null } };
      installCLI: { params: { wsl: boolean }; response: boolean };
      updateState: { params: undefined; response: UpdateState };
      checkUpdates: { params: undefined; response: UpdateState };
      dismissUpdate: { params: undefined; response: boolean };
      openDefaultApps: { params: undefined; response: boolean };
      open: { params: undefined; response: DocumentSnapshot | null };
      newDocument: { params: undefined; response: DocumentSnapshot };
      stageSave: { params: SaveChunk & { id: string }; response: boolean };
      save: { params: { id: string; transferId: string; saveAs: boolean }; response: DocumentMetadata | null };
      saveScratch: { params: { id: string; transferId: string }; response: boolean };
      clearScratch: { params: undefined; response: boolean };
      check: { params: { id: string }; response: { changed: boolean; error: string | null } };
      reload: { params: { id: string }; response: DocumentSnapshot };
      confirmDiscard: { params: undefined; response: "save" | "discard" | "cancel" };
      openLink: { params: { url: string }; response: boolean };
      windowAction: { params: { action: WindowAction }; response: boolean };
      finishClose: { params: { quit: boolean }; response: boolean };
    };
    messages: { cancelSave: { transferId: string }; dirty: { id: string; dirty: boolean }; ready: { userAgent: string }; diagnostic: { event: string; message: string } };
  };
  webview: {
    requests: {};
    messages: { command: Command; update: UpdateState };
  };
};

export function validateDraft(value: unknown): asserts value is Draft {
  if (!value || typeof value !== "object") throw new Error("Invalid document.");
  const draft = value as Draft;
  if (typeof draft.text !== "string" || draft.text.length > MAX_DOCUMENT_BYTES || draft.text.includes("\u0000")) {
    throw new Error("Sideleaf supports text documents up to 10 MiB, without NUL characters.");
  }
  if (!Array.isArray(draft.comments) || draft.comments.length > MAX_COMMENTS) throw new Error("Invalid comment list.");
  const ids = new Set<string>();
  for (const comment of draft.comments) {
    if (!comment || typeof comment.id !== "string" || !comment.id || ids.has(comment.id) || comment.id.length > 100 ||
      typeof comment.body !== "string" || comment.body.length > 20_000 || !comment.body.trim() ||
      typeof comment.createdAt !== "string" || comment.createdAt.length > 40) throw new Error("Invalid comment.");
    for (const field of ["author", "updatedBy", "updatedAt"] as const) {
      if (comment[field] !== undefined && (typeof comment[field] !== "string" || !comment[field]!.trim() || comment[field]!.length > 200)) throw new Error("Invalid comment attribution.");
    }
    ids.add(comment.id);
    const anchor = comment.anchor;
    if (!anchor || !Number.isInteger(anchor.from) || !Number.isInteger(anchor.to) || anchor.from < 0 || anchor.to < anchor.from ||
      typeof anchor.quote !== "string" || !anchor.quote || anchor.quote.length > 8192 ||
      typeof anchor.prefix !== "string" || anchor.prefix.length > 32 || typeof anchor.suffix !== "string" || anchor.suffix.length > 32 ||
      !["attached", "orphaned"].includes(anchor.state)) throw new Error("Invalid comment anchor.");
    if (anchor.state === "attached" && (anchor.to > draft.text.length || draft.text.slice(anchor.from, anchor.to) !== anchor.quote)) {
      throw new Error("A comment anchor no longer matches its text.");
    }
  }
}
