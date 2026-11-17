import { useEffect, useMemo, useState } from "react";
import { Platform, Text } from "react-native";
import type { PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { MODULES, hubDefaults, hubRpc, hubSchema, type HubModule } from "../shared/hub";
import { installedPluginsRpc } from "../shared/plugin-list";
import { syncHiddenRows } from "./hub-hidden-rows";
import {
  discoverSidebarRows,
  reloadApp,
  setSidebarEntryVisible,
  sidebarEntryVisible,
  type DiscoveredSidebarRow,
} from "./web";

export function createHubSettingsScreen(client: PluginClientContext) {
  return function HubSettingsScreen(_props: PluginSurfaceProps) {
    const [enabled, setEnabled] = useState<string[]>(hubDefaults().enabled);
    const [revision, setRevision] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [pending, setPending] = useState(false);
    const locale: string = (client as { i18n?: { locale?: string } }).i18n?.locale ?? "";
    const zh = locale.startsWith("zh");

    useEffect(() => {
      client
        .rpc(hubRpc.read, {})
        .then((result) => {
          if (result.status !== "ready") {
            setError(result.error);
            if (syncHiddenRows(hubDefaults().enabled)) setPending(true);
            return;
          }
          // settingsRpc returns values as loose JSON; parse against the schema.
          const parsed = hubSchema.safeParse(result.values);
          if (parsed.success) {
            setEnabled(parsed.data.enabled);
            setRevision(result.revision);
            if (syncHiddenRows(parsed.data.enabled)) setPending(true);
          } else {
            setError(parsed.error.message);
          }
        })
        .catch((e: unknown) => setError(String(e)));
    }, []);

    async function toggle(id: string, value: boolean) {
      const next = value ? [...new Set([...enabled, id])] : enabled.filter((x) => x !== id);
      setEnabled(next);
      // A checked module takes over its plugin's own sidebar row; unchecked hands it back.
      const module = MODULES.find((m) => m.id === id);
      if (module?.sourceSidebarEntry && Platform.OS === "web") {
        const pluginId = module.externalSurface?.pluginId ?? "sidebar-hub";
        if (setSidebarEntryVisible(pluginId, module.sourceSidebarEntry.section, module.sourceSidebarEntry.itemId, !value)) {
          setPending(true);
        }
      }
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
          info={
            zh
              ? "勾选的模块出现在侧栏分组菜单里；勾选外部插件时它自己的侧栏条目会自动隐藏"
              : "Checked modules appear in the sidebar group menu; checking an external plugin hides its own sidebar row"
          }
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
        {Platform.OS === "web" ? <SidebarRowsSection zh={zh} setPending={setPending} /> : null}
        {pending ? (
          <SettingsSection title={zh ? "待生效" : "Pending changes"}>
            <SettingsCard>
              <SettingsAction
                label={zh ? "改动已保存，刷新应用后生效（尽快刷新，避免被其他设置写回覆盖）" : "Saved. Reload the app to apply (soon, to avoid being overwritten)."}
                actionLabel={zh ? "立即刷新" : "Reload now"}
                onPress={() => reloadApp()}
              />
            </SettingsCard>
          </SettingsSection>
        ) : null}
      </>
    );
  };
}

function SidebarRowsSection({
  zh,
  setPending,
}: {
  zh: boolean;
  setPending: (value: boolean) => void;
}) {
  const list = useRpc(installedPluginsRpc);
  const { data, refetch } = useQuery({
    queryKey: ["sidebar-hub", "installed-plugins"],
    queryFn: async () => list({}),
    // New installs must appear without restarting the app.
    staleTime: 0,
    refetchOnMount: "always",
  });
  // Initial visibility reads the app-settings blob once per row set.
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  // Rows the source scan cannot see (dynamic ids) come from the live DOM/storage.
  const [discovered, setDiscovered] = useState<DiscoveredSidebarRow[]>([]);

  const plugins = useMemo(() => data?.plugins ?? [], [data]);

  const scanned = useMemo(
    () =>
      plugins.flatMap((plugin) =>
        plugin.entries.map((entry) => ({
          pluginId: plugin.id,
          section: entry.section,
          itemId: entry.itemId,
        })),
      ),
    [plugins],
  );

  const knownIds = useMemo(() => plugins.map((plugin) => plugin.id), [plugins]);

  useEffect(() => {
    setDiscovered(discoverSidebarRows(knownIds));
  }, [knownIds]);

  const rows = useMemo(() => {
    const map = new Map<string, (typeof scanned)[number] & { key: string }>();
    for (const row of [...scanned, ...discovered]) {
      const key = `${row.pluginId}/${row.section}/${row.itemId}`;
      if (!map.has(key)) map.set(key, { key, ...row });
    }
    return [...map.values()];
  }, [scanned, discovered]);

  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const row of rows) next[row.key] = sidebarEntryVisible(row.pluginId, row.section, row.itemId);
    setVisible(next);
  }, [rows]);

  function toggle(row: (typeof rows)[number], value: boolean) {
    if (setSidebarEntryVisible(row.pluginId, row.section, row.itemId, value)) {
      setVisible((current) => ({ ...current, [row.key]: value }));
      setPending(true);
    }
  }

  async function refresh() {
    try {
      const result = await refetch();
      const ids = (result.data?.plugins ?? []).map((plugin) => plugin.id);
      setDiscovered(discoverSidebarRows(ids));
    } catch {
      // Keep the current list; the error banner above reports RPC failures.
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
        {rows.map((row) => (
          <SettingsSwitch
            key={row.key}
            label={zh ? `${row.pluginId}（${row.section === "header" ? "上" : "下"}区）` : `${row.pluginId} · ${row.section}`}
            value={visible[row.key] !== false}
            onValueChange={(value) => toggle(row, value)}
          />
        ))}
        {rows.length === 0 ? (
          <Text style={{ paddingHorizontal: 16, fontSize: 12, color: "gray" }}>
            {zh ? "未发现可管理的侧栏条目" : "No manageable sidebar rows found"}
          </Text>
        ) : null}
        <SettingsAction
          label={zh ? "刚装的插件没出现？重新扫描一次" : "Newly installed plugin missing? Rescan"}
          actionLabel={zh ? "刷新列表" : "Refresh"}
          onPress={() => void refresh()}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
