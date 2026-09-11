import { Compartment } from "@codemirror/state";
import { EditorView, placeholder } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { isPlainText } from "../shared/document-type.ts";

// Reconfigure this compartment on Save As/Rename without resetting undo or comments.
export const documentMode = new Compartment();
function extensions(plain: boolean) {
  return [
    plain ? [] : markdown(),
    placeholder(plain ? "Start writing." : "# A fresh page\n\nStart writing, or open a Markdown file."),
    EditorView.contentAttributes.of({ "aria-label": plain ? "Text editor" : "Markdown editor", spellcheck: "true", autocapitalize: "off", autocorrect: "off" }),
  ];
}
const plainExtensions = extensions(true), markdownExtensions = extensions(false);
export function documentExtensions(name: string) {
  return isPlainText(name) ? plainExtensions : markdownExtensions;
}
