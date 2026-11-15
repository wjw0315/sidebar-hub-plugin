import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PlaneScreen } from "./plane-screen";
import { PlaneSettingsPage } from "./plane-settings-page";
import { PLANE_SCREEN_ID } from "../../shared/plane/plane-ids";

/**
 * 装配 Plane 模块的贡献点（自 plane-plugin 移植进 sidebar-hub）：
 * - 看板屏幕（`addScreen`）
 * - 命令中心入口（`addCommandCenterItem`）
 * - 配置设置页（`addSettingsScreen`）
 * 侧边栏头部入口不再注册——由 hub 的分组 popover 统一提供。
 *
 * 返回的清理函数在插件卸载时依次调用各贡献点的 remove。
 */
export function contributePlane(client: PluginClientContext): () => void {
  const cleanups: Array<() => void> = [
    client.addScreen({
      id: PLANE_SCREEN_ID,
      title: "Plane 任务看板",
      Component: PlaneScreen,
    }),
    client.addCommandCenterItem({
      id: "open-plane-board",
      title: "打开 Plane 任务看板",
      icon: "SquareKanban",
      keywords: ["plane", "看板", "任务", "board", "kanban"],
      context: "global",
      onSelect: (context) => {
        context.openScreen({ screenId: PLANE_SCREEN_ID });
      },
    }),
    client.addSettingsScreen({
      id: "plane-settings",
      title: "Plane",
      icon: "Blocks",
      Component: PlaneSettingsPage,
    }),
  ];

  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}
