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

/** Same layout the app uses: header rows and footer rows store separate keys. */
export function sidebarPreferenceKey(pluginId: string, section: SidebarSection, itemId: string): string {
  return section === "header"
    ? `${pluginId}/sidebar/${itemId}`
    : `${pluginId}/sidebar-footer/${itemId}`;
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
    const entries = Array.isArray(settings[field])
      ? [...(settings[field] as SidebarPreferenceEntry[])]
      : [];
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

/** The app caches settings in memory; a reload makes it re-read the blob. */
export function reloadApp(): void {
  try {
    (globalThis as { location?: { reload(): void } }).location?.reload();
  } catch {
    // Non-web surface; the toggle is only offered on web.
  }
}
