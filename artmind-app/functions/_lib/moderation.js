// 社区内容审核算法（Workers 运行时 ESM 版本，由 server/moderation.js 移植）
// 纯函数、无外部依赖；可在 Cloudflare Workers 中直接运行。
// 生产环境可在此基础上叠加 AI 分类模型调用（fetch 到模型服务）。

const LEXICON = {
  bully: ["垃圾", "去死", "废物", "丑八怪", "滚出去", "傻", "丑"],
  violence: ["打死你", "弄死", "杀了你"],
  ad_scam: ["加微信", "代购", "扫码领", "兼职日结", "私聊有偿"],
  crisis: ["不想活", "撑不下去", "结束自己", "活不下去", "自杀", "想消失", "没有意义"],
};

const PII = [/\b1[3-9]\d{9}\b/, /\d{17}[\dXx]/];

function localPrefilter(text = "") {
  const hits = {};
  for (const [cat, words] of Object.entries(LEXICON)) {
    for (const w of words) if (text.includes(w)) hits[cat] = (hits[cat] || 0) + 1;
  }
  hits.pii = PII.some((r) => r.test(text)) ? 1 : 0;
  return hits;
}

function aggregateRisk(hits) {
  const clamp = (n) => Math.min(1, Math.max(0, n));
  return {
    bully: clamp(hits.bully ? 0.7 : 0),
    violence: clamp(hits.violence ? 0.8 : 0),
    ad_scam: clamp(hits.ad_scam ? 0.6 : 0),
    pii: hits.pii ? 0.9 : 0,
    selfharm: clamp(hits.crisis ? 0.75 : 0),
  };
}

function maskPII(text) {
  return text.replace(/\b1[3-9]\d{9}\b/g, "***********").replace(/\d{17}[\dXx]/g, "******************");
}

// 分级决策：未成年人从严；危机优先于违规
export function decide(risk, { isDM = false } = {}) {
  const k = isDM ? 0.85 : 1;
  if (risk.selfharm >= 0.5) return { action: "crisis", score: risk.selfharm, reason: "检测到情绪危机信号，启动关怀干预。" };
  if (risk.violence >= 0.7 * k) return { action: "block", score: risk.violence, reason: "包含暴力威胁内容。" };
  if (risk.bully >= 0.6 * k) return { action: "block", score: risk.bully, reason: "检测到攻击性/欺凌言论。" };
  if (risk.ad_scam >= 0.6 * k) return { action: "block", score: risk.ad_scam, reason: "疑似广告/诈骗内容。" };
  if (risk.pii >= 0.6) return { action: "mask", score: risk.pii, reason: "包含个人隐私信息，已打码。" };
  const max = Math.max(...Object.values(risk));
  if (max >= 0.4) return { action: "review", score: max, reason: "风险中等，转人工复核。" };
  return { action: "approve", score: max, reason: "" };
}

// 审核主入口：返回判定 + 处理后文本
export function moderate(text, { isDM = false } = {}) {
  const hits = localPrefilter(text || "");
  const risk = aggregateRisk(hits);
  const verdict = decide(risk, { isDM });
  const outputText = verdict.action === "mask" ? maskPII(text) : text;
  const visible = verdict.action === "approve" || verdict.action === "mask";
  return { ...verdict, risk, outputText, visible };
}
