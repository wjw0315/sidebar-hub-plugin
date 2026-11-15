import { useEffect, useState } from "react";
import { Text } from "react-native";
import type { PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { MODULES, hubDefaults, hubRpc, hubSchema } from "../shared/hub";

export function createHubSettingsScreen(client: PluginClientContext) {
  return function HubSettingsScreen(_props: PluginSurfaceProps) {
    const [enabled, setEnabled] = useState<string[]>(hubDefaults().enabled);
    const [revision, setRevision] = useState("");
    const [error, setError] = useState<string | null>(null);
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
    );
  };
}
