import type { PluginServerContext } from "@getpaseo/plugin/server";
import { preferences } from "./shared/bg/settings";
import { hubSettings } from "./shared/hub";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(hubSettings);
  server.registerSettings(preferences);
  return () => {};
}
