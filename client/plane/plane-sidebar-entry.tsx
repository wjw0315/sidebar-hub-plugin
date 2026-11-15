import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { PLANE_SCREEN_ID } from "../../shared/plane/plane-ids";

/**
 * 侧边栏头部入口（`addSidebarHeaderItem`）。点击打开看板屏幕。
 */
export function PlaneSidebarEntry(props: PluginSidebarItemProps) {
  const { theme, openScreen, currentScreen } = props;
  const c = theme.colors;
  const isActive = currentScreen?.screenId === PLANE_SCREEN_ID;

  return (
    <Pressable
      onPress={() => openScreen({ screenId: PLANE_SCREEN_ID })}
      style={[
        styles.row,
        {
          backgroundColor: isActive ? c.surface2 : "transparent",
          borderColor: c.border,
        },
      ]}
    >
      <View style={styles.iconWrap}>
        <Text style={[styles.icon, { color: isActive ? c.accent : c.foregroundMuted }]}>▦</Text>
      </View>
      <Text style={[styles.label, { color: isActive ? c.accent : c.foreground }]}>Plane 任务看板</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
    marginBottom: 4,
  },
  iconWrap: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  icon: {
    fontSize: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: "500",
  },
});
