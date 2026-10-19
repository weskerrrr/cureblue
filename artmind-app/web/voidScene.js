import * as THREE from "./vendor/three.module.min.js";

/* 整页的混沌空间。按钮仍负责触摸，这里只负责看见。 */
const ROOMS = ["studio", "tasks", "gallery", "community"];
const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 40);
camera.position.set(0, 0.2, 8.4);
scene.add(camera);

const rig = new THREE.Group();
rig.position.set(0, -1.02, -6.05);
camera.add(rig);

const uniforms = {
  uTime: { value: 0 },
  uHold: { value: 0 },
  uBusy: { value: 0 },
  uBreath: { value: 0.5 },
};

let renderer = null;
let root = null;
let frame = 0;
let started = false;
let room = "studio";
let hold = 0;
let busy = 0;
let clock = 0;
const weights = Object.fromEntries(ROOMS.map((id) => [id, id === "studio" ? 1 : 0]));
const forms = {};
const camDesired = new THREE.Vector3(0, 0.2, 8.4);

const fieldVertex = `
precision highp float;
attribute float aSeed;
uniform float uTime;
uniform float uHold;
uniform float uBreath;
varying float vSeed;
varying float vFade;
void main() {
  float spin = uTime * (0.045 + uHold * 0.12) + aSeed * 0.35;
  float c = cos(spin);
  float s = sin(spin);
  vec3 p = position;
  p.xz = mat2(c, s, -s, c) * p.xz;
  float drift = sin(uTime * 0.33 + aSeed * 18.0) * (0.28 + uBreath * 0.22);
  p += normalize(p + 0.001) * drift;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = (1.1 + aSeed * 2.4) * (72.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
  vSeed = aSeed;
  vFade = smoothstep(18.0, 5.0, length(p));
}
`;

const fieldFragment = `
precision highp float;
varying float vSeed;
varying float vFade;
uniform float uHold;
uniform float uBusy;
void main() {
  vec2 uv = gl_PointCoord - 0.5;
  float d = length(uv);
  if (d > 0.5) discard;
  float alpha = smoothstep(0.5, 0.05, d) * vFade;
  vec3 violet = vec3(0.42, 0.34, 0.78);
  vec3 gold = vec3(0.93, 0.76, 0.46);
  float goldMix = smoothstep(0.86, 0.98, vSeed);
  vec3 col = mix(violet, gold, goldMix);
  alpha *= 0.28 + vSeed * 0.55 + uHold * 0.25 + uBusy * 0.15;
  gl_FragColor = vec4(col, alpha);
}
`;

const micVertex = `
precision highp float;
uniform float uTime;
uniform float uHold;
uniform float uBreath;
uniform float uBusy;
varying float vN;
varying vec3 vNrm;
void main() {
  float t = uTime * (0.9 + uHold * 2.4 + uBusy * 1.4);
  float n = sin(position.x * 5.5 + t) * sin(position.y * 6.4 - t * 1.15) * sin(position.z * 4.6 + t * 0.75);
  float amp = 0.14 + uBreath * 0.08 + uHold * 0.34 + uBusy * 0.1;
  vec3 p = position + normal * n * amp;
  vN = n;
  vNrm = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const micFragment = `
