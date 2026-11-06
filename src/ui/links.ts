/** Keep rendered links inert unless they are web/email, fragments or relative files. */
export function previewLinkKind(url: string): "external" | "fragment" | "relative" | null {
  if (!url || url.length > 8192 || /[\u0000-\u0020\u007f\\]/.test(url)) return null;
  if (/^(https?:|mailto:)/i.test(url)) return "external";
  if (url.startsWith("#")) return "fragment";
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith("/") || url.startsWith("?")) return null;
  return "relative";
}

export function headingSlug(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, "").trim().replace(/\s+/g, "-");
}
