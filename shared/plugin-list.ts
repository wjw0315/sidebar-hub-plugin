import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Installed plugins from the daemon's config.json plus the sidebar items each
 * one registers (scanned from its source) and the screens it registers. The
 * app's sidebar preference key is `plugin:<pluginId>:<itemId>`; the section only
 * picks the settings field (`sidebarNavItems` / `sidebarFooterItems`). Newly
 * installed plugins show up in the settings page without any registration.
 *
 * `screens` matters for the hub menu: a URL can only open a plugin surface that
 * is a registered screen (`addScreen`) or a legacy sidebar item's own surface.
 * A modern `addSidebarHeaderItem`/`FooterItem` has no surface of its own — its
 * row component decides which screen to open — so a plugin with sidebar items
 * but no screens cannot be reached from the hub at all.
 */
export const installedPluginsRpc = defineRpc({
  name: "sidebar-hub.installed-plugins",
  input: z.object({}),
  output: z.object({
    plugins: z.array(
      z.object({
        id: z.string(),
        enabled: z.boolean(),
        /** Display name from the plugin's own manifest, when it has one. */
        name: z.string().nullable(),
        /** Screen ids registered with `addScreen` — the surfaces a URL can open. */
        screens: z.array(z.string()),
        entries: z.array(
          z.object({
            section: z.enum(["header", "footer"]),
            itemId: z.string(),
            /** `addSidebarItem`: carries its own `surface`, so a `sidebar` route opens it. */
            legacy: z.boolean(),
          }),
        ),
      }),
    ),
  }),
});

export type InstalledPlugin = {
  id: string;
  enabled: boolean;
  name: string | null;
  screens: string[];
  entries: Array<{ section: "header" | "footer"; itemId: string; legacy: boolean }>;
};
