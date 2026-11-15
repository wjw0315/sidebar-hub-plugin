import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Installed plugins from the daemon's config.json plus the sidebar items each
 * one registers (scanned from its source). The app's sidebar preference key is
 * `<pluginId>/sidebar/<itemId>` for header rows and
 * `<pluginId>/sidebar-footer/<itemId>` for footer rows, so this list drives the
 * per-row toggle. Newly installed plugins show up in the settings page without
 * any registration.
 */
export const installedPluginsRpc = defineRpc({
  name: "sidebar-hub.installed-plugins",
  input: z.object({}),
  output: z.object({
    plugins: z.array(
      z.object({
        id: z.string(),
        enabled: z.boolean(),
        entries: z.array(
          z.object({
            section: z.enum(["header", "footer"]),
            itemId: z.string(),
          }),
        ),
      }),
    ),
  }),
});
