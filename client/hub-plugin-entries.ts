import type { InstalledPlugin } from "../shared/plugin-list";

/**
 * A plugin's entry in the hub group menu.
 *
 * The hub is where a plugin stays reachable after the user hides that plugin's
 * own sidebar row （设置页「插件侧栏条目」的开关）. Only plugins with at least one
 * hidden row qualify — a visible row is still in the sidebar, and listing it
 * twice would just be noise.
 *
 * `target` is what the app's surface route can actually open:
 * - `sidebar`: a legacy item id; the app resolves the surface that item declares.
 * - `surface`: a screen id from `addScreen`. A modern sidebar item has no
 *   surface of its own (its row component picks the screen), so a screen id is
 *   the only address we can build without running the plugin's row code.
 */
export interface PluginGroupEntry {
  pluginId: string;
  title: string;
  target: { kind: "surface" | "sidebar"; surfaceId: string };
}

type ScannedRow = InstalledPlugin["entries"][number];

function targetFor(plugin: InstalledPlugin, hidden: ScannedRow[]): PluginGroupEntry["target"] | null {
  // A legacy item carries its own surface, so the app can always open it.
  const legacy = hidden.find((row) => row.legacy);
  if (legacy) return { kind: "sidebar", surfaceId: legacy.itemId };
  // Otherwise prefer the screen the hidden row was most likely made for.
  const paired = hidden.find((row) => plugin.screens.includes(row.itemId));
  if (paired) return { kind: "surface", surfaceId: paired.itemId };
  if (plugin.screens.length > 0) return { kind: "surface", surfaceId: plugin.screens[0] };
  return null;
}

/** One entry per plugin that currently has hidden sidebar rows, titled by its manifest name. */
export function pluginGroupEntries(
  plugins: readonly InstalledPlugin[],
  isVisible: (pluginId: string, section: "header" | "footer", itemId: string) => boolean,
  excludePluginIds: readonly string[] = [],
  warn: (message: string) => void = () => {},
): PluginGroupEntry[] {
  const excluded = new Set(excludePluginIds);
  const entries: PluginGroupEntry[] = [];
  for (const plugin of plugins) {
    if (!plugin.enabled || excluded.has(plugin.id)) continue;
    const hidden = plugin.entries.filter((row) => !isVisible(plugin.id, row.section, row.itemId));
    if (hidden.length === 0) continue;
    const target = targetFor(plugin, hidden);
    if (!target) {
      // A dead menu entry is worse than a missing one: say why in the console.
      warn(
        `[sidebar-hub] ${plugin.id}: 侧栏条目已隐藏，但它没有注册 screen，菜单里无法跳转，已跳过`,
      );
      continue;
    }
    entries.push({ pluginId: plugin.id, title: plugin.name ?? plugin.id, target });
  }
  return entries.sort((a, b) => a.title.localeCompare(b.title));
}
