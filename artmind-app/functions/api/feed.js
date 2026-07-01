// GET /api/feed — 社区动态列表（家长可见被拦截记录）
import { json, error, preflight, getUser } from "../_lib/response.js";
import { listPosts } from "../_lib/db.js";

export async function onRequestOptions() {
  return preflight();
}

export async function onRequestGet({ request, env }) {
  if (!env.DB) return error("D1 未绑定（env.DB）", 503);
  const { role } = getUser(request);
  const isParent = role === "parent";
  const rows = await listPosts(env.DB, isParent);

  const posts = rows.map((r) => ({
    id: r.id,
    author: r.author_name,
    text: r.mod_action === "block" ? "［内容已被安全系统拦截］" : r.body,
    status: r.mod_action === "approve" || r.mod_action === "mask" ? "approved" : r.mod_action === "block" ? "blocked" : r.mod_action,
    hasImage: r.has_image === 1,
    reason: r.mod_action === "block" ? "内容未通过安全审核" : undefined,
  }));

  return json({ ok: true, posts });
}
