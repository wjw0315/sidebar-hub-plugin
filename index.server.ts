import type { PluginServerContext } from "@getpaseo/plugin/server";
import { preferences } from "./shared/bg/settings";
import { hubSettings } from "./shared/hub";
import { contributePlaneServer } from "./server/plane-server";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(hubSettings);
  server.registerSettings(preferences);
  const stopPlane = contributePlaneServer(server);
  return async () => {
    await stopPlane();
  };
}
