import { createRequire } from "node:module";
const { JSDOM } = createRequire(
  new URL("../../../admin-web/package.json", import.meta.url),
)("jsdom");
export function xml(bytes) {
  return new JSDOM(bytes.toString(), { contentType: "application/xhtml+xml" })
    .window.document;
}
function render(node) {
  if (node.nodeType === 3) return node.nodeValue.replace(/[\t\r\n]+/g, " ");
  if (node.nodeType !== 1) return "";
  const tag = node.localName;
  if (["script", "style"].includes(tag)) return "";
  if (tag === "br") return "\n";
  if (tag === "img")
    return "\n[" + (node.getAttribute("alt") || "Illustration") + "]\n";
  const value = [...node.childNodes].map(render).join("");
  if ((node.getAttribute("epub:type") || "").split(/\s+/).includes("line"))
    return value + "\n";
  if (tag === "td" || tag === "th") return value + " ";
  return [
    "p",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "div",
    "section",
    "article",
    "blockquote",
    "li",
    "tr",
    "figure",
    "figcaption",
  ].includes(tag)
    ? "\n\n" + value + "\n\n"
    : value;
}
export function normalized(doc) {
  const body = doc.querySelector("body");
  if (!body) throw Error("Missing source body");
  return (
    render(body)
      .replace(/\r/g, "")
      .split("\n")
      .map((s) => s.replace(/[\t ]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  );
}