precision highp float;
varying float vN;
varying vec3 vNrm;
uniform float uHold;
uniform float uBreath;
uniform float uAlpha;
void main() {
  float fres = pow(1.0 - abs(dot(normalize(vNrm), vec3(0.0, 0.0, 1.0))), 1.5);
  vec3 ink = vec3(0.16, 0.08, 0.24);
  vec3 gold = vec3(0.95, 0.74, 0.38);
  vec3 col = mix(ink, gold, 0.38 + fres * 0.85 + uHold * 0.2);
  col += vec3(1.0, 0.86, 0.55) * (0.15 + vN * 0.35) * (uBreath + uHold);
  gl_FragColor = vec4(col, uAlpha);
}
`;

function makeField() {
  const count = 6400;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const y = 1 - (i / (count - 1)) * 2;
    const ring = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = Math.PI * (3 - Math.sqrt(5)) * i;
    const radius = 3.2 + (i % 23) * 0.48;
    positions[i * 3] = Math.cos(theta) * ring * radius;
    positions[i * 3 + 1] = y * radius * 0.62;
    positions[i * 3 + 2] = Math.sin(theta) * ring * radius;
    seeds[i] = Math.random();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: fieldVertex,
    fragmentShader: fieldFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  material.toneMapped = false;
  scene.add(new THREE.Points(geo, material));
}

function micMaterial(alphaUniform) {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uAlpha: alphaUniform },
    vertexShader: micVertex,
    fragmentShader: micFragment,
    transparent: true,
  });
  material.toneMapped = false;
  return material;
}

function makeForms() {
  const alpha = { value: 1 };
  const mic = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.62, 128, 96), micMaterial(alpha));
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 24, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff3cc }),
  );
  const ringCount = 90;
  const ringPos = new Float32Array(ringCount * 3);
  const ringSeed = new Float32Array(ringCount);
  for (let i = 0; i < ringCount; i += 1) {
    const a = (i / ringCount) * Math.PI * 2;
    const r = 1.15 + (i % 5) * 0.03;
    ringPos[i * 3] = Math.cos(a) * r;
    ringPos[i * 3 + 1] = Math.sin(a * 3) * 0.08;
    ringPos[i * 3 + 2] = Math.sin(a) * r;
    ringSeed[i] = i / ringCount;
  }
  const ringGeo = new THREE.BufferGeometry();
  ringGeo.setAttribute("position", new THREE.BufferAttribute(ringPos, 3));
  ringGeo.setAttribute("aSeed", new THREE.BufferAttribute(ringSeed, 1));
  const ring = new THREE.Points(ringGeo, new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      precision highp float;
      attribute float aSeed;
      uniform float uTime;
      uniform float uHold;
      void main() {
        float ang = uTime * (0.35 + uHold) + aSeed * 6.283;
        float c = cos(ang);
        float s = sin(ang);
        vec3 p = position;
        p.xz = mat2(c, s, -s, c) * p.xz;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = 5.0 + aSeed * 7.0;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      precision highp float;
      uniform float uHold;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float alpha = smoothstep(0.5, 0.0, d) * (0.45 + uHold * 0.4);
        gl_FragColor = vec4(0.93, 0.78, 0.48, alpha);
      }
    `,
  }));
  ring.material.toneMapped = false;
  mic.add(shell, core, ring);
  mic.userData.shell = shell;
  mic.userData.core = core;
  mic.userData.ring = ring;
  mic.userData.alpha = alpha;
  forms.studio = mic;

  const breath = new THREE.Mesh(
    new THREE.SphereGeometry(0.72, 48, 48),
    new THREE.MeshPhysicalMaterial({
      color: 0xf0c14b,
      emissive: 0xc8892d,
      emissiveIntensity: 0.62,
      roughness: 0.28,
      metalness: 0.12,
      transparent: true,
      opacity: 0.94,
    }),
  );
  forms.tasks = breath;

  forms.gallery = new THREE.Group();

  const cluster = new THREE.Group();
  for (let i = 0; i < 18; i += 1) {
    const mote = new THREE.Mesh(
      new THREE.SphereGeometry(0.05 + (i % 4) * 0.018, 12, 12),
      new THREE.MeshBasicMaterial({ color: i % 3 ? 0xe7c27a : 0xc9c2ff }),
    );
    const a = (i / 18) * Math.PI * 2;
    const r = 0.25 + (i % 5) * 0.12;
    mote.position.set(Math.cos(a) * r, Math.sin(a * 2) * 0.28, Math.sin(a) * r);
    cluster.add(mote);
  }
  forms.community = cluster;

  ROOMS.forEach((id) => rig.add(forms[id]));
}

