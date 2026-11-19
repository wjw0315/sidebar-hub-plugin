import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RpcInput } from "@getpaseo/plugin";
import { installedPluginsRpc } from "../shared/plugin-list";

interface SidebarEntry {
  section: "header" | "footer";
  itemId: string;
  /** Registered with the legacy `addSidebarItem`, which carries its own surface id. */
  legacy: boolean;
}

interface ScanResult {
  id: string;
  enabled: boolean;
  name: string | null;
  screens: string[];
  entries: SidebarEntry[];
}

type CallKind = "addSidebarHeaderItem" | "addSidebarFooterItem" | "addSidebarItem";

const CALL_RE = /\b(addSidebarHeaderItem|addSidebarFooterItem|addSidebarItem)\s*\(/g;
const SCREEN_RE = /\baddScreen\s*\(/g;
/** `const PLANE_SCREEN_ID = "plane-board"` — ids are often shared constants, not literals. */
const CONST_RE = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(["'])([^"'\\]*)\2/g;
const SKIP_DIRS = new Set(["node_modules", ".git", "tests", "test", "verification"]);
const MAX_FILES = 500;

async function walkSources(dir: string, out: string[]): Promise<void> {
  if (out.length >= MAX_FILES) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= MAX_FILES) return;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      await walkSources(full, out);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
      out.push(full);
    }
  }
}

/** Blank out comments while keeping strings, so commented-out registrations stay out. */
function stripComments(source: string): string {
  let out = "";
  let i = 0;
  let quote: "'" | '"' | "`" | null = null;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (quote) {
      out += char;
      if (char === "\\") {
        out += next ?? "";
        i += 2;
        continue;
      }
      if (char === quote) quote = null;
      i += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      out += char;
      i += 1;
      continue;
    }
    if (char === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        out += " ";
        i += 1;
      }
      continue;
    }
    if (char === "/" && next === "*") {
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
        out += source[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      out += "  ";
      i += 2;
      continue;
    }
    out += char;
    i += 1;
  }
  return out;
}

