/* ============================================================
   BIGOLA: STELLARFALL — Shadow of Gargantua
   A cinematic action-RPG beneath a black hole.
   ============================================================ */
'use strict';

/* ---------------- utils ---------------- */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

/* ---------------- DOM ---------------- */
const $ = (id) => document.getElementById(id);
const hud = $('hud'), menu = $('menu');
const hpFill = $('hpFill'), hpText = $('hpText'), novaFill = $('novaFill'), novaText = $('novaText');
const xpFill = $('xpFill'), lvlText = $('lvlText'), killsText = $('killsText');
const questName = $('questName'), questFill = $('questFill'), questProgress = $('questProgress');
const bossWrap = $('bossWrap'), bossFill = $('bossFill'), bossName = $('bossName');
const vignette = $('vignette'), flash = $('flash'), toastEl = $('toast');
const hitmarker = $('hitmarker');

bossWrap.style.display = 'none';

/* ============================================================
   AUDIO — everything synthesized with Web Audio
   ============================================================ */
const AudioSys = {
  ctx: null, master: null,
  init() {
    if (this.ctx) return;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    this.ctx = new C();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.85;
    this.master.connect(this.ctx.destination);
    this.startDrone();
  },
  now() { return this.ctx ? this.ctx.currentTime : 0; },
  env(g, t0, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec);
  },
  blip(freq, type, peak, dur, slideTo) {
    if (!this.ctx) return;
    const t = this.now(), o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    this.env(g, t, 0.008, peak, dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  },
  noise(peak, dur, cutoff) {
    if (!this.ctx) return;
    const t = this.now(), len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff || 800;
    const g = this.ctx.createGain(); this.env(g, t, 0.01, peak, dur);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t);
  },
  shoot()   { this.blip(920, 'square', 0.14, 0.11, 150); },
  bolt()    { this.blip(330, 'square', 0.11, 0.15, 230); },
  enemyHit(){ this.blip(240, 'sawtooth', 0.16, 0.08, 120); },
  hurt()    { this.noise(0.28, 0.22, 520); this.blip(85, 'sine', 0.3, 0.24, 42); },
  explode() { this.noise(0.5, 0.55, 340); this.blip(58, 'sine', 0.42, 0.55, 28); },
  orb()     { this.blip(1318, 'sine', 0.09, 0.09, 1760); },
  levelUp() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.blip(f, 'triangle', 0.22, 0.34), i * 105)); },
  chime()   { this.blip(1568, 'sine', 0.18, 0.4); setTimeout(() => this.blip(2093, 'sine', 0.16, 0.5), 140); },
  nova()    { this.blip(170, 'sawtooth', 0.38, 0.85, 1650); this.noise(0.36, 0.8, 1250); },
  bossRoar(){ this.blip(48, 'sawtooth', 0.5, 1.3, 30); this.noise(0.4, 1.1, 220); },
  startDrone() {
    const t = this.now();
    const tones = [[36, 'sine', 0.5], [54, 'sine', 0.3], [108.2, 'triangle', 0.06]];
    tones.forEach(([f, ty, v]) => {
      const o = this.ctx.createOscillator(); o.type = ty; o.frequency.value = f;
      const g = this.ctx.createGain(); g.gain.value = v;
      const lfo = this.ctx.createOscillator(); lfo.frequency.value = rand(0.05, 0.12);
      const lg = this.ctx.createGain(); lg.gain.value = v * 0.55;
      lfo.connect(lg); lg.connect(g.gain);
      o.connect(g); g.connect(this.master); o.start(t); lfo.start(t);
    });
    const len = this.ctx.sampleRate * 2, buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 400; f.Q.value = 0.55;
    const g = this.ctx.createGain(); g.gain.value = 0.055;
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t);
  }
};

/* ============================================================
   THREE.JS WORLD
   ============================================================ */
const WORLD_R = 145;
let scene, camera, renderer, clock;
let weapon, muzzleGlow, muzzleLight;
let portals = [], crystals = [], wreckLights = [];
let snow, snowVel;
const tmpV = new THREE.Vector3();

const player = {
  hp: 100, maxHp: 100, level: 1, xp: 0, xpNeed: 60,
  dmg: 26, nova: 0, kills: 0, speed: 6.1,
  yaw: 0, pitch: 0,
  pos: new THREE.Vector3(0, 0, 46),
  regenDelay: 0, walkPhase: 0, runTime: 0
};

let state = 'menu';           // menu | playing | paused | dead | victory
let shake = 0, vignetteOp = 0, novaFlash = 0;
let enemies = [], bolts = [], orbs = [], medkits = [], tracers = [], shockwaves = [];
let spawnTimer = 0, fireCooldown = 0, recoil = 0;
let quest = { stage: 0, need: 8, count: 0 };
let boss = null, minionTimer = 0;

