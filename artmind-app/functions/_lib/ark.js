/**
 * 火山方舟：生图、语音合成、语音理解。
 * 密钥只从环境变量 ARK_API_KEY 读取（本地 .dev.vars，线上 Pages Secret）。
 */

const ARK = "https://ark.cn-beijing.volces.com/api/v3";
const TTS_URL = "https://openspeech.bytedance.com/api/v3/tts/unidirectional";

function envValue(value) {
  return String(value || "").replace(/^\uFEFF/, "").trim();
}

const STYLE_ZH = {
  auto: "画面清晰，主体大，自然配色",
  watercolor: "水彩，颜色柔和",
  cartoon: "干净的卡通插画",
  crayon: "蜡笔儿童画",
  oil: "油画笔触",
};

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function arkError(data, status) {
  const message = data?.error?.message || data?.message || "";
  return String(message || `请求失败（${status}）`).slice(0, 180);
}

export async function arkImage(env, prompt, styleId = "auto") {
  const scene = String(prompt || "").trim().slice(0, 280);
  const style = STYLE_ZH[styleId] || STYLE_ZH.auto;
  const model = envValue(env.ARK_IMAGE_MODEL) || "doubao-seedream-5-0-pro-260628";
  const res = await fetch(`${ARK}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${envValue(env.ARK_API_KEY)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt: `${scene}。${style}。`,
      size: envValue(env.ARK_IMAGE_SIZE) || "2K",
      response_format: "b64_json",
      output_format: "jpeg",
      watermark: false,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = arkError(data, res.status);
    if (/not activated|activate the model|do not have access|does not exist/i.test(detail)) {
      throw new Error(`方舟生图失败：账号还没有开通模型 ${model}。请到火山方舟控制台开通这个生图模型。`);
    }
    throw new Error(`方舟生图失败：${detail}`);
  }
  const item = data?.data?.[0] || {};
  let url = "";
  if (item.b64_json) url = `data:image/jpeg;base64,${item.b64_json}`;
  else if (item.url) url = item.url;
  if (!url) throw new Error("方舟生图失败：没有返回图片。");
  return {
    kind: "image",
    url,
    prompt: scene,
    seed: 0,
    style: styleId,
    englishPrompt: scene,
    provider: "ark",
    providerLabel: "火山方舟",
    altText: `这是一幅画，画的是${scene}。`,
  };
}

export async function arkSpeak(env, text) {
  const res = await fetch(TTS_URL, {
    method: "POST",
    headers: {
      "X-Api-Key": envValue(env.ARK_TTS_API_KEY) || envValue(env.ARK_API_KEY),
      "X-Api-Resource-Id": envValue(env.ARK_TTS_RESOURCE) || "seed-tts-2.0",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      req_params: {
        text,
        speaker: envValue(env.ARK_TTS_SPEAKER) || "zh_female_vv_uranus_bigtts",
        audio_params: { format: "mp3", sample_rate: 24000 },
      },
    }),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`方舟语音失败：${raw.slice(0, 180) || res.status}`);

  const pieces = [];
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const chunks = lines.length ? lines : [raw.trim()];
  for (const line of chunks) {
    let data;
    try {
      data = JSON.parse(line);
    } catch {
      continue;
    }
    const code = Number(data.code || data.header?.code || 0);
    const message = data.message || data.header?.message || "";
    if (code === 20000000) break;
    if (code > 0) throw new Error(`方舟语音失败：${message || code}`);
    if (data.data) pieces.push(String(data.data));
  }
  if (!pieces.length) throw new Error("方舟语音失败：没有返回音频。");

  const arrays = pieces.map(base64ToBytes);
  const total = arrays.reduce((sum, item) => sum + item.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const item of arrays) {
    bytes.set(item, offset);
    offset += item.length;
  }
  return bytesToBase64(bytes);
}

export async function arkTranscribe(env, b64, mime = "audio/webm") {
  const format = String(mime).replace(/^audio\//, "").split(";")[0] || "webm";
  const model = envValue(env.ARK_ASR_MODEL) || "doubao-seed-2-1-lite-260915";
  const res = await fetch(`${ARK}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${envValue(env.ARK_API_KEY)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "input_audio", input_audio: { data: b64, format } },
            { type: "text", text: "请把这段语音转写成中文。只输出转写文字，不要解释。" },
          ],
        },
      ],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`方舟识别失败：${arkError(data, res.status)}`);
  const text = data?.choices?.[0]?.message?.content;
  const clean = String(text || "").trim();
  if (!clean) throw new Error("方舟识别失败：没有识别出文字。");
  return clean;
}
