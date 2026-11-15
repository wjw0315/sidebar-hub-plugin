import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Plane 插件配置：连接自托管 Plane 实例并选择目标 workspace。
 * project 是看板数据级字段，在看板中切换，不留在设置里。
 *
 * 每个字段各自降级到默认值，单个非法值不会使整个记录失效。
 * 配置持久化由 daemon 通过 `server.registerSettings` 自动处理，
 * 客户端经 `settingsRpc` 读写。
 */
export const PLANE_SETTINGS = defineSettings({
  id: "plane",
  scope: "host",
  version: 2,
  schema: z.object({
    baseUrl: z.string().default(""),
    apiKey: z.string().default(""),
    workspace: z.string().default(""),
    apiVersion: z.enum(["v1", "v2"]).default("v2"),
    webhookEnabled: z.boolean().default(false),
    webhookSecret: z.string().default(""),
    webhookPort: z.number().int().min(1).max(65535).default(8788),
  }),
});

export type PlaneConfig = z.infer<typeof PLANE_SETTINGS.schema>;
