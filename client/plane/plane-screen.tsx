import React, { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View, Pressable, PanResponder } from "react-native";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { settingsRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { PLANE_SETTINGS, type PlaneConfig } from "../../shared/plane/plane-settings";
import {
  planeListProjectsRpc,
  planeListStatesRpc,
  planeListWorkItemsRpc,
  planePatchStateRpc,
  planeResolveSessionRpc,
  planeProjectSchema,
  planeStateSchema,
  planeWorkItemSchema,
} from "../../shared/plane/plane-rpc";

type PlaneProject = z.infer<typeof planeProjectSchema>;
type PlaneState = z.infer<typeof planeStateSchema>;
type PlaneWorkItem = z.infer<typeof planeWorkItemSchema>;

const PRIORITY_LABELS: Record<string, string> = {
  urgent: "紧急",
  high: "高",
  medium: "中",
  low: "低",
};

/**
 * Plane 任务看板屏幕（`addScreen` id `plane-board`）。
 *
 * 顶部项目切换器（来自 list-projects），下方动态列（来自 list-states），
 * 每列渲染该状态下的 work item 卡片。项目切换后自动重新拉取数据。
 */
export function PlaneScreen(props: PluginScreenProps) {
  const { theme, params, navigation } = props;
  const c = theme.colors;

  const readSettings = useRpc(settingsRpc(PLANE_SETTINGS.id).read);
  const fetchProjects = useRpc(planeListProjectsRpc);
  const fetchStates = useRpc(planeListStatesRpc);
  const fetchItems = useRpc(planeListWorkItemsRpc);
  const patchState = useRpc(planePatchStateRpc);
  const resolveSession = useRpc(planeResolveSessionRpc);

  const [config, setConfig] = useState<PlaneConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [projects, setProjects] = useState<PlaneProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(params.projectId ?? "");
  const [states, setStates] = useState<PlaneState[]>([]);
  const [workItems, setWorkItems] = useState<PlaneWorkItem[]>([]);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStateId, setDragOverStateId] = useState<string | null>(null);
  const [dragError, setDragError] = useState<string | null>(null);
  const [tapError, setTapError] = useState<string | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const columnRefs = useRef<Record<string, View | null>>({});
  const columnRects = useRef<Record<string, { x: number; y: number; w: number; h: number }>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await readSettings({});
        if (cancelled) return;
        if (result.status === "ready") {
          setConfig(result.values as PlaneConfig);
        } else {
          setConfigError(result.error ?? "配置读取失败");
        }
      } catch (e) {
        if (!cancelled) setConfigError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await fetchProjects({});
        if (cancelled) return;
        if (result.status === "ready") {
          setProjects(result.projects);
          if (!selectedProjectId && result.projects.length > 0) {
            setSelectedProjectId(result.projects[0].id);
          }
        } else {
          setBoardError(result.error);
        }
      } catch (e) {
        if (!cancelled) setBoardError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  useEffect(() => {
    if (!config || !selectedProjectId) return;
    let cancelled = false;
    setLoadingBoard(true);
    setBoardError(null);
    setDragError(null);
    setStates([]);
    setWorkItems([]);

    (async () => {
      try {
        const [statesResult, itemsResult] = await Promise.all([
          fetchStates({ projectId: selectedProjectId }),
          fetchItems({ projectId: selectedProjectId }),
        ]);
        if (cancelled) return;

        if (statesResult.status === "ready") {
          setStates(statesResult.states);
        } else {
          setBoardError(statesResult.error);
        }
        if (itemsResult.status === "ready") {
          setWorkItems(itemsResult.items);
        } else if (statesResult.status === "ready") {
          setBoardError(itemsResult.error);
        }
      } catch (e) {
        if (!cancelled) setBoardError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingBoard(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [config, selectedProjectId]);

  const hitTestColumn = (x: number, y: number): string | null => {
    for (const s of states) {
      const r = columnRects.current[s.id];
      if (r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) return s.id;
    }
    return null;
  };

  // 点击卡片：按标签反查会话并唤起；无法关联时提示
  const handleTapCard = (item: PlaneWorkItem) => {
    setTapError(null);
    resolveSession({ projectId: selectedProjectId, workItemId: item.id }).then((result) => {
      if (result.status === "error") {
        setTapError(result.error);
        return;
      }
      if (!navigation?.openAgent) {
        setTapError("当前环境不支持唤起会话");
        return;
      }
      navigation.openAgent({ agentId: result.agentId });
    }).catch((e: unknown) => {
      setTapError(e instanceof Error ? e.message : String(e));
    });
  };

  const createCardPanResponder = (item: PlaneWorkItem) =>
    PanResponder.create({
      // 卡片一旦被摸到就接管手势，看板横向滚动留给滚轮/触控板/列间空隙
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => false,
      onPanResponderGrant: () => {
        draggingIdRef.current = item.id;
        setDraggingId(item.id);
        setDragOverStateId(item.stateId);
        setDragError(null);
        columnRects.current = {};
        Promise.all(
          states.map(
            (s) =>
              new Promise<void>((resolve) => {
                const ref = columnRefs.current[s.id];
                if (!ref) {
                  resolve();
                  return;
                }
                ref.measureInWindow((x, y, w, h) => {
                  columnRects.current[s.id] = { x, y, w, h };
                  resolve();
                });
              }),
          ),
        ).catch(() => {});
      },
      onPanResponderMove: (_e, gs) => {
        if (!draggingIdRef.current) return;
        setDragOverStateId(hitTestColumn(gs.x0 + gs.dx, gs.y0 + gs.dy));
      },
      onPanResponderRelease: (_e, gs) => {
        const draggedId = draggingIdRef.current;
        setDraggingId(null);
        setDragOverStateId(null);
        draggingIdRef.current = null;
        if (!draggedId || draggedId !== item.id) return;
        // 位移极小视为点按：唤起会话；否则走拖拽改状态
        if (Math.abs(gs.dx) < 10 && Math.abs(gs.dy) < 10) {
          handleTapCard(item);
          return;
        }
        const target = hitTestColumn(gs.x0 + gs.dx, gs.y0 + gs.dy);
        if (!target || target === item.stateId) return;
        // 乐观移动卡片，失败回滚到原列并提示
        setWorkItems((prev) =>
          prev.map((w) => (w.id === item.id ? { ...w, stateId: target } : w)),
        );
        patchState({ projectId: selectedProjectId, workItemId: item.id, stateId: target })
          .then((result) => {
            if (result.status === "error") {
              setWorkItems((prev) =>
                prev.map((w) => (w.id === item.id ? { ...w, stateId: item.stateId } : w)),
              );
              setDragError(result.error);
            }
          })
          .catch((e: unknown) => {
            setWorkItems((prev) =>
              prev.map((w) => (w.id === item.id ? { ...w, stateId: item.stateId } : w)),
            );
            setDragError(e instanceof Error ? e.message : String(e));
          });
      },
      onPanResponderTerminationRequest: () => false,
      onPanResponderTerminate: () => {
        draggingIdRef.current = null;
        setDraggingId(null);
        setDragOverStateId(null);
      },
    });

  const errorNode = (msg: string) => (
    <View style={[styles.container, { backgroundColor: c.surface0 }]}>
      <Text style={[styles.title, { color: c.foreground }]}>Plane 任务看板</Text>
      <Text style={[styles.text, { color: c.statusDanger }]}>{msg}</Text>
    </View>
  );

  if (configError) return errorNode(configError);

  if (!config || !config.baseUrl || !config.apiKey || !config.workspace) {
    return errorNode("请在设置中配置 Plane base URL、API Key 与 workspace。");
  }

  const itemsByState = (stateId: string) => workItems.filter((w) => w.stateId === stateId);

  return (
    <View style={[styles.container, { backgroundColor: c.surface0 }]}>
      <Text style={[styles.title, { color: c.foreground }]}>Plane 任务看板</Text>

      {/* 项目切换器 */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.projectScroll}
        contentContainerStyle={styles.projectScrollContent}
      >
        {projects.map((p) => {
          const active = p.id === selectedProjectId;
          return (
            <Pressable
              key={p.id}
              onPress={() => setSelectedProjectId(p.id)}
              style={[
                styles.projectButton,
                {
                  backgroundColor: active ? c.accent : c.surface1,
                  borderColor: c.border,
                },
              ]}
            >
              <Text
                style={[
                  styles.projectButtonText,
                  { color: active ? c.accentForeground : c.foreground },
                ]}
              >
                {p.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* 看板主体 */}
      {boardError ? (
        <Text style={[styles.text, { color: c.statusDanger }]}>{boardError}</Text>
      ) : loadingBoard ? (
        <Text style={[styles.text, { color: c.foregroundMuted }]}>加载中…</Text>
      ) : states.length === 0 ? (
        <Text style={[styles.text, { color: c.foregroundMuted }]}>该项目暂无工作流列。</Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.board}
          contentContainerStyle={styles.boardContent}
        >
          {states.map((state) => {
            const items = itemsByState(state.id);
            return (
              <View
                key={state.id}
                ref={(el) => {
                  columnRefs.current[state.id] = el;
                }}
                style={[
                  styles.column,
                  {
                    backgroundColor: c.surface1,
                    borderColor: dragOverStateId === state.id ? c.accent : c.border,
                  },
                ]}
              >
                <View style={styles.columnHeader}>
                  <View
                    style={[
                      styles.colorDot,
                      { backgroundColor: state.color ?? c.foregroundMuted },
                    ]}
                  />
                  <Text style={[styles.columnTitle, { color: c.foreground }]}>
                    {state.name}
                  </Text>
                  <Text style={[styles.columnCount, { color: c.foregroundMuted }]}>
                    {items.length}
                  </Text>
                </View>
                {items.map((item) => (
                  <View
                    key={item.id}
                    style={[
                      styles.card,
                      {
                        backgroundColor: c.surface2,
                        borderColor: draggingId === item.id ? c.accent : c.border,
                        opacity: draggingId ? (draggingId === item.id ? 0.8 : 0.6) : 1,
                      },
                    ]}
                    {...createCardPanResponder(item).panHandlers}
                  >
                    <View style={styles.cardTop}>
                      <Text style={[styles.cardIdentifier, { color: c.foregroundMuted }]}>
                        {item.identifier}
                      </Text>
                      {item.priority ? (
                        <Text
                          style={[
                            styles.cardPriority,
                            {
                              color:
                                item.priority === "urgent"
                                  ? c.statusDanger
                                  : item.priority === "high"
                                    ? c.statusWarning
                                    : c.foregroundMuted,
                            },
                          ]}
                        >
                          {PRIORITY_LABELS[item.priority] ?? item.priority}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[styles.cardName, { color: c.foreground }]} numberOfLines={2}>
                      {item.name}
                    </Text>
                    <Text style={[styles.cardAssignee, { color: c.foregroundMuted }]}>
                      {item.assignees.length > 0 ? item.assignees[0].name : "未指派"}
                    </Text>
                  </View>
                ))}
                {items.length === 0 ? (
                  <Text style={[styles.cardEmpty, { color: c.foregroundMuted }]}>空</Text>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      )}

      {dragError ? (
        <Text style={[styles.text, { color: c.statusDanger }]}>拖拽失败：{dragError}</Text>
      ) : null}
      {tapError ? (
        <Text style={[styles.text, { color: c.statusWarning }]}>{tapError}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 12,
  },
  text: {
    fontSize: 14,
    lineHeight: 22,
  },
  projectScroll: {
    marginBottom: 16,
  },
  projectScrollContent: {
    flexDirection: "row",
    gap: 8,
  },
  projectButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    marginRight: 8,
  },
  projectButtonText: {
    fontSize: 14,
    fontWeight: "500",
  },
  board: {
    flex: 1,
  },
  boardContent: {
    flexDirection: "row",
    gap: 12,
    paddingBottom: 20,
  },
  column: {
    width: 280,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  columnHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  columnTitle: {
    fontSize: 14,
    fontWeight: "600",
    flex: 1,
  },
  columnCount: {
    fontSize: 13,
  },
  card: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  cardIdentifier: {
    fontSize: 12,
    fontWeight: "600",
  },
  cardPriority: {
    fontSize: 12,
    fontWeight: "500",
  },
  cardName: {
    fontSize: 14,
    fontWeight: "500",
    marginBottom: 6,
  },
  cardAssignee: {
    fontSize: 12,
  },
  cardEmpty: {
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 12,
  },
});
