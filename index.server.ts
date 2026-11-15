import type { PluginServerContext } from "@getpaseo/plugin/server";
import { preferences } from "./shared/bg/settings";
import { hubSettings } from "./shared/hub";
import { installedPluginsRpc } from "./shared/plugin-list";
import { installedPlugins } from "./server/plugin-list";
import { contributePlaneServer } from "./server/plane-server";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(hubSettings);
  server.registerSettings(preferences);
  server.handle(installedPluginsRpc, installedPlugins);
  const stopPlane = contributePlaneServer(server);
  return async () => {
    await stopPlane();
  };
}
