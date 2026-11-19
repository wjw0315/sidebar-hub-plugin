import { defineSettings, settingsRpc } from "@getpaseo/plugin";
import { z } from "zod";

// A module is a plugin surface moved into the hub. Adding a module = add an
// entry here + move its code under client/<id>/ and shared/<id>/, then register
// its screen in index.client.tsx. The toggle list renders from this table.
export interface HubModule {
  id: string;
  /** Hub screen opened from the group popover. Modules transplanted into the hub set this. */
  screenId?: string;
  /**
   * External plugin surface, opened by URL navigation — no code moved, plugin keeps running.
   * `kind` is Paseo's route segment, and it must be `surface` / `sidebar`: the app parses
   * `/h/<serverId>/plugin/<pluginId>/(sidebar|surface)/<id>` and anything else fails to parse
   * (the route renders nothing, so the entry looks dead). A plugin's `addScreen` id is reached
   * as `surface`; a legacy sidebar item id as `sidebar`. Settings screens are a different route
   * (`buildPluginSettingsRoute`) and are not reachable this way.
   */
  externalSurface?: { pluginId: string; kind: "surface" | "sidebar"; surfaceId: string };
  /** The plugin's own sidebar row, hidden while the module is checked, restored when unchecked. */
  sourceSidebarEntry?: { section: "header" | "footer"; itemId: string };
  /**
   * Registered only in the web branch of index.client.tsx (DOM-dependent).
   * Native builds must not list it — `openScreen` would target a screen that
   * was never added, which renders nothing and looks like a dead entry.
   */
  webOnly?: boolean;
  /** Lucide icon name. */
  icon: string;
  enTitle: string;
  zhTitle: string;
}

export const MODULES: HubModule[] = [
  {
    id: "background",
    screenId: "hub-background",
    webOnly: true,
    icon: "Image",
    enTitle: "Backgrounds",
    zhTitle: "背景",
  },
  { id: "plane", screenId: "plane-board", icon: "SquareKanban", enTitle: "Plane Board", zhTitle: "Plane 任务看板" },
  {
    id: "server-browser",
    externalSurface: { pluginId: "server-browser", kind: "surface", surfaceId: "server-browser" },
    sourceSidebarEntry: { section: "header", itemId: "server-browser" },
    icon: "MonitorSmartphone",
    enTitle: "Server Browser",
    zhTitle: "服务器浏览器",
  },
  {
    id: "vivid-activity",
    externalSurface: { pluginId: "vivid-activity", kind: "surface", surfaceId: "settings" },
    sourceSidebarEntry: { section: "header", itemId: "settings" },
    icon: "Activity",
    enTitle: "Vivid Activity",
    zhTitle: "彩色活动行",
  },
  // 二期移植 Chat Polish 时在此登记：{ id: "polish", screenId: "hub-polish", icon: "Sparkles", enTitle: "Chat Polish", zhTitle: "Chat Polish" }
];

export const hubSchema = z.object({
  enabled: z.array(z.string()).default(MODULES.map((m) => m.id)),
});

export type HubSettings = z.infer<typeof hubSchema>;

export const hubSettings = defineSettings({
  id: "hub",
  scope: "host",
  version: 1,
  schema: hubSchema,
});

export const hubRpc = settingsRpc(hubSettings.id);

export const hubDefaults = (): HubSettings => hubSchema.parse({});