/** Index of the matching close char, or -1. Understands strings and nested delimiters. */
function matchDelimiter(source: string, openIndex: number, open: string, close: string): number {
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    if (quote) {
      if (char === "\\") {
        i += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Top-level `key: value` pairs of an object literal; shorthand yields the key as value. */
function topLevelProperties(objectText: string): Record<string, string> {
  const props: Record<string, string> = {};
  const inner = objectText.slice(1, -1);
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && /[\s,]/.test(inner[i])) i += 1;
    if (i >= inner.length) break;
    if (inner.startsWith("...", i)) {
      i = skipToNextComma(inner, i);
      continue;
    }
    const keyMatch = /^[A-Za-z_$][\w$]*/.exec(inner.slice(i));
    if (!keyMatch) {
      i += 1;
      continue;
    }
    const key = keyMatch[0];
    i += key.length;
    while (i < inner.length && /\s/.test(inner[i])) i += 1;
    if (inner[i] === ":") {
      i += 1;
      const start = i;
      i = skipValue(inner, i);
      props[key] = inner.slice(start, i).trim();
    } else if (inner[i] === ",") {
      props[key] = key;
    } else {
      i += 1;
    }
  }
  return props;
}

function skipToNextComma(text: string, start: number): number {
  let i = start;
  while (i < text.length && text[i] !== ",") i += 1;
  return i + 1;
}

/** Move past one property value until a top-level comma. */
function skipValue(text: string, start: number): number {
  let i = start;
  let depth = 0;
  let quote: "'" | '"' | "`" | null = null;
  while (i < text.length) {
    const char = text[i];
    if (quote) {
      if (char === "\\") i += 1;
      else if (char === quote) quote = null;
      i += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quote = char;
      i += 1;
      continue;
    }
    if (char === "(" || char === "[" || char === "{") depth += 1;
    else if (char === ")" || char === "]" || char === "}") {
      if (depth === 0) return i;
      depth -= 1;
    } else if (char === "," && depth === 0) return i;
    i += 1;
  }
  return i;
}

function literalString(value: string): string | null {
  const match = /^(["'])([^"'\\]*)\1$/.exec(value.trim());
  if (!match) return null;
  return match[2];
}

/** Split the contents of an array literal into top-level elements. */
function arrayElements(arrayText: string): string[] {
  const inner = arrayText.slice(1, -1);
  const elements: string[] = [];
  let i = 0;
  while (i < inner.length) {
    while (i < inner.length && /[\s,]/.test(inner[i])) i += 1;
    if (i >= inner.length) break;
    const start = i;
    i = skipValue(inner, i);
    elements.push(inner.slice(start, i).trim());
  }
  return elements;
}

/**
 * Ids inside an array declaration. Supports the common registration styles:
 *   [["item-a", ...], ["item-b", ...]]
 *   [{ id: "item-a" }, { id: "item-b" }]
 *   ["item-a", "item-b"]
 */
function idsFromArrayLiteral(arrayText: string): string[] {
  const ids: string[] = [];
  for (const element of arrayElements(arrayText)) {
    if (!element) continue;
    if (element.startsWith("[")) {
      const end = matchDelimiter(element, 0, "[", "]");
      if (end < 0) continue;
      const first = arrayElements(element.slice(0, end + 1))[0] ?? "";
      const value = literalString(first);
      if (value) ids.push(value);
      continue;
    }
    if (element.startsWith("{")) {
      const end = matchDelimiter(element, 0, "{", "}");
      if (end < 0) continue;
      const value = literalString(topLevelProperties(element.slice(0, end + 1)).id ?? "");
      if (value) ids.push(value);
      continue;
    }
    const value = literalString(element);
    if (value) ids.push(value);
  }
  return ids;
}

/** Find `const|let|var name = [...]` before `before`, then list its ids. */
function idsFromNamedArray(source: string, name: string, before: number): string[] {
  const pattern = new RegExp(`\\b(?:const|let|var)\\s+${name}\\b[^=]*=\\s*\\[`, "g");
  let match: RegExpExecArray | null;
  let best: RegExpExecArray | null = null;
  while ((match = pattern.exec(source)) !== null) {
    if (match.index >= before) break;
    best = match;
  }
  if (!best) return [];
  const open = best.index + best[0].length - 1;
  const end = matchDelimiter(source, open, "[", "]");
  if (end < 0) return [];
  return idsFromArrayLiteral(source.slice(open, end + 1));
}

/**
 * Dynamic ids come from iterating an array (`screenList.forEach(([id]) => ...)`
 * or `.map((screen) => ... id: screen.id ...)`). Locate that array nearby and
 * read its string ids.
 */
function idsForDynamicCall(source: string, callIndex: number, idExpression: string): string[] {
  const before = source.slice(Math.max(0, callIndex - 8000), callIndex);
  const idVar = /^([A-Za-z_$][\w$]*)$/.exec(idExpression.trim())?.[1];
  if (idVar) {
    const tuplePatterns = [
      new RegExp(`([A-Za-z_$][\\w$]*)\\s*\\.\\s*(?:forEach|map|flatMap)\\s*\\(\\s*\\(\\s*\\[\\s*${idVar}\\b`, "g"),
      new RegExp(`for\\s*\\(\\s*const\\s*\\[\\s*${idVar}\\b[^\\]]*\\]\\s+of\\s+([A-Za-z_$][\\w$]*)`, "g"),
    ];
    for (const pattern of tuplePatterns) {
      const nearest = [...before.matchAll(pattern)].at(-1);
      if (nearest?.[1]) {
        const ids = idsFromNamedArray(source, nearest[1], callIndex);
        if (ids.length > 0) return ids;
      }
    }
  }
  const member = /^([A-Za-z_$][\w$]*)\s*\.\s*id$/.exec(idExpression.trim());
  if (member) {
    const itemVar = member[1];
    const pattern = new RegExp(
      `([A-Za-z_$][\\w$]*)\\s*\\.\\s*(?:forEach|map|flatMap)\\s*\\(\\s*\\(\\s*${itemVar}\\b`,
      "g",
    );
    const nearest = [...before.matchAll(pattern)].at(-1);
    if (nearest?.[1]) return idsFromNamedArray(source, nearest[1], callIndex);
  }
  return [];
}

function extractEntries(
  source: string,
  entries: SidebarEntry[],
  screens: string[],
  constants: Map<string, string>,
): void {
  /** A literal id, a `const` that holds one, or ids built by iterating an array. */
  const idsOf = (raw: string, callIndex: number): string[] => {
    const literal = literalString(raw);
    if (literal) return [literal];
    const constant = constants.get(raw.trim());
    if (constant) return [constant];
    return idsForDynamicCall(source, callIndex, raw);
  };

  CALL_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CALL_RE.exec(source)) !== null) {
    const kind = match[1] as CallKind;
    const section = kind === "addSidebarFooterItem" ? "footer" : "header";
    const openBrace = source.indexOf("{", match.index + match[0].length);
    if (openBrace < 0) continue;
    const closeBrace = matchDelimiter(source, openBrace, "{", "}");
    if (closeBrace < 0) continue;
    const props = topLevelProperties(source.slice(openBrace, closeBrace + 1));
    const rawId = props.id;
    if (!rawId) continue;
    const legacy = kind === "addSidebarItem";
    for (const id of idsOf(rawId, match.index)) entries.push({ section, itemId: id, legacy });
  }

  // Screens are the only surfaces a plugin surface route can open (see shared/plugin-list.ts).
  SCREEN_RE.lastIndex = 0;
  while ((match = SCREEN_RE.exec(source)) !== null) {
    const openBrace = source.indexOf("{", match.index + match[0].length);
    if (openBrace < 0) continue;
    const closeBrace = matchDelimiter(source, openBrace, "{", "}");
    if (closeBrace < 0) continue;
    const rawId = topLevelProperties(source.slice(openBrace, closeBrace + 1)).id;
    if (!rawId) continue;
    screens.push(...idsOf(rawId, match.index));
  }
}

/** String constants declared anywhere in the plugin, so `id: SOME_ID` resolves. */
function collectConstants(sources: string[], constants: Map<string, string>): void {
  for (const source of sources) {
    CONST_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CONST_RE.exec(source)) !== null) {
      const [, name, , value] = match;
      if (name && value && !constants.has(name)) constants.set(name, value);
    }
  }
}

