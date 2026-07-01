/**
 * 心绘 ArtMind — 社区内容实时审核算法（参考实现 / Node.js）
 *
 * 多级流水线（任一级命中高危即短路）：
 *   L0 本地敏感词/正则预过滤（毫秒级，离线）
 *   L1 AI 文本分类（涉黄涉暴涉政、欺凌、广告诈骗、隐私泄露）
 *   L2 AI 图像审核（仅含图内容）
 *   L3 危机信号检测（自伤/自杀倾向）—— 走特殊干预通道，绝不简单删除
 *   → 风险聚合打分 → 分级动作
 *
 * 分级动作 mod_action：
 *   approve  通过并展示
 *   mask     部分打码后展示（如轻微不当词）
 *   block    拦截，不进入公共流（家长可见拦截记录）
 *   review   进入人工复核队列（边界样本）
 *   crisis   危机干预通道（推送热线 + 通知疗愈师 + 通知家长）
 *
 * 面向未成年人的从严策略：阈值更低、危机优先、私信比公开内容更严格。
 */

// ---- L0：本地词典（演示，生产应用加密词库 + 定期更新）----
const LEXICON = {
  bully:   ["垃圾", "去死", "废物", "丑八怪", "滚出去"],
  porn:    [/* 涉黄词，略 */],
  violence:["打死你", "弄死"],
  ad_scam: ["加微信", "代购", "扫码领", "兼职日结", "私聊有偿"],
  pii:     [/\d{17}[\dXx]/ /* 身份证 */, /\b1[3-9]\d{9}\b/ /* 手机号 */],
  crisis:  ["不想活", "撑不下去", "结束自己", "活不下去", "自杀", "想消失", "没有意义"],
};

// ---- AI 分类器适配（伪实现，替换为真实多标签分类模型）----
async function aiTextClassify(text) {
  // return await moderationModel.classify(text)
  return { bully: 0, porn: 0, violence: 0, political: 0, selfharm: 0, ad_scam: 0 };
}
async function aiImageClassify(imageUrl) {
  return { nsfw: 0, violence: 0, minor_safety_risk: 0 };
}

// ---- L0 预过滤 ----
function localPrefilter(text = "") {
  const hits = {};
  for (const [cat, rules] of Object.entries(LEXICON)) {
    for (const r of rules) {
      const matched = r instanceof RegExp ? r.test(text) : text.includes(r);
      if (matched) hits[cat] = (hits[cat] || 0) + 1;
    }
  }
  return hits; // { bully: 2, crisis: 1, ... }
}

// ---- 风险聚合：把本地命中 + AI 分数合成为各类别风险分 ----
function aggregateRisk(localHits, aiText, aiImage = {}) {
  const clamp = (n) => Math.min(1, Math.max(0, n));
  return {
    bully:    clamp((aiText.bully || 0) + (localHits.bully ? 0.6 : 0)),
    porn:     clamp((aiText.porn || 0) + (aiImage.nsfw || 0) + (localHits.porn ? 0.7 : 0)),
    violence: clamp((aiText.violence || 0) + (aiImage.violence || 0) + (localHits.violence ? 0.6 : 0)),
    political:clamp(aiText.political || 0),
    ad_scam:  clamp((aiText.ad_scam || 0) + (localHits.ad_scam ? 0.5 : 0)),
    pii:      localHits.pii ? 0.9 : 0,
    selfharm: clamp((aiText.selfharm || 0) + (localHits.crisis ? 0.7 : 0)),
    minor_risk: clamp(aiImage.minor_safety_risk || 0),
  };
}

// ---- 分级决策（未成年人从严：阈值偏低）----
function decide(risk, { isDM = false } = {}) {
  // 私信更严格
  const k = isDM ? 0.85 : 1;

  // 1) 危机优先：自伤/自杀倾向 → 永远走 crisis，绝不当作违规删除
  if (risk.selfharm >= 0.5) {
    return { action: "crisis", score: risk.selfharm, reason: "检测到情绪危机信号，启动关怀干预。" };
  }
  // 2) 高危硬拦截
  const hardCats = ["porn", "violence", "political", "minor_risk"];
  for (const c of hardCats) {
    if (risk[c] >= 0.7 * k) return { action: "block", score: risk[c], reason: `命中高危类别：${c}` };
  }
  // 3) 欺凌 / 诈骗
  if (risk.bully >= 0.6 * k) return { action: "block", score: risk.bully, reason: "攻击性/欺凌言论。" };
  if (risk.ad_scam >= 0.6 * k) return { action: "block", score: risk.ad_scam, reason: "疑似广告/诈骗。" };
  // 4) 隐私信息 → 打码
  if (risk.pii >= 0.6) return { action: "mask", score: risk.pii, reason: "包含个人隐私信息，已打码。" };
  // 5) 边界样本 → 人工复核
  const maxScore = Math.max(...Object.values(risk));
  if (maxScore >= 0.4) return { action: "review", score: maxScore, reason: "风险中等，转人工复核。" };
  // 6) 通过
  return { action: "approve", score: maxScore, reason: "" };
}

// ---- 隐私打码 ----
function maskPII(text) {
  return text
    .replace(/\b1[3-9]\d{9}\b/g, "***********")
    .replace(/\d{17}[\dXx]/g, "******************");
}

// ============================================================
// 审核主流程：发布即审
// ============================================================
async function moderate(ctx, { contentType, contentId, authorId, text, imageUrl }) {
  // L0
  const localHits = localPrefilter(text);
  // L1 / L2（命中危机词时仍要跑 AI 以减少误报，但保持危机敏感）
  const [aiText, aiImage] = await Promise.all([
    text ? aiTextClassify(text) : {},
    imageUrl ? aiImageClassify(imageUrl) : {},
  ]);

  const risk = aggregateRisk(localHits, aiText, aiImage);
  const verdict = decide(risk, { isDM: contentType === "dm" });

  // 落审计日志
  await ctx.db.insertModerationLog({
    content_type: contentType,
    content_id: contentId,
    author_id: authorId,
    action: verdict.action,
    risk_score: verdict.score,
    categories: risk,
    reason: verdict.reason,
  });

  // 动作后置处理
  let outputText = text;
  switch (verdict.action) {
    case "crisis":
      await triggerCrisisIntervention(ctx, authorId, contentId);
      break;
    case "mask":
      outputText = maskPII(text);
      break;
    case "review":
      await ctx.db.enqueueHumanReview({ contentType, contentId });
      break;
  }

  const visible = verdict.action === "approve" || verdict.action === "mask";
  return { ...verdict, visible, outputText, risk };
}

// ============================================================
// 危机干预通道：关怀优先，多方联动
// ============================================================
async function triggerCrisisIntervention(ctx, userId, contentId) {
  await ctx.db.insertCrisisEvent({
    user_id: userId,
    trigger_content: contentId,
    hotline_pushed: true,
    notified_therapist: true,
    notified_guardian: true,
  });
  // 1) 给用户温和回应 + 心理援助热线（不暴露"你被举报了"这类负面措辞）
  await ctx.notify.toUser(userId, {
    tone: "supportive",
    message: "我们注意到你可能正经历一些困难，你并不孤单。",
    hotline: "全国心理援助热线 12356",
  });
  // 2) 通知绑定疗愈师与家长（监护知情）
  await ctx.notify.toTherapistOf(userId, { type: "crisis_alert" });
  await ctx.notify.toGuardianOf(userId, { type: "crisis_alert" });
}

module.exports = { moderate, decide, aggregateRisk, localPrefilter, maskPII, triggerCrisisIntervention };
