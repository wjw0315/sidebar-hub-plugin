import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RpcInput } from "@getpaseo/plugin";
import { installedPluginsRpc } from "../shared/plugin-list";

/**
 * Reads the daemon's config.json plugins section. The config key is the
 * plugin's manifest id, which is exactly the prefix the app uses for sidebar
 * preference keys (`<id>/screens`), so this list drives the toggle directly.
 */
export async function installedPlugins(_input: RpcInput<typeof installedPluginsRpc>) {
  const home = process.env.PASEO_HOME || join(homedir(), ".paseo");
  const configPath = join(home, "config.json");
  try {
    const raw = await readFile(configPath, "utf8");
    const config = JSON.parse(raw) as {
      plugins?: Record<string, { enabled?: boolean }>;
    };
    const plugins = Object.entries(config.plugins ?? {}).map(([id, entry]) => ({
      id,
      enabled: entry?.enabled !== false,
    }));
    plugins.sort((a, b) => a.id.localeCompare(b.id));
    return { plugins };
  } catch (error) {
    console.warn("[sidebar-hub] config.json unreadable, plugin list unavailable", error);
    return { plugins: [] };
  }
}
