import events from "electrobun/main/events";
import { extname } from "node:path";

export const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdown"] as const;
const markdownSuffixes = new Set(MARKDOWN_EXTENSIONS.map((extension) => `.${extension}`));
const earlyFileActivations: string[] = [];
let fileActivationReceiver: ((path: string) => void) | undefined;

// This module must remain the first import in main.ts. Electrobun flushes its
// native cold-launch queue while BrowserWindow's module graph is evaluating,
// so the application listener has to exist before that graph is imported.
events.on("open-url", (value) => {
  const path = pathFromFileActivation((value as { data?: { url?: unknown } }).data?.url);
  if (!path) return;
  if (fileActivationReceiver) fileActivationReceiver(path);
  else earlyFileActivations.push(path);
});

export function isMarkdownPath(path: string): boolean {
  return markdownSuffixes.has(extname(path).toLowerCase());
}

export function pathFromFileActivation(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 32_768) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "file:" || /%2f|%5c/i.test(url.pathname)) return null;
    let path = decodeURIComponent(url.pathname);
    if (process.platform === "win32") {
      path = url.hostname ? `\\\\${url.hostname}${path.replaceAll("/", "\\")}` : path.replace(/^\/([A-Za-z]:)/, "$1").replaceAll("/", "\\");
    } else if (url.hostname) return null;
    return isMarkdownPath(path) ? path : null;
  } catch { return null; }
}

export function pathFromLaunch(argv: readonly string[], environmentPath?: string): string | null {
  if (environmentPath) return environmentPath;
  const marker = argv.indexOf("--sideleaf-open");
  const path = marker >= 0 ? argv[marker + 1] : undefined;
  return path || null;
}

export function takeInitialFileActivation(): string | null {
  return earlyFileActivations.shift() ?? null;
}

export function setFileActivationReceiver(receiver: (path: string) => void): void {
  fileActivationReceiver = receiver;
  for (const path of earlyFileActivations.splice(0)) receiver(path);
}