/** The plugin's own display name, so the hub menu can label it without i18n guessing. */
async function manifestName(path: string): Promise<string | null> {
  try {
    const raw = await readFile(join(path, "paseo-plugin.json"), "utf8");
    const manifest = JSON.parse(raw) as { name?: unknown };
    const name = typeof manifest.name === "string" ? manifest.name.trim() : "";
    return name || null;
  } catch {
    return null;
  }
}

async function scanPlugin(id: string, enabled: boolean, path: string): Promise<ScanResult> {
  const entries: SidebarEntry[] = [];
  const screens: string[] = [];
  const files: string[] = [];
  const sources: string[] = [];
  await walkSources(path, files);
  for (const file of files) {
    try {
      sources.push(stripComments(await readFile(file, "utf8")));
    } catch {
      // unreadable file: skip
    }
  }
  // Two passes: ids are often shared constants (e.g. PLANE_SCREEN_ID) declared elsewhere.
  const constants = new Map<string, string>();
  collectConstants(sources, constants);
  for (const source of sources) extractEntries(source, entries, screens, constants);
  // Dedupe (id, section) and repeated screen ids (re-registration on language change).
  const seen = new Set<string>();
  const unique = entries.filter((entry) => {
    const key = `${entry.section}/${entry.itemId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { id, enabled, name: await manifestName(path), screens: [...new Set(screens)], entries: unique };
}

/**
 * Installed plugins from the daemon's config.json, each scanned for sidebar
 * item registrations. The app's sidebar preference key is derived from the
 * plugin manifest id and the item id (see client/web.ts), so this list drives
 * the per-row toggle. Newly installed plugins appear here without registration.
 * Modern header/footer calls, legacy addSidebarItem calls and ids built by
 * iterating an array are all recognized; anything still missed is picked up
 * from the rendered sidebar by the settings screen.
 */
export async function installedPlugins(_input: RpcInput<typeof installedPluginsRpc>) {
  const home = process.env.PASEO_HOME || join(homedir(), ".paseo");
  const configPath = join(home, "config.json");
  try {
    const raw = await readFile(configPath, "utf8");
    const config = JSON.parse(raw) as {
      plugins?: Record<string, { enabled?: boolean; path?: string }>;
    };
    const results: ScanResult[] = [];
    for (const [id, entry] of Object.entries(config.plugins ?? {})) {
      const enabled = entry?.enabled !== false;
      const path = entry?.path;
      results.push(
        enabled && path
          ? await scanPlugin(id, enabled, path)
          : { id, enabled, name: null, screens: [], entries: [] },
      );
    }
    results.sort((a, b) => a.id.localeCompare(b.id));
    return { plugins: results };
  } catch (error) {
    console.warn("[sidebar-hub] config.json unreadable, plugin list unavailable", error);
    return { plugins: [] };
  }
}
