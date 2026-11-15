import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { TextInput } from "@getpaseo/plugin/client/ui";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { settingsRpc } from "@getpaseo/plugin";
import { PLANE_SETTINGS, type PlaneConfig } from "../../shared/plane/plane-settings";

const DEFAULT_CONFIG: PlaneConfig = {
  baseUrl: "",
  apiKey: "",
  workspace: "",
  apiVersion: "v2",
  webhookEnabled: false,
  webhookSecret: "",
  webhookPort: 8788,
};

type TextField = keyof Omit<PlaneConfig, "apiVersion">;

/**
 * Plane 配置设置页（`addSettingsScreen`）。
 *
 * 读取当前配置填充表单，保存时经 `settingsRpc.write` 持久化到 daemon。
 * 配置缺失或非法时给出明确提示，不崩溃。
 */
export function PlaneSettingsPage(props: PluginSurfaceProps) {
  const { theme } = props;
  const c = theme.colors;
  const readSettings = useRpc(settingsRpc(PLANE_SETTINGS.id).read);
  const writeSettings = useRpc(settingsRpc(PLANE_SETTINGS.id).write);

  const [revision, setRevision] = useState<string | null>(null);
  const [form, setForm] = useState<PlaneConfig>(DEFAULT_CONFIG);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await readSettings({});
        if (cancelled) return;
        if (result.status === "ready") {
          setRevision(result.revision);
          setForm(result.values as PlaneConfig);
        } else {
          setError(result.error ?? "配置读取失败，将使用默认值");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    setStatus(null);
    setError(null);
    if (!revision) {
      setError("配置尚未加载完成，无法保存");
      return;
    }
    setStatus("保存中…");
    try {
      const result = await writeSettings({ revision, values: form });
      if (result.status === "saved") {
        setRevision(result.revision);
        setStatus("已保存");
        setTimeout(() => setStatus(null), 2000);
      } else if (result.status === "conflict") {
        setStatus(null);
        setError("配置已被其他端修改，请重新加载后再保存");
      } else {
        setStatus(null);
        setError(result.error ?? "保存失败");
      }
    } catch (e) {
      setStatus(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const updateField = (field: TextField, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const setApiVersion = (v: "v1" | "v2") => {
    setForm((prev) => ({ ...prev, apiVersion: v }));
  };

  const setWebhookEnabled = (v: boolean) => {
    setForm((prev) => ({ ...prev, webhookEnabled: v }));
  };

  const setWebhookPort = (v: string) => {
    const port = Number(v);
    setForm((prev) => ({ ...prev, webhookPort: Number.isFinite(port) ? Math.trunc(port) : prev.webhookPort }));
  };

  const inputStyle: object = {
    backgroundColor: c.surface1,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: c.foreground,
    fontSize: 14,
    marginBottom: 16,
  };

  const labelStyle: object = {
    color: c.foregroundMuted,
    fontSize: 13,
    fontWeight: "500",
    marginBottom: 6,
    marginLeft: 2,
  };

  return (
    <ScrollView style={[styles.container, { backgroundColor: c.surface0 }]} contentContainerStyle={styles.content}>
      <Text style={[styles.title, { color: c.foreground }]}>Plane 连接</Text>

      <Text style={labelStyle}>Base URL</Text>
      <TextInput
        style={inputStyle}
        value={form.baseUrl}
        onChangeText={(v) => updateField("baseUrl", v)}
        placeholder="https://plane.example.com"
        placeholderTextColor={c.foregroundMuted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
      />

      <Text style={labelStyle}>API Key</Text>
      <TextInput
        style={inputStyle}
        value={form.apiKey}
        onChangeText={(v) => updateField("apiKey", v)}
        placeholder="个人访问令牌 (X-Api-Key)"
        placeholderTextColor={c.foregroundMuted}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />

      <Text style={labelStyle}>Workspace</Text>
      <TextInput
        style={inputStyle}
        value={form.workspace}
        onChangeText={(v) => updateField("workspace", v)}
        placeholder="workspace slug"
        placeholderTextColor={c.foregroundMuted}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={labelStyle}>API 版本</Text>
      <View style={[styles.segmented, { backgroundColor: c.surface1, borderColor: c.border }]}>
        <Pressable
          onPress={() => setApiVersion("v1")}
          style={[
            styles.segment,
            { backgroundColor: form.apiVersion === "v1" ? c.accent : "transparent", borderColor: c.border },
          ]}
        >
          <Text style={[styles.segmentText, { color: form.apiVersion === "v1" ? c.accentForeground : c.foregroundMuted }]}>
            v1
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setApiVersion("v2")}
          style={[
            styles.segment,
            { backgroundColor: form.apiVersion === "v2" ? c.accent : "transparent", borderColor: c.border },
          ]}
        >
          <Text style={[styles.segmentText, { color: form.apiVersion === "v2" ? c.accentForeground : c.foregroundMuted }]}>
            v2
          </Text>
        </Pressable>
      </View>

      <Text style={[styles.title, { color: c.foreground, fontSize: 16, marginTop: 16, marginBottom: 12 }]}>
        Webhook（可选）
      </Text>

      <View style={[styles.segmented, { backgroundColor: c.surface1, borderColor: c.border }]}>
        <Pressable
          onPress={() => setWebhookEnabled(false)}
          style={[
            styles.segment,
            { backgroundColor: !form.webhookEnabled ? c.accent : "transparent", borderColor: c.border },
          ]}
        >
          <Text style={[styles.segmentText, { color: !form.webhookEnabled ? c.accentForeground : c.foregroundMuted }]}>
            关闭
          </Text>
        </Pressable>
        <Pressable
          onPress={() => setWebhookEnabled(true)}
          style={[
            styles.segment,
            { backgroundColor: form.webhookEnabled ? c.accent : "transparent", borderColor: c.border },
          ]}
        >
          <Text style={[styles.segmentText, { color: form.webhookEnabled ? c.accentForeground : c.foregroundMuted }]}>
            启用
          </Text>
        </Pressable>
      </View>

      {form.webhookEnabled ? (
        <>
          <Text style={labelStyle}>Webhook Secret</Text>
          <TextInput
            style={inputStyle}
            value={form.webhookSecret}
            onChangeText={(v) => updateField("webhookSecret", v)}
            placeholder="plane_wh_..."
            placeholderTextColor={c.foregroundMuted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />

          <Text style={labelStyle}>Webhook 端口</Text>
          <TextInput
            style={inputStyle}
            value={String(form.webhookPort)}
            onChangeText={setWebhookPort}
            placeholder="8788"
            placeholderTextColor={c.foregroundMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="numeric"
          />
        </>
      ) : null}

      <Pressable
        onPress={handleSave}
        disabled={!loaded}
        style={[styles.saveButton, { backgroundColor: c.accent, opacity: loaded ? 1 : 0.5 }]}
      >
        <Text style={[styles.saveText, { color: c.accentForeground }]}>保存配置</Text>
      </Pressable>

      {status ? <Text style={[styles.status, { color: c.statusSuccess }]}>{status}</Text> : null}
      {error ? <Text style={[styles.status, { color: c.statusDanger }]}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 20, fontWeight: "600", marginBottom: 24 },
  segmented: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 8,
    padding: 3,
    marginBottom: 24,
  },
  segment: {
    flex: 1,
    paddingVertical: 8,
    borderWidth: 1,
    borderRadius: 6,
    alignItems: "center",
  },
  segmentText: { fontSize: 14, fontWeight: "500" },
  saveButton: { borderRadius: 8, paddingVertical: 12, alignItems: "center", marginBottom: 12 },
  saveText: { fontSize: 15, fontWeight: "600" },
  status: { fontSize: 13, marginTop: 4 },
});
