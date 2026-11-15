import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Installed plugins as recorded in the daemon's config.json. The sidebar row
 * toggle writes `${id}/screens` visibility into the app-settings blob, and this
 * manifest id is exactly that config key, so newly installed plugins show up in
 * the settings page without any registration.
 */
export const installedPluginsRpc = defineRpc({
  name: "sidebar-hub.installed-plugins",
  input: z.object({}),
  output: z.object({
    plugins: z.array(
      z.object({
        id: z.string(),
        enabled: z.boolean(),
      }),
    ),
  }),
});
