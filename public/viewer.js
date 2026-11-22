// Experi3D viewer
// Walk a 3D world exported from Blender (GLB), with the real sun for any place, date and time,
// and on phones optionally by walking for real (camera tracking at real-world scale).
//
// URL parameters
//   ?w=<id>            load worlds/<id>/world.json (default: worlds/index.json "default")
//   ?world=<url>       load any world.json by URL
//   ?model=<url>       just a GLB, no world.json
//   ?date=YYYY-MM-DD   ?time=HH:MM   ?lat=  ?lon=  ?north=  ?tz=   start the sun here (the page keeps these up to date, so links share a study)
//   ?edit              developer readout, F fly, G collision wireframe, P copy spawn
//   ?lang=sv|en

import { buildKeypad, buildStick, howToHTML, PHONE_FLIP } from './controls.js';
import { Gyro, yawPitchOf } from './gyro.js';
import { sunPosition, sunTimes, sunDirection, daylight, zonedToUtc, utcToZoned, hhmm } from './sun.js';
import { XrWalk, askMotionPermission, XR_CREDIT } from './xrwalk.js';

const libs = Promise.all([import('./lib/playcanvas.mjs'), import('./lib/rapier.mjs')]);

const qs = new URLSearchParams(location.search);
const EDIT = qs.has('edit');
const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem('experi3d.' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('experi3d.' + k, v); } catch { /* private mode */ } },
};

// ---------------------------------------------------------------- strings
const STRINGS = {
  en: {
    loading: 'Loading', enter: 'Step inside', resume: 'Continue', tapEnter: 'Tap to step inside', walkReal: 'Walk for real',
    move: 'Move', lookShort: 'Look', tilt: 'Tilt phone', exit: 'Pause', sun: 'Sun', walk: 'Walk',
    hint: 'WASD to walk · drag to look · , and . change the time · P plays the day · Esc pauses',
    hintTouch: 'Joystick to walk · drag to look',
    gyro: 'Look around by moving your phone', gyroOn: 'Move your phone to look around', gyroOff: 'Drag to look around',
    gyroNone: "This phone doesn't report how it's turned", gyroDenied: 'Motion access was not allowed',
    err: 'The world could not be loaded.', errTitle: "Can't open this world", mb: 'MB',
    fullscreen: 'Full screen (F)', fullscreenExit: 'Exit full screen (F)', close: 'Close',
    fsHelpTitle: 'Full screen', fsHelp: "This browser can't show a web page in full screen. Add the page to your home screen instead: open the browser's Share menu and choose Add to Home Screen. Opened from there, it fills the whole screen.",
    sunToggle: 'Sun and time', play: 'Play the day', pause: 'Stop',
    lat: 'Latitude', lon: 'Longitude', north: 'North (° from −Z)', tz: 'Time zone', useHere: 'Use my location', done: 'Done',
    popNote: 'North: where true north points in the model, in degrees clockwise from −Z seen from above. From Blender, 0 means north is Blender’s +Y.',
    here: 'My location', locating: 'Finding you…', locFail: 'Your location is not available',
    sunUp: 'Sun', azimuth: 'from the', above: 'above the horizon', below: 'below the horizon',
    sunrise: 'Sunrise', sunset: 'Sunset', polarDay: 'Midnight sun', polarNight: 'Polar night',
    dirs: ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'],
    chips: [['03-20', 'Mar equinox'], ['06-21', 'Midsummer'], ['09-22', 'Sep equinox'], ['12-21', 'Midwinter']],
    xrStart: 'Walk for real: your phone’s camera follows how you move', xrStop: 'Stop walking for real',
    xrStarting: 'Starting the camera…', xrLimited: 'Move the phone slowly side to side', xrNormal: 'Walk around · the joystick still moves you further',
    xrRecenter: 'Recenter', xrFailCamera: 'The camera could not be used', xrFailEngine: 'Tracking could not start on this device',
    xrDenied: 'Motion access was not allowed', xrHint: 'Clear a space to walk in. Walls in the model stop you even where your room continues.',
    noGeometryLight: 'Splats keep the light they were captured with; only the model’s geometry gets the simulated sun.',
    warnDraco: 'The model is compressed (Draco/meshopt): it shows, but you walk through it. Export without compression, or add a collision.glb.',
  },
  sv: {
    loading: 'Laddar', enter: 'Kliv in', resume: 'Fortsätt', tapEnter: 'Tryck för att kliva in', walkReal: 'Gå på riktigt',
    move: 'Gå', lookShort: 'Titta', tilt: 'Vrid mobilen', exit: 'Paus', sun: 'Sol', walk: 'Gå',
    hint: 'WASD för att gå · dra för att titta · , och . ändrar tiden · P spelar upp dagen · Esc för paus',
    hintTouch: 'Styrspak för att gå · dra för att titta',
    gyro: 'Titta runt genom att röra telefonen', gyroOn: 'Rör telefonen för att se dig omkring', gyroOff: 'Dra för att se dig omkring',
    gyroNone: 'Telefonen rapporterar inte hur den vrids', gyroDenied: 'Åtkomst till rörelse tilläts inte',
    err: 'Världen kunde inte laddas.', errTitle: 'Kan inte öppna världen', mb: 'MB',
    fullscreen: 'Helskärm (F)', fullscreenExit: 'Lämna helskärm (F)', close: 'Stäng',
    fsHelpTitle: 'Helskärm', fsHelp: 'Den här webbläsaren kan inte visa en webbsida i helskärm. Lägg i stället sidan på hemskärmen: öppna webbläsarens Dela-meny och välj Lägg till på hemskärmen. Öppnad därifrån fyller den hela skärmen.',
    sunToggle: 'Sol och tid', play: 'Spela upp dagen', pause: 'Stoppa',
    lat: 'Latitud', lon: 'Longitud', north: 'Norr (° från −Z)', tz: 'Tidszon', useHere: 'Använd min plats', done: 'Klar',
    popNote: 'Norr: dit sann nord pekar i modellen, i grader medurs från −Z sett ovanifrån. Från Blender betyder 0 att norr är Blenders +Y.',
    here: 'Min plats', locating: 'Letar…', locFail: 'Platsen är inte tillgänglig',
    sunUp: 'Solen', azimuth: 'i', above: 'över horisonten', below: 'under horisonten',
    sunrise: 'Upp', sunset: 'Ner', polarDay: 'Midnattssol', polarNight: 'Polarnatt',
    dirs: ['norr', 'nordost', 'öster', 'sydost', 'söder', 'sydväst', 'väster', 'nordväst'],
    chips: [['03-20', 'Vårdagjämning'], ['06-21', 'Midsommar'], ['09-22', 'Höstdagjämning'], ['12-21', 'Midvinter']],
    xrStart: 'Gå på riktigt: mobilens kamera följer hur du rör dig', xrStop: 'Sluta gå på riktigt',
    xrStarting: 'Startar kameran…', xrLimited: 'För mobilen långsamt från sida till sida', xrNormal: 'Gå omkring · styrspaken flyttar dig längre',
    xrRecenter: 'Centrera', xrFailCamera: 'Kameran kunde inte användas', xrFailEngine: 'Spårningen kunde inte starta på den här enheten',
    xrDenied: 'Åtkomst till rörelse tilläts inte', xrHint: 'Röj en yta att gå på. Väggar i modellen stoppar dig även där ditt rum fortsätter.',
    noGeometryLight: 'Splats behåller ljuset de fångades med; bara modellens geometri får den simulerade solen.',
    warnDraco: 'Modellen är komprimerad (Draco/meshopt): den syns, men du går rakt igenom den. Exportera utan komprimering eller lägg till en collision.glb.',
  },
};
let T = STRINGS.en;

