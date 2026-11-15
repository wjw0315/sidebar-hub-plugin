import { useEffect, useState } from "react";
import { Platform, Text } from "react-native";
import type { PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { MODULES, hubDefaults, hubRpc, hubSchema } from "../shared/hub";
import { installedPluginsRpc } from "../shared/plugin-list";
import { pluginSidebarVisible, reloadApp, setPluginSidebarVisible } from "./web";

export function createHubSettingsScreen(client: PluginClientContext) {
  return function HubSettingsScreen(_props: PluginSurfaceProps) {
    const [enabled, setEnabled] = useState<string[]>(hubDefaults().enabled);
    const [revision, setRevision] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [dirty, setDirty] = useState(false);
    const locale: string = (client as { i18n?: { locale?: string } }).i18n?.locale ?? "";
    const zh = locale.startsWith("zh");

    useEffect(() => {
      client
        .rpc(hubRpc.read, {})
        .then((result) => {
          if (result.status !== "ready") {
            setError(result.error);
            return;
          }
          // settingsRpc returns values as loose JSON; parse against the schema.
          const parsed = hubSchema.safeParse(result.values);
          if (parsed.success) {
            setEnabled(parsed.data.enabled);
            setRevision(result.revision);
          } else {
            setError(parsed.error.message);
          }
        })
        .catch((e: unknown) => setError(String(e)));
    }, []);

    async function toggle(id: string, value: boolean) {
      const next = value ? [...new Set([...enabled, id])] : enabled.filter((x) => x !== id);
      setEnabled(next);
      try {
        const result = await client.rpc(hubRpc.write, { values: { enabled: next }, revision });
        if (result.status !== "saved") {
          setError(result.error);
          return;
        }
        const parsed = hubSchema.safeParse(result.values);
        if (parsed.success) {
          setEnabled(parsed.data.enabled);
          setRevision(result.revision);
          setError(null);
        }
      } catch (e) {
        setError(String(e));
      }
    }

    return (
      <>
        <SettingsSection
          title={zh ? "组内模块" : "Modules in the group"}
          info={zh ? "勾选的模块出现在侧栏分组菜单里" : "Checked modules appear in the sidebar group menu"}
        >
          <SettingsCard>
            {MODULES.map((module) => (
              <SettingsSwitch
                key={module.id}
                label={zh ? module.zhTitle : module.enTitle}
                value={enabled.includes(module.id)}
                onValueChange={(value) => void toggle(module.id, value)}
              />
            ))}
          </SettingsCard>
          {error ? (
            <Text style={{ paddingHorizontal: 16, fontSize: 12, color: "red" }}>{error}</Text>
          ) : null}
        </SettingsSection>
        {Platform.OS === "web" ? <SidebarRowsSection zh={zh} dirty={dirty} setDirty={setDirty} /> : null}
      </>
    );
  };
}

function SidebarRowsSection({
  zh,
  dirty,
  setDirty,
}: {
  zh: boolean;
  dirty: boolean;
  setDirty: (value: boolean) => void;
}) {
  const list = useRpc(installedPluginsRpc);
  const { data } = useQuery({
    queryKey: ["sidebar-hub", "installed-plugins"],
    queryFn: async () => list({}),
    staleTime: 30_000,
  });
  // Initial visibility reads the app-settings blob once on mount.
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  useEffect(() => {
    if (!data) return;
    const next: Record<string, boolean> = {};
    for (const plugin of data.plugins) next[plugin.id] = pluginSidebarVisible(plugin.id);
    setVisible(next);
  }, [data]);

  function toggle(pluginId: string, value: boolean) {
    if (setPluginSidebarVisible(pluginId, value)) {
      setVisible((current) => ({ ...current, [pluginId]: value }));
      setDirty(true);
    }
  }

  return (
    <SettingsSection
      title={zh ? "插件侧栏条目" : "Plugin sidebar rows"}
      info={
        zh
          ? "控制每个插件自己的条目是否显示在左侧栏（新装插件自动出现在这里）"
          : "Show or hide each plugin's own sidebar row, including newly installed plugins"
      }
    >
      <SettingsCard>
        {(data?.plugins ?? [])
          .filter((plugin) => plugin.id !== "sidebar-hub" && plugin.enabled)
          .map((plugin) => (
            <SettingsSwitch
              key={plugin.id}
              label={plugin.id}
              value={visible[plugin.id] !== false}
              onValueChange={(value) => toggle(plugin.id, value)}
            />
          ))}
      </SettingsCard>
      {dirty ? (
        <SettingsCard>
          <SettingsAction
            label={zh ? "改动已保存，刷新应用后生效（尽快刷新，避免被其他设置写回覆盖）" : "Saved. Reload the app to apply (soon, to avoid being overwritten)."}
            actionLabel={zh ? "立即刷新" : "Reload now"}
            onPress={() => reloadApp()}
          />
        </SettingsCard>
      ) : null}
    </SettingsSection>
  );
}
