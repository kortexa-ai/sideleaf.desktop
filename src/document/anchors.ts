import type { Anchor, Comment } from "../shared/contracts.ts";

export function makeAnchor(text: string, from: number, to: number): Anchor {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > text.length || to - from > 8192) {
    throw new Error("Select between 1 and 8,192 characters to comment on.");
  }
  return { from, to, quote: text.slice(from, to), prefix: text.slice(Math.max(0, from - 32), from), suffix: text.slice(to, to + 32), state: "attached" };
}

// Only reattach after external edits when the quotation AND its context identify
// one location. UTF-16 offsets match CodeMirror; these are never byte offsets.
export function relocateComment(comment: Comment, text: string, sameRevision: boolean): Comment {
  const a = comment.anchor;
  if (sameRevision && a.state === "attached" && text.slice(a.from, a.to) === a.quote) return comment;
  if (a.state === "orphaned") return comment;
  const matches: number[] = [];
  let position = text.indexOf(a.quote);
  while (position >= 0) {
    const before = text.slice(Math.max(0, position - a.prefix.length), position);
    const after = text.slice(position + a.quote.length, position + a.quote.length + a.suffix.length);
    if (before === a.prefix && after === a.suffix) matches.push(position);
    if (matches.length > 1) break;
    position = text.indexOf(a.quote, position + 1);
  }
  if (matches.length !== 1) return { ...comment, anchor: { ...a, state: "orphaned" } };
  return { ...comment, anchor: makeAnchor(text, matches[0]!, matches[0]! + a.quote.length) };
}
