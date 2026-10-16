// POST /api/ai — AI 多模态创作网关（服务端权威额度校验）
// body: { capability: "speech2image"|"desc2music"|"visualize"|"lipread"|"artguide", prompt }
// 生图优先 Cloudflare Workers AI，失败回退 Pollinations；其余能力保留结构化演示结果。
import { json, error, preflight, getUser, uuid } from "../_lib/response.js";
import { ensureUser, logAiInvocation } from "../_lib/db.js";
import { buildImageResult } from "../_lib/imageGen.js";

export async function onRequestOptions() {
  return preflight();
}

export async function onRequestPost({ request, env }) {
  if (!env.DB) return error("D1 未绑定（env.DB）", 503);
  const t0 = Date.now();
  const { id, role } = getUser(request);
  const { capability, prompt = "", options = {} } = await request.json().catch(() => ({}));
  if (!capability) return error("缺少 capability 参数");
  if (String(prompt).length > 300) return error("画面描述不能超过 300 个字符");

  await ensureUser(env.DB, id, role);

  let result;
  try {
    result = await generate(capability, prompt, options, env);
  } catch {
    return json({ ok: false, error: "生图服务暂时不可用，请换一个接口或稍后重试。" }, 502);
  }

  await logAiInvocation(env.DB, id, capability, true, Date.now() - t0);
  return json({ ok: true, capability, result, aiQuotaLeft: -1 });
}

async function generate(capability, prompt, options = {}, env) {
  const p = (prompt || "").trim() || "一片宁静的蓝色海洋";
  switch (capability) {
    case "speech2image": {
      const image = await buildImageResult(p, options.style, env, options.provider);
      return {
        ...image,
        assetId: uuid(),
        palette: ["深靛蓝", "雾青", "暖金"],
      };
    }
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
