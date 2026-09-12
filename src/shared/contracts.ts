export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_COMMENTS = 1000;
export const MAX_REPLACEMENT_CHARACTERS = 8_000;
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
/** The v1 on-disk shape and the compatibility view returned by old CLI verbs. */
export type Comment = { id: string; body: string; createdAt: string; author?: string; updatedAt?: string; updatedBy?: string; anchor: Anchor };
export type ThreadMessage = { id: string; body: string; createdAt: string; author?: string; updatedAt?: string; updatedBy?: string };
export type ReviewSuggestion = {
  version: 1;
  state: "pending" | "accepted" | "rejected";
  original: string;
  replacement: string;
  prefix?: string;
  suffix?: string;
  decidedAt?: string;
  decidedBy?: string;
};
export type ReviewThread = {
  id: string;
  anchor: Anchor;
  state: "open" | "resolved";
  resolvedAt?: string;
  resolvedBy?: string;
  messages: ThreadMessage[];
  suggestion?: ReviewSuggestion;
};
export type Draft = { text: string; threads: ReviewThread[] };
export type DocumentMetadata = {
  id: string;
  path: string | null;
  name: string;
  lineEnding: "\n" | "\r\n";
  notice: string | null;
};
export type DocumentSnapshot = Draft & DocumentMetadata;
export type CollaborationTarget = { path: string; documentId?: never } | { path?: never; documentId: string };
export type LiveDocumentInfo = DocumentMetadata & { active: boolean; dirty: boolean; generation: number; revision: string };
export type CompactChange = { operation: number; from: number; to: number; inserted: number };
export type ChangeIds = { threadIds: string[]; messageIds: string[] };
export type LiveReadStart = { transferId: string; total: number; document: LiveDocumentInfo; cursor: string };
export type LiveFocusResult = { document: LiveDocumentInfo; cursor: string; focus: unknown };
export type LiveApplyResult = { document: LiveDocumentInfo; operations: number; change: { from: number; to: number; inserted: number } | null; changes: CompactChange[];
  created: ChangeIds; changed: ChangeIds; cursor: string; activity: import("../collaboration/activity.ts").CursorActivity[]; autoSave: boolean };
