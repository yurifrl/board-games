import { expect, test } from "bun:test";
import { renderNote } from "./note-render.ts";

test("renders Obsidian markdown as a structured document", () => {
  const html = renderNote(`# Setup\n\nUse **three cards**.\n\n## Turn\n\n1. Draw\n2. Play\n   - Pay the cost\n\n> Remember the hand limit.`);

  expect(html).toContain("<h1>Setup</h1>");
  expect(html).toContain("<h2>Turn</h2>");
  expect(html).toContain("<strong>three cards</strong>");
  expect(html).toContain("<ol>");
  expect(html).toContain("<ul>");
  expect(html).toContain("<blockquote>");
});

test("pretty prints and highlights a JSON note", () => {
  const html = renderNote('{"players":4,"ready":true,"name":"Arcs"}');

  expect(html).toContain('class="note-code language-json"');
  expect(html).toContain('class="json-key">&quot;players&quot;</span>');
  expect(html).toContain('class="json-number">4</span>');
  expect(html).toContain('class="json-boolean">true</span>');
  expect(html).toContain('class="json-string">&quot;Arcs&quot;</span>');
  expect(html).toContain("\n");
});

test("preserves JSON numbers and duplicate keys while formatting", () => {
  const html = renderNote('{"id":9007199254740993,"huge":1e400,"same":1,"same":2}');

  expect(html).toContain("9007199254740993");
  expect(html).toContain("1e400");
  expect(html.match(/&quot;same&quot;/g)).toHaveLength(2);
});

test("highlights fenced JSON and blocks executable HTML and links", () => {
  const html = renderNote('```json\n{"ok": false}\n```\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))');

  expect(html).toContain('class="note-code language-json"');
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain('href="javascript:');
});
