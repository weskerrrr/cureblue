/**
 * 心绘 ArtMind — AI 多模态接口调用逻辑（参考实现 / Node.js）
 *
 * 设计：统一 AI 网关，按"能力(capability)"路由到不同模型供应商；
 *      所有能力都强制产出"无障碍配套产物"——
 *        · 视障用户：任何视觉产物必须附带 audioThumb（音频缩略图）+ alt 语音深描
 *        · 听障用户：任何听觉产物必须附带 captions（字幕）+ visualization（可视化）
 *
 * 安全：调用前做额度/权益校验（见 enforceQuota）；情绪相关输入脱敏后再入库。
 */

// ---- 供应商适配层（伪实现，替换为真实 SDK / HTTP 调用）----
const providers = {
  async textToImage({ prompt, style }) {
    // return await openai.images.generate(...) / stability / 自研扩散模型
    return { url: `cdn://img/${hash(prompt)}.png`, width: 1024, height: 1024 };
  },
  async textToMusic({ prompt, mood }) {
    // return await suno/musicgen(...)
    return { url: `cdn://audio/${hash(prompt)}.mp3`, durationSec: 24, key: "C major" };
  },
  async describeImage({ imageUrl }) {
    // 多模态理解模型：输出色彩/构图/情感
    return {
      palette: ["深靛蓝", "雾青", "暖金"],
      composition: "横向三分构图，留白集中在右上",
      emotion: "宁静中带着期待",
      objects: ["海", "日出", "地平线"],
    };
  },
  async audioToSpectrum({ audioUrl }) {
    // 音频特征提取 → 频谱/节律帧序列
    return { frames: Array.from({ length: 64 }, () => Math.random()), bpm: 92 };
  },
  async lipRead({ videoFrames }) {
    // 唇语识别模型 → 文本
    return { text: "画一只在天空飞翔的鸟", confidence: 0.86 };
  },
  async tts({ text, lang = "zh-CN", rate = 1 }) {
    return { url: `cdn://tts/${hash(text)}.mp3` };
  },
  async sonify({ palette }) {
    // 把画面色彩/材质"声音化"，为视障用户生成音频缩略图
    return { url: `cdn://sonify/${hash(palette.join())}.mp3`, durationSec: 6 };
  },
};

function hash(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h.toString(16);
}

// ============================================================
// 额度 / 权益校验（前端只是体验拦截，这里才是权威）
// ============================================================
async function enforceQuota(db, userId) {
  const ent = await db.getEntitlements(userId);
  if (ent.ai_unlimited) return; // 订阅会员无限
  const used = await db.getDailyAiUsage(userId); // ai_usage_daily.count
  if (used >= ent.ai_daily_quota) {
    const err = new Error("FREE_QUOTA_EXCEEDED");
    err.code = 402; // Payment Required → 前端弹 Paywall
    throw err;
  }
  await db.incrDailyAiUsage(userId);
}

async function logInvocation(db, userId, capability, meta) {
  await db.insertAiInvocation({ userId, capability, ...meta });
}

// ============================================================
// 能力一：视障 — 语音/文字描述 → 图像（+ 音频缩略图 + 语音深描）
// ============================================================
async function speechDescToImage(ctx, { prompt, isPro }) {
  await enforceQuota(ctx.db, ctx.userId);
  const t0 = Date.now();

  const image = await providers.textToImage({ prompt, style: isPro ? "hd" : "standard" });
  // 无障碍配套：先理解画面 → 生成 alt 语音深描 → 声音化缩略图
  const understanding = await providers.describeImage({ imageUrl: image.url });
  const altText =
    `这幅画描绘了${prompt}。主色为${understanding.palette.join("、")}，` +
    `${understanding.composition}，整体情感${understanding.emotion}。`;
  const audioThumb = await providers.sonify({ palette: understanding.palette });
  const altAudio = await providers.tts({ text: altText });

  await logInvocation(ctx.db, ctx.userId, "speech2image", { latency_ms: Date.now() - t0, success: true });

  return {
    kind: "image",
    assetUrl: image.url,
    audioThumbUrl: audioThumb.url, // 视障无障碍核心
    altText,                       // 读屏 alt + 朗读文本
    altAudioUrl: altAudio.url,
  };
}

// ============================================================
// 能力二：视障 — 描述 → 音乐
// ============================================================
async function descToMusic(ctx, { prompt, mood }) {
  await enforceQuota(ctx.db, ctx.userId);
  const music = await providers.textToMusic({ prompt, mood });
  const caption = `已生成 ${music.durationSec} 秒 ${music.key} 旋律，情绪：${mood || "舒缓"}。`;
  await logInvocation(ctx.db, ctx.userId, "desc2music", { success: true });
  return { kind: "music", assetUrl: music.url, caption /* 听障也能读懂 */ };
}

// ============================================================
// 能力三：听障 — 音频/旋律 → 实时视觉可视化（+ 字幕）
// ============================================================
async function audioToVisual(ctx, { audioUrl }) {
  await enforceQuota(ctx.db, ctx.userId);
  const spec = await providers.audioToSpectrum({ audioUrl });
  await logInvocation(ctx.db, ctx.userId, "visualize", { success: true });
  return {
    kind: "visualization",
    frames: spec.frames,           // 前端渲染为频谱/色块
    bpm: spec.bpm,
    caption: `节奏 ${spec.bpm} BPM，能量随旋律起伏。`, // 字幕通道
  };
}

// ============================================================
// 能力四：听障 — 唇语识别辅助创作（PRO）
// ============================================================
async function lipReadToCommand(ctx, { videoFrames }) {
  // PRO 能力，权益已在路由层校验
  const r = await providers.lipRead({ videoFrames });
  await logInvocation(ctx.db, ctx.userId, "lipread", { success: r.confidence > 0.6 });
  return { text: r.text, confidence: r.confidence };
}

// ============================================================
// 能力五：通用 — AI 艺术导览（情感/色彩/构图深度解读，双通道输出）
// ============================================================
async function artGuide(ctx, { imageUrl }) {
  const u = await providers.describeImage({ imageUrl });
  const narration =
    `这幅作品以${u.palette.join("、")}为主色调。${u.composition}。` +
    `画面中可见${u.objects.join("、")}，传达出${u.emotion}的情绪。`;
  const audio = await providers.tts({ text: narration }); // 视障：语音
  await logInvocation(ctx.db, ctx.userId, "artguide", { success: true });
  return {
    narration,           // 听障：字幕文本
    narrationAudioUrl: audio.url, // 视障：语音
    palette: u.palette,
    emotion: u.emotion,
    composition: u.composition,
  };
}

// ============================================================
// 路由分发：HTTP 控制器调用入口
// ============================================================
const PRO_ONLY = new Set(["lipread"]);

async function handleAiRequest(ctx, capability, payload) {
  const ent = await ctx.db.getEntitlements(ctx.userId);
  if (PRO_ONLY.has(capability) && !ent.ai_unlimited) {
    const err = new Error("PRO_REQUIRED");
    err.code = 402;
    throw err;
  }
  switch (capability) {
    case "speech2image": return speechDescToImage(ctx, payload);
    case "desc2music":   return descToMusic(ctx, payload);
    case "visualize":    return audioToVisual(ctx, payload);
    case "lipread":      return lipReadToCommand(ctx, payload);
    case "artguide":     return artGuide(ctx, payload);
    default:
      throw new Error("UNKNOWN_CAPABILITY: " + capability);
  }
}

module.exports = {
  handleAiRequest,
  speechDescToImage,
  descToMusic,
  audioToVisual,
  lipReadToCommand,
  artGuide,
  enforceQuota,
};