function placeCamera(index) {
  const angle = index * (Math.PI * 2 / ROOMS.length);
  camDesired.set(Math.sin(angle) * 1.35, 0.22 + Math.sin(angle * 2) * 0.12, 8.15 + Math.cos(angle) * 0.85);
}

function applyWeights() {
  ROOMS.forEach((id) => {
    const form = forms[id];
    const w = weights[id];
    form.visible = w > 0.03;
    const scale = 0.84 + w * 0.16;
    form.scale.setScalar(scale);
    form.traverse((obj) => {
      const mat = obj.material;
      if (!mat) return;
      if (mat.uniforms?.uAlpha) mat.uniforms.uAlpha.value = w;
      else if ("opacity" in mat) {
        mat.transparent = true;
        mat.opacity = w;
      }
    });
  });
}

function resize() {
  if (!renderer) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

function tick(now) {
  frame = requestAnimationFrame(tick);
  const plain = document.body.dataset.contrast === "high";
  if (root) root.style.visibility = plain ? "hidden" : "visible";
  if (plain) return;
  const quiet = !!document.querySelector(".task-live, .med-live");
  rig.visible = !quiet;
  if (!reduced) clock = now / 1000;
  const breath = reduced ? 0.45 : 0.5 + Math.sin(clock * 0.85) * 0.5;
  uniforms.uTime.value = clock;
  uniforms.uBreath.value = breath;
  uniforms.uHold.value += ((hold ? 1 : 0) - uniforms.uHold.value) * (reduced ? 1 : 0.12);
  uniforms.uBusy.value += ((busy ? 1 : 0) - uniforms.uBusy.value) * (reduced ? 1 : 0.08);
  const step = reduced ? 1 : 0.06;
  ROOMS.forEach((id) => {
    const goal = id === room ? 1 : 0;
    weights[id] += (goal - weights[id]) * step;
  });
  applyWeights();
  const mic = forms.studio;
  if (mic) {
    const pulse = 1 + Math.sin(clock * (hold ? 3.1 : 1.15)) * (hold ? 0.06 : 0.03);
    mic.userData.core.scale.setScalar(pulse);
    mic.userData.ring.rotation.z = clock * (hold ? 0.9 : 0.25);
    mic.userData.ring.rotation.x = 1.15 + Math.sin(clock * 0.4) * 0.12;
  }
  forms.tasks.scale.setScalar((0.9 + breath * 0.12) * (0.84 + weights.tasks * 0.16));
  forms.gallery.rotation.y = Math.sin(clock * 0.35) * 0.18;
  forms.community.rotation.y = clock * 0.2;
  if (reduced) camera.position.copy(camDesired);
  else camera.position.lerp(camDesired, 0.05);
  camera.lookAt(0, 0.05, 0);
  renderer.render(scene, camera);
}

function start() {
  if (started || !window.WebGLRenderingContext) return;
  root = document.createElement("div");
  root.id = "void-root";
  root.setAttribute("aria-hidden", "true");
  document.body.prepend(root);
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "low-power",
    });
  } catch {
    renderer = null;
    root.remove();
    root = null;
    return;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x07060c, 1);
  renderer.domElement.setAttribute("aria-hidden", "true");
  root.appendChild(renderer.domElement);
  makeField();
  makeForms();
  scene.add(new THREE.AmbientLight(0xf4efe4, 0.35));
  const key = new THREE.PointLight(0xffe0a8, 12, 14);
  key.position.set(1.4, 1.6, 2);
  rig.add(key);
  document.documentElement.classList.add("void-on");
  started = true;
  resize();
  window.addEventListener("resize", resize);
  placeCamera(0);
  frame = requestAnimationFrame(tick);
}

function setRoom(id) {
  if (!ROOMS.includes(id)) return;
  room = id;
  placeCamera(ROOMS.indexOf(id));
}

function setHolding(on) {
  hold = on ? 1 : 0;
}

function setBusy(on) {
  busy = on ? 1 : 0;
}

window.ArtMindVoid = { start, setRoom, setHolding, setBusy };
