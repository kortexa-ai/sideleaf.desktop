/** The filename is the format choice; ordinary untitled documents are Markdown. */
export function isMarkdownName(name: string | null | undefined): boolean {
  return typeof name === "string" && /\.(md|markdown|mdown)$/i.test(name);
}

/** Every file that is not Markdown opens as plain text, such as .txt, .json, .ini or .env. */
export function isPlainText(name: string | null | undefined): boolean {
  return typeof name === "string" && !isMarkdownName(name);
}

/**
 * Comments and agent commands embed Sideleaf metadata in the file, so they are
 * limited to Sideleaf's own document types. Other text files stay byte-exact.
 */
export function supportsReview(name: string | null | undefined): boolean {
  return isMarkdownName(name) || (typeof name === "string" && /\.txt$/i.test(name));
}
export const REVIEW_UNSUPPORTED = "Comments and agent commands support only .md, .markdown, .mdown and .txt documents.";

export type ViewMode = "write" | "split" | "read";
export function documentViewMode(name: string, markdownMode: ViewMode): ViewMode {
  return isPlainText(name) ? "write" : markdownMode;
}
