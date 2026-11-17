// DOM exit point for the hub (web only, entered after Platform.OS === "web").
// Reads and writes Paseo's own app-settings blob to toggle plugin sidebar rows.
//
// shortcut: the app-settings key, sidebar fields and preference-key layout are
// Paseo internals (packages/app/src/hooks/use-settings and
// packages/app/src/plugins/sidebar-groups), not a plugin API — a Paseo update
// that renames them silently disables the toggle, and rows can then be hidden
// by hand in Settings > Sidebar.
//
// Narrow browser contracts: no DOM lib, same style as bg's client/web.ts.

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface SidebarPreferenceEntry {
  key: string;
  visible: boolean;
}

export type SidebarSection = "header" | "footer";

const APP_SETTINGS_KEY = "@paseo:app-settings";

/**
 * Same key the app uses for both sections (`pluginSidebarNavKey`): the section
 * only decides which preference field stores the entry. Older versions of this
 * plugin wrote `<pluginId>/sidebar[-footer]/<itemId>`, which never matched.
 */
export function sidebarPreferenceKey(pluginId: string, _section: SidebarSection, itemId: string): string {
  return `plugin:${pluginId}:${itemId}`;
}

function storage(): StorageLike | null {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    return null;
  }
}

function fieldFor(section: SidebarSection): string {
  return section === "header" ? "sidebarNavItems" : "sidebarFooterItems";
}

function legacyKeys(pluginId: string, itemId: string): Set<string> {
  return new Set([
    `${pluginId}/sidebar/${itemId}`,
    `${pluginId}/sidebar-footer/${itemId}`,
  ]);
}

