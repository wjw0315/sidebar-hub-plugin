import { useEffect, useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import type {
  PluginClientContext,
  PluginPopoverProps,
  PluginSidebarItemProps,
} from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { MODULES, hubDefaults, hubRpc, hubSchema, type HubModule } from "../shared/hub";
import { installedPluginsRpc, type InstalledPlugin } from "../shared/plugin-list";
import { syncHiddenRows } from "./hub-hidden-rows";
import { pluginGroupEntries, type PluginGroupEntry } from "./hub-plugin-entries";
import { navigateToSurface, sidebarEntryVisible } from "./web";

function titleOf(module: HubModule, zh: boolean): string {
  return zh ? module.zhTitle : module.enTitle;
}

function GroupMenu({
  readEnabled,
  readPluginEntries,
  zh,
  theme,
  close,
  openScreen,
  host,
}: PluginPopoverProps & {
  readEnabled: () => Promise<string[]>;
  readPluginEntries: () => Promise<PluginGroupEntry[]>;
  zh: boolean;
}) {
  const [enabled, setEnabled] = useState<string[] | null>(null);
  const [pluginEntries, setPluginEntries] = useState<PluginGroupEntry[]>([]);
  useEffect(() => {
    void readEnabled()
      .then(setEnabled)
      .catch((error: unknown) => {
        console.warn("[sidebar-hub] Module list unavailable, showing all", error);
        setEnabled(hubDefaults().enabled);
      });
  }, [readEnabled]);
  // Plugins whose own sidebar row the user hid: the hub is where they stay reachable.
  useEffect(() => {
    let cancelled = false;
    void readPluginEntries()
      .then((next) => {
        if (!cancelled) setPluginEntries(next);
      })
      .catch((error: unknown) => {
        // Transport error: keep the module list, just without the plugin rows.
        console.warn("[sidebar-hub] Installed plugin list unavailable", error);
      });
    return () => {
      cancelled = true;
    };
  }, [readPluginEntries]);
  const shown = enabled === null ? MODULES : MODULES.filter((m) => enabled.includes(m.id));
  const rowStyle = {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: theme.colors.surface0,
  };
  if (shown.length === 0 && pluginEntries.length === 0) {
    return (
      <View style={{ padding: 12, maxWidth: 260 }}>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
          {zh ? "组内没有启用的模块，去设置里勾选。" : "No modules enabled. Pick some in settings."}
        </Text>
      </View>
    );
  }
  return (
    <View style={{ minWidth: 200 }}>
      {shown.map((module) => (
        <Pressable
          key={module.id}
          accessibilityRole="button"
          accessibilityLabel={titleOf(module, zh)}
          onPress={() => {
            close();
            if (module.externalSurface) {
              navigateToSurface(host.id, module.externalSurface);
            } else if (module.screenId) {
              openScreen({ screenId: module.screenId });
            }
          }}
          style={rowStyle}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>{titleOf(module, zh)}</Text>
        </Pressable>
      ))}
      {pluginEntries.map((entry) => (
        <Pressable
          key={`plugin:${entry.pluginId}`}
          accessibilityRole="button"
          accessibilityLabel={entry.title}
          onPress={() => {
            close();
            navigateToSurface(host.id, { ...entry.target, pluginId: entry.pluginId });
          }}
          style={rowStyle}
        >
          <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>{entry.title}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function createHubItem(client: PluginClientContext) {
  async function readEnabled(): Promise<string[]> {
    const result = await client.rpc(hubRpc.read, {});
    if (result.status !== "ready" || result.values === null) return hubDefaults().enabled;
    // settingsRpc returns values as loose JSON; parse against the schema like bg's controller does.
    const parsed = hubSchema.safeParse(result.values);
    return parsed.success ? parsed.data.enabled : hubDefaults().enabled;
  }
  /**
   * Plugin rows the user hid from the sidebar, one entry per plugin. Modules that
   * the hub already lists itself (server-browser / vivid-activity) are excluded so
   * the same target never appears twice.
   *
   * The daemon scan costs ~0.6–0.9 s across 23 installed plugins, so the raw plugin
   * list is cached briefly; row visibility is still read fresh every open (it comes
   * from the app-settings blob, not from this scan).
   */
  let pluginScan: { at: number; plugins: InstalledPlugin[] } | null = null;
  async function readPlugins(): Promise<InstalledPlugin[]> {
    const now = Date.now();
    if (pluginScan && now - pluginScan.at < 30_000) return pluginScan.plugins;
    const data = await client.rpc(installedPluginsRpc, {});
    pluginScan = { at: now, plugins: data.plugins };
    return data.plugins;
  }
  async function readPluginEntries(): Promise<PluginGroupEntry[]> {
    if (Platform.OS !== "web") return [];
    const plugins = await readPlugins();
    const ownModulePlugins = MODULES.flatMap((module) =>
      module.externalSurface ? [module.externalSurface.pluginId] : [],
    );
    return pluginGroupEntries(
      plugins,
      (pluginId, section, itemId) => sidebarEntryVisible(pluginId, section, itemId),
      ["sidebar-hub", ...ownModulePlugins],
      (message) => console.warn(message),
    );
  }
  const locale: string = (client as { i18n?: { locale?: string } }).i18n?.locale ?? "";
  const zh = locale.startsWith("zh");
  function HubItem({ openPopover }: PluginSidebarItemProps) {
    // Heal hidden source rows on every mount (web only). The popover cannot
    // hide them, and waiting for a settings-screen visit meant default-enabled
    // external modules kept their own rows visible forever. Reads fail soft:
    // transport errors skip the heal, no saved settings (null) means the
    // schema defaults. Writes apply at the next app-side read (launch or the
    // settings screen's "Reload now"); this never reloads on its own.
    useEffect(() => {
      if (Platform.OS !== "web") return;
      let cancelled = false;
      void (async () => {
        try {
          const result = await client.rpc(hubRpc.read, {});
          if (cancelled || result.status !== "ready") return;
          const enabled =
            result.values === null
              ? hubDefaults().enabled
              : hubSchema.safeParse(result.values).success
                ? hubSchema.parse(result.values).enabled
                : null;
          if (enabled) syncHiddenRows(enabled);
        } catch {
          // Retry happens on the next mount or settings open.
        }
      })();
      return () => {
        cancelled = true;
      };
    }, []);
    return (
      <SidebarRow
        icon="Folders"
        onPress={() =>
          openPopover((props) => (
            <GroupMenu {...props} readEnabled={readEnabled} readPluginEntries={readPluginEntries} zh={zh} />
          ))
        }
      />
    );
  }
  return HubItem;
}
