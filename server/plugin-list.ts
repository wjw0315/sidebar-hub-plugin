import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RpcInput } from "@getpaseo/plugin";
import { installedPluginsRpc } from "../shared/plugin-list";

interface SidebarEntry {
  section: "header" | "footer";
  itemId: string;
}

interface ScanResult {
  id: string;
  enabled: boolean;
  entries: SidebarEntry[];
}

const HEADER_RE = /addSidebarHeaderItem\(\s*\{\s*id:\s*["']([a-z][a-z0-9-]*)["']/g;
const FOOTER_RE = /addSidebarFooterItem\(\s*\{\s*id:\s*["']([a-z][a-z0-9-]*)["']/g;
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

function extractEntries(source: string, entries: SidebarEntry[]): void {
  for (const match of source.matchAll(HEADER_RE)) entries.push({ section: "header", itemId: match[1] });
  for (const match of source.matchAll(FOOTER_RE)) entries.push({ section: "footer", itemId: match[1] });
}

async function scanPlugin(id: string, enabled: boolean, path: string): Promise<ScanResult> {
  const entries: SidebarEntry[] = [];
  const files: string[] = [];
  await walkSources(path, files);
  for (const file of files) {
    try {
      extractEntries(await readFile(file, "utf8"), entries);
    } catch {
      // unreadable file: skip
    }
  }
  // Dedupe (id, section).
  const seen = new Set<string>();
  const unique = entries.filter((entry) => {
    const key = `${entry.section}/${entry.itemId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { id, enabled, entries: unique };
}

/**
 * Installed plugins from the daemon's config.json, each scanned for sidebar
 * item registrations. The app's sidebar preference key is derived from the
 * plugin manifest id and the item id (see client/web.ts), so this list drives
 * the per-row toggle. Newly installed plugins appear here without registration.
 * A plugin whose item id is built dynamically (not a literal) yields no entry
 * and stays manageable by hand in Settings > Sidebar.
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
      results.push(enabled && path ? await scanPlugin(id, enabled, path) : { id, enabled, entries: [] });
    }
    results.sort((a, b) => a.id.localeCompare(b.id));
    return { plugins: results };
  } catch (error) {
    console.warn("[sidebar-hub] config.json unreadable, plugin list unavailable", error);
    return { plugins: [] };
  }
}
