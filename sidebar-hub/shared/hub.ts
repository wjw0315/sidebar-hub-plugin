import { defineSettings, settingsRpc } from "@getpaseo/plugin";
import { z } from "zod";

// A module is a plugin surface moved into the hub. Adding a module = add an
// entry here + move its code under client/<id>/ and shared/<id>/, then register
// its screen in index.client.tsx. The toggle list renders from this table.
export interface HubModule {
  id: string;
  /** Hub screen opened from the group popover. */
  screenId: string;
  /** Lucide icon name. */
  icon: string;
  enTitle: string;
  zhTitle: string;
}

export const MODULES: HubModule[] = [
  { id: "background", screenId: "hub-background", icon: "Image", enTitle: "Backgrounds", zhTitle: "背景" },
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
