/** The filename is the format choice; ordinary untitled documents are Markdown. */
export function isPlainText(name: string | null | undefined): boolean {
  return typeof name === "string" && /\.txt$/i.test(name);
}

export type ViewMode = "write" | "split" | "read";
export function documentViewMode(name: string, markdownMode: ViewMode): ViewMode {
  return isPlainText(name) ? "write" : markdownMode;
}
