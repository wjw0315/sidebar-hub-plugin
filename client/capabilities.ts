import { Platform } from "react-native";
import type { HubModule } from "../shared/hub";

/**
 * What the hub can actually do on the platform this bundle is running on.
 *
 * Two capabilities are web-only by construction, not by oversight:
 * - Row visibility lives in Paseo's app-settings blob, read/written through
 *   `localStorage` (see client/web.ts). React Native has no such global and
 *   the plugin API exposes no host-settings channel, so a phone cannot hide
 *   another plugin's sidebar row — neither automatically nor from settings.
 * - Cross-plugin navigation builds a URL (`/h/<server>/plugin/<id>/<kind>/<id>`)
 *   and clicks a synthetic anchor. Native has no router on `globalThis`.
 *
 * Consumers must filter on these instead of assuming the web behaviour.
 */
export const isWeb = Platform.OS === "web";

export const canManageSidebarRows = isWeb;

export const canNavigateToSurface = isWeb;

/**
 * Whether the group menu can open this module here.
 *
 * `webOnly` modules are registered only on web (the background screen is part
 * of the web-only branch in index.client.tsx), and every `externalSurface`
 * module needs URL navigation. Everything else uses `openScreen`, which the
 * plugin API exposes on all platforms.
 */
export function moduleAvailable(module: HubModule): boolean {
  if (module.webOnly) return isWeb;
  if (module.externalSurface) return canNavigateToSurface;
  return true;
}