export type LiveApplyResponse = { ok: true; result: LiveApplyResult } | { ok: false; error: string; code: "BUSY" | "CONFLICT" | "NOT_FOUND" | "INVALID" | "UNCERTAIN"; retryable: boolean };
export type WorkspaceInfo = { id: string; root: string | null; name: string; explicit: boolean; activeId: string | null };
export type OpenResult = { workspace: WorkspaceInfo; document: DocumentSnapshot | null };
export type FolderEntry = { key: string; name: string; kind: "directory" | "file"; path: string };
export type FolderListing = { workspaceId: string; key: string; entries: FolderEntry[]; error: string | null; truncated: boolean };
export type PendingComment = { anchor: Anchor; body: string; valid: boolean };
export type ThreadComposer = { kind: "reply" | "edit"; threadId: string; messageId?: string; body: string; baseSemantic: string };
export type PendingReview = { comment?: PendingComment | null; composer?: ThreadComposer | null };
export type RecoveredDocument = { document: DocumentSnapshot; originalPath: string | null; revision: string | null; pending?: PendingReview | null };
export type InitialDocument = OpenResult & { recovered: RecoveredDocument[]; recoveredScratch: boolean; recoveryError: string | null; localAuthor: string; collaborationInstanceId: string };
export function documentMetadata(snapshot: DocumentSnapshot): DocumentMetadata {
  const { id, path, name, lineEnding, notice } = snapshot;
  return { id, path, name, lineEnding, notice };
}
export type Command = "new" | "open" | "openFolder" | "closeFolder" | "toggleFolder" | "openExternal" | "save" | "saveAs" | "close" | "quit" | "comment" | "find" | "undo" | "redo" | "modeWrite" | "modeSplit" | "modeRead" | "distractionFree" | "zoomIn" | "zoomOut" | "zoomReset" | "about" | "settings" | "makeDefaultEditor";
export type WindowAction = "minimize" | "toggle-maximize" | "close" | "move" | "system-menu" | "titlebar-double-click" | "enter-distraction-free" | "exit-distraction-free";
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
      open: { params: undefined; response: OpenResult | null };
      openFolder: { params: undefined; response: OpenResult | null };
      closeFolder: { params: undefined; response: OpenResult };
      openPending: { params: undefined; response: OpenResult | null };
      pendingOpenRequiresLeave: { params: undefined; response: boolean };
      cancelPendingOpen: { params: undefined; response: boolean };
      newDocument: { params: undefined; response: OpenResult };
      workspace: { params: undefined; response: WorkspaceInfo };
      listFolder: { params: { workspaceId: string; key: string }; response: FolderListing };
      watchFolders: { params: { workspaceId: string; keys: string[] }; response: boolean };
      openEntry: { params: { workspaceId: string; key: string }; response: OpenResult };
      activateDocument: { params: { id: string }; response: WorkspaceInfo };
      closeDocument: { params: { id: string }; response: OpenResult };
      renameDocument: { params: { id: string; name: string }; response: DocumentMetadata };
      trashDocument: { params: { id: string }; response: OpenResult };
      stageSave: { params: SaveChunk & { id: string }; response: boolean };
      save: { params: { id: string; transferId: string; saveAs: boolean; folderKey?: string }; response: DocumentMetadata | null };
      saveScratch: { params: { id: string; transferId: string; pending?: PendingReview | null }; response: boolean };
      clearScratch: { params: { id?: string }; response: boolean };
      check: { params: { id: string }; response: { changed: boolean; error: string | null } };
      reload: { params: { id: string }; response: DocumentSnapshot };
      confirmDiscard: { params: { id: string }; response: "save" | "discard" | "cancel" };
      openLink: { params: { url: string }; response: boolean };
      windowAction: { params: { action: WindowAction }; response: boolean };
      finishClose: { params: { quit: boolean }; response: boolean };
    };
    messages: { cancelSave: { transferId: string }; dirty: { id: string; dirty: boolean }; ready: { userAgent: string }; diagnostic: { event: string; message: string };
      collaborationActivity: import("../collaboration/activity.ts").CursorActivity; collaborationClosed: { documentId: string } };
  };
  webview: {
    requests: {
      collaborationDocuments: { params: { instanceId: string }; response: LiveDocumentInfo[] };
      collaborationReadStart: { params: { instanceId: string; target: CollaborationTarget }; response: LiveReadStart };
      collaborationReadChunk: { params: { transferId: string; index: number }; response: string };
      collaborationFocus: { params: { instanceId: string; target: CollaborationTarget; request: unknown }; response: LiveFocusResult };
      collaborationApply: { params: { instanceId: string; target: CollaborationTarget; actor: string; ifRevision?: string; ifThreadRevision?: string; envelope: unknown; deadline: number }; response: LiveApplyResponse };
    };
    messages: { command: Command; update: UpdateState; foldersChanged: { workspaceId: string } };
  };
};

