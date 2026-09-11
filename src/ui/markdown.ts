import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false });
markdown.validateLink = (url) => /^(https?:|mailto:|#)/i.test(url);
markdown.renderer.rules.image = (tokens, index) => {
  const token = tokens[index]!;
  const alt = markdown.utils.escapeHtml(token.content || "Image");
  return `<span class="image-placeholder" role="img" aria-label="${alt}">Image: ${alt} <small>(loading disabled)</small></span>`;
};

export const PREVIEW_LIMIT = 200_000;
// The renderer reads options.breaks on every render, so toggling this takes
// effect on the next preview without rebuilding the parser.
export function setHardBreaks(breaks: boolean): void { markdown.options.breaks = breaks; }
export function renderMarkdown(source: string): string { return markdown.render(source.slice(0, PREVIEW_LIMIT)); }
