// POST /api/stt — 中文语音识别（手机/微信没有系统语音识别时使用）
// body: { audio: "data:audio/...;base64,..." | raw base64, mime? }
import { json, error, preflight } from "../_lib/response.js";
import { arkTranscribe } from "../_lib/ark.js";

const STT_MODEL = "@cf/openai/whisper-large-v3-turbo";
const STT_FALLBACK = "@cf/openai/whisper";
const MAX_BYTES = 2 * 1024 * 1024;

export async function onRequestOptions() {
  return preflight();
}

function stripDataUrl(audio) {
  const raw = String(audio || "");
  const comma = raw.indexOf(",");
  return raw.startsWith("data:") && comma >= 0 ? raw.slice(comma + 1) : raw;
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function pickText(result) {
  const text = result?.text ?? result?.transcription ?? result?.result?.text ?? "";
  return String(text).trim();
}

async function transcribe(env, b64) {
  const turbo = await env.AI.run(STT_MODEL, {
    audio: b64,
    task: "transcribe",
    language: "zh",
    initial_prompt: "中文画面描述。",
  }).catch(() => null);
  const text = pickText(turbo);
  if (text) return text;

  const bytes = base64ToBytes(b64);
  const legacy = await env.AI.run(STT_FALLBACK, { audio: [...bytes] });
  const fallback = pickText(legacy);
  if (fallback) return fallback;
  throw new Error("empty-stt-text");
}

export async function onRequestPost({ request, env }) {
  if (!env.ARK_API_KEY && !env.AI) return error("语音识别未配置", 503);
  const { audio = "" } = await request.json().catch(() => ({}));
  const mime = /^data:([^;,]+)/.exec(String(audio))?.[1] || "audio/webm";
  const b64 = stripDataUrl(audio).replace(/\s/g, "");
  if (!b64) return error("缺少 audio 参数");

  const pad = b64.length % 4 === 0 ? 0 : 4 - (b64.length % 4);
  const bytes = Math.floor((b64.length * 3) / 4) - pad;
  if (bytes > MAX_BYTES) return error("录音太长，请说得短一些。", 413);

  try {
    const text = env.ARK_API_KEY ? await arkTranscribe(env, b64, mime) : await transcribe(env, b64);
    return json({ ok: true, text });
  } catch (err) {
    console.error("[stt]", err?.message || err);
    const message = String(err?.message || "");
    return json({ ok: false, error: message.startsWith("方舟") ? message : "语音识别暂时不可用，请直接打字。" }, 502);
  }
}
