// DOM exit point for the hub (web only, entered after Platform.OS === "web").
// Reads and writes Paseo's own app-settings blob to toggle plugin sidebar rows.
//
// shortcut: the app-settings key and sidebar-fields layout are Paseo internals
// (packages/app/src/hooks/use-settings), not a plugin API — a Paseo update that
// renames them silently disables the toggle, and the rows can then be hidden by
// hand in Settings > Sidebar.
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

const APP_SETTINGS_KEY = "@paseo:app-settings";

function storage(): StorageLike | null {
  try {
    return (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
  } catch {
    return null;
  }
}

function readAppSettings(storageLike: StorageLike): Record<string, unknown> {
  const raw = storageLike.getItem(APP_SETTINGS_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
}

function preferenceEntry(pluginId: string, entries: unknown): SidebarPreferenceEntry | null {
  if (!Array.isArray(entries)) return null;
  const key = `${pluginId}/screens`;
  for (const entry of entries as SidebarPreferenceEntry[]) {
    if (entry && entry.key === key) return entry;
  }
  return null;
}

/**
 * Whether the plugin's sidebar row (header or footer) is currently shown.
 * Nothing persisted (or no storage) means the default: visible.
 */
export function pluginSidebarVisible(pluginId: string): boolean {
  const storageLike = storage();
  if (!storageLike) return true;
  try {
    const settings = readAppSettings(storageLike);
    for (const field of ["sidebarNavItems", "sidebarFooterItems"]) {
      const entry = preferenceEntry(pluginId, settings[field]);
      if (entry) return entry.visible;
    }
    return true;
  } catch {
    return true;
  }
}

/**
 * Show or hide the plugin's sidebar row by writing both section lists (a key
 * without a matching rendered group is ignored by the app, so writing both is
 * safe for plugins that only render one row).
 */
export function setPluginSidebarVisible(pluginId: string, visible: boolean): boolean {
  const storageLike = storage();
  if (!storageLike) return false;
  try {
    const settings = readAppSettings(storageLike);
    for (const field of ["sidebarNavItems", "sidebarFooterItems"]) {
      const entries = Array.isArray(settings[field])
        ? [...(settings[field] as SidebarPreferenceEntry[])]
        : [];
      const key = `${pluginId}/screens`;
      const index = entries.findIndex((entry) => entry && entry.key === key);
      if (index >= 0) entries[index] = { key, visible };
      else entries.push({ key, visible });
      settings[field] = entries;
    }
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