export function validateDraft(value: unknown): asserts value is Draft {
  if (!value || typeof value !== "object") throw new Error("Invalid document.");
  const draft = value as Draft;
  if (typeof draft.text !== "string" || draft.text.length > MAX_DOCUMENT_BYTES || draft.text.includes("\u0000")) {
    throw new Error("Sideleaf supports text documents up to 10 MiB, without NUL characters.");
  }
  if (!Array.isArray(draft.threads) || draft.threads.length > MAX_COMMENTS) throw new Error("Invalid thread list.");
  const ids = new Set<string>();
  for (const thread of draft.threads) {
    if (!thread || typeof thread.id !== "string" || !thread.id || ids.has(thread.id) || thread.id.length > 100 ||
      !["open", "resolved"].includes(thread.state) || !Array.isArray(thread.messages) || !thread.messages.length || thread.messages.length > MAX_COMMENTS) {
      throw new Error("Invalid review thread.");
    }
    ids.add(thread.id);
    if (thread.state === "resolved" && (typeof thread.resolvedAt !== "string" || !thread.resolvedAt || typeof thread.resolvedBy !== "string" || !thread.resolvedBy.trim())) {
      throw new Error("Invalid resolved thread attribution.");
    }
    if (thread.state === "open" && (thread.resolvedAt !== undefined || thread.resolvedBy !== undefined)) throw new Error("Invalid open thread state.");
    for (const field of ["resolvedBy", "resolvedAt"] as const) {
      if (thread[field] !== undefined && (typeof thread[field] !== "string" || !thread[field]!.trim() || thread[field]!.length > 200)) throw new Error("Invalid thread attribution.");
    }
    for (const [messageIndex, message] of thread.messages.entries()) {
      if (!message || typeof message.id !== "string" || !message.id || message.id.length > 100 ||
        messageIndex === 0 && message.id !== thread.id || messageIndex > 0 && ids.has(message.id) ||
        typeof message.body !== "string" || message.body.length > 20_000 || !message.body.trim() ||
        typeof message.createdAt !== "string" || !message.createdAt || message.createdAt.length > 40 ||
        message.author !== undefined && (typeof message.author !== "string" || !message.author.trim() || message.author.length > 200)) throw new Error("Invalid thread message.");
      if (messageIndex > 0) ids.add(message.id);
      for (const field of ["updatedBy", "updatedAt"] as const) {
        if (message[field] !== undefined && (typeof message[field] !== "string" || !message[field]!.trim() || message[field]!.length > 200)) throw new Error("Invalid message attribution.");
      }
    }
    const anchor = thread.anchor;
    if (!anchor || !Number.isInteger(anchor.from) || !Number.isInteger(anchor.to) || anchor.from < 0 || anchor.to < anchor.from ||
      typeof anchor.quote !== "string" || !anchor.quote || anchor.quote.length > 8192 ||
      typeof anchor.prefix !== "string" || anchor.prefix.length > 32 || typeof anchor.suffix !== "string" || anchor.suffix.length > 32 ||
      !["attached", "orphaned"].includes(anchor.state)) throw new Error("Invalid thread anchor.");
    if (anchor.state === "attached" && (anchor.to > draft.text.length || draft.text.slice(anchor.from, anchor.to) !== anchor.quote)) {
      throw new Error("A thread anchor no longer matches its text.");
    }
    const suggestion = thread.suggestion;
    if (suggestion !== undefined) {
      const allowed = new Set(["version", "state", "original", "replacement", "prefix", "suffix", "decidedAt", "decidedBy"]);
      const complete = (text: string) => {
        for (let index = 0; index < text.length; index++) {
          const code = text.charCodeAt(index);
          if (code >= 0xd800 && code <= 0xdbff) {
            const next = text.charCodeAt(++index);
            if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
          } else if (code >= 0xdc00 && code <= 0xdfff) return false;
        }
        return true;
      };
      const validText = (text: unknown, maximum: number, empty: boolean) => typeof text === "string" &&
        (empty || text.length > 0) && text.length <= maximum && !text.includes("\r") && !text.includes("\u0000") && complete(text);
      if (!suggestion || typeof suggestion !== "object" || Object.keys(suggestion).some((key) => !allowed.has(key)) ||
        suggestion.version !== 1 || !["pending", "accepted", "rejected"].includes(suggestion.state) ||
        !validText(suggestion.original, 8192, false) || suggestion.original !== anchor.quote ||
        !validText(suggestion.replacement, MAX_REPLACEMENT_CHARACTERS, true) ||
        suggestion.prefix !== undefined && !validText(suggestion.prefix, 256, true) ||
        suggestion.suffix !== undefined && !validText(suggestion.suffix, 256, true)) throw new Error("Invalid review suggestion.");
      if (suggestion.state === "pending" && (suggestion.decidedAt !== undefined || suggestion.decidedBy !== undefined)) {
        throw new Error("Invalid pending suggestion state.");
      }
      if (suggestion.state !== "pending" && (typeof suggestion.decidedAt !== "string" || suggestion.decidedAt.length > 40 ||
        !Number.isFinite(Date.parse(suggestion.decidedAt)) || typeof suggestion.decidedBy !== "string" ||
        !suggestion.decidedBy.trim() || suggestion.decidedBy.length > 200)) throw new Error("Invalid suggestion decision attribution.");
    }
  }
}

export function legacyComments(threads: ReviewThread[]): Comment[] {
  return threads.map((thread) => ({ ...structuredClone(thread.messages[0]!), anchor: structuredClone(thread.anchor) }));
}
