/* ============================================================
   心绘 ArtMind — 触觉反馈
   · 安卓浏览器：navigator.vibrate，支持节奏与图案。
   · iPhone：网页不支持 vibrate；iOS 18 起切换 switch 开关会产生一次轻震，
     只能在用户点击时触发，所以 iPhone 上只有"点一下震一下"，
     节奏部分改由节拍声和画面闪动代替。
   ============================================================ */
window.ArtMindHaptics = (() => {
  const canVibrate = typeof navigator.vibrate === "function";
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let enabled = true;
  let rhythmTimer = null;
  let iosSwitch = null;
  let trail = 0;

  function iosTick() {
    if (!isIOS) return;
    if (!iosSwitch) {
      iosSwitch = document.createElement("label");
      iosSwitch.setAttribute("aria-hidden", "true");
      iosSwitch.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.tabIndex = -1;
      input.setAttribute("switch", "");
      iosSwitch.appendChild(input);
      iosSwitch.addEventListener("click", (e) => e.stopPropagation());
      document.body.appendChild(iosSwitch);
    }
    iosSwitch.click();
  }

  function vibrate(pattern) {
    if (!enabled || !pattern) return;
    if (canVibrate) navigator.vibrate(pattern);
    else iosTick();
  }

  // phase(elapsedMs) 返回 { interval, dur } 继续，返回 null 停止
  function rhythm(phase, onBeat) {
    stopRhythm();
    const t0 = performance.now();
    const beat = () => {
      const step = phase(performance.now() - t0);
      if (!step) return stopRhythm();
      if (enabled && canVibrate) navigator.vibrate(step.dur);
      onBeat?.(step);
      rhythmTimer = setTimeout(beat, step.interval);
    };
    beat();
  }

  function stopRhythm() {
    if (!rhythmTimer) return;
    clearTimeout(rhythmTimer);
    rhythmTimer = null;
    if (canVibrate) navigator.vibrate(0);
  }

  // 把节奏展开成节拍时间表，供不能震动的设备生成节拍声
  function schedule(phase, maxMs) {
    const beats = [];
    for (let t = 0; t < maxMs; ) {
      const step = phase(t);
      if (!step) break;
      beats.push({ t: t / 1000, dur: step.dur });
      t += step.interval;
    }
    return beats;
  }

  function toHsl(hex) {
    const n = parseInt(hex.replace("#", ""), 16);
    const r = ((n >> 16) & 255) / 255;
    const g = ((n >> 8) & 255) / 255;
    const b = (n & 255) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (!d) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    return { h, s, l };
  }

  // 每种颜色的"手感"：暖色细密轻快，绿色柔和，冷色舒缓绵长，灰色厚重，深色更沉
  function colorProfile(hex) {
    const { h, s, l } = toHsl(hex);
    let p;
    if (s < 0.18 && l > 0.15 && l < 0.92) p = { feel: "厚重而缓慢", step: 46, dur: 30, tap: [45] };
    else if (h < 70 || h >= 320) p = { feel: "轻快细密", step: 16, dur: 9, tap: [15, 35, 15, 35, 15] };
    else if (h < 170) p = { feel: "柔和均匀", step: 26, dur: 14, tap: [25, 45, 25] };
    else p = { feel: "舒缓绵长", step: 38, dur: 22, tap: [70] };
    if (l < 0.38) p = { ...p, feel: `${p.feel}，带一点沉`, dur: p.dur + 12 };
    if (l > 0.85) p = { ...p, feel: "轻盈若无", dur: Math.max(6, p.dur - 5) };
    return p;
  }

  // 画笔移动时按距离触发：颜色决定间隔与力度，笔刷越粗震得越久
  function brush(distance, hex, size = 16) {
    const p = colorProfile(hex);
    trail += distance;
    if (trail < p.step) return;
    trail = 0;
    if (enabled && canVibrate) navigator.vibrate(Math.round(p.dur * (0.7 + size / 40)));
  }

  return {
    canVibrate,
    isIOS,
    get enabled() { return enabled; },
    setEnabled(on) {
      enabled = !!on;
      if (!enabled) stopRhythm();
    },
    vibrate,
    rhythm,
    stopRhythm,
    schedule,
    colorProfile,
    brush,
  };
})();
