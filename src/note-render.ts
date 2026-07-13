import MarkdownIt from "markdown-it";
import type { RuleInline } from "markdown-it/lib/parser_inline.mjs";

const md = new MarkdownIt({ html: false, linkify: true, typographer: true });
md.options.highlight = (code: string, language: string): string => {
  const json = language.toLowerCase() === "json" ? formatJson(code) : null;
  return `<pre class="note-code${json ? " language-json" : ""}"><code>${json ?? md.utils.escapeHtml(code)}</code></pre>`;
};

const defaultLinkOpen =
  md.renderer.rules.link_open ??
  ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
md.renderer.rules.link_open = (tokens, index, options, env, self) => {
  tokens[index].attrSet("target", "_blank");
  tokens[index].attrSet("rel", "noopener noreferrer");
  return defaultLinkOpen(tokens, index, options, env, self);
};

const obsidianWikiLink: RuleInline = (state, silent) => {
  if (!state.src.startsWith("[[", state.pos)) return false;
  const end = state.src.indexOf("]]", state.pos + 2);
  if (end === -1) return false;
  const value = state.src.slice(state.pos + 2, end);
  const label = (value.split("|")[1] ?? value.split("|")[0]).trim();
  if (!label) return false;
  if (!silent) {
    const open = state.push("obsidian_wikilink_open", "span", 1);
    open.attrSet("class", "note-wikilink");
    const text = state.push("text", "", 0);
    text.content = label;
    state.push("obsidian_wikilink_close", "span", -1);
  }
  state.pos = end + 2;
  return true;
};
md.inline.ruler.before("link", "obsidian-wikilink", obsidianWikiLink);

function prettyJson(source: string): string {
  JSON.parse(source);
  let output = "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  const newline = () => `\n${"  ".repeat(depth)}`;
  for (const char of source.trim()) {
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      output += char;
    } else if (char === "{" || char === "[") {
      output += char;
      depth++;
      output += newline();
    } else if (char === "}" || char === "]") {
      depth--;
      output = output.trimEnd() + newline() + char;
    } else if (char === ",") output += char + newline();
    else if (char === ":") output += ": ";
    else if (!/\s/.test(char)) output += char;
  }
  return output;
}

function formatJson(source: string): string | null {
  try {
    const json = prettyJson(source);
    const pattern = /"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(?=\s*:)|"(?:\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"|\b(?:true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
    let html = "";
    let offset = 0;
    for (const match of json.matchAll(pattern)) {
      html += md.utils.escapeHtml(json.slice(offset, match.index));
      const token = match[0];
      const kind = token.startsWith('"') ? (json.slice(match.index + token.length).match(/^\s*:/) ? "key" : "string")
        : token === "true" || token === "false" ? "boolean"
        : token === "null" ? "null" : "number";
      html += `<span class="json-${kind}">${md.utils.escapeHtml(token)}</span>`;
      offset = match.index + token.length;
    }
    return html + md.utils.escapeHtml(json.slice(offset));
  } catch {
    return null;
  }
}

export function renderNote(note: string): string {
  const json = formatJson(note.trim());
  if (json) return `<pre class="note-code language-json"><code>${json}</code></pre>`;
  return md.render(note);
}
