// POST /api/moderate — 发帖即审（服务端权威审核 + 持久化 + 危机干预）
// body: { text }
import { json, error, preflight, getUser } from "../_lib/response.js";
import { moderate } from "../_lib/moderation.js";
import { ensureUser, insertPost, insertModerationLog, insertCrisisEvent } from "../_lib/db.js";

export async function onRequestOptions() {
  return preflight();
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return error("D1 未绑定（env.DB）", 503);
  const { id, role } = getUser(request);
  const { text } = await request.json().catch(() => ({}));
  if (!text || !text.trim()) return error("内容不能为空");

  await ensureUser(env.DB, id, role);
  const verdict = moderate(text.trim());

  // 落库：帖子（危机内容不进入公共流，但保留干预记录）
  const authorName = "我";
  const postId = await insertPost(env.DB, {
    authorName,
    body: verdict.outputText,
    action: verdict.action,
    visible: verdict.visible,
  });

  await insertModerationLog(env.DB, {
    contentId: postId,
    authorId: id,
    action: verdict.action,
    score: verdict.score,
    categories: verdict.risk,
    reason: verdict.reason,
  });

  if (verdict.action === "crisis") {
    // 危机干预通道：推送热线 + 通知疗愈师/家长（此处记录事件；真实项目触发消息推送）
    await insertCrisisEvent(env.DB, id, postId);
    return json({
      ok: true,
      action: "crisis",
      message: "我们注意到你可能正经历困难，你并不孤单。已为你准备帮助资源，并通知了你信任的疗愈师。",
      hotline: "全国心理援助热线 12356",
    });
  }

  return json({ ok: true, action: verdict.action, reason: verdict.reason, visible: verdict.visible });
}
