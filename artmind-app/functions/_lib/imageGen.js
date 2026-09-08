/**
 * 心绘生图：中文提示译成英文 + Pollinations flux。
 * 供 Pages Function 使用（Workers 运行时）。
 */

const ENDPOINT = "https://image.pollinations.ai/prompt/";

const STYLE_EN = {
  auto: "warm healing children's illustration, soft colors, storybook",
  watercolor: "watercolor painting, soft washes, gentle bleeding edges",
  cartoon: "cute cartoon illustration, bright clean lines",
  crayon: "children's crayon drawing, waxy texture",
  oil: "oil painting, rich visible brushstrokes",
  pixel: "pixel art, charming 16-bit style",
};

const PHRASE_EN = [
  ["一只在草地上奔跑的小狗，阳光很温暖", "a puppy running on the grass in warm sunlight"],
  ["夜空里有一弯月亮和很多星星", "a crescent moon and many stars in the night sky"],
  ["海边的灯塔，海浪轻轻拍打", "a lighthouse by the sea with gentle waves"],
  ["森林里的小木屋，烟囱冒着炊烟", "a small wooden cabin in the forest with smoke from the chimney"],
  ["一片宁静的蓝色海洋", "a calm blue ocean"],
  ["一只小猫", "a little kitten"],
  ["一轮月亮", "a crescent moon"],
  ["大海", "the ocean"],
  ["我自己", "a child that looks like me"],
  ["在森林里", "in a forest"],
  ["在海边", "by the seaside"],
  ["在天空中", "in the sky"],
  ["在花园里", "in a garden"],
  ["加上彩虹", "with a rainbow"],
  ["加上星星", "with stars"],
  ["加上花朵", "with flowers"],
  ["加上气球", "with balloons"],
  ["开心", "happy"],
  ["平静", "calm"],
  ["有点难过", "a little sad but gentle"],
  ["兴奋", "excited"],
];

function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(text);
}

function localTranslate(text) {
  let remaining = text.trim();
  const kept = [];

  for (const [zh, en] of PHRASE_EN) {
    if (remaining.includes(zh)) {
      remaining = remaining.split(zh).join(" ");
      kept.push(en);
    }
  }

  remaining = remaining.replace(/[，。、；：！？,.;:!?]/g, " ").replace(/\s+/g, " ").trim();

  if (!remaining || !hasChinese(remaining)) {
    const extra = remaining && !hasChinese(remaining) ? remaining : "";
    return [...kept, extra].filter(Boolean).join(", ");
  }
  if (kept.length) return `${kept.join(", ")}, scene described as: ${text.trim()}`;
  return `illustration of this scene: ${text.trim()}`;
}

async function translateZhToEn(text) {
  if (!hasChinese(text)) return text;
  const local = localTranslate(text);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
      text.slice(0, 450),
    )}&langpair=zh|en`;
    const res = await fetch(url, { signal: controller.signal });
    const data = await res.json();
    const translated = String(data?.responseData?.translatedText || "").trim();
    const bad =
      !translated ||
      /MYMEMORY WARNING/i.test(translated) ||
      hasChinese(translated) ||
      translated.toLowerCase() === text.toLowerCase();
    if (!bad) return translated;
  } catch {
    /* 翻译失败时用本地词典 */
  } finally {
    clearTimeout(timer);
  }
  return local;
}

export async function buildImageResult(prompt, styleId = "auto") {
  const clean = (prompt || "").trim();
  const style = STYLE_EN[styleId] ? styleId : "auto";
  const sceneEn = await translateZhToEn(clean);
  const englishPrompt = [
    sceneEn,
    STYLE_EN[style],
    "children's storybook illustration",
    "wholesome, gentle atmosphere, clearly depicting the described scene",
    "not a photograph of food, not a random stock photo, not an unrelated object",
  ].join(", ");

  const seed = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  const url =
    `${ENDPOINT}${encodeURIComponent(englishPrompt)}` +
    `?width=768&height=768&seed=${seed}&model=flux&private=true`;

  return {
    kind: "image",
    url,
    prompt: clean,
    seed,
    style,
    englishPrompt,
    altText: `这是一幅画，画的是${clean}。`,
  };
}
