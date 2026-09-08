export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_COMMENTS = 1000;

export type Anchor = {
  from: number;
  to: number;
  quote: string;
  prefix: string;
  suffix: string;
  state: "attached" | "orphaned";
};
export type Comment = { id: string; body: string; createdAt: string; anchor: Anchor };
export type Draft = { text: string; comments: Comment[] };
export type DocumentSnapshot = Draft & {
  id: string;
  path: string | null;
  name: string;
  lineEnding: "\n" | "\r\n";
  notice: string | null;
};
export type Command = "new" | "open" | "save" | "saveAs" | "close" | "quit" | "comment" | "find" | "undo" | "redo";

export type SideleafRPC = {
  bun: {
    requests: {
      initial: { params: undefined; response: DocumentSnapshot };
      open: { params: undefined; response: DocumentSnapshot | null };
      newDocument: { params: undefined; response: DocumentSnapshot };
      save: { params: { id: string; draft: Draft; saveAs: boolean }; response: DocumentSnapshot | null };
      check: { params: { id: string }; response: { changed: boolean; error: string | null } };
      reload: { params: { id: string }; response: DocumentSnapshot };
      confirmDiscard: { params: undefined; response: "save" | "discard" | "cancel" };
      openLink: { params: { url: string }; response: boolean };
      finishClose: { params: { quit: boolean }; response: boolean };
    };
    messages: { dirty: { id: string; dirty: boolean }; ready: { userAgent: string }; diagnostic: { event: string; message: string } };
  };
  webview: {
    requests: {};
    messages: { command: Command };
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
