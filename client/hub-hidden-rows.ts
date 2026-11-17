import { Platform } from "react-native";
import { MODULES } from "../shared/hub";
import { setSidebarEntryVisible, sidebarEntryVisible } from "./web";

/**
 * Enabling a module must hide its plugin's own sidebar row. This runs on every
 * hub entry mount (the footer row is always rendered) and on every settings
 * open — the hub popover cannot hide rows (it only navigates), so relying on
 * the settings screen alone meant default-enabled external modules kept both
 * rows visible until the user happened to open settings on that device.
 *
 * Writes land in the app-settings blob and take effect the next time the app
 * reads it (next launch, or the settings screen's "Reload now"). This helper
 * never reloads the app on its own.
 */
export function syncHiddenRows(enabledIds: string[]): boolean {
  if (Platform.OS !== "web") return false;
  let changed = false;
  for (const module of MODULES) {
    if (!module.sourceSidebarEntry || !enabledIds.includes(module.id)) continue;
    const pluginId = module.externalSurface?.pluginId ?? "sidebar-hub";
    const { section, itemId } = module.sourceSidebarEntry;
    if (sidebarEntryVisible(pluginId, section, itemId)) {
      if (setSidebarEntryVisible(pluginId, section, itemId, false)) changed = true;
    }
  }
  return changed;
}
