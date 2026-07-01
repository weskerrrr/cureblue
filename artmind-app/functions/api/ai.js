// POST /api/ai — AI 多模态创作网关（服务端权威额度校验）
// body: { capability: "speech2image"|"desc2music"|"visualize"|"lipread"|"artguide", prompt }
// 说明：真实模型调用为可替换点（此处返回结构化的无障碍配套产物）。
import { json, error, preflight, getUser, uuid } from "../_lib/response.js";
import { ensureUser, getEntitlements, getDailyUsage, incrDailyUsage, logAiInvocation } from "../_lib/db.js";

const PRO_ONLY = new Set(["lipread"]);

export async function onRequestOptions() {
  return preflight();
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return error("D1 未绑定（env.DB）", 503);
  const t0 = Date.now();
  const { id, role } = getUser(request);
  const { capability, prompt = "" } = await request.json().catch(() => ({}));
  if (!capability) return error("缺少 capability 参数");

  await ensureUser(env.DB, id, role);
  const ent = await getEntitlements(env.DB, id);
  const isPro = ent.ai_unlimited === 1;

  // PRO 专属能力
  if (PRO_ONLY.has(capability) && !isPro) {
    return json({ ok: false, code: "PRO_REQUIRED", error: "该能力为会员专享。" }, 402);
  }

  // 免费额度校验（服务端权威）
  if (!isPro) {
    const used = await getDailyUsage(env.DB, id);
    if (used >= ent.ai_daily_quota) {
      return json({ ok: false, code: "FREE_QUOTA_EXCEEDED", error: "今日免费次数已用完。" }, 402);
    }
    await incrDailyUsage(env.DB, id);
  }

  const result = generate(capability, prompt);
  await logAiInvocation(env.DB, id, capability, true, Date.now() - t0);

  const used = isPro ? -1 : await getDailyUsage(env.DB, id);
  const quotaLeft = isPro ? -1 : Math.max(0, ent.ai_daily_quota - used);
  return json({ ok: true, capability, result, aiQuotaLeft: quotaLeft });
}

// 生成结果（含无障碍配套产物）；真实项目在此接扩散/音乐/多模态模型
function generate(capability, prompt) {
  const p = (prompt || "").trim() || "一片宁静的蓝色海洋";
  switch (capability) {
    case "speech2image":
      return {
        kind: "image",
        assetId: uuid(),
        altText: `画作已生成。${p}。主色为蓝色与暖金，构图开阔，整体情绪宁静而充满希望。`,
        palette: ["深靛蓝", "雾青", "暖金"],
      };
    case "desc2music":
      return { kind: "music", durationSec: 24, key: "C major", caption: `已根据"${p}"生成一段舒缓的大调旋律，约 24 秒。` };
    case "visualize":
      return { kind: "visualization", bpm: 92, frames: Array.from({ length: 16 }, () => Math.round(20 + Math.random() * 140)), caption: "节奏 92 BPM，能量随旋律起伏。" };
    case "lipread":
      return { kind: "text", text: "画一只在天空飞翔的鸟", confidence: 0.86 };
    case "artguide":
      return { kind: "narration", narration: `这幅作品以深靛蓝、雾青、暖金为主色。横向三分构图，留白集中在右上，传达出宁静而充满期待的情绪。` };
    default:
      return { kind: "unknown" };
  }
}
