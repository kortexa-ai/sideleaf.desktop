import { EditorState, type Text } from "@codemirror/state";
import { commentField } from "./comments.ts";
import { documentMetadata, type Anchor, type DocumentMetadata, type DocumentSnapshot, type Draft, type PendingReview, type ThreadComposer } from "../shared/contracts.ts";

/** The complete editor state carries history, selection and comment effects. */
export class EditorBuffer {
  metadata: DocumentMetadata;
  savedDoc: Text;
  savedComments: string;
  generation = 0;
  pendingAnchor: Anchor | null = null;
  pendingGeneration = 0;
  commentBody = "";
  composer: ThreadComposer | null = null;
  composerSelection: { start: number; end: number } | null = null;
  composerFocused = false;
  composerComposing = false;
  composerRenderPending = false;
  editorTop = 0;
  editorLeft = 0;
  previewTop = 0;
  conflict = false;
  error: string | null = null;
  recoveryGeneration = -1;
  recoveryJSON: string | null = null;
  originalPath: string | null = null;
  saving: Promise<boolean> | null = null;
  constructor(snapshot: DocumentSnapshot, public state: EditorState, recovered = false) {
    this.metadata = documentMetadata(snapshot);
    this.savedDoc = recovered ? EditorState.create({ doc: "" }).doc : state.doc;
    this.savedComments = recovered ? "[]" : this.commentsJSON();
  }
  static reloaded(snapshot: DocumentSnapshot, state: EditorState, previous: EditorBuffer) {
    if (snapshot.id !== previous.metadata.id) throw new Error("Reload result belongs to another document.");
    const next = new EditorBuffer(snapshot, state);
    // A document ID is stable for the session, so a replaced editor state must
    // advance the monotonic generation instead of reusing revision generation 0.
    next.generation = previous.generation + 1;
    next.editorTop = previous.editorTop; next.editorLeft = previous.editorLeft; next.previewTop = previous.previewTop;
    return next;
  }
  commentsJSON() { return JSON.stringify(this.state.field(commentField)); }
  draft(): Draft { return { text: this.state.doc.toString(), threads: this.state.field(commentField) }; }
  pendingReview(): PendingReview | null {
    if (!this.hasCommentDraft) return null;
    return {
      comment: this.pendingAnchor ? { anchor: this.pendingAnchor, body: this.commentBody, valid: this.generation === this.pendingGeneration } : null,
      composer: this.composer?.body.trim() ? structuredClone(this.composer) : null,
    };
  }
  recoveryPayload() { return JSON.stringify({ draft: this.draft(), pending: this.pendingReview() }); }
  markRecovery(serialized: string, generation: number): boolean {
    if (serialized !== this.recoveryPayload()) { this.recoveryGeneration = -1; return false; }
    this.recoveryJSON = serialized; this.recoveryGeneration = generation; return true;
  }
  guard() { return { state: this.state, generation: this.generation, pending: JSON.stringify(this.pendingReview()), composerComposing: this.composerComposing }; }
  guardedBy(guard: { state: EditorState; generation: number; pending: string; composerComposing: boolean }) {
    return this.state === guard.state && this.generation === guard.generation && JSON.stringify(this.pendingReview()) === guard.pending
      && this.composerComposing === guard.composerComposing;
  }
  get dirty() { return !this.state.doc.eq(this.savedDoc) || this.commentsJSON() !== this.savedComments; }
  get hasCommentDraft() { return !!this.pendingAnchor && !!this.commentBody.trim() || !!this.composer?.body.trim(); }
  saved(metadata: DocumentMetadata, state: EditorState) {
    if (metadata.id !== this.metadata.id) throw new Error("Save result belongs to another document.");
    this.metadata = metadata; this.savedDoc = state.doc;
    this.savedComments = JSON.stringify(state.field(commentField));
    this.conflict = false; this.error = null; this.recoveryGeneration = -1; this.recoveryJSON = null;
  }
}

/** Re-save stale untitled recovery records once, then reject if any snapshot
 * changed while another buffer was being written. Callers keep inputs frozen
 * until the close either commits or is cancelled. */
export async function refreshUntitledRecoveries(buffers: Iterable<EditorBuffer>, persist: (buffer: EditorBuffer) => Promise<boolean>): Promise<boolean> {
  const current = [...buffers].filter((buffer) => !buffer.metadata.path && (buffer.dirty || buffer.hasCommentDraft));
  for (const buffer of current) {
    if (buffer.recoveryJSON !== buffer.recoveryPayload() && !(await persist(buffer))) return false;
  }
  return current.every((buffer) => buffer.recoveryJSON === buffer.recoveryPayload());
}
