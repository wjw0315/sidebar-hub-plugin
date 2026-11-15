import type { PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { PLANE_SETTINGS, type PlaneConfig } from "../shared/plane/plane-settings";
import {
  planeListStatesRpc,
  planeListWorkItemsRpc,
  planePatchStateRpc,
  planeListProjectsRpc,
  planeResolveSessionRpc,
} from "../shared/plane/plane-rpc";
import {
  listStates,
  listWorkItems,
  patchState,
  listProjects,
  createWorkItem,
  ensureLabel,
  resolveStateForPhase,
  getWorkItem,
  resolveSessionAgentId,
  PlaneApiError,
  type SyncPhase,
} from "./plane/plane-api";
import { startWebhookServer, type WebhookEvent } from "./plane/plane-webhook";

type ListStatesOut = z.infer<typeof planeListStatesRpc.output>;
type ListWorkItemsOut = z.infer<typeof planeListWorkItemsRpc.output>;
type PatchStateOut = z.infer<typeof planePatchStateRpc.output>;
type ListProjectsOut = z.infer<typeof planeListProjectsRpc.output>;
type ResolveSessionOut = z.infer<typeof planeResolveSessionRpc.output>;

/**
 * Plane 模块的 server 侧贡献（自 plane-plugin 移植）：
 * 配置设置、四个 Plane API RPC、会话生命周期同步钩子、webhook 反向通知。
 * 所有 API 错误被捕获后转成可读响应或日志，不抛出未处理异常。
 */

/** 会话标签约定：`plane:project` = 目标 Plane 项目 uuid；无标签则不同步，避免孤立 work item。 */
const PROJECT_LABEL_KEY = "plane:project";

interface SyncRecord {
  projectId: string;
  workItemId: string;
  phase: SyncPhase;
}

// 会话 ↔ work item 同步状态（server 内存，插件重载后重置）
const agentProjects = new Map<string, string>();
const syncItems = new Map<string, SyncRecord>();

/** 会话通知所需的最小 paseo 能力（从 hook context 捕获，结构兼容 PaseoApi）。 */
interface SessionNotifier {
  agents: {
    ref: (agentId: string) => { send: (text: string) => Promise<void> };
  };
}

// 从生命周期钩子上下文捕获的 paseo 引用（contribute 本身不接收 paseo）
let paseoNotifier: SessionNotifier | null = null;

function logError(msg: string, e: unknown): void {
  console.error(`[plane-plugin] ${msg}: ${e instanceof Error ? e.message : String(e)}`);
}

export function contributePlaneServer(server: PluginServerContext) {
  const settings = server.registerSettings(PLANE_SETTINGS);

  const readConfig = async (): Promise<PlaneConfig | null> => {
    const result = await settings.read();
    return result.status === "ready" ? result.values : null;
  };

  /** 把已有 work item 流转到目标阶段（幂等，同阶段跳过）。 */
  const syncPhase = async (agentId: string, phase: SyncPhase): Promise<void> => {
    const rec = syncItems.get(agentId);
    if (!rec || rec.phase === phase) return;
    const config = await readConfig();
    if (!config) return;
    const states = await listStates(config, rec.projectId);
    const stateId = resolveStateForPhase(states, phase);
    if (!stateId) {
      console.error(`[plane-plugin] 项目 ${rec.projectId} 无匹配 ${phase} 的状态，跳过同步`);
      return;
    }
    const item = await patchState(config, rec.projectId, rec.workItemId, stateId);
    rec.phase = phase;
    rec.workItemId = item.id || rec.workItemId;
  };

  // 目标项目来自会话标签：在 session_open 时记录 agentId → projectId，并捕获 paseo 引用
  server.before("agent.session_open", ({ request }, context) => {
    const projectId = request.labels[PROJECT_LABEL_KEY];
    if (projectId) agentProjects.set(request.agentId, projectId);
    if (!paseoNotifier) paseoNotifier = context.paseo as SessionNotifier;
  });

  // 会话创建：生成 work item（标题=会话名，state=Backlog，标签 paseo-<agentId>）
  server.on("agent.created", async ({ agent }) => {
    try {
      const projectId = agentProjects.get(agent.id);
      if (!projectId) return;
      const config = await readConfig();
      if (!config) return;
      const states = await listStates(config, projectId);
      const backlogId = resolveStateForPhase(states, "backlog");
      if (!backlogId) {
        console.error(`[plane-plugin] 项目 ${projectId} 无 Backlog 状态，会话 ${agent.id} 不同步`);
        return;
      }
      const label = await ensureLabel(config, `paseo-${agent.id}`);
      const item = await createWorkItem(
        config,
        projectId,
        agent.title ?? agent.id,
        backlogId,
        [label.id],
      );
      syncItems.set(agent.id, { projectId, workItemId: item.id, phase: "backlog" });
    } catch (e) {
      logError(`会话 ${agent.id} 创建 work item 失败`, e);
    }
  });

  // 会话进行中：首次 turn 时流转到 In Progress
  server.on("agent.turn_started", async ({ agent }) => {
    try {
      await syncPhase(agent.id, "in_progress");
    } catch (e) {
      logError(`会话 ${agent.id} 同步 In Progress 失败`, e);
    }
  });

  // 会话结束：流转到 Done（约定：closed/archived 均视为结束，不留未完结 item）
  server.on("agent.closed", async ({ agent }) => {
    try {
      await syncPhase(agent.id, "done");
    } catch (e) {
      logError(`会话 ${agent.id} 同步 Done 失败`, e);
    }
  });

  server.on("agent.archived", async ({ agent }) => {
    try {
      await syncPhase(agent.id, "done");
    } catch (e) {
      logError(`会话 ${agent.id} 同步 Done 失败`, e);
    }
  });

  server.handle(planeListProjectsRpc, async (): Promise<ListProjectsOut> => {
    try {
      const result = await settings.read();
      if (result.status !== "ready") {
        return { status: "error", error: result.error };
      }
      const projects = await listProjects(result.values);
      return { status: "ready", projects };
    } catch (e) {
      return { status: "error", error: e instanceof PlaneApiError ? e.message : String(e) };
    }
  });

  server.handle(planeListStatesRpc, async (input): Promise<ListStatesOut> => {
    try {
      const result = await settings.read();
      if (result.status !== "ready") {
        return { status: "error", error: result.error };
      }
      const states = await listStates(result.values, input.projectId);
      return { status: "ready", states };
    } catch (e) {
      return { status: "error", error: e instanceof PlaneApiError ? e.message : String(e) };
    }
  });

  server.handle(planeListWorkItemsRpc, async (input): Promise<ListWorkItemsOut> => {
    try {
      const result = await settings.read();
      if (result.status !== "ready") {
        return { status: "error", error: result.error };
      }
      const items = await listWorkItems(result.values, input.projectId, input.stateId);
      return { status: "ready", items };
    } catch (e) {
      return { status: "error", error: e instanceof PlaneApiError ? e.message : String(e) };
    }
  });

  server.handle(planePatchStateRpc, async (input): Promise<PatchStateOut> => {
    try {
      const result = await settings.read();
      if (result.status !== "ready") {
        return { status: "error", error: result.error };
      }
      const item = await patchState(result.values, input.projectId, input.workItemId, input.stateId);
      return { status: "ready", item };
    } catch (e) {
      return { status: "error", error: e instanceof PlaneApiError ? e.message : String(e) };
    }
  });

  server.handle(planeResolveSessionRpc, async (input): Promise<ResolveSessionOut> => {
    try {
      const result = await settings.read();
      if (result.status !== "ready") {
        return { status: "error", error: result.error };
      }
      const item = await getWorkItem(result.values, input.projectId, input.workItemId);
      const agentId = await resolveSessionAgentId(result.values, item.labels);
      if (!agentId) {
        return { status: "error", error: "该任务未关联 Paseo 会话" };
      }
      return { status: "ready", agentId };
    } catch (e) {
      return { status: "error", error: e instanceof PlaneApiError ? e.message : String(e) };
    }
  });

  // --- Webhook 反向事件（可选）---
  // work item 状态变更 → 反查会话 → 向会话发送通知
  const handleWebhookEvent = async (event: WebhookEvent): Promise<void> => {
    if (!event.event.startsWith("workitem.")) return;
    const config = await readConfig();
    if (!config) return;
    const projectId = String(event.data.project ?? "");
    if (!projectId) {
      console.error(`[plane-plugin] webhook 事件 ${event.event} 缺少 project，跳过`);
      return;
    }
    // 优先用载荷里的 labels；缺失则拉取单条 work item 取标签
    const rawLabels = Array.isArray(event.data.labels) ? event.data.labels : null;
    const itemLabels = rawLabels
      ? rawLabels.map((l) => String(l))
      : (await getWorkItem(config, projectId, event.entityId)).labels;
    const agentId = await resolveSessionAgentId(config, itemLabels);
    if (!agentId) return;
    if (!paseoNotifier) {
      console.error(`[plane-plugin] 无 paseo 引用，无法通知会话 ${agentId}`);
      return;
    }
    await paseoNotifier.agents.ref(agentId).send(
      `[Plane] 任务 ${event.entityId} 状态变更（${event.event}）`,
    );
  };

  // 仅在 webhookEnabled 且配置了 secret 时启动 HTTP 服务器
  let stopWebhook: (() => Promise<void>) | null = null;
  (async () => {
    const config = await readConfig();
    if (config?.webhookEnabled && config.webhookSecret) {
      stopWebhook = startWebhookServer(config, handleWebhookEvent);
      console.log(`[plane-plugin] webhook 服务器已启动，端口 ${config.webhookPort}`);
    }
  })().catch((e) => logError("启动 webhook 服务器失败", e));

  return async () => {
    if (stopWebhook) await stopWebhook();
  };
}
