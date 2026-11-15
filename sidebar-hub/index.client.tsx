import { Platform, ScrollView } from "react-native";
import type { PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { createController } from "./client/bg/controller";
import { createSettingsScreen } from "./client/bg/settings-screen";
import { language } from "./client/bg/web";
import { createHubItem } from "./client/hub-item";
import { createHubSettingsScreen } from "./client/hub-settings";

export default function contribute(client: PluginClientContext) {
  // Hub group: one footer row whose popover lists the enabled modules, plus the
  // settings screen that decides what is in the group.
  client.addSidebarFooterItem({ id: "hub", title: "Sidebar Hub", Component: createHubItem(client) });
  client.addSettingsScreen({
    id: "hub-settings",
    title: "Sidebar Hub",
    icon: "Folders",
    Component: createHubSettingsScreen(client),
  });
  client.addCommandCenterItem({
    id: "hub-configure",
    title: "Configure Sidebar Hub",
    icon: "Folders",
    keywords: ["sidebar", "hub", "分组", "折叠"],
    context: "global",
    onSelect({ openSettings }) {
      openSettings("hub-settings");
    },
  });

  // Background module, moved from the standalone bg plugin (web-only there too).
  if (Platform.OS === "web") {
    const controller = createController(client);
    const Settings = createSettingsScreen(controller);
    const zh = language() === "zh";
    const title = zh ? "背景" : "Backgrounds";
    client.addSettingsScreen({ id: "background", title, icon: "Image", Component: Settings });
    client.addScreen({
      id: "hub-background",
      title,
      Component: (props: PluginSurfaceProps) => (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }}>
          <Settings {...props} />
        </ScrollView>
      ),
    });
    client.addCommandCenterItem({
      id: "open-background",
      title: zh ? "打开背景设置" : "Open background settings",
      icon: "Image",
      keywords: ["background", "wallpaper", "opacity", "背景", "透明度"],
      context: "global",
      onSelect: ({ openSettings }) => openSettings("background"),
    });
    client.addCommandCenterItem({
      id: "toggle-background",
      title: zh ? "切换背景开关" : "Toggle background",
      icon: "Image",
      keywords: ["background", "wallpaper", "背景"],
      context: "global",
      async onSelect() {
        await controller.toggle();
      },
    });
    return () => controller.dispose();
  }
  return () => {};
}
