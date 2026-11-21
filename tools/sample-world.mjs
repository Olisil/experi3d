// Builds worlds/sample/model.glb: a small house to try the sun on (until a real Blender export replaces it).
// Units: meters. +Y up, north = -Z (Blender's +Y). The house's long glazed side faces south (+Z).
// Run: node tools/sample-world.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const mats = {
  ground: { color: [0.36, 0.42, 0.28], rough: 0.95 },
  paving: { color: [0.62, 0.6, 0.56], rough: 0.85 },
  wall: { color: [0.86, 0.84, 0.8], rough: 0.9 },
  floor: { color: [0.62, 0.46, 0.32], rough: 0.7 },
  roof: { color: [0.24, 0.24, 0.25], rough: 0.8 },
  wood: { color: [0.5, 0.36, 0.24], rough: 0.75 },
  frame: { color: [0.16, 0.16, 0.17], rough: 0.5 },
  glass: { color: [0.6, 0.75, 0.8], rough: 0.05, alpha: 0.18 },
};
const parts = Object.fromEntries(Object.keys(mats).map((k) => [k, { pos: [], nrm: [], idx: [] }]));

// axis-aligned box from min/max corners; names ending in _nc are left out of walking collision
function box(mat, [x0, y0, z0], [x1, y1, z1]) {
  const p = parts[mat];
  const faces = [
    [[1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]],
    [[-1, 0, 0], [[x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [x0, y0, z0]]],
    [[0, 1, 0], [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]]],
    [[0, -1, 0], [[x0, y0, z1], [x0, y0, z0], [x1, y0, z0], [x1, y0, z1]]],
    [[0, 0, 1], [[x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [x0, y0, z1]]],
    [[0, 0, -1], [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]]],
  ];
  for (const [n, vs] of faces) {
    const b = p.pos.length / 3;
    for (const v of vs) { p.pos.push(...v); p.nrm.push(...n); }
    p.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
}

// ---- site
box('ground', [-30, -0.1, -30], [30, 0, 30]);
box('paving', [-5.6, 0, 4.2], [7.5, 0.02, 7.2]);        // terrace on the south side
// ---- house 12 x 8 m, walls 0.25 m, 2.9 m high, floor slab
const W0 = -6, W1 = 6, D0 = -4, D1 = 4, H = 2.9, t = 0.25;
box('floor', [W0, 0, D0], [W1, 0.05, D1]);
// north wall with two small windows (sill 1.0, head 2.1)
const wallX = (z0, z1, openings) => {      // wall along X between z0..z1, openings [[x0,x1,y0,y1],...]
  let x = W0;
  const cuts = [...openings].sort((a, b) => a[0] - b[0]);
  for (const [a, b, y0, y1] of cuts) {
    box('wall', [x, 0, z0], [a, H, z1]);
    if (y0 > 0) box('wall', [a, 0, z0], [b, y0, z1]);
    box('wall', [a, y1, z0], [b, H, z1]);
    if (y0 > 0 || y1 < H) {
      box('frame', [a, y0, (z0 + z1) / 2 - 0.03], [b, y0 + 0.05, (z0 + z1) / 2 + 0.03]);
      if (y1 < H) box('glass', [a, y0 + 0.05, (z0 + z1) / 2 - 0.01], [b, y1, (z0 + z1) / 2 + 0.01]);
    }
    x = b;
  }
  box('wall', [x, 0, z0], [W1, H, z1]);
};
wallX(D0, D0 + t, [[-3.5, -2.3, 1.0, 2.1], [1.5, 2.7, 1.0, 2.1]]);
// south wall: big glazing (0.1 .. 2.5) and a door opening without glass
wallX(D1 - t, D1, [[-4.8, -0.8, 0.1, 2.5], [1.2, 2.2, 0.0, 2.9], [2.8, 5.2, 0.1, 2.5]]);
// east and west walls, west with a tall narrow window
box('wall', [W1 - t, 0, D0], [W1, H, D1]);
box('wall', [W0, 0, D0], [W0 + t, H, -1.2]);
box('wall', [W0, 0, -0.4], [W0 + t, H, D1]);
box('wall', [W0, 0, -1.2], [W0 + t, 0.4, -0.4]);
box('wall', [W0, 2.5, -1.2], [W0 + t, H, -0.4]);
box('glass', [W0 + 0.11, 0.4, -1.2], [W0 + 0.14, 2.5, -0.4]);
// interior wall with a doorway
box('wall', [0.4, 0, D0 + t], [0.52, H, -0.6]);
box('wall', [0.4, 2.1, -0.6], [0.52, H, 0.4]);
box('wall', [0.4, 0, 0.4], [0.52, H, 1.6]);
// roof slab with 0.9 m overhang (south 1.4 m, to shade the high summer sun)
box('roof', [W0 - 0.9, H, D0 - 0.9], [W1 + 0.9, H + 0.3, D1 + 1.4]);
// pergola west of the terrace: 4 posts, slats north-south
for (const [x, z] of [[-9.4, 2.6], [-6.6, 2.6], [-9.4, 6.6], [-6.6, 6.6]]) box('wood', [x - 0.08, 0, z - 0.08], [x + 0.08, 2.5, z + 0.08]);
box('wood', [-9.6, 2.5, 2.5], [-6.4, 2.65, 2.7]); box('wood', [-9.6, 2.5, 6.5], [-6.4, 2.65, 6.7]);
for (let x = -9.5; x <= -6.45; x += 0.3) box('wood', [x, 2.65, 2.4], [x + 0.06, 2.8, 6.8]);
// a low garden wall and a bench, to catch long shadows
box('wall', [-12, 0, 8.5], [10, 0.6, 8.8]);
box('wood', [3.2, 0.42, 5.6], [5.4, 0.48, 6.0]); box('wood', [3.3, 0, 5.65], [3.4, 0.42, 5.95]); box('wood', [5.2, 0, 5.65], [5.3, 0.42, 5.95]);

// ---- write the GLB
const json = { asset: { version: '2.0', generator: 'experi3d sample-world' }, scene: 0, scenes: [{ nodes: [] }], nodes: [], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
const chunks = []; let byteLen = 0;
const addView = (typed, target) => {
  const pad = (4 - (byteLen % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); byteLen += pad; }
  json.bufferViews.push({ buffer: 0, byteOffset: byteLen, byteLength: typed.byteLength, target });
  chunks.push(new Uint8Array(typed.buffer)); byteLen += typed.byteLength;
  return json.bufferViews.length - 1;
};
for (const [name, m] of Object.entries(mats)) {
  const p = parts[name]; if (!p.idx.length) continue;
  const pos = new Float32Array(p.pos), nrm = new Float32Array(p.nrm), idx = new Uint32Array(p.idx);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < pos.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], pos[i + k]); max[k] = Math.max(max[k], pos[i + k]); }
  const a0 = json.accessors.push({ bufferView: addView(pos, 34962), componentType: 5126, count: pos.length / 3, type: 'VEC3', min, max }) - 1;
  const a1 = json.accessors.push({ bufferView: addView(nrm, 34962), componentType: 5126, count: nrm.length / 3, type: 'VEC3' }) - 1;
  const a2 = json.accessors.push({ bufferView: addView(idx, 34963), componentType: 5125, count: idx.length, type: 'SCALAR' }) - 1;
  const mat = { name, pbrMetallicRoughness: { baseColorFactor: [...m.color, m.alpha ?? 1], metallicFactor: 0, roughnessFactor: m.rough } };
  if (m.alpha !== undefined) { mat.alphaMode = 'BLEND'; mat.doubleSided = true; }
  const mi = json.materials.push(mat) - 1;
  const me = json.meshes.push({ name, primitives: [{ attributes: { POSITION: a0, NORMAL: a1 }, indices: a2, material: mi }] }) - 1;
  // glass is left out of collision so you can't lean on it from outside... it is a window: keep it solid
  json.scenes[0].nodes.push(json.nodes.push({ name: name === 'glass' ? 'glass' : name, mesh: me }) - 1);
}
// where you start: an empty named "spawn" (inside, looking south through the big window)
json.scenes[0].nodes.push(json.nodes.push({ name: 'spawn', translation: [-2.5, 0.05, -1.5], rotation: [0, 1, 0, 0] }) - 1);
json.buffers.push({ byteLength: byteLen });
const bin = new Uint8Array(byteLen); let o = 0; for (const c of chunks) { bin.set(c, o); o += c.byteLength; }
let js = new TextEncoder().encode(JSON.stringify(json));
const jpad = (4 - (js.length % 4)) % 4; js = Uint8Array.from([...js, ...Array(jpad).fill(0x20)]);
const total = 12 + 8 + js.length + 8 + bin.length;
const out = new Uint8Array(total); const dv = new DataView(out.buffer);
dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
dv.setUint32(12, js.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(js, 20);
dv.setUint32(20 + js.length, bin.length, true); dv.setUint32(24 + js.length, 0x004e4942, true); out.set(bin, 28 + js.length);
const dir = new URL('../public/worlds/sample/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('model.glb', dir), out);
console.log('wrote', new URL('model.glb', dir).pathname, out.length, 'bytes');
