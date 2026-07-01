// 统一 JSON 响应与 CORS 辅助（Pages Functions 共享，_ 前缀不会成为路由）

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-User-Id,X-User-Role",
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

export function error(message, status = 400) {
  return json({ ok: false, error: message }, status);
}

export function preflight() {
  return new Response(null, { status: 204, headers: CORS });
}

// 从请求头解析当前用户（原型用：无鉴权，前端生成的匿名 ID）
export function getUser(request) {
  const id = request.headers.get("X-User-Id") || "anon";
  const role = request.headers.get("X-User-Role") || "blind_teen";
  return { id, role };
}

// 今日日期（用于 AI 每日额度键）
export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function uuid() {
  return crypto.randomUUID();
}