function readAppSettings(storageLike: StorageLike): Record<string, unknown> {
  const raw = storageLike.getItem(APP_SETTINGS_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

/**
 * Whether the plugin's sidebar row is currently shown. Nothing persisted (or
 * no storage) means the default: visible.
 */
export function sidebarEntryVisible(pluginId: string, section: SidebarSection, itemId: string): boolean {
  const storageLike = storage();
  if (!storageLike) return true;
  try {
    const settings = readAppSettings(storageLike);
    const key = sidebarPreferenceKey(pluginId, section, itemId);
    const entries = settings[fieldFor(section)];
    if (!Array.isArray(entries)) return true;
    for (const entry of entries as SidebarPreferenceEntry[]) {
      if (entry && entry.key === key) return entry.visible;
    }
    return true;
  } catch {
    return true;
  }
}

/** Show or hide one plugin sidebar row. */
export function setSidebarEntryVisible(
  pluginId: string,
  section: SidebarSection,
  itemId: string,
  visible: boolean,
): boolean {
  const storageLike = storage();
  if (!storageLike) return false;
  try {
    const settings = readAppSettings(storageLike);
    const field = fieldFor(section);
    const key = sidebarPreferenceKey(pluginId, section, itemId);
    const stored = Array.isArray(settings[field])
      ? [...(settings[field] as SidebarPreferenceEntry[])]
      : [];
    // Drop entries written by the old (wrong) key layout so they cannot shadow
    // the real entry in a future app version that happens to read them.
    const legacy = legacyKeys(pluginId, itemId);
    const entries = stored.filter((entry) => entry && !legacy.has(entry.key));
    const index = entries.findIndex((entry) => entry && entry.key === key);
    if (index >= 0) entries[index] = { key, visible };
    else entries.push({ key, visible });
    settings[field] = entries;
    storageLike.setItem(APP_SETTINGS_KEY, JSON.stringify(settings));
    return true;
  } catch (error) {
    console.warn("[sidebar-hub] Failed to update sidebar visibility", error);
    return false;
  }
}

export interface DiscoveredSidebarRow {
  pluginId: string;
  section: SidebarSection;
  itemId: string;
}

interface ElementLike {
  getAttribute(name: string): string | null;
}

interface DocumentLike {
  querySelectorAll(selector: string): ArrayLike<ElementLike>;
}

function matchKnownPlugin(
  value: string,
  pluginIds: string[],
  separator: string,
): { pluginId: string; itemId: string } | null {
  const sorted = [...pluginIds].sort((a, b) => b.length - a.length);
  for (const pluginId of sorted) {
    const prefix = `${pluginId}${separator}`;
    if (value.startsWith(prefix) && value.length > prefix.length) {
      return { pluginId, itemId: value.slice(prefix.length) };
    }
  }
  return null;
}

/**
 * Rows that actually exist in the running app, found without trusting source
 * scans: rendered sidebar testIDs plus preference keys already in storage.
 * Dynamic item ids (arrays/loops) are only discoverable this way.
 */
export function discoverSidebarRows(pluginIds: string[]): DiscoveredSidebarRow[] {
  const found: DiscoveredSidebarRow[] = [];
  const doc = (globalThis as { document?: DocumentLike }).document;
  if (doc?.querySelectorAll) {
    try {
      const nodes = doc.querySelectorAll('[data-testid^="plugin-sidebar-"]');
      for (let i = 0; i < nodes.length; i += 1) {
        const testId = nodes[i]?.getAttribute("data-testid") ?? "";
        if (testId === "plugin-sidebar-view") continue;
        const footer = testId.startsWith("plugin-sidebar-footer-");
        const section: SidebarSection = footer ? "footer" : "header";
        const rest = testId.slice(footer ? "plugin-sidebar-footer-".length : "plugin-sidebar-".length);
        const match = matchKnownPlugin(rest, pluginIds, "-");
        if (match) found.push({ ...match, section });
      }
    } catch {
      // DOM access can fail in non-web surfaces; preference keys still work.
    }
  }

  const storageLike = storage();
  if (storageLike) {
    try {
      const settings = readAppSettings(storageLike);
      for (const section of ["header", "footer"] as const) {
        const entries = settings[fieldFor(section)];
        if (!Array.isArray(entries)) continue;
        for (const entry of entries as SidebarPreferenceEntry[]) {
          const key = entry?.key;
          if (!key) continue;
          if (key.startsWith("plugin:")) {
            const match = matchKnownPlugin(key.slice("plugin:".length), pluginIds, ":");
            if (match) found.push({ ...match, section });
            continue;
          }
          // Old keys written by this plugin: still describe a real row.
          const headerPrefix = `${key.split("/sidebar/")[0]}/sidebar/`;
          const footerPrefix = `${key.split("/sidebar-footer/")[0]}/sidebar-footer/`;
          if (key.includes("/sidebar/")) {
            const pluginId = key.slice(0, key.indexOf("/sidebar/"));
            if (pluginIds.includes(pluginId)) {
              found.push({ pluginId, section: "header", itemId: key.slice(headerPrefix.length) });
            }
          } else if (key.includes("/sidebar-footer/")) {
            const pluginId = key.slice(0, key.indexOf("/sidebar-footer/"));
            if (pluginIds.includes(pluginId)) {
              found.push({ pluginId, section: "footer", itemId: key.slice(footerPrefix.length) });
            }
          }
        }
      }
    } catch {
      // Corrupt blob: leave discovery to the source scan.
    }
  }

  const seen = new Set<string>();
  return found.filter((row) => {
    const key = `${row.pluginId}/${row.section}/${row.itemId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The app caches settings in memory; a reload makes it re-read the blob. */
export function reloadApp(): void {
  try {
    (globalThis as { location?: { reload(): void } }).location?.reload();
  } catch {
    // Non-web surface; the toggle is only offered on web.
  }
}

/**
 * Navigate to any plugin surface by its route (`/h/<serverId>/plugin/<pluginId>/<kind>/<id>`),
 * the same URL form Paseo builds for screens. Tries a synthetic link click first so Expo Router
 * routes client-side; falls back to a full navigation if the pathname did not move.
 */
export function navigateToSurface(
  serverId: string,
  target: { pluginId: string; kind: string; surfaceId: string },
): boolean {
  const path = `/h/${encodeURIComponent(serverId)}/plugin/${encodeURIComponent(target.pluginId)}/${target.kind}/${encodeURIComponent(target.surfaceId)}`;
  interface NavigableWindow {
    location?: { assign(url: string): void; pathname?: string };
    document?: {
      createElement(tag: string): { href: string; click(): void };
      body?: { appendChild(node: unknown): void; removeChild(node: unknown): void };
    };
  }
  const g = globalThis as NavigableWindow;
  try {
    const doc = g.document;
    if (doc?.body) {
      const anchor = doc.createElement("a");
      anchor.href = path;
      doc.body.appendChild(anchor);
      anchor.click();
      doc.body.removeChild(anchor);
      setTimeout(() => {
        const pathname = g.location?.pathname;
        if (pathname && !pathname.includes("/plugin/")) g.location?.assign(path);
      }, 600);
      return true;
    }
    g.location?.assign(path);
    return true;
  } catch (error) {
    console.warn("[sidebar-hub] Navigation failed", error);
    return false;
  }
}
