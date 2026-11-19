import MarkdownIt from "markdown-it";
import { headingSlug, previewLinkKind } from "./links.ts";
import { characterCount, detectFrontMatter, escapeHTML, frontMatterGlance, frontMatterLineHTML, plural, type FrontMatterField } from "./front-matter.ts";

const markdown = new MarkdownIt({ html: false, linkify: false, typographer: false, breaks: false });
markdown.validateLink = (url) => previewLinkKind(url) !== null;
markdown.renderer.rules.heading_open = (tokens, index, options, env, renderer) => {
  const text = tokens[index + 1]?.children?.filter((token) => ["text", "code_inline", "image"].includes(token.type)).map((token) => token.content).join("") ?? "";
  const slug = headingSlug(text), used = env!.headingIds as Set<string>;
  let id = slug, suffix = 0;
  while (used.has(id)) id = `${slug}-${++suffix}`;
  used.add(id);
  tokens[index]!.attrSet("id", `sideleaf-heading-${id}`);
  tokens[index]!.attrSet("data-heading-id", id);
  return renderer.renderToken(tokens, index, options);
};
// Raw HTML stays escaped. Only a bare <br>, the usual way to break a line
// inside a GFM table cell, becomes a real line break.
markdown.inline.ruler.before("html_inline", "br_tag", (state, silent) => {
  const match = /^<br\s*\/?>/i.exec(state.src.slice(state.pos, state.pos + 8));
  if (!match) return false;
  if (!silent) state.push("hardbreak", "br", 0);
  state.pos += match[0].length;
  return true;
});
// Front matter at the very start of the document becomes one block instead of a rule and a heading.
markdown.block.ruler.before("table", "front_matter", (state, startLine, _endLine, silent) => {
  if (startLine !== 0 || state.parentType !== "root" || state.bMarks[0]! + state.tShift[0]! !== 0) return false;
  const matter = detectFrontMatter(state.src);
  if (!matter) return false;
  if (silent) return true;
  let line = startLine;
  while (line < state.lineMax && state.bMarks[line]! < matter.bodyFrom) line++;
  const token = state.push("front_matter", "", 0);
  token.block = true; token.map = [startLine, line]; token.meta = { fields: matter.fields, size: matter.size };
  state.line = line;
  return true;
});
markdown.renderer.rules.front_matter = (tokens, index, _options, env) => {
  const { fields, size } = tokens[index]!.meta as { fields: FrontMatterField[]; size: number };
  // A long value also shows its own length.
  const rows = fields.map(({ key, value }) => {
    const length = characterCount(value);
    return `<dt>${escapeHTML(key)}</dt><dd>${escapeHTML(value)}${length > 200 ? `<span class="front-matter-length">${plural(length, "character")}</span>` : ""}</dd>`;
  }).join("");
  return `<details class="front-matter"${env!.frontMatterOpen ? " open" : ""}><summary class="front-matter-line">${frontMatterLineHTML(frontMatterGlance(fields, size))}</summary><dl>${rows}</dl></details>\n`;
};
markdown.renderer.rules.image = (tokens, index) => {
  const token = tokens[index]!;
  const alt = markdown.utils.escapeHtml(token.content || "Image");
  return `<span class="image-placeholder" role="img" aria-label="${alt}">Image: ${alt} <small>(loading disabled)</small></span>`;
};

export const PREVIEW_LIMIT = 200_000;
// The renderer reads options.breaks on every render, so toggling this takes
// effect on the next preview without rebuilding the parser.
export function setHardBreaks(breaks: boolean): void { markdown.options.breaks = breaks; }
// The front matter is closed unless the editor shows it open.
export function renderMarkdown(source: string, options: { frontMatterOpen?: boolean } = {}): string {
  return markdown.render(source.slice(0, PREVIEW_LIMIT), { headingIds: new Set<string>(), frontMatterOpen: !!options.frontMatterOpen });
}