// ---------------------------------------------------------------- icons
const svg = (body, vb = '0 0 24 24') => `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON = {
  fsEnter: svg('<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>'),
  fsExit: svg('<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>'),
  walk: svg('<circle cx="13.5" cy="4" r="1.8"/><path d="M10 21l2.2-6.5L15 17v4M8 12.5l2.5-5 3.5 1 2 3.5 2.5 1M10.5 7.5 8 9l-1 3.5"/>'),
  play: svg('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>'),
  stop: svg('<rect x="7" y="6" width="3.6" height="12" rx="1" fill="currentColor"/><rect x="13.4" y="6" width="3.6" height="12" rx="1" fill="currentColor"/>'),
  pin: svg('<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'),
};

// ---------------------------------------------------------------- world config
const WORLDS_BASE = new URL(document.querySelector('meta[name="experi3d-worlds"]')?.content || 'worlds/', document.baseURI).href;

async function resolveWorld() {
  if (qs.get('model')) {
    const url = new URL(qs.get('model'), document.baseURI).href;
    return { url, json: { title: decodeURIComponent(url.split('/').pop().replace(/\.glb$/i, '')), model: url } };
  }
  if (qs.get('world')) {
    const url = new URL(qs.get('world'), document.baseURI).href;
    return { url, json: await (await fetch(url, { cache: 'no-cache' })).json() };
  }
  const bases = [...new Set([WORLDS_BASE, new URL('worlds/', document.baseURI).href])];
  let id = qs.get('w');
  if (!id) {
    for (const base of bases) {
      try {
        const idx = await (await fetch(new URL('index.json', base), { cache: 'no-cache' })).json();
        id = idx.default || idx.worlds?.[0]?.id;
        if (id) break;
      } catch { /* none here */ }
    }
  }
  id = encodeURIComponent(id || 'sample');
  for (const base of bases) {
    const url = new URL(`${id}/world.json`, base).href;
    try {
      const r = await fetch(url, { cache: 'no-cache' });
      if (r.ok) return { url, json: await r.json() };
    } catch { /* next */ }
  }
  throw new Error(`world "${decodeURIComponent(id)}" not found`);
}

const DEFAULTS = {
  title: 'Experi3D', eyebrow: 'Experi3D', subtitle: '', lang: null,
  model: 'model.glb', collision: null, splat: null, splatTransform: null,
  spawn: null,                       // { position: [x,y,z], yaw } – else an empty named "spawn" in the GLB, else the model's edge
  location: null,                    // { lat, lon, timeZone, north, name } – also read from the GLB scene's custom properties
  eyeHeight: 1.6, walkSpeed: 1.4, runSpeed: 3.2,
  fov: 70, stepHeight: 0.3, playerRadius: 0.22,
  shadowDistance: null,              // metres of shadow around you (default: from the model's size, 20–80)
  exposure: 1,
};
const DEFAULT_PLACE = { lat: 59.3293, lon: 18.0686, timeZone: 'Europe/Stockholm', north: 0, name: 'Stockholm' };

// ---------------------------------------------------------------- device
const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const fsElement = () => document.fullscreenElement || document.webkitFullscreenElement || null;
const fullscreenOK = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
function toggleFullscreen() {
  if (!fullscreenOK) return;
  if (fsElement()) (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
  else {
    const el = document.documentElement;
    (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el, { navigationUI: 'hide' })?.catch?.(() => {});
  }
}

// ---------------------------------------------------------------- download with progress + resume
async function download(url, onProgress, tries = 5) {
  let got = 0, total = 0, chunks = [];
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, got ? { headers: { Range: `bytes=${got}-` } } : { cache: 'no-cache' });
      if (got && res.status !== 206) { got = 0; chunks = []; }
      if (!res.ok) throw new Error(`${url.split('/').pop()} (${res.status})`);
      if (!total) total = parseInt(res.headers.get('content-length') || '0', 10) + got;
      if (!res.body?.getReader) { const b = await res.arrayBuffer(); onProgress(b.byteLength, b.byteLength); return b; }
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); got += value.byteLength;
        onProgress(got, total);
      }
      return await new Blob(chunks).arrayBuffer();
    } catch (e) {
      if (attempt >= tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
    }
  }
}

// ---------------------------------------------------------------- GLB reader (collision, spawn, place)
// Reads triangles in world space through the whole node hierarchy, the "spawn" empty, and the
// scene's custom properties (Blender: Scene Properties > Custom Properties, exported with
// "Include > Custom Properties"): lat, lon, north, timeZone, place.
// Objects whose name ends in "_nc" or contains "nocollide" are left out of collision (plants, curtains…).
function readGlb(buf, { collide = true } = {}) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('the model is not a .glb file');
  let off = 12, json = null, bin = null;
  while (off < buf.byteLength) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const start = off + 8;
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, start, len)));
    else if (type === 0x004e4942) bin = buf.slice(start, start + len);
    off = start + len;
  }
  const used = json.extensionsUsed || [];
  const compressed = used.includes('KHR_draco_mesh_compression') || used.includes('EXT_meshopt_compression');
  const positions = [], indices = [];
  let base = 0, spawn = null;
  const C = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
  const N = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const read = (i) => {
    const acc = json.accessors[i];
    const n = N[acc.type], Ty = C[acc.componentType];
    const out = new Float64Array(acc.count * n);
    if (acc.bufferView === undefined) return out;
    const view = json.bufferViews[acc.bufferView];
    const stride = view.byteStride || n * Ty.BYTES_PER_ELEMENT;
    const d = new DataView(bin, (view.byteOffset || 0) + (acc.byteOffset || 0));
    const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[acc.componentType];
    const norm = acc.normalized ? { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[acc.componentType] : 0;
    for (let k = 0; k < acc.count; k++) for (let j = 0; j < n; j++) {
      let v = d[get](k * stride + j * Ty.BYTES_PER_ELEMENT, true);
      if (norm) v = Math.max(v / norm, -1);
      out[k * n + j] = v;
    }
    return out;
  };
  const mat4 = (node) => {
    if (node.matrix) return node.matrix.slice();
    const [tx, ty, tz] = node.translation || [0, 0, 0];
    const [x, y, z, w] = node.rotation || [0, 0, 0, 1];
    const [sx, sy, sz] = node.scale || [1, 1, 1];
    return [
      (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
      2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
      2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
      tx, ty, tz, 1,
    ];
  };
  const mul = (a, b) => {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  };
  const walk = (ni, parent, skip) => {
    const node = json.nodes[ni];
    const m = mul(parent, mat4(node));
    const name = node.name || '';
    const off = skip || /_nc$|nocollide/i.test(name);
    if (!spawn && /^spawn/i.test(name)) {
      // forward of an empty = its -Z (glTF), i.e. Blender's +Y for an empty, or the view of a camera
      const fx = -m[8], fz = -m[10];
      spawn = { position: [m[12], m[13], m[14]], yaw: (Math.atan2(-fx, -fz) * 180) / Math.PI };
    }
    if (collide && !off && node.mesh !== undefined && !compressed) {
      for (const prim of json.meshes[node.mesh].primitives) {
        if (prim.mode !== undefined && prim.mode !== 4) continue;
        if (prim.attributes.POSITION === undefined) continue;
        const pos = read(prim.attributes.POSITION);
        const count = pos.length / 3;
        for (let i = 0; i < count; i++) {
          const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
          positions.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
        }
        const idx = prim.indices !== undefined ? read(prim.indices) : Array.from({ length: count }, (_, i) => i);
        for (let i = 0; i < idx.length; i++) indices.push(idx[i] + base);
        base += count;
      }
    }
    for (const c of node.children || []) walk(c, m, off);
  };
  const scene = json.scenes?.[json.scene || 0];
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const ni of scene?.nodes || []) walk(ni, I, false);
  const extras = { ...(json.extras || {}), ...(scene?.extras || {}) };
  return { vertices: new Float32Array(positions), indices: new Uint32Array(indices), spawn, extras, compressed };
}

// ---------------------------------------------------------------- main
async function main() {
  const { url: worldUrl, json } = await resolveWorld();
  const world = { ...DEFAULTS, ...json };
  const lang = qs.get('lang') || world.lang || (navigator.language || 'en').slice(0, 2);
  T = STRINGS[lang] || STRINGS.en;
  document.documentElement.lang = STRINGS[lang] ? lang : 'en';
  document.title = `${world.title} · Experi3D`;
  $('title').textContent = world.title;
  $('eyebrow').textContent = world.eyebrow || 'Experi3D';
  $('subtitle').textContent = world.subtitle || '';
  $('errorTitle').textContent = T.errTitle;
  $('enterLabel').textContent = T.loading;
  const xrOK = XrWalk.supported;
  $('keys').innerHTML = howToHTML({ touch, T, sun: ICON.sun, walk: xrOK ? ICON.walk : null });
  $('credit').innerHTML = `${XR_CREDIT.short} · <a href="${XR_CREDIT.licenseUrl}" target="_blank" rel="noopener">© Niantic Spatial, Inc. · license</a>`;
  $('credit').classList.toggle('hidden', !xrOK);
  const resolve = (f) => new URL(f, worldUrl).href;

  // ---- downloads, in parallel
  const progressBar = $('progress').firstElementChild;
  const progressText = $('progressText');
  const showProgress = (got, total) => {
    if (!total) return;
    $('progress').classList.remove('indeterminate');
    progressBar.style.width = `${Math.min(100, (got / total) * 100).toFixed(1)}%`;
    progressText.textContent = `${(got / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} ${T.mb}`;
  };
  $('progress').classList.add('indeterminate');
  const modelData = download(resolve(world.model), showProgress);
  const collisionData = world.collision
    ? fetch(resolve(world.collision)).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null)
    : Promise.resolve(null);
  const splatData = world.splat ? download(resolve(world.splat), () => {}).catch((e) => { console.warn('splat', e); return null; }) : Promise.resolve(null);
  const [pc, { default: RAPIER }] = await libs;

  // ---- PlayCanvas app
  const canvas = $('c');
  const app = new pc.Application(canvas, {
    graphicsDeviceOptions: { antialias: true, alpha: false, powerPreference: 'high-performance' },
  });
  app.setCanvasFillMode(pc.FILLMODE_NONE);
  app.setCanvasResolution(pc.RESOLUTION_AUTO);
  canvas.style.width = ''; canvas.style.height = '';
  const baseRatio = Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 2);
  let renderScale = touch ? 0.9 : 1;
  const minScale = Math.max(0.5, 0.75 / baseRatio);
  const applyScale = () => { app.graphicsDevice.maxPixelRatio = baseRatio * renderScale; app.updateCanvasSize(); };
  applyScale();
  window.addEventListener('resize', () => app.updateCanvasSize());
  app.start();

  const camera = new pc.Entity('camera');
  camera.addComponent('camera', {
    clearColor: new pc.Color(0.5, 0.6, 0.75),
    fov: world.fov, nearClip: 0.05, farClip: 2000,
    toneMapping: pc.TONEMAP_ACES2 ?? pc.TONEMAP_ACES, gammaCorrection: pc.GAMMA_SRGB,
  });
  app.root.addChild(camera);

  // ---- the model
  const modelBuf = await modelData;
  const glb = (() => { try { return readGlb(modelBuf, { collide: !world.collision }); } catch (e) { console.warn(e); return null; } })();
  if (!glb) throw new Error('the model is not a .glb file');
  const blobUrl = URL.createObjectURL(new Blob([modelBuf], { type: 'model/gltf-binary' }));
  const container = await new Promise((ok, fail) => {
    const asset = new pc.Asset('model', 'container', { url: blobUrl, filename: 'model.glb' });
    asset.ready(() => ok(asset.resource));
    asset.on('error', (e) => fail(new Error(`model: ${e}`)));
    app.assets.add(asset);
    app.assets.load(asset);
  });
  const model = container.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
  app.root.addChild(model);
  // see-through materials (glass) let the sun through: they don't cast shadows
  const bounds = new pc.BoundingBox();
  let first = true;
  // Glass from Blender arrives as transmission (refraction). Drawing real refraction needs an extra copy of
  // the screen every frame, too costly on phones, so it is drawn as simple see-through glass instead.
  const glassDone = new Set();
  const asGlass = (m) => {
    if (glassDone.has(m)) return; glassDone.add(m);
    m.refraction = 0; m.refractionMap = null; m.useDynamicRefraction = false;
    m.blendType = pc.BLEND_NORMAL; m.opacity = Math.min(m.opacity ?? 1, 0.22); m.depthWrite = false;
    m.useMetalness = true; m.metalness = 0; m.gloss = Math.max(m.gloss ?? 0.9, 0.9);
    m.update();
  };
  for (const r of model.findComponents('render')) {
    for (const mi of r.meshInstances) {
      const m = mi.material;
      if (m && (m.refraction > 0 || m.useDynamicRefraction)) asGlass(m);
      if (m && (m.blendType !== pc.BLEND_NONE || (m.opacity !== undefined && m.opacity < 0.99) || m.refraction > 0 || m.useDynamicRefraction)) mi.castShadow = false;
      if (first) { bounds.copy(mi.aabb); first = false; } else bounds.add(mi.aabb);
    }
  }
  const size = Math.max(bounds.halfExtents.x, bounds.halfExtents.z) * 2;

  // place: world.json, then the GLB's scene properties, then the URL, then the default
  const ex = glb.extras || {};
  const fromGlb = ex.lat !== undefined && ex.lon !== undefined
    ? { lat: +ex.lat, lon: +ex.lon, north: ex.north !== undefined ? +ex.north : undefined, timeZone: ex.timeZone || ex.timezone, name: ex.place || ex.location } : {};
  const clean = (o) => Object.fromEntries(Object.entries(o || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const place = { ...DEFAULT_PLACE, ...clean(fromGlb), ...clean(world.location) };
  if (qs.get('lat')) place.lat = +qs.get('lat');
  if (qs.get('lon')) place.lon = +qs.get('lon');
  if (qs.get('north')) place.north = +qs.get('north');
  if (qs.get('tz')) place.timeZone = qs.get('tz');
  if (qs.get('lat') && !qs.get('place')) place.name = '';
  if (qs.get('place')) place.name = qs.get('place');

  // ---- optional splat (keeps its own captured light)
  let splat = null;
  const splatBuf = await splatData;
  if (splatBuf) {
    try {
      const asset = new pc.Asset('splat', 'gsplat', { url: resolve(world.splat), filename: world.splat.split('/').pop(), contents: splatBuf });
      await new Promise((ok, fail) => { asset.ready(ok); asset.on('error', fail); app.assets.add(asset); app.assets.load(asset); });
      splat = new pc.Entity('splat');
      splat.addComponent('gsplat', { asset });
      const tr = world.splatTransform || {};
      splat.setLocalPosition(...(tr.position || [0, 0, 0]));
      splat.setLocalEulerAngles(...(tr.rotation || [0, 0, 180]));
      if (tr.scale) splat.setLocalScale(tr.scale, tr.scale, tr.scale);
      app.root.addChild(splat);
    } catch (e) { console.warn('splat failed', e); }
  }

  // ---- physics + collision
  await RAPIER.init();
  const phys = new RAPIER.World({ x: 0, y: 0, z: 0 });
  let tris = glb;
  try {
    const cbuf = await collisionData;
    if (cbuf) tris = readGlb(cbuf);
  } catch (e) { console.warn('collision file failed', e); }
  if (tris.indices.length) phys.createCollider(RAPIER.ColliderDesc.trimesh(tris.vertices, tris.indices));
  else phys.createCollider(RAPIER.ColliderDesc.cuboid(1000, 0.05, 1000).setTranslation(0, -0.05, 0));
  if (glb.compressed && !world.collision) { $('worldWarn').textContent = T.warnDraco; $('worldWarn').classList.remove('hidden'); }

  // ================================================================ sun, sky and light
  const sunEnt = new pc.Entity('sun');
  const shadowDist = world.shadowDistance || Math.min(80, Math.max(20, size * 1.2));
  sunEnt.addComponent('light', {
    type: 'directional', castShadows: true,
    shadowType: pc.SHADOW_PCF3_32F, shadowResolution: touch ? 1536 : 2048,
    numCascades: touch ? 2 : 3, cascadeDistribution: 0.6, shadowDistance: shadowDist,
    shadowBias: 0.25, normalOffsetBias: 0.06, intensity: 2,
  });
  app.root.addChild(sunEnt);
  app.scene.exposure = world.exposure;

  // sky: a small cubemap painted from the sun's position, used for the background and the ambient light
  const SKY = 32;
  const skyTex = new pc.Texture(app.graphicsDevice, {
    name: 'sky', cubemap: true, width: SKY, height: SKY, format: pc.PIXELFORMAT_SRGBA8 ?? pc.PIXELFORMAT_RGBA8, mipmaps: false,
    minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE,
  });
  // the background is painted at full strength; the copy that lights the scene is dimmer, because without
  // bounced light (and walls that block the sky indoors) full-strength sky light washes everything out
  const skyFaces = Array.from({ length: 6 }, () => new Uint8Array(SKY * SKY * 4));
  const litFaces = Array.from({ length: 6 }, () => new Uint8Array(SKY * SKY * 4));
  const litTex = new pc.Texture(app.graphicsDevice, {
    name: 'sky-light', cubemap: true, width: SKY, height: SKY, format: pc.PIXELFORMAT_SRGBA8 ?? pc.PIXELFORMAT_RGBA8, mipmaps: false,
    minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE,
  });
  const SKY_LIGHT = world.skyLight ?? 0.45;
  const toSrgb = (v) => { v = Math.max(0, Math.min(1, v)); return Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)); };
  const faceDir = (f, s, t) => [[1, -t, -s], [-1, -t, s], [s, 1, t], [s, -1, -t], [s, -t, 1], [-s, -t, -1]][f];
  let envAtlas = null, lightSrc = null;
  const paintSky = (S, L) => {
    const ground = L.horizon.map((v, i) => v * 0.25 + [0.06, 0.055, 0.045][i] * L.dayness);
    for (let f = 0; f < 6; f++) {
      const px = skyFaces[f], lx = litFaces[f];
      for (let y = 0; y < SKY; y++) for (let x = 0; x < SKY; x++) {
        const s = ((x + 0.5) / SKY) * 2 - 1, t = ((y + 0.5) / SKY) * 2 - 1;
        let [dx, dy, dz] = faceDir(f, s, t);
        const n = Math.hypot(dx, dy, dz); dx /= n; dy /= n; dz /= n;
        let c;
        if (dy >= 0) {
          const k = Math.pow(dy, 0.45);
          c = L.horizon.map((h, i) => h + (L.zenith[i] - h) * k);
        } else {
          const k = Math.min(1, -dy * 6);
          c = L.horizon.map((h, i) => h + (ground[i] - h) * k);
        }
        const g = Math.max(0, dx * S[0] + dy * S[1] + dz * S[2]);
        const glow = (Math.pow(g, 600) * 6 + Math.pow(g, 24) * 0.35 + Math.pow(g, 4) * 0.08) * Math.min(1, L.sunIntensity);
        const o = (y * SKY + x) * 4;
        px[o] = toSrgb(c[0] + L.sunColor[0] * glow); px[o + 1] = toSrgb(c[1] + L.sunColor[1] * glow); px[o + 2] = toSrgb(c[2] + L.sunColor[2] * glow); px[o + 3] = 255;
        lx[o] = toSrgb(c[0] * SKY_LIGHT); lx[o + 1] = toSrgb(c[1] * SKY_LIGHT); lx[o + 2] = toSrgb(c[2] * SKY_LIGHT); lx[o + 3] = 255;
      }
    }
    for (let f = 0; f < 6; f++) { skyTex.lock({ face: f }).set(skyFaces[f]); skyTex.unlock(); litTex.lock({ face: f }).set(litFaces[f]); litTex.unlock(); }
    try {
      lightSrc = pc.EnvLighting.generateLightingSource(litTex, lightSrc ? { target: lightSrc } : { size: 64 });
      const first = !envAtlas;
      envAtlas = pc.EnvLighting.generateAtlas(lightSrc, envAtlas ? { target: envAtlas } : { size: touch ? 256 : 512 });
      if (first) app.scene.envAtlas = envAtlas;
    } catch (e) { console.warn('environment lighting', e); }
    app.scene.skybox = skyTex;
    app.scene.skyboxMip = 0;
  };

  // the study: place + date + time (local clock in the place's time zone)
  const now = utcToZoned(Date.now(), place.timeZone);
  const sun = {
    date: /^\d{4}-\d{2}-\d{2}$/.test(qs.get('date') || '') ? qs.get('date') : now.date,
    minutes: /^\d{1,2}:\d{2}$/.test(qs.get('time') || '') ? (([h, m]) => +h * 60 + +m)(qs.get('time').split(':')) : now.minutes,
    playing: false, speed: 30,   // minutes of sun per second when playing
    pos: null, times: null, lastSky: null, skyAt: 0,
  };
  const applySun = (force = false) => {
    const utc = zonedToUtc(sun.date, sun.minutes, place.timeZone);
    const p = sunPosition(utc, place.lat, place.lon);
    sun.pos = p;
    const S = sunDirection(p.azimuth, p.elevation, place.north || 0);
    const L = daylight(p.elevation);
    // light shines along the entity's -Y: point +Y at the sun
    const up = new pc.Vec3(0, 1, 0), to = new pc.Vec3(S[0], S[1], S[2]);
    const axis = new pc.Vec3().cross(up, to);
    const ang = Math.acos(Math.max(-1, Math.min(1, up.dot(to))));
    const q = new pc.Quat();
    if (axis.length() < 1e-6) q.set(0, 0, 0, 1); else q.setFromAxisAngle(axis.normalize(), ang * pc.math.RAD_TO_DEG);
    sunEnt.setRotation(q);
    sunEnt.light.color = new pc.Color(...L.sunColor);
    sunEnt.light.intensity = L.sunIntensity;
    sunEnt.light.enabled = L.sunIntensity > 0.01;
    app.scene.ambientLight = new pc.Color(...L.ambient);
    camera.camera.clearColor = new pc.Color(...L.horizon);
    // repaint the sky when the sun has moved enough (it is cheap, but not free on phones)
    const key = [p.azimuth, p.elevation];
    const nowT = performance.now();
    if (force || !sun.lastSky || ((Math.abs(key[0] - sun.lastSky[0]) > 1.5 || Math.abs(key[1] - sun.lastSky[1]) > 0.7) && nowT - sun.skyAt > 150)) {
      paintSky(S, L); sun.lastSky = key; sun.skyAt = nowT;
    }
    renderSunUI();
  };

  // ================================================================ player
  const R = world.playerRadius;
  const HALF = Math.max(0.1, (1.75 - 2 * R) / 2);
  const CENTER = HALF + R;
  const body = phys.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased());
  const collider = phys.createCollider(RAPIER.ColliderDesc.capsule(HALF, R), body);
  const kcc = phys.createCharacterController(0.02);
  kcc.setUp({ x: 0, y: 1, z: 0 });
  kcc.enableAutostep(world.stepHeight, 0.05, false);
  kcc.enableSnapToGround(0.35);
  kcc.setMaxSlopeClimbAngle((55 * Math.PI) / 180);
  kcc.setMinSlopeSlideAngle((65 * Math.PI) / 180);
  kcc.setSlideEnabled(true);

  const feet = new pc.Vec3(), prevFeet = new pc.Vec3(), drawFeet = new pc.Vec3();
  let yaw = 0, pitch = 0, vy = 0, fly = false, smoothEye = null;
  const gyro = new Gyro();
  const xr = new XrWalk(new URL('lib/xr8/', document.baseURI).href);
  let xrTurn = null, xrLast = null, xrEye = null, xrOwnsGyro = false;
  const xrCarry = [0, 0];   // phone movement not yet handed to the physics step
  const place3 = (x, y, z, yw = yaw, pt = 0) => {
    if (gyro.on) gyro.setYaw(yw);
    xrTurn = null;
    feet.set(x, y + 0.02, z); prevFeet.copy(feet);
    yaw = yw; pitch = pt; vy = 0; smoothEye = null;
    body.setTranslation({ x, y: y + CENTER + 0.02, z }, true);
    body.setNextKinematicTranslation({ x, y: y + CENTER + 0.02, z });
  };
  // start: world.json spawn, else the "spawn" empty in the model, else outside the model looking at it
  const spawn = world.spawn || glb.spawn || (() => {
    const c = bounds.center, h = bounds.halfExtents;
    return { position: [c.x, bounds.getMin().y, c.z + h.z + 4], yaw: 0 };
  })();
  const respawn = () => { const [x, y, z] = spawn.position; place3(x, y, z, spawn.yaw || 0, spawn.pitch || 0); };
  respawn();

  // ---- debug collision overlay (?edit, key G)
  let overlay = null;
  if (EDIT && tris.indices.length) {
    const mesh = new pc.Mesh(app.graphicsDevice);
    mesh.setPositions(tris.vertices); mesh.setIndices(tris.indices); mesh.update(); mesh.generateWireframe();
    const mat = new pc.StandardMaterial(); mat.emissive = new pc.Color(1, 0.45, 0.1); mat.useLighting = false; mat.update();
    const mi = new pc.MeshInstance(mesh, mat); mi.renderStyle = pc.RENDERSTYLE_WIREFRAME;
    overlay = new pc.Entity('collision'); overlay.addComponent('render', { meshInstances: [mi], castShadows: false });
    overlay.enabled = false; app.root.addChild(overlay);
  }

  // ================================================================ input
  const keys = new Set();
  const stick = { x: 0, y: 0 };
  let active = false;
  const look = (dx, dy, k) => { yaw -= dx * k; pitch = Math.max(-85, Math.min(85, pitch - dy * k)); };
  const nudgeTime = (d) => { sun.minutes = ((sun.minutes + d) % 1440 + 1440) % 1440; applySun(); syncUrl(); };
  addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, select, textarea')) return;
    if (e.code === 'Escape' && active) { pause(); return; }
    if (!active) return;
    keys.add(e.code);
    if (e.code === 'KeyR') respawn();
    if (e.code === 'Comma') nudgeTime(e.shiftKey ? -60 : -10);
    if (e.code === 'Period') nudgeTime(e.shiftKey ? 60 : 10);
    if (e.code === 'KeyP') setPlaying(!sun.playing);
    if (EDIT && e.code === 'KeyF') { fly = !fly; vy = 0; }
    else if (e.code === 'KeyF' && !e.repeat && !e.metaKey && !e.ctrlKey) toggleFullscreen();
    if (EDIT && e.code === 'KeyG' && overlay) overlay.enabled = !overlay.enabled;
    if (EDIT && e.code === 'KeyP' && e.shiftKey) {
      const s = { position: [+feet.x.toFixed(3), +feet.y.toFixed(3), +feet.z.toFixed(3)], yaw: +yaw.toFixed(1) };
      navigator.clipboard?.writeText(`"spawn": ${JSON.stringify(s)}`);
      flash(`Copied spawn ${JSON.stringify(s)}`);
    }
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  // mouse: drag to look (no pointer lock, so the sun controls stay in reach)
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || !active) return;
    drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); canvas.classList.add('dragging');
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerType !== 'mouse') return;
    look(e.clientX - drag.x, e.clientY - drag.y, 0.2); drag.x = e.clientX; drag.y = e.clientY;
  });
  const endDrag = () => { drag = null; canvas.classList.remove('dragging'); };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // touch: joystick in the lower-left corner, drag anywhere else to look
  const stickEl = $('stick'), knob = $('knob'), stickZone = $('stickZone');
  buildStick(stickEl, 112);
  buildKeypad($('keypad'));
  let stickId = null, lookId = null, lx = 0, ly = 0, sx = 0, sy = 0, sr = 56;
  const stickMove = (t) => {
    let x = (t.clientX - sx) / sr, y = (t.clientY - sy) / sr;
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    stick.x = x; stick.y = y;
    knob.style.transform = `translate(${x * 20}px, ${y * 20}px)`;
  };
  const stickStart = (t) => {
    stickEl.style.transform = '';
    const r = stickEl.getBoundingClientRect();
    sr = r.width / 2; sx = r.left + sr; sy = r.top + sr;
    if (Math.hypot(t.clientX - sx, t.clientY - sy) > sr + 12) {
      const nx = Math.min(Math.max(t.clientX, sr + 8), innerWidth - sr - 8), ny = Math.min(Math.max(t.clientY, sr + 8), innerHeight - sr - 8);
      stickEl.style.transform = `translate(${nx - sx}px, ${ny - sy}px)`;
      sx = nx; sy = ny;
    }
    stickMove(t);
  };
  stickZone.addEventListener('touchstart', (e) => {
    e.preventDefault();
    if (stickId !== null && [...e.touches].some((t) => t.identifier === stickId)) return;
    stickId = e.changedTouches[0].identifier; stickStart(e.changedTouches[0]);
  }, { passive: false });
  canvas.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; lookId = t.identifier; lx = t.clientX; ly = t.clientY; }, { passive: true });
  addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) stickMove(t);
      else if (t.identifier === lookId && !xr.on) {
        if (gyro.on) gyro.turn(-(t.clientX - lx) * 0.25); else look(t.clientX - lx, t.clientY - ly, 0.25);
        lx = t.clientX; ly = t.clientY;
      }
    }
  }, { passive: true });
  const touchEnd = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) { stickId = null; stick.x = stick.y = 0; knob.style.transform = ''; stickEl.style.transform = ''; }
      if (t.identifier === lookId) lookId = null;
    }
  };
  addEventListener('touchend', touchEnd);
  addEventListener('touchcancel', touchEnd);

  // ================================================================ enter / pause
  const intro = $('intro'), enter = $('enter');
  enter.disabled = false;
  $('enterLabel').textContent = touch ? T.tapEnter : T.enter;
  $('progress').classList.add('hidden');
  progressText.textContent = '';
  document.body.classList.add('ready');
  let entered = false;
  function start() {
    active = true; entered = true;
    intro.classList.add('hidden');
    $('hud').classList.remove('hidden');
    if (!touch || store.get('sunbar') === 'on') showSunbar(true);
    if (touch) stickZone.classList.remove('hidden');
    else $('keypad').classList.remove('hidden');
  }
  function pause() {
    active = false; keys.clear(); endDrag();
    $('enterLabel').textContent = T.resume;
    intro.classList.remove('hidden');
    $('hud').classList.add('hidden');
    $('sunbar').classList.add('hidden');
    if (touch) stickZone.classList.add('hidden');
    if (xr.on) stopXr();
  }
  enter.addEventListener('click', start);

  const hint = $('hint');
  let hintT = null;
  const flash = (msg, ms = 2600) => { hint.textContent = msg; hint.style.opacity = 1; clearTimeout(hintT); hintT = setTimeout(() => { hint.style.opacity = 0; }, ms); };
  hint.textContent = touch ? T.hintTouch : T.hint;
  hintT = setTimeout(() => { hint.style.opacity = 0; }, 8000);
  $('badgeTitle').textContent = world.title;

  // ---- round buttons, top right
  const roundBtn = (id, icon, title) => {
    const b = $(id); b.innerHTML = icon; b.title = title; b.setAttribute('aria-label', title); b.classList.remove('hidden');
    $('hud').classList.add('has-round');
    return b;
  };
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
  if (fullscreenOK) {
    const fb = roundBtn('fsBtn', ICON.fsEnter, T.fullscreen);
    const sync = () => {
      const on = !!fsElement();
      fb.innerHTML = on ? ICON.fsExit : ICON.fsEnter;
      fb.title = on ? T.fullscreenExit : T.fullscreen; fb.setAttribute('aria-label', fb.title); fb.setAttribute('aria-pressed', String(on));
    };
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync);
    fb.addEventListener('click', toggleFullscreen);
  } else if (!standalone) {
    const fb = roundBtn('fsBtn', ICON.fsEnter, T.fullscreen.replace(/ \(F\)$/, '')), help = $('fsHelp');
    $('fsHelpTitle').textContent = T.fsHelpTitle; $('fsHelpText').textContent = T.fsHelp;
    $('fsHelpX').innerHTML = ICON.close; $('fsHelpX').setAttribute('aria-label', T.close);
    const setHelp = (open) => { help.classList.toggle('hidden', !open); fb.setAttribute('aria-pressed', String(open)); };
    fb.addEventListener('click', (e) => { e.stopPropagation(); setHelp(help.classList.contains('hidden')); });
    $('fsHelpX').addEventListener('click', () => setHelp(false));
    addEventListener('pointerdown', (e) => { if (!help.classList.contains('hidden') && !help.contains(e.target) && !fb.contains(e.target)) setHelp(false); });
  }
  // sun panel toggle (on phones the panel is folded away while walking)
  const sunBtn = roundBtn('sunBtn', ICON.sun, T.sunToggle);
  function showSunbar(on) {
    $('sunbar').classList.toggle('hidden', !on);
    sunBtn.classList.toggle('on', on); sunBtn.setAttribute('aria-pressed', String(on));
    if (!on) $('sunPop').classList.add('hidden');
  }
  sunBtn.addEventListener('click', () => {
    const on = $('sunbar').classList.contains('hidden');
    showSunbar(on); if (touch) store.set('sunbar', on ? 'on' : 'off');
  });
  // look with the phone
  if (touch && Gyro.supported) {
    const btn = roundBtn('gyroBtn', PHONE_FLIP, T.gyro);
    btn.addEventListener('click', async () => {
      if (xr.on) return;
      if (gyro.on) { gyro.disable(); pitch = 0; btn.classList.remove('on'); btn.setAttribute('aria-pressed', 'false'); flash(T.gyroOff); return; }
      try { await gyro.enable(yaw); btn.classList.add('on'); btn.setAttribute('aria-pressed', 'true'); flash(T.gyroOn); }
      catch (e) { flash(e.message === 'denied' ? T.gyroDenied : T.gyroNone); }
    });
  }

  // ================================================================ walk for real (8th Wall)
  const xrBtn = xrOK ? roundBtn('xrBtn', ICON.walk, T.xrStart) : null;
  $('xrRecenter').textContent = T.xrRecenter;
  $('xrCredit').innerHTML = `${XR_CREDIT.short} · <a href="${XR_CREDIT.licenseUrl}" target="_blank" rel="noopener">© Niantic Spatial</a>`;
  const xrStatus = (s, why) => {
    const bar = $('xrBar');
    if (s === 'off') { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    bar.dataset.state = s;
    $('xrText').textContent = s === 'failed' ? (why === 'camera' ? T.xrFailCamera : why === 'permission' ? T.xrDenied : T.xrFailEngine)
      : s === 'normal' ? T.xrNormal : s === 'limited' ? T.xrLimited : T.xrStarting;
    if (s === 'failed') { setXrBtn(false); setTimeout(() => { if (!xr.on) bar.classList.add('hidden'); }, 5000); }
  };
  xr.onStatus = xrStatus;
  const setXrBtn = (on) => {
    if (!xrBtn) return;
    xrBtn.classList.toggle('on', on); xrBtn.setAttribute('aria-pressed', String(on));
    xrBtn.title = on ? T.xrStop : T.xrStart; xrBtn.setAttribute('aria-label', xrBtn.title);
    $('gyroBtn').classList.toggle('dim', on);
  };
  async function startXr() {
    const motion = askMotionPermission();   // inside the tap, before anything is awaited
    setXrBtn(true);
    xrStatus('starting');
    if (!(await motion)) { setXrBtn(false); xrStatus('off'); flash(T.xrDenied); return; }
    // The view turns with the phone's own motion sensors (which already know which way the screen is
    // turned, also on the foldable); the camera tracking only says how far you have moved.
    if (!gyro.on) { try { await gyro.enable(yaw); xrOwnsGyro = true; } catch { xrOwnsGyro = false; } }
    try { await xr.start(); flash(T.xrHint, 6000); }
    catch (e) { console.warn(e); xrStatus('failed', 'engine'); }
  }
  function stopXr() {
    xr.stop(); setXrBtn(false); xrTurn = null; xrLast = null; xrEye = null;
    if (xrOwnsGyro) { gyro.disable(); xrOwnsGyro = false; pitch = 0; }
  }
  xrBtn?.addEventListener('click', () => (xr.on || xrBtn.classList.contains('on') ? stopXr() : startXr()));
  $('xrRecenter').addEventListener('click', () => { xrTurn = null; xrLast = null; });
  if (xrOK) {
    const b = $('enterXr');
    b.textContent = T.walkReal; b.classList.remove('hidden');
    b.addEventListener('click', () => { start(); startXr(); });
  }

  // ================================================================ sun panel
  const tzs = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return []; } })();
  $('tzList').innerHTML = tzs.map((z) => `<option value="${z}">`).join('');
  $('sunPlay').innerHTML = ICON.play; $('sunPlay').title = T.play; $('sunPlay').setAttribute('aria-label', T.play);
  $('sunChips').innerHTML = T.chips.map(([md, label]) => `<button data-md="${md}" title="${label}">${label}</button>`).join('');
  for (const [id, k] of [['lblLat', 'lat'], ['lblLon', 'lon'], ['lblNorth', 'north'], ['lblTz', 'tz']]) $(id).textContent = T[k];
  $('useHere').textContent = T.useHere; $('popDone').textContent = T.done; $('popNote').textContent = T.popNote;
  const compass = (az) => T.dirs[Math.round(az / 45) % 8];
  const fmtCoord = (v, pos, neg) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? pos : neg}`;
  let urlT = null;
  function syncUrl() {
    clearTimeout(urlT);
    urlT = setTimeout(() => {
      const u = new URL(location.href);
      u.searchParams.set('date', sun.date); u.searchParams.set('time', hhmm(sun.minutes));
      for (const [k, v] of [['lat', place.lat], ['lon', place.lon], ['north', place.north || 0], ['tz', place.timeZone]]) u.searchParams.set(k, k === 'lat' || k === 'lon' ? (+v).toFixed(5) : v);
      if (place.name) u.searchParams.set('place', place.name); else u.searchParams.delete('place');
      history.replaceState(null, '', u.href);
    }, 400);
  }
  function renderSunUI() {
    const p = sun.pos;
    $('sunTime').value = String(Math.round(sun.minutes) % 1440);
    $('sunClock').textContent = hhmm(sun.minutes);
    if ($('sunDate').value !== sun.date) $('sunDate').value = sun.date;
    const md = sun.date.slice(5);
    $('sunChips').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.md === md));
    $('sunPlace').innerHTML = `${ICON.pin}${place.name ? `${place.name.replace(/</g, '&lt;')} · ` : ''}${fmtCoord(place.lat, 'N', 'S')}, ${fmtCoord(place.lon, 'E', 'W')}`;
    $('badgePlace').textContent = `${hhmm(sun.minutes)} · ${sun.date}`;
    $('badgePlace').classList.remove('hidden');
    if (!p) return;
    const t = sun.times;
    const when = t?.polarDay ? T.polarDay : t?.polarNight ? T.polarNight : `${T.sunrise} ${hhmm(t?.sunrise)} · ${T.sunset} ${hhmm(t?.sunset)}`;
    $('sunRead').innerHTML = `${T.sunUp} ${T.azimuth} <b>${compass(p.azimuth)}</b> ${Math.round(p.azimuth)}° · <b>${p.elevation.toFixed(1)}°</b> ${p.elevation >= 0 ? T.above : T.below} · ${when}`;
  }
  // the slider's track shows night, twilight and day for the chosen date
  function paintTrack() {
    sun.times = sunTimes(sun.date, place.lat, place.lon, place.timeZone);
    const stops = [];
    for (let m = 0; m <= 1440; m += 30) {
      const e = sunPosition(zonedToUtc(sun.date, m, place.timeZone), place.lat, place.lon).elevation;
      const L = daylight(e);
      const c = L.dayness > 0.05 ? L.horizon.map((v, i) => v * 0.55 + L.zenith[i] * 0.45) : L.zenith;
      stops.push(`rgb(${c.map((v) => Math.round(255 * Math.min(1, v ** (1 / 2.2)))).join(',')}) ${((m / 1440) * 100).toFixed(1)}%`);
    }
    $('sunTrack').style.setProperty('--track', `linear-gradient(90deg, ${stops.join(',')})`);
  }
  function setPlaying(on) {
    sun.playing = on;
    $('sunPlay').innerHTML = on ? ICON.stop : ICON.play;
    $('sunPlay').title = on ? T.pause : T.play; $('sunPlay').setAttribute('aria-label', $('sunPlay').title);
    $('sunPlay').setAttribute('aria-pressed', String(on));
    if (!on) applySun(true);
  }
  $('sunPlay').addEventListener('click', () => setPlaying(!sun.playing));
  $('sunTime').addEventListener('input', (e) => { sun.minutes = +e.target.value; applySun(); syncUrl(); });
  $('sunTime').addEventListener('change', () => applySun(true));
  $('sunDate').addEventListener('change', (e) => { if (e.target.value) { sun.date = e.target.value; paintTrack(); applySun(true); syncUrl(); } });
  $('sunChips').addEventListener('click', (e) => {
    const b = e.target.closest('[data-md]'); if (!b) return;
    sun.date = `${sun.date.slice(0, 4)}-${b.dataset.md}`; paintTrack(); applySun(true); syncUrl();
  });
  const pop = $('sunPop');
  const fillPop = () => { $('inLat').value = place.lat; $('inLon').value = place.lon; $('inNorth').value = place.north || 0; $('inTz').value = place.timeZone; };
  $('sunPlaceBtn').addEventListener('click', () => { fillPop(); pop.classList.toggle('hidden'); });
  const readPop = () => {
    const lat = parseFloat(String($('inLat').value).replace(',', '.')), lon = parseFloat(String($('inLon').value).replace(',', '.'));
    const north = parseFloat($('inNorth').value);
    const tz = $('inTz').value.trim();
    let changed = false;
    if (isFinite(lat) && Math.abs(lat) <= 90 && lat !== place.lat) { place.lat = lat; changed = true; }
    if (isFinite(lon) && Math.abs(lon) <= 180 && lon !== place.lon) { place.lon = lon; changed = true; }
    if (changed) place.name = '';
    if (isFinite(north)) place.north = north;
    if (tz && (tzs.includes(tz) || (() => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } })())) place.timeZone = tz;
    paintTrack(); applySun(true); syncUrl();
  };
  for (const id of ['inLat', 'inLon', 'inNorth', 'inTz']) $(id).addEventListener('change', readPop);
  $('popDone').addEventListener('click', () => { readPop(); pop.classList.add('hidden'); });
  $('useHere').addEventListener('click', () => {
    if (!navigator.geolocation) { flash(T.locFail); return; }
    $('useHere').textContent = T.locating;
    navigator.geolocation.getCurrentPosition((p) => {
      place.lat = +p.coords.latitude.toFixed(5); place.lon = +p.coords.longitude.toFixed(5); place.name = T.here;
      try { place.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || place.timeZone; } catch { /* keep */ }
      fillPop(); paintTrack(); applySun(true); syncUrl();
      $('useHere').textContent = T.useHere;
    }, () => { flash(T.locFail); $('useHere').textContent = T.useHere; }, { enableHighAccuracy: false, timeout: 10000 });
  });
  for (const ev of ['pointerdown', 'touchstart', 'wheel']) $('sunbar').addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
  if (splat) { $('worldWarn').textContent = T.noGeometryLight; $('worldWarn').classList.remove('hidden'); }
  paintTrack();
  applySun(true);

  // ================================================================ simulation
  const STEP = 1 / 60;
  let acc = 0, ema = 1 / 60, lastAdjust = performance.now();
  const forward = new pc.Vec3(), right = new pc.Vec3(), move = new pc.Vec3();
  const minY = bounds.getMin().y - 10;
  const dirEls = [...document.querySelectorAll('#keypad [data-dir], #stick [data-dir]')];
  let dirState = '';
  const showDirections = () => {
    const k = (...c) => active && c.some((x) => keys.has(x));
    const d = { f: k('KeyW', 'ArrowUp') || stick.y < -0.35, b: k('KeyS', 'ArrowDown') || stick.y > 0.35, l: k('KeyA', 'ArrowLeft') || stick.x < -0.35, r: k('KeyD', 'ArrowRight') || stick.x > 0.35 };
    const st = `${+d.f}${+d.b}${+d.l}${+d.r}`;
    if (st === dirState) return;
    dirState = st;
    for (const el of dirEls) el.classList.toggle('on', d[el.dataset.dir]);
    $('keypad').classList.toggle('active', st !== '0000');
  };
  const rotY = (deg, x, z) => { const r = deg * pc.math.DEG_TO_RAD, c = Math.cos(r), s = Math.sin(r); return [c * x + s * z, -s * x + c * z]; };

  app.on('update', (dt) => {
    dt = Math.min(dt, 0.1);
    app.updateCanvasSize();
    ema = ema * 0.94 + dt * 0.06;
    const nowT = performance.now();
    if (active && nowT - lastAdjust > 1500) {
      if (ema > 1 / 40 && renderScale > minScale) { renderScale = Math.max(minScale, renderScale - 0.1); applyScale(); lastAdjust = nowT; }
      else if (ema < 1 / 56 && renderScale < 1 && nowT - lastAdjust > 5000) { renderScale = Math.min(1, renderScale + 0.05); applyScale(); lastAdjust = nowT; }
    }
    if (sun.playing) {
      sun.minutes += sun.speed * dt;
      if (sun.minutes >= 1440) sun.minutes -= 1440;
      applySun(); syncUrl();
    }

    // walking for real: how far the phone moved since last frame, turned into the world's frame.
    // xrTurn is the angle between the tracking's world and ours, measured from where the camera points
    // (a sideways-turned screen in the tracking does not change that), and kept in step slowly.
    let xrRot = null;
    const pose = xr.on ? xr.pose : null;
    if (pose) {
      const ep = yawPitchOf(pose.q);
      const target = yaw - ep.yaw;
      const level = Math.abs(ep.pitch) < 70 && Math.abs(pitch) < 70;
      if (xrTurn === null) { if (level || !gyro.on) xrTurn = target; }
      else if (gyro.on && level) xrTurn += (((target - xrTurn + 540) % 360) - 180) * Math.min(1, dt * 1.5);
      if (xr.tracking === 'normal' && xrTurn !== null) {
        if (xrLast) {
          const [dx, dz] = rotY(xrTurn, pose.p[0] - xrLast[0], pose.p[2] - xrLast[2]);
          if (Math.hypot(dx, dz) < 1.5) { xrCarry[0] += dx; xrCarry[1] += dz; }   // ignore jumps when tracking resets
        }
        xrLast = pose.p.slice();
        // the phone's height above the floor is your eye height (crouch to see under things)
        if (pose.p[1] > 0.3 && pose.p[1] < 2.4) xrEye = xrEye === null ? pose.p[1] : xrEye + (pose.p[1] - xrEye) * Math.min(1, dt * 6);
      } else xrLast = null;
      // without motion sensors of our own, the tracking's camera turns the view
      if (!gyro.on && xrTurn !== null) xrRot = new pc.Quat().mul2(new pc.Quat().setFromEulerAngles(0, xrTurn, 0), new pc.Quat(pose.q[0], pose.q[1], pose.q[2], pose.q[3]));
    }

    acc += dt;
    while (acc >= STEP) {
      acc -= STEP;
      prevFeet.copy(feet);
      const yr = (yaw * Math.PI) / 180;
      forward.set(-Math.sin(yr), 0, -Math.cos(yr));
      right.set(Math.cos(yr), 0, -Math.sin(yr));
      let f = 0, s = 0, u = 0;
      if (active) {
        if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
        if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
        if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1;
        if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
        if (keys.has('KeyE') || keys.has('Space')) u += 1;
        if (keys.has('KeyQ') || keys.has('KeyC')) u -= 1;
        f -= stick.y; s += stick.x;
      }
      const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
      const speed = (run ? world.runSpeed : world.walkSpeed) * (fly ? 1.5 : 1);
      move.set(forward.x * f + right.x * s, 0, forward.z * f + right.z * s);
      if (move.length() > 1) move.normalize();
      move.mulScalar(speed * STEP);
      if (xrCarry[0] || xrCarry[1]) { move.x += xrCarry[0]; move.z += xrCarry[1]; xrCarry[0] = xrCarry[1] = 0; }

      if (fly) {
        feet.add(move); feet.y += u * speed * STEP;
        body.setNextKinematicTranslation({ x: feet.x, y: feet.y + CENTER, z: feet.z });
      } else {
        vy = Math.max(vy - 9.81 * STEP, -20);
        kcc.computeColliderMovement(collider, { x: move.x, y: vy * STEP, z: move.z });
        const m = kcc.computedMovement();
        if (kcc.computedGrounded()) vy = 0;
        const p = body.translation();
        const nx = p.x + m.x, ny = p.y + m.y, nz = p.z + m.z;
        body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });
        feet.set(nx, ny - CENTER, nz);
        if (feet.y < minY) respawn();
      }
      phys.step();
    }
    drawFeet.lerp(prevFeet, feet, acc / STEP);
    const eyeH = xr.on && xrEye !== null ? xrEye : world.eyeHeight;
    const eyeY = drawFeet.y + eyeH;
    smoothEye = smoothEye === null || fly ? eyeY : pc.math.lerp(smoothEye, eyeY, 1 - Math.exp(-dt * 14));
    camera.setPosition(drawFeet.x, smoothEye, drawFeet.z);
    const gq = xrRot ? null : gyro.frame(dt);
    if (xrRot) {
      camera.setRotation(xrRot);
      ({ yaw, pitch } = yawPitchOf([xrRot.x, xrRot.y, xrRot.z, xrRot.w]));
    } else if (gq) {
      camera.setRotation(new pc.Quat(gq[0], gq[1], gq[2], gq[3]));
      ({ yaw, pitch } = yawPitchOf(gq));
    } else camera.setEulerAngles(pitch, yaw, 0);
    showDirections();
    if (EDIT) {
      $('dev').textContent = `pos  ${feet.x.toFixed(2)} ${feet.y.toFixed(2)} ${feet.z.toFixed(2)}\nyaw  ${yaw.toFixed(0)}°  ${fly ? 'FLY' : 'walk'}  ${(1 / ema).toFixed(0)} fps  scale ${renderScale.toFixed(2)}\n`
        + `sun  az ${sun.pos?.azimuth.toFixed(1)}  el ${sun.pos?.elevation.toFixed(1)}\n${xr.debug()}\nF fly · G collision · Shift+P copy spawn`;
    }
  });
  if (EDIT) $('dev').classList.remove('hidden');

  // scripting hook (tests, embedding)
  window.__experi3d = {
    app, world, place, sun, keys, respawn,
    get feet() { return [feet.x, feet.y, feet.z]; },
    get view() { return { yaw, pitch }; },
    setView: (y, p = 0) => { yaw = y; pitch = p; },
    teleport: (x, y, z) => place3(x, y, z, yaw, pitch),
    setTime: (date, minutes) => { if (date) sun.date = date; if (minutes !== undefined) sun.minutes = minutes; paintTrack(); applySun(true); },
    setPlace: (p) => { Object.assign(place, p); paintTrack(); applySun(true); },
    start, pause, xr,
  };
}

main().catch((e) => {
  console.error(e);
  $('intro').classList.add('hidden');
  $('error').classList.remove('hidden');
  $('errorText').textContent = `${T.err} ${e.message || e}`;
  window.__experi3dError = String(e.message || e);
});