/* ---------- canvas texture helpers ---------- */
function makeCanvas(size, fn) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  fn(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function glowTexture(inner, mid) {
  return makeCanvas(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
    g.addColorStop(0, inner); g.addColorStop(0.35, mid); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  });
}
const TEX = {};
function buildTextures() {
  TEX.glowWhite   = glowTexture('rgba(255,255,255,1)', 'rgba(160,240,255,.55)');
  TEX.glowMagenta = glowTexture('rgba(255,190,255,1)', 'rgba(255,43,214,.5)');
  TEX.glowCyan    = glowTexture('rgba(210,255,255,1)', 'rgba(34,211,238,.5)');
  TEX.glowOrange  = glowTexture('rgba(255,240,200,1)', 'rgba(255,150,50,.5)');
  TEX.glowRed     = glowTexture('rgba(255,210,210,1)', 'rgba(255,40,60,.55)');
  TEX.accretion   = makeCanvas(512, (ctx, s) => {
    const g = ctx.createRadialGradient(s/2, s/2, s*0.18, s/2, s/2, s*0.5);
    g.addColorStop(0.0, 'rgba(255,255,240,0)');
    g.addColorStop(0.28, 'rgba(255,255,235,.95)');
    g.addColorStop(0.38, 'rgba(255,214,130,.9)');
    g.addColorStop(0.52, 'rgba(255,150,60,.55)');
    g.addColorStop(0.68, 'rgba(180,80,200,.28)');
    g.addColorStop(1.0, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  });
  TEX.ground = makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = '#161130'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 5200; i++) {
      const a = Math.random() * 0.5 + 0.08;
      ctx.fillStyle = Math.random() < 0.5 ? `rgba(200,190,255,${a * 0.35})` : `rgba(6,4,18,${a})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, Math.random() * 2.4 + 0.6, Math.random() * 2.4 + 0.6);
    }
    ctx.strokeStyle = 'rgba(190,180,255,.06)';
    for (let i = 0; i < 26; i++) {
      ctx.beginPath();
      ctx.moveTo(Math.random() * s, Math.random() * s);
      ctx.lineTo(Math.random() * s, Math.random() * s);
      ctx.stroke();
    }
  });
  TEX.ground.wrapS = TEX.ground.wrapT = THREE.RepeatWrapping;
  TEX.ground.repeat.set(9, 9);
}
/* cheap value-noise fbm for dunes */
function hash2(x, y) { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); }
function smooth(t) { return t * t * (3 - 2 * t); }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  const u = smooth(xf), v = smooth(yf);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
function fbm(x, y) { return vnoise(x, y) * 0.6 + vnoise(x * 2.1 + 5, y * 2.1 + 5) * 0.3 + vnoise(x * 4.3 + 9, y * 4.3 + 9) * 0.1; }

/* ---------- world build ---------- */
function buildWorld() {
  buildTextures();
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x070218, 0.0105);

  camera = new THREE.PerspectiveCamera(74, innerWidth / innerHeight, 0.1, 7000);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  $('app').appendChild(renderer.domElement);

  /* lighting — cold starlight + violet bounce */
  scene.add(new THREE.HemisphereLight(0x5546a8, 0x0a0518, 1.25));
  const key = new THREE.DirectionalLight(0xcfe4ff, 1.5); key.position.set(-140, 190, -60); scene.add(key);
  const rim = new THREE.DirectionalLight(0xff77dd, 0.55); rim.position.set(170, 70, 160); scene.add(rim);

  /* ground — Kharon-7, the ash plain */
  const gGeo = new THREE.PlaneGeometry(640, 640, 96, 96);
  const pos = gGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const d = Math.hypot(x, y);
    let h = fbm(x * 0.016 + 3, y * 0.016 + 7) * 11;
    h += Math.max(0, d - 235) * 0.42;           // rim mountains closing the bowl
    pos.setZ(i, h - 2.4);
  }
  gGeo.computeVertexNormals();
  const ground = new THREE.Mesh(gGeo, new THREE.MeshStandardMaterial({ map: TEX.ground, color: 0x9a93c4, roughness: 0.97, metalness: 0.04 }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  /* sky dome — indigo vault with a sickly glow on the horizon */
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {
      top:    { value: new THREE.Color(0x040118) },
      mid:    { value: new THREE.Color(0x120a35) },
      glow:   { value: new THREE.Color(0x6d28d9) }
    },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'varying vec3 vP; uniform vec3 top; uniform vec3 mid; uniform vec3 glow;',
      'void main(){',
      ' float h = normalize(vP).y;',
      ' vec3 col = mix(mid, top, clamp(h * 1.5 + 0.32, 0.0, 1.0));',
      ' float b = pow(max(0.0, 1.0 - abs(h + 0.10)), 7.0);',
      ' col += glow * b * 0.95;',
      ' gl_FragColor = vec4(col, 1.0);',
      '}'
    ].join('\n')
  });
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(5200, 28, 18), skyMat));

  /* starfield */
  const starGeo = new THREE.BufferGeometry();
  const starPos = new Float32Array(2600 * 3);
  const starCol = new Float32Array(2600 * 3);
  const starTint = [new THREE.Color(0xffffff), new THREE.Color(0xa5f3fc), new THREE.Color(0xf0abfc), new THREE.Color(0xc4b5fd)];
  for (let i = 0; i < 2600; i++) {
    const theta = Math.random() * TAU, phi = Math.acos(rand(0.02, 1));
    const r = 4700;
    starPos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
    starPos[i*3+1] = r * Math.cos(phi);
    starPos[i*3+2] = r * Math.sin(phi) * Math.sin(theta);
    const c = starTint[(Math.random() * starTint.length) | 0];
    const b = rand(0.45, 1);
    starCol[i*3] = c.r * b; starCol[i*3+1] = c.g * b; starCol[i*3+2] = c.b * b;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ size: 2.4, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.95, fog: false })));

  /* ---- GARGANTUA — the wound in the sky ---- */
  const holePos = new THREE.Vector3(-240, 330, -3900);
  const hole = new THREE.Group();
  const holeGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glowOrange, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, transparent: true, opacity: 0.9 }));
  holeGlow.scale.set(2400, 2400, 1); hole.add(holeGlow);
  const disc = new THREE.Mesh(new THREE.RingGeometry(165, 560, 96, 1), new THREE.MeshBasicMaterial({ map: TEX.accretion, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  disc.rotation.x = -0.42; hole.add(disc);
  const photonRing = new THREE.Mesh(new THREE.TorusGeometry(176, 7, 8, 72), new THREE.MeshBasicMaterial({ color: 0xfff3c4, fog: false }));
  photonRing.rotation.x = -0.42; hole.add(photonRing);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(158, 32, 32), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
  hole.add(eye);
  /* the lensing arc crowning the shadow */
  const arc = new THREE.Mesh(new THREE.RingGeometry(168, 235, 64, 1, Math.PI * 0.08, Math.PI * 0.84), new THREE.MeshBasicMaterial({ map: TEX.accretion, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, opacity: 0.95 }));
  arc.position.y = 40; arc.rotation.x = -0.1; hole.add(arc);
  hole.position.copy(holePos);
  scene.add(hole);

  /* rocks — dead world debris */
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x322b52, roughness: 0.95, flatShading: true });
  for (let i = 0; i < 95; i++) {
    const r = rand(0.6, 4.6);
    const rock = new THREE.Mesh(rockGeo, rockMat);
    const a = Math.random() * TAU, d = rand(14, WORLD_R - 8);
    rock.position.set(Math.cos(a) * d, r * 0.35, Math.sin(a) * d);
    rock.scale.set(r, r * rand(0.6, 1.15), r);
    rock.rotation.set(Math.random() * TAU, Math.random() * TAU, Math.random() * TAU);
    scene.add(rock);
  }

  /* glowing crystals — Kharon-7's cursed veins */
  const crysGeo = new THREE.ConeGeometry(0.55, 3.4, 5);
  [0x22d3ee, 0xff2bd6, 0xa78bfa].forEach((col, ci) => {
    const mat = new THREE.MeshStandardMaterial({ color: 0x120a28, emissive: col, emissiveIntensity: 2.1, roughness: 0.3, flatShading: true });
    for (let i = 0; i < 7; i++) {
      const crys = new THREE.Mesh(crysGeo, mat);
      const a = Math.random() * TAU, d = rand(12, WORLD_R - 15);
      crys.position.set(Math.cos(a) * d, 1.2, Math.sin(a) * d);
      crys.rotation.set(rand(-0.35, 0.35), Math.random() * TAU, rand(-0.35, 0.35));
      crys.scale.setScalar(rand(0.7, 1.9));
      scene.add(crys); crystals.push(crys);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: ci === 0 ? TEX.glowCyan : TEX.glowMagenta, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 }));
      glow.position.copy(crys.position); glow.scale.set(6, 6, 1); scene.add(glow); crystals.push(glow);
    }
  });

  /* wreckage — the colony that fell */
  buildCrashedShip();
  buildRuin(new THREE.Vector3(-38, 0, -14), 0.7);
  buildRuin(new THREE.Vector3(30, 0, -34), -0.9);
  buildRuin(new THREE.Vector3(12, 0, 34), 2.1);

  /* Hollow spawn portals */
  const portalPos = [[-62, -40], [58, -52], [-34, 68], [70, 30], [0, -88]];
  portalPos.forEach(([x, z]) => {
    const p = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.42, 10, 40), new THREE.MeshStandardMaterial({ color: 0x12001f, emissive: 0xff2bd6, emissiveIntensity: 2.6, roughness: 0.4 }));
    ring.position.y = 3.4; p.add(ring);
    const throat = new THREE.Mesh(new THREE.CircleGeometry(2.9, 32), new THREE.MeshBasicMaterial({ color: 0x2a0033, transparent: true, opacity: 0.92, side: THREE.DoubleSide }));
    throat.position.y = 3.4; p.add(throat);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glowMagenta, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.75 }));
    glow.position.y = 3.4; glow.scale.set(13, 13, 1); p.add(glow);
    p.position.set(x, 0, z);
    scene.add(p);
    portals.push({ group: p, ring, glow, baseY: 3.4, spin: rand(0.4, 0.9) * (Math.random() < 0.5 ? 1 : -1) });
  });

  /* drifting Kharon ash */
  const SNOW_N = 750;
  const sPos = new Float32Array(SNOW_N * 3);
  snowVel = new Float32Array(SNOW_N);
  for (let i = 0; i < SNOW_N; i++) {
    sPos[i*3] = rand(-WORLD_R - 30, WORLD_R + 30);
    sPos[i*3+1] = rand(0, 70);
    sPos[i*3+2] = rand(-WORLD_R - 30, WORLD_R + 30);
    snowVel[i] = rand(1.6, 4.2);
  }
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  snow = new THREE.Points(sGeo, new THREE.PointsMaterial({ color: 0xcfc9ee, size: 0.34, transparent: true, opacity: 0.75, depthWrite: false }));
  scene.add(snow);

  buildWeapon();
}

function buildCrashedShip() {
  const ship = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x3d3866, roughness: 0.55, metalness: 0.75, flatShading: true });
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 3.6, 17, 9), hullMat);
  hull.rotation.z = Math.PI / 2.16; hull.rotation.y = 0.4; hull.position.y = 2.4; ship.add(hull);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(2.3, 5.5, 9), hullMat);
  nose.rotation.z = Math.PI / 2.16; nose.rotation.y = 0.4; nose.position.set(8.6, 3.4, -3.2); ship.add(nose);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.4, 3.2), hullMat);
  fin.position.set(-6.4, 4.6, 1.6); fin.rotation.z = 0.4; ship.add(fin);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(10.5, 0.28, 0.28), new THREE.MeshBasicMaterial({ color: 0x22d3ee }));
  stripe.position.set(1.2, 3.1, 1.4); stripe.rotation.z = 0.16; ship.add(stripe);
  const light = new THREE.PointLight(0x22d3ee, 1.1, 26, 0);
  light.position.set(1.2, 4.2, 1.4); ship.add(light); wreckLights.push(light);
  ship.position.set(-14, 0, 12);
  ship.rotation.y = -0.7;
  scene.add(ship);
}
function buildRuin(at, rotY) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x2b2547, roughness: 0.9, flatShading: true });
  const p1 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 7.5, 1.6), mat); p1.position.set(-2.6, 3.2, 0); p1.rotation.z = 0.12; g.add(p1);
  const p2 = new THREE.Mesh(new THREE.BoxGeometry(1.6, 6.2, 1.6), mat); p2.position.set(2.6, 2.6, 0); p2.rotation.z = -0.18; g.add(p2);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(7.4, 1.1, 1.4), mat); beam.position.set(0, 6.6, 0); beam.rotation.z = 0.09; g.add(beam);
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff3b30 }));
  beacon.position.set(0, 7.5, 0); g.add(beacon);
  const bl = new THREE.PointLight(0xff3b30, 0.9, 18, 0); bl.position.set(0, 7.5, 0); g.add(bl); wreckLights.push(bl);
  g.position.copy(at); g.rotation.y = rotY;
  scene.add(g);
}

/* ---------- weapon viewmodel ---------- */
function buildWeapon() {
  weapon = new THREE.Group();
  const gun = new THREE.MeshStandardMaterial({ color: 0x1e1b38, roughness: 0.32, metalness: 0.85 });
  const glowCyan = new THREE.MeshStandardMaterial({ color: 0x0b2b33, emissive: 0x22d3ee, emissiveIntensity: 2.4 });
  const glowMag  = new THREE.MeshStandardMaterial({ color: 0x2b0b26, emissive: 0xff2bd6, emissiveIntensity: 2.0 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.95), gun); weapon.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.36, 12), gun);
  barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.045, -0.62); weapon.add(barrel);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.022, 8, 18), glowCyan);
  ring.position.set(0, 0.045, -0.81); weapon.add(ring);
  const cell = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.3), glowMag);
  cell.position.set(0, -0.155, 0.08); weapon.add(cell);
  const finL = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.5), glowCyan);
  finL.position.set(-0.2, 0.02, 0.12); weapon.add(finL);
  const finR = finL.clone(); finR.position.x = 0.2; weapon.add(finR);

  muzzleGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glowCyan, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  muzzleGlow.position.set(0, 0.045, -0.92); muzzleGlow.scale.set(0.65, 0.65, 1); weapon.add(muzzleGlow);

  weapon.position.set(0.34, -0.31, -0.78);
  weapon.rotation.y = 0.06;
  camera.add(weapon);

  muzzleLight = new THREE.PointLight(0x66f0ff, 0, 8, 0);
  muzzleLight.position.set(0.34, -0.26, -1.4);
  camera.add(muzzleLight);
}

/* ============================================================
   PARTICLES / TRACERS / SHOCKWAVES
   ============================================================ */
const MAX_PARTICLES = 900;
const particlePool = [];
let particlePoints = null, particleGeo = null;
function initParticles() {
  particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
  particleGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_PARTICLES * 3), 3));
  particlePoints = new THREE.Points(particleGeo, new THREE.PointsMaterial({ size: 0.55, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  particlePoints.frustumCulled = false;
  scene.add(particlePoints);
}
function spawnBurst(p, hex, count, speed, life, gravity) {
  const col = new THREE.Color(hex);
  for (let i = 0; i < count && particlePool.length < MAX_PARTICLES; i++) {
    const th = Math.random() * TAU, ph = Math.acos(rand(-1, 1)), s = rand(speed * 0.35, speed);
    particlePool.push({
      x: p.x, y: p.y, z: p.z,
      vx: Math.sin(ph) * Math.cos(th) * s, vy: Math.cos(ph) * s + 1.2, vz: Math.sin(ph) * Math.sin(th) * s,
      life: rand(life * 0.55, life), maxLife: life, g: gravity === undefined ? 9 : gravity,
      r: col.r, gcol: col.g, b: col.b
    });
  }
}
function updateParticles(dt) {
  const posA = particleGeo.attributes.position.array, colA = particleGeo.attributes.color.array;
  let n = 0;
  for (let i = particlePool.length - 1; i >= 0; i--) {
    const p = particlePool[i];
    p.life -= dt;
    if (p.life <= 0) { particlePool.splice(i, 1); continue; }
    p.vy -= p.g * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.y < 0.1) { p.y = 0.1; p.vy *= -0.4; p.vx *= 0.7; p.vz *= 0.7; }
    const f = p.life / p.maxLife;
    posA[n*3] = p.x; posA[n*3+1] = p.y; posA[n*3+2] = p.z;
    colA[n*3] = p.r * f; colA[n*3+1] = p.gcol * f; colA[n*3+2] = p.b * f;
    n++;
  }
  particleGeo.attributes.position.needsUpdate = true;
  particleGeo.attributes.color.needsUpdate = true;
  particleGeo.setDrawRange(0, n);
}
function spawnTracer(from, to) {
  const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x9df2ff, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(line);
  tracers.push({ line, life: 0.09, maxLife: 0.09 });
}
function updateTracers(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    const t = tracers[i];
    t.life -= dt;
    t.line.material.opacity = Math.max(0, t.life / t.maxLife);
    if (t.life <= 0) { scene.remove(t.line); t.line.geometry.dispose(); t.line.material.dispose(); tracers.splice(i, 1); }
  }
}
function spawnShockwave(origin, color) {
  const m = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.35, 48), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(origin.x, 0.35, origin.z);
  scene.add(m);
  shockwaves.push({ m, t: 0 });
}
function updateShockwaves(dt) {
  for (let i = shockwaves.length - 1; i >= 0; i--) {
    const s = shockwaves[i];
    s.t += dt * 1.6;
    const sc = 1 + s.t * 34;
    s.m.scale.set(sc, sc, sc);
    s.m.material.opacity = Math.max(0, 1 - s.t);
    if (s.t >= 1) { scene.remove(s.m); s.m.geometry.dispose(); s.m.material.dispose(); shockwaves.splice(i, 1); }
  }
}

/* ============================================================
   ENEMIES
   ============================================================ */
function makeEnemyMesh(type) {
  const g = new THREE.Group();
  const parts = { group: g };
  if (type === 'skitter') {
    const body = new THREE.Mesh(new THREE.IcosahedronGeometry(0.82, 0), new THREE.MeshStandardMaterial({ color: 0x1a1030, emissive: 0xb01aff, emissiveIntensity: 1.05, flatShading: true, roughness: 0.5 }));
    body.position.y = 1.05; g.add(body); parts.body = body; parts.baseY = 1.05;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.85, 5), new THREE.MeshStandardMaterial({ color: 0x241436, emissive: 0xff2bd6, emissiveIntensity: 1.6, flatShading: true }));
      spike.position.set(Math.cos(a) * 0.72, 1.35, Math.sin(a) * 0.72);
      spike.rotation.set(Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1);
      g.add(spike);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glowMagenta, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.75 }));
    glow.position.y = 1.05; glow.scale.set(3.4, 3.4, 1); g.add(glow);
    [-0.32, 0.32].forEach(x => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.09, 6, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      eye.position.set(x, 1.18, 0.68); g.add(eye);
    });
    parts.hitRadius = 1.15;
  } else if (type === 'wraith') {
    const cloak = new THREE.Mesh(new THREE.ConeGeometry(1.05, 2.9, 7), new THREE.MeshStandardMaterial({ color: 0x141031, emissive: 0x6d28d9, emissiveIntensity: 0.95, flatShading: true, roughness: 0.6 }));
    cloak.rotation.x = Math.PI; cloak.position.y = 2.1; g.add(cloak); parts.body = cloak; parts.baseY = 2.1;
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 0), new THREE.MeshStandardMaterial({ color: 0x0d0a24, emissive: 0xa78bfa, emissiveIntensity: 1.8, flatShading: true }));
    head.position.y = 3.35; g.add(head);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glowMagenta, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 }));
    glow.position.y = 2.3; glow.scale.set(4.6, 5.4, 1); g.add(glow);
    [-0.2, 0.2].forEach(x => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), new THREE.MeshBasicMaterial({ color: 0xc4b5fd }));
      eye.position.set(x, 3.42, 0.38); g.add(eye);
    });
    parts.hitRadius = 1.4;
  } else { /* herald */
    const core = new THREE.Mesh(new THREE.ConeGeometry(2.0, 5.6, 8), new THREE.MeshStandardMaterial({ color: 0x1c0f2e, emissive: 0xff2bd6, emissiveIntensity: 1.15, flatShading: true, roughness: 0.45 }));
    core.rotation.x = Math.PI; core.position.y = 3.6; g.add(core); parts.body = core; parts.baseY = 3.6;
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.15, 0), new THREE.MeshStandardMaterial({ color: 0x2b0a3d, emissive: 0xfbbf24, emissiveIntensity: 1.7, flatShading: true }));
    crown.position.y = 6.15; g.add(crown); parts.crown = crown;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.6, 5), new THREE.MeshStandardMaterial({ color: 0x33102a, emissive: 0xff7ad9, emissiveIntensity: 2.2, flatShading: true }));
      horn.position.set(Math.cos(a) * 1.05, 7.0, Math.sin(a) * 1.05);
      horn.rotation.set(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55);
      g.add(horn);
    }
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glowOrange, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 }));
    glow.position.y = 4.4; glow.scale.set(11, 12, 1); g.add(glow);
    [-0.45, 0, 0.45].forEach(x => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff4040 }));
      eye.position.set(x, 6.2, 1.0); g.add(eye);
    });
    parts.hitRadius = 2.8;
  }
  return parts;
}

function spawnEnemy(type, forcedPos) {
  const lvl = player.level;
  const scale = 1 + 0.16 * (lvl - 1);
  const at = forcedPos || portals[(Math.random() * portals.length) | 0].group.position;
  const mesh = makeEnemyMesh(type);
  mesh.group.position.set(at.x + rand(-2, 2), 0, at.z + rand(-2, 2));
  scene.add(mesh.group);
  const e = {
    type, mesh, group: mesh.group,
    hp: type === 'skitter' ? 34 * scale : type === 'wraith' ? 72 * scale : 620,
    maxHp: type === 'skitter' ? 34 * scale : type === 'wraith' ? 72 * scale : 620,
    speed: type === 'skitter' ? rand(3.7, 4.7) + lvl * 0.15 : type === 'wraith' ? 2.45 : 1.75,
    dmg: type === 'skitter' ? 8 : type === 'wraith' ? 10 : 22,
    xp: type === 'skitter' ? 10 : type === 'wraith' ? 25 : 260,
    r: mesh.hitRadius,
    fireCd: rand(1.4, 2.6), meleeCd: 0, summonCd: 6,
    phase: Math.random() * TAU, flash: 0, burstCd: 2.0
  };
  if (type === 'herald') { boss = e; bossWrap.style.display = 'block'; }
  enemies.push(e);
  spawnBurst(mesh.group.position.clone().setY(2), 0xff2bd6, 16, 6, 0.8, 4);
  return e;
}

function damageEnemy(e, dmg, hitPoint) {
  e.hp -= dmg;
  e.flash = 1;
  AudioSys.enemyHit();
  if (hitPoint) spawnBurst(hitPoint, 0x9df2ff, 6, 5, 0.45, 6);
  hitmarker.classList.remove('show');
  void hitmarker.offsetWidth;
  hitmarker.classList.add('show');
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e) {
  const idx = enemies.indexOf(e);
  if (idx === -1) return;
  enemies.splice(idx, 1);
  const p = e.group.position.clone().setY(e.type === 'herald' ? 4 : 1.6);
  spawnBurst(p, e.type === 'skitter' ? 0xff2bd6 : e.type === 'wraith' ? 0xa78bfa : 0xfbbf24, e.type === 'herald' ? 60 : 20, e.type === 'herald' ? 13 : 8, 1.1, 7);
  AudioSys.explode();
  shake = Math.min(shake + (e.type === 'herald' ? 1.6 : 0.28), 2);
  scene.remove(e.group);
  player.kills++;
  player.nova = clamp(player.nova + (e.type === 'herald' ? 100 : 12), 0, 100);
  dropOrb(e.group.position, e.xp);
  if (Math.random() < 0.15 && e.type !== 'herald') dropMedkit(e.group.position);
  killsText.textContent = player.kills;

  if (e.type === 'herald') {
    boss = null;
    bossWrap.style.display = 'none';
    quest.stage = 2; quest.count = 1;
    updateQuestHUD();
    showToast('✦ THE HERALD IS UNDONE ✦');
    AudioSys.chime();
    setTimeout(victory, 1400);
    return;
  }
  if (quest.stage === 0) {
    quest.count++;
    updateQuestHUD();
    if (quest.count >= quest.need) awakenHerald();
  }
}

function awakenHerald() {
  quest.stage = 1; quest.count = 0;
  updateQuestHUD();
  const at = new THREE.Vector3(0, 0, -70);
  spawnEnemy('herald', at);
  showToast('⚠ THE HERALD AWAKENS ⚠');
  AudioSys.bossRoar();
  shake = 2;
}

/* ============================================================
   PICKUPS
   ============================================================ */
function dropOrb(at, value) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), new THREE.MeshBasicMaterial({ color: 0x5ef2ff }));
  m.position.set(at.x + rand(-1, 1), 0.9, at.z + rand(-1, 1));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glowCyan, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9 }));
  glow.scale.set(2.2, 2.2, 1); m.add(glow);
  scene.add(m);
  orbs.push({ m, value });
}
function dropMedkit(at) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.42, 0.62), new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.4 }));
  box.position.y = 0.42; g.add(box);
  const crossMat = new THREE.MeshBasicMaterial({ color: 0xff2244 });
  const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.14), crossMat); c1.position.y = 0.64; g.add(c1);
  const c2 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.36), crossMat); c2.position.y = 0.64; g.add(c2);
  g.position.set(at.x + rand(-1.5, 1.5), 0, at.z + rand(-1.5, 1.5));
  scene.add(g);
  medkits.push({ g, phase: Math.random() * TAU });
}
function updatePickups(dt, t) {
  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i];
    const d = o.m.position.distanceTo(player.pos);
    if (d < 10) {
      tmpV.copy(player.pos).setY(0.9).sub(o.m.position).normalize().multiplyScalar((11 - d) * 2.1 * dt + 2 * dt);
      o.m.position.add(tmpV);
    }
    o.m.position.y = 0.9 + Math.sin(t * 3 + i) * 0.14;
    if (d < 1.5) {
      scene.remove(o.m); orbs.splice(i, 1);
      addXP(o.value);
      AudioSys.orb();
    }
  }
  for (let i = medkits.length - 1; i >= 0; i--) {
    const k = medkits[i];
    k.g.position.y = Math.sin(t * 2 + k.phase) * 0.18;
    k.g.rotation.y = t * 1.4;
    if (k.g.position.distanceTo(player.pos) < 1.7) {
      scene.remove(k.g); medkits.splice(i, 1);
      player.hp = clamp(player.hp + 40, 0, player.maxHp);
      showToast('+40 HULL');
      AudioSys.chime();
    }
  }
}
function addXP(v) {
  player.xp += v;
  while (player.xp >= player.xpNeed) {
    player.xp -= player.xpNeed;
    player.level++;
    player.maxHp += 18; player.hp = player.maxHp;
    player.dmg += 6; player.speed += 0.18;
    player.xpNeed = Math.round(player.xpNeed * 1.34 + 22);
    showToast('LEVEL ' + player.level + ' — THE WARDEN ENDURES');
    AudioSys.levelUp();
    novaFlash = Math.max(novaFlash, 0.35);
  }
}

/* ============================================================
   COMBAT
   ============================================================ */
const rayDir = new THREE.Vector3(), rayOrigin = new THREE.Vector3();
function tryShoot() {
  if (fireCooldown > 0) return;
  fireCooldown = 0.145;
  recoil = Math.min(recoil + 0.16, 0.42);
  AudioSys.shoot();
  muzzleGlow.material.opacity = 1;
  muzzleLight.intensity = 1.5;

  camera.getWorldDirection(rayDir);
  rayOrigin.copy(camera.position);

  let bestT = Infinity, bestEnemy = null;
  for (const e of enemies) {
    const c = tmpV.copy(e.group.position); c.y = e.type === 'herald' ? 4.2 : e.type === 'wraith' ? 2.3 : 1.15;
    const toC = c.clone().sub(rayOrigin);
    const tProj = toC.dot(rayDir);
    if (tProj < 0.5 || tProj > 150) continue;
    const closest = rayDir.clone().multiplyScalar(tProj).add(rayOrigin);
    const d = closest.distanceTo(c);
    if (d < e.r + 0.35 && tProj < bestT) { bestT = tProj; bestEnemy = e; }
  }
  const muzzle = new THREE.Vector3(0.34, -0.26, -0.95).applyMatrix4(camera.matrixWorld);
  const hitPoint = bestEnemy ? rayDir.clone().multiplyScalar(bestT).add(rayOrigin) : rayOrigin.clone().add(rayDir.clone().multiplyScalar(150));
  spawnTracer(muzzle, hitPoint);
  if (bestEnemy) {
    damageEnemy(bestEnemy, player.dmg, hitPoint);
    shake = Math.min(shake + 0.06, 2);
  }
}
function fireBolt(from, target, speed, dmg, spread) {
  const dir = target.clone().sub(from).normalize();
  if (spread) {
    dir.x += rand(-spread, spread); dir.y += rand(-spread * 0.5, spread * 0.5); dir.z += rand(-spread, spread);
    dir.normalize();
  }
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 8), new THREE.MeshBasicMaterial({ color: 0xff5be0 }));
  m.position.copy(from);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.glowMagenta, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.95 }));
  glow.scale.set(1.8, 1.8, 1); m.add(glow);
  scene.add(m);
  bolts.push({ m, vel: dir.multiplyScalar(speed), dmg, life: 5 });
  AudioSys.bolt();
}
function updateBolts(dt) {
  const playerCenter = player.pos.clone().setY(1.6);
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.m.position.addScaledVector(b.vel, dt);
    b.life -= dt;
    let dead = b.life <= 0 || b.m.position.y < 0.05;
    if (b.m.position.distanceTo(playerCenter) < 1.15) {
      hurtPlayer(b.dmg);
      spawnBurst(b.m.position.clone(), 0xff5be0, 8, 6, 0.5, 5);
      dead = true;
    }
    if (dead) { scene.remove(b.m); bolts.splice(i, 1); }
  }
}
function hurtPlayer(dmg) {
  if (state !== 'playing') return;
  player.hp -= dmg;
  player.regenDelay = 4.5;
  vignetteOp = Math.min(vignetteOp + 0.55, 0.85);
  shake = Math.min(shake + 0.45, 2);
  AudioSys.hurt();
  if (player.hp <= 0) { player.hp = 0; die(); }
}
function novaBlast() {
  if (player.nova < 100) { showToast('NOVA NOT CHARGED — ' + Math.floor(player.nova) + '%'); return; }
  player.nova = 0;
  AudioSys.nova();
  novaFlash = 1;
  shake = 2;
  spawnShockwave(player.pos, 0x67e8f9);
  spawnShockwave(player.pos, 0xff2bd6);
  spawnBurst(player.pos.clone().setY(1.5), 0x67e8f9, 46, 17, 1.15, 3);
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    const d = e.group.position.distanceTo(player.pos);
    if (d < 22) {
      tmpV.copy(e.group.position).sub(player.pos).normalize().multiplyScalar(11);
      e.group.position.add(tmpV);
      damageEnemy(e, 170, e.group.position.clone().setY(1.5));
    }
  }
}

/* ============================================================
   ENEMY AI
   ============================================================ */
function updateEnemies(dt, t) {
  minionTimer -= dt;
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    const p = e.group.position;
    tmpV.copy(player.pos).sub(p); tmpV.y = 0;
    const dist = tmpV.length();
    if (dist > 0.001) tmpV.normalize();
    e.group.rotation.y = Math.atan2(tmpV.x, tmpV.z);

    /* hover bob */
    const hoverAmp = e.type === 'herald' ? 0.4 : 0.3;
    const hoverSpeed = e.type === 'skitter' ? 3.1 : 1.9;
    const bodyPart = e.mesh.body;
    if (bodyPart) bodyPart.position.y = e.mesh.baseY + Math.sin(t * hoverSpeed + e.phase) * hoverAmp;
    if (e.mesh.crown) e.mesh.crown.rotation.y = t * 2.2;

    /* hit flash */
    if (e.flash > 0) {
      e.flash = Math.max(0, e.flash - dt * 3.2);
      if (bodyPart) bodyPart.material.emissiveIntensity = 1.05 + e.flash * 3.4;
    }

    e.meleeCd -= dt; e.fireCd -= dt;

    if (e.type === 'skitter') {
      if (dist > 2.1) {
        p.addScaledVector(tmpV, e.speed * dt);
      } else if (e.meleeCd <= 0) {
        e.meleeCd = 1.05;
        hurtPlayer(e.dmg);
      }
    } else if (e.type === 'wraith') {
      if (dist > 21) p.addScaledVector(tmpV, e.speed * dt);
      else if (dist < 12) p.addScaledVector(tmpV, -e.speed * 0.8 * dt);
      else {
        const strafe = Math.sin(t * 0.9 + e.phase) > 0 ? 1 : -1;
        p.x += -tmpV.z * strafe * e.speed * 0.55 * dt;
        p.z +=  tmpV.x * strafe * e.speed * 0.55 * dt;
      }
      if (e.fireCd <= 0 && dist < 60) {
        e.fireCd = rand(2.0, 3.0);
        const from = p.clone().setY(2.6);
        const target = player.pos.clone().setY(1.5);
        fireBolt(from, target, 29, e.dmg, 0.03);
      }
    } else { /* herald */
      if (dist > 5.6) p.addScaledVector(tmpV, e.speed * dt);
      else if (e.meleeCd <= 0) { e.meleeCd = 1.4; hurtPlayer(e.dmg); }
      e.burstCd -= dt;
      if (e.burstCd <= 0 && dist < 95) {
        e.burstCd = player.hp < 40 || e.hp < e.maxHp * 0.5 ? 1.6 : 2.5;
        const from = p.clone().setY(5.4);
        const target = player.pos.clone().setY(1.4);
        for (let k = -1; k <= 1; k++) {
          const off = target.clone(); off.x += k * 2.4; off.y += rand(-0.6, 0.6);
          fireBolt(from, off, 33, 14, 0.02);
        }
      }
      if (minionTimer <= 0 && enemies.length < 5) {
        minionTimer = 9;
        spawnEnemy('skitter'); spawnEnemy('skitter');
        showToast('THE HERALD CALLS ITS BROOD');
      }
    }
    /* keep inside the bowl */
    const dc = Math.hypot(p.x, p.z);
    if (dc > WORLD_R + 6) { p.x *= (WORLD_R + 6) / dc; p.z *= (WORLD_R + 6) / dc; }
  }
  if (boss) {
    bossFill.style.transform = 'scaleX(' + clamp(boss.hp / boss.maxHp, 0, 1) + ')';
  }
}

/* ============================================================
   SPAWNER
   ============================================================ */
function updateSpawner(dt) {
  spawnTimer -= dt;
  const cap = quest.stage === 0 ? Math.min(4 + player.level, 9) : 2;
  const minions = enemies.filter(e => e.type !== 'herald').length;
  if (spawnTimer <= 0 && minions < cap) {
    spawnTimer = Math.max(1.15, 2.7 - player.level * 0.2);
    spawnEnemy(Math.random() < 0.68 ? 'skitter' : 'wraith');
  }
}

/* ============================================================
   QUESTS & HUD
   ============================================================ */
function updateQuestHUD() {
  if (quest.stage === 0) {
    questName.textContent = 'Thin the Hollow';
    questFill.style.width = (quest.count / quest.need * 100) + '%';
    questProgress.textContent = quest.count + ' / ' + quest.need + ' SLAIN';
  } else if (quest.stage === 1) {
    questName.textContent = 'Silence the Herald of Gargantua';
    questFill.style.width = '100%';
    questProgress.textContent = 'THE HERALD WALKS';
  } else {
    questName.textContent = 'The line holds. Kharon-7 endures.';
    questFill.style.width = '100%';
    questProgress.textContent = 'OATH FULFILLED';
  }
}
let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
}
function updateHUD() {
  const hpFrac = clamp(player.hp / player.maxHp, 0, 1);
  hpFill.style.transform = 'scaleX(' + hpFrac + ')';
  hpFill.classList.toggle('low', hpFrac < 0.3);
  hpText.textContent = Math.ceil(player.hp);
  novaFill.style.transform = 'scaleX(' + (player.nova / 100) + ')';
  novaText.textContent = Math.floor(player.nova) + '%';
  xpFill.style.width = clamp(player.xp / player.xpNeed * 100, 0, 100) + '%';
  lvlText.textContent = 'LV ' + player.level;
}

/* ============================================================
   INPUT
   ============================================================ */
const keys = {};
let mouseDown = false;
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'KeyF' && state === 'playing') novaBlast();
  if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('mousedown', (e) => { if (e.button === 0) mouseDown = true; });
addEventListener('mouseup', (e) => { if (e.button === 0) mouseDown = false; });
addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement && state === 'playing') {
    player.yaw -= e.movementX * 0.00215;
    player.pitch = clamp(player.pitch - e.movementY * 0.00215, -1.45, 1.45);
  }
});
function lockPointer() {
  const el = renderer.domElement;
  if (el.requestPointerLock) el.requestPointerLock();
}
document.addEventListener('pointerlockchange', () => {
  const locked = !!document.pointerLockElement;
  if (!locked && state === 'playing') {
    state = 'paused';
    $('pauseOverlay').classList.remove('hidden');
  } else if (locked && state === 'paused') {
    state = 'playing';
    $('pauseOverlay').classList.add('hidden');
  }
});

/* ============================================================
   PLAYER UPDATE
   ============================================================ */
function updatePlayer(dt, t) {
  player.runTime += dt;
  fireCooldown -= dt;
  player.regenDelay -= dt;
  if (player.regenDelay <= 0 && player.hp < player.maxHp) {
    player.hp = clamp(player.hp + 2.4 * dt, 0, player.maxHp);
  }

  const fwd = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const str = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  const moving = fwd !== 0 || str !== 0;
  const sprint = keys.ShiftLeft || keys.ShiftRight;
  const speed = player.speed * (sprint && moving ? 1.55 : 1);

  if (moving) {
    const sin = Math.sin(player.yaw), cos = Math.cos(player.yaw);
    let dx = (-sin * fwd + cos * str);
    let dz = (-cos * fwd - sin * str);
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    player.pos.x += dx * speed * dt;
    player.pos.z += dz * speed * dt;
    player.walkPhase += dt * (sprint ? 13 : 8.6);
  }
  const dc = Math.hypot(player.pos.x, player.pos.z);
  if (dc > WORLD_R) { player.pos.x *= WORLD_R / dc; player.pos.z *= WORLD_R / dc; }

  /* camera: eye height + bob + shake */
  const bob = moving ? Math.sin(player.walkPhase) * 0.085 : 0;
  shake = Math.max(0, shake - dt * 2.4);
  const sx = (Math.random() - 0.5) * shake * 0.42;
  const sy = (Math.random() - 0.5) * shake * 0.42;
  camera.position.set(player.pos.x + sx, 2.12 + bob + sy, player.pos.z);
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;

  /* weapon recoil + glow decay */
  recoil = Math.max(0, recoil - dt * 1.9);
  if (weapon) {
    weapon.position.z = -0.78 + recoil * 0.32;
    weapon.rotation.x = recoil * 0.32;
  }
  if (muzzleGlow) muzzleGlow.material.opacity = Math.max(0, muzzleGlow.material.opacity - dt * 9);
  if (muzzleLight) muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 11);

  if (mouseDown) tryShoot();
}

/* ============================================================
   ENVIRONMENT ANIMATION (always runs, even in menu)
   ============================================================ */
function updateEnvironment(dt, t) {
  /* portals pulse */
  for (const p of portals) {
    p.ring.rotation.z += dt * p.spin;
    const s = 1 + Math.sin(t * 2.1 + p.spin * 10) * 0.07;
    p.ring.scale.set(s, s, s);
    p.glow.material.opacity = 0.55 + Math.sin(t * 3.1) * 0.25;
  }
  /* wreck beacons flicker */
  wreckLights.forEach((l, i) => { l.intensity = 0.75 + Math.max(0, Math.sin(t * (1.4 + i * 0.5) + i * 2)) ** 6 * 1.4; });
  /* drifting ash */
  if (snow) {
    const a = snow.geometry.attributes.position.array;
    for (let i = 0; i < snowVel.length; i++) {
      a[i*3+1] -= snowVel[i] * dt;
      a[i*3] += Math.sin(t * 0.6 + i) * 0.35 * dt;
      if (a[i*3+1] < 0) { a[i*3+1] = rand(38, 64); a[i*3] = rand(-WORLD_R, WORLD_R); a[i*3+2] = rand(-WORLD_R, WORLD_R); }
    }
    snow.geometry.attributes.position.needsUpdate = true;
  }
  /* vignette / flash decay */
  vignetteOp = Math.max(0, vignetteOp - dt * 1.5);
  vignette.style.opacity = vignetteOp;
  novaFlash = Math.max(0, novaFlash - dt * 1.8);
  flash.style.opacity = novaFlash * 0.75;
}

/* menu cinematic — slow orbit around the crash site */
let menuOrbit = 0;
function updateMenuCamera(dt) {
  menuOrbit += dt * 0.055;
  const r = 34;
  camera.position.set(Math.cos(menuOrbit) * r - 8, 9.5, Math.sin(menuOrbit) * r + 8);
  camera.lookAt(-8, 2.6, 8);
}

/* ============================================================
   FLOW — start / pause / death / victory
   ============================================================ */
const BEST_KEY = 'bigola-stellarfall-best';
function loadBest() {
  try { return JSON.parse(localStorage.getItem(BEST_KEY) || 'null'); } catch { return null; }
}
function saveBest() {
  const b = loadBest() || { victories: 0, bestLevel: 1, bestTime: null };
  b.victories += 1;
  b.bestLevel = Math.max(b.bestLevel, player.level);
  const t = Math.round(player.runTime);
  if (b.bestTime === null || t < b.bestTime) b.bestTime = t;
  try { localStorage.setItem(BEST_KEY, JSON.stringify(b)); } catch (e) { /* private mode */ }
}
function renderBestLine() {
  const b = loadBest();
  $('bestLine').innerHTML = b
    ? 'BEST — <b>LV ' + b.bestLevel + '</b>' + (b.bestTime ? ' &nbsp;•&nbsp; FASTEST VICTORY <b>' + b.bestTime + 'S</b>' : '') + ' &nbsp;•&nbsp; VICTORIES <b>' + b.victories + '</b>'
    : 'UNTESTED WARDEN';
}
function statChip(v, k) {
  return '<div class="stat-chip"><div class="v">' + v + '</div><div class="k">' + k + '</div></div>';
}
function startGame() {
  AudioSys.init();
  if (AudioSys.ctx && AudioSys.ctx.state === 'suspended') AudioSys.ctx.resume();
  menu.classList.add('hidden');
  hud.classList.remove('hidden');
  state = 'playing';
  clock.getDelta();
  updateQuestHUD();
  updateHUD();
  killsText.textContent = '0';
  showToast("WARDEN'S OATH — THIN THE HOLLOW");
  lockPointer();
}
function die() {
  if (state !== 'playing') return;
  state = 'dead';
  if (document.pointerLockElement) document.exitPointerLock();
  AudioSys.explode();
  spawnBurst(player.pos.clone().setY(1.6), 0xff4040, 44, 12, 1.2, 6);
  $('deathStats').innerHTML = statChip(player.level, 'Level') + statChip(player.kills, 'Hollow Slain') + statChip(Math.round(player.runTime) + 's', 'Time');
  $('deathOverlay').classList.remove('hidden');
}
function victory() {
  if (state !== 'playing') return;
  state = 'victory';
  saveBest();
  if (document.pointerLockElement) document.exitPointerLock();
  $('victoryStats').innerHTML = statChip(player.level, 'Level') + statChip(player.kills, 'Hollow Slain') + statChip(Math.round(player.runTime) + 's', 'Clear Time');
  $('victoryOverlay').classList.remove('hidden');
}
$('startBtn').addEventListener('click', startGame);
$('resumeBtn').addEventListener('click', () => lockPointer());
$('retryBtn').addEventListener('click', () => location.reload());
$('againBtn').addEventListener('click', () => location.reload());

/* ============================================================
   MAIN LOOP
   ============================================================ */
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  updateEnvironment(dt, t);
  updateTracers(dt);
  updateShockwaves(dt);
  updateParticles(dt);

  if (state === 'playing') {
    player.runTime += 0; /* accumulated in updatePlayer */
    updatePlayer(dt, t);
    updateEnemies(dt, t);
    updateBolts(dt);
    updatePickups(dt, t);
    updateSpawner(dt);
    updateHUD();
  } else if (state === 'menu') {
    updateMenuCamera(dt);
  }
  renderer.render(scene, camera);
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', onResize);

/* ============================================================
   BOOT
   ============================================================ */
buildWorld();
initParticles();
clock = new THREE.Clock();
renderBestLine();
updateQuestHUD();
animate();
