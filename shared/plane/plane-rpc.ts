import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Plane v2 work item state（看板列）。 */
export const planeStateSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string().nullable(),
});

/** Plane v2 work item（看板卡片）。 */
export const planeWorkItemSchema = z.object({
  id: z.string(),
  identifier: z.string(),
  name: z.string(),
  stateId: z.string(),
  priority: z.string().nullable(),
  assignees: z.array(z.object({ id: z.string(), name: z.string() })),
  labels: z.array(z.string()),
});

/** Plane v2 project（看板项目切换器选项）。 */
export const planeProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  identifier: z.string(),
});

/** 拉取 workspace 下的项目列表，用于看板项目切换。 */
export const planeListProjectsRpc = defineRpc({
  name: "plane.list-projects",
  input: z.object({}),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("ready"), projects: z.array(planeProjectSchema) }),
    z.object({ status: z.literal("error"), error: z.string() }),
  ]),
});

/** 拉取目标项目的 states 列表。 */
export const planeListStatesRpc = defineRpc({
  name: "plane.list-states",
  input: z.object({ projectId: z.string() }),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("ready"), states: z.array(planeStateSchema) }),
    z.object({ status: z.literal("error"), error: z.string() }),
  ]),
});

/** 拉取目标项目的 work items 列表，可按 state 过滤。 */
export const planeListWorkItemsRpc = defineRpc({
  name: "plane.list-work-items",
  input: z.object({
    projectId: z.string(),
    stateId: z.string().optional(),
  }),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("ready"), items: z.array(planeWorkItemSchema) }),
    z.object({ status: z.literal("error"), error: z.string() }),
  ]),
});

/** 将单个 work item 的 state 更新为指定值。 */
export const planePatchStateRpc = defineRpc({
  name: "plane.patch-state",
  input: z.object({
    projectId: z.string(),
    workItemId: z.string(),
    stateId: z.string(),
  }),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("ready"), item: planeWorkItemSchema }),
    z.object({ status: z.literal("error"), error: z.string() }),
  ]),
});

/** 按 work item 的标签反查关联的 Paseo 会话 id（标签名 `paseo-<agentId>`）。 */
export const planeResolveSessionRpc = defineRpc({
  name: "plane.resolve-session",
  input: z.object({ projectId: z.string(), workItemId: z.string() }),
  output: z.discriminatedUnion("status", [
    z.object({ status: z.literal("ready"), agentId: z.string() }),
    z.object({ status: z.literal("error"), error: z.string() }),
  ]),
});
