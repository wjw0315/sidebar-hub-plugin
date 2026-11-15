import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import type { PlaneConfig } from "../../shared/plane/plane-settings";

/** Plane webhook 载荷（v2 结构）的解析结果。 */
export interface WebhookEvent {
  /** 事件名，如 `workitem.updated`。 */
  event: string;
  /** 触发事件的工作项 id（entity_id）。 */
  entityId: string;
  /** 所属 workspace id。 */
  workspaceId: string;
  /** 事件数据快照。 */
  data: Record<string, unknown>;
}

/**
 * 校验 Plane webhook 签名。
 *
 * Plane 以 HMAC-SHA256 对原始请求体字节签名，签名放入 `X-Plane-Signature`
 * 头（hex 编码）。使用常量时间比较防止时序攻击。
 *
 * 必须传入原始请求体字符串，不可用重新序列化的 JSON——键序变化会破坏校验。
 */
export function verifyWebhookSignature(
  secret: string,
  body: string,
  signature: string,
): boolean {
  if (!secret) return false;
  if (!signature) return false;
  const expected = createHmac("sha256", secret).update(body, "utf8").digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** 解析 Plane webhook 载荷，非法结构返回 null。 */
export function parseWebhookPayload(body: string): WebhookEvent | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const event = typeof obj.event === "string" ? obj.event : "";
  const entityId = typeof obj.entity_id === "string" ? obj.entity_id : "";
  const workspaceId = typeof obj.workspace_id === "string" ? obj.workspace_id : "";
  if (!event || !entityId) return null;
  const data =
    typeof obj.data === "object" && obj.data !== null
      ? (obj.data as Record<string, unknown>)
      : {};
  return { event, entityId, workspaceId, data };
}

/** 读取请求的原始 body（字符串）。 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * 启动 webhook HTTP 服务器，返回停止函数。
 *
 * 仅在 `config.webhookEnabled` 为真时由插件调用。服务器监听指定端口，
 * 接收 Plane POST 请求：校验签名 → 解析载荷 → 调用 `onEvent`。
 * 非法签名返回 403，非法载荷返回 400，其余异常返回 500，成功返回 200。
 */
export function startWebhookServer(
  config: PlaneConfig,
  onEvent: (event: WebhookEvent) => Promise<void>,
): () => Promise<void> {
  const server = createServer(async (req, res) => {
    const send = (status: number, text: string): void => {
      res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(text);
    };
    if (req.method !== "POST") {
      send(405, "Method Not Allowed");
      return;
    }
    const signature = req.headers["x-plane-signature"];
    const body = await readBody(req).catch(() => "");
    if (!verifyWebhookSignature(config.webhookSecret, body, String(signature ?? ""))) {
      send(403, "Invalid signature");
      return;
    }
    const event = parseWebhookPayload(body);
    if (!event) {
      send(400, "Invalid payload");
      return;
    }
    try {
      await onEvent(event);
      send(200, "OK");
    } catch (e) {
      console.error(
        `[plane-plugin] webhook 事件处理失败: ${e instanceof Error ? e.message : String(e)}`,
      );
      send(500, "Internal Error");
    }
  });
  server.listen(config.webhookPort);
  return () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
}
