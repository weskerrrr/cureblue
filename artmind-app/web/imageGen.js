/* 心绘前端生图：后端不可用时的降级路径。自定义中文会先尽量译成英文。 */
window.ArtMindImage = (() => {
  const ENDPOINT = "https://image.pollinations.ai/prompt/";
  const STYLE_EN = {
    auto: "clear illustration, natural colors, the main subject is large",
    watercolor: "watercolor painting, soft washes, gentle bleeding edges",
    cartoon: "cute cartoon illustration, bright clean lines",
    crayon: "children's crayon drawing, waxy texture",
    oil: "oil painting, rich visible brushstrokes",
    pixel: "pixel art, charming 16-bit style",
  };
  const PHRASE_EN = [
    ["一只在草地上奔跑的小狗，阳光很温暖", "a puppy running on the grass in warm sunlight"],
    ["一只在草地上奔跑的小猫，阳光很温暖", "a kitten running on the grass in warm sunlight"],
    ["夜空里有一弯月亮和很多星星", "a crescent moon and many stars in the night sky"],
    ["海边的灯塔，海浪轻轻拍打", "a lighthouse by the sea with gentle waves"],
    ["森林里的小木屋，烟囱冒着炊烟", "a small wooden cabin in the forest with smoke from the chimney"],
    ["一片宁静的蓝色海洋", "a calm blue ocean"],
    ["阳光很温暖", "warm sunlight"],
    ["在草地上奔跑", "running on the grass"],
    ["在草地上", "on the grass"],
    ["很多星星", "many stars"],
    ["一弯月亮", "a crescent moon"],
    ["一只小猫", "a little kitten"],
    ["一只小狗", "a little puppy"],
    ["小木屋", "a small wooden cabin"],
    ["海浪", "ocean waves"],
    ["灯塔", "a lighthouse"],
    ["森林", "a forest"],
    ["夜空", "the night sky"],
    ["星星", "stars"],
    ["月亮", "the moon"],
    ["大海", "the ocean"],
    ["海洋", "the ocean"],
    ["海边", "by the seaside"],
    ["草地", "a grassy field"],
    ["小猫咪", "a kitten"],
    ["小猫", "a kitten"],
    ["小狗", "a puppy"],
    ["奔跑", "running"],
    ["阳光", "sunlight"],
    ["温暖", "warm"],
    ["彩虹", "a rainbow"],
    ["花朵", "flowers"],
    ["气球", "balloons"],
    ["烟囱", "a chimney"],
    ["炊烟", "smoke from a chimney"],
    ["我自己", "a child that looks like me"],
    ["在森林里", "in a forest"],
    ["在天空中", "in the sky"],
    ["在花园里", "in a garden"],
    ["加上彩虹", "with a rainbow"],
    ["加上星星", "with stars"],
    ["加上花朵", "with flowers"],
    ["加上气球", "with balloons"],
    ["有点难过", "a little sad but gentle"],
    ["开心", "happy"],
    ["平静", "calm"],
    ["兴奋", "excited"],
  ].sort((a, b) => b[0].length - a[0].length);

  function hasChinese(text) {
    return /[\u4e00-\u9fff]/.test(text);
  }

  function stripChinese(text) {
    return String(text || "")
      .replace(/[\u4e00-\u9fff]/g, " ")
      .replace(/[，。、；：！？]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
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
    const leftoverChinese = hasChinese(remaining);
    remaining = stripChinese(remaining);
    return {
      english: [...kept, remaining].filter(Boolean).join(", "),
      complete: !leftoverChinese,
    };
  }

  function isGoodEnglish(text) {
    const t = String(text || "").trim();
    if (t.length < 4 || hasChinese(t)) return false;
    if (/MYMEMORY WARNING/i.test(t)) return false;
    return /[a-zA-Z]{3,}/.test(t);
  }

  async function translateZhToEn(text) {
    if (!hasChinese(text)) return text;
    const local = localTranslate(text);
    if (local.complete && isGoodEnglish(local.english)) return local.english;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
        text.slice(0, 450),
      )}&langpair=zh|en`;
      const res = await fetch(url, { signal: controller.signal });
      const data = await res.json();
      const translated = String(data?.responseData?.translatedText || "").trim();
      if (isGoodEnglish(translated) && translated.toLowerCase() !== text.toLowerCase()) {
        return translated;
      }
    } catch {
      /* 翻译失败时用本地词典 */
    } finally {
      clearTimeout(timer);
    }
    return isGoodEnglish(local.english) ? local.english : text;
  }

  async function build({ prompt, style = "auto" }) {
    const clean = (prompt || "").trim();
    const styleId = STYLE_EN[style] ? style : "auto";
    const sceneEn = await translateZhToEn(clean);
    const scene = String(sceneEn || "").replace(/\s+/g, " ").trim();
    const englishPrompt = `${scene}. The picture shows exactly this scene: ${scene}. ${STYLE_EN[styleId]}.`;
    const seed = Math.floor(Math.random() * 1_000_000);
    const url =
      `${ENDPOINT}${encodeURIComponent(englishPrompt)}` +
      `?width=768&height=768&seed=${seed}&model=flux&private=true`;
    return { url, prompt: clean, seed, style: styleId, englishPrompt, provider: "pollinations", providerLabel: "Pollinations" };
  }

  return { build };
})();
