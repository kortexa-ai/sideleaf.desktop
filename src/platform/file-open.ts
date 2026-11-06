import events from "electrobun/main/events";
import { extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { supportsReview } from "../shared/document-type.ts";
import { previewLinkKind } from "../ui/links.ts";

export const MARKDOWN_EXTENSIONS = ["md", "markdown", "mdown"] as const;
export type LaunchRequest = { kind: "open" | "open-folder"; path: string };
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

export function resolveRelativeLink(url: string, documentPath: string | null): { path: string; fragment: string | null } {
  if (typeof url !== "string" || previewLinkKind(url) !== "relative") throw new Error("Only relative document links can be opened here.");
  if (!documentPath) throw new Error("Save this document before opening a relative link.");
  const target = new URL(url, pathToFileURL(documentPath));
  const fragment = target.hash ? decodeURIComponent(target.hash.slice(1)) : null;
  target.hash = ""; target.search = "";
  return { path: fileURLToPath(target), fragment };
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
    // The OS only hands over registered types; other text files open through the CLI.
    return supportsReview(path) ? path : null;
  } catch { return null; }
}

export function pathFromLaunch(argv: readonly string[], environmentPath?: string): string | null {
  return launchRequestFromLaunch(argv, environmentPath)?.path ?? null;
}

export function launchRequestFromLaunch(argv: readonly string[], environmentPath?: string, environmentKind?: string): LaunchRequest | null {
  if (environmentPath) return { kind: environmentKind === "folder" ? "open-folder" : "open", path: environmentPath };
  for (const [marker, kind] of [["--sideleaf-open", "open"], ["--sideleaf-open-folder", "open-folder"]] as const) {
    const index = argv.indexOf(marker);
    const path = index >= 0 ? argv[index + 1] : undefined;
    if (path) return { kind, path };
  }
  return null;
}

export function takeInitialFileActivation(): string | null {
  return earlyFileActivations.shift() ?? null;
}

export function setFileActivationReceiver(receiver: (path: string) => void): void {
  fileActivationReceiver = receiver;
  for (const path of earlyFileActivations.splice(0)) receiver(path);
}
