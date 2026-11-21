// Web version of a Blender glTF export for Experi3D: merge duplicates, simplify dense meshes,
// quantize geometry, and shrink textures to WebP by how much they matter (keeps a model under ~25 MB).
//   cd tools && npm install && node web-glb.mjs path/to/export.gltf ../public/worlds/<id>/model.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, quantize, getBounds, listTextureSlots } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
const [,, input, output] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();
const tris = () => root.listMeshes().reduce((n, m) => n + m.listPrimitives().reduce((k, p) => k + (p.getIndices()?.getCount() ?? p.getAttribute('POSITION').getCount()) / 3, 0), 0);
console.log('start', tris(), 'tris', root.listTextures().length, 'textures');
await doc.transform(dedup(), prune(), weld({ tolerance: 0.0001 }));
await MeshoptSimplifier.ready;
await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: 0.35, error: 0.0008, lockBorder: true }));
console.log('after simplify', tris());

// how big may each texture be? colour on big surfaces (walls, floors, facade, ground) 1024 px,
// their other maps 512; colour on small things 512, their other maps 256
const area = new Map();
for (const node of root.listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue;
  const b = getBounds(node); const ext = [0, 1, 2].map((i) => b.max[i] - b.min[i]).sort((a, c) => c - a);
  for (const p of mesh.listPrimitives()) {
    const m = p.getMaterial(); if (!m) continue;
    area.set(m, Math.max(area.get(m) || 0, ext[0] * ext[1]));
  }
}
let gpu = 0, n = 0;
for (const tex of root.listTextures()) {
  const slots = listTextureSlots(tex);
  const color = slots.some((s) => /baseColor|emissive/i.test(s));
  const mats = tex.listParents().filter((p) => p.propertyType === 'Material');
  const big = mats.some((m) => (area.get(m) || 0) >= 6);
  const max = big ? (color ? 1024 : 512) : (color ? 512 : 256);
  const img = sharp(Buffer.from(tex.getImage()));
  const meta = await img.metadata();
  const s = Math.min(1, max / Math.max(meta.width, meta.height));
  const w = Math.max(4, Math.round(meta.width * s)), h = Math.max(4, Math.round(meta.height * s));
  const out = await img.resize(w, h).webp({ quality: color ? 80 : 75, alphaQuality: 90 }).toBuffer();
  tex.setImage(new Uint8Array(out)).setMimeType('image/webp').setURI((tex.getURI() || tex.getName() || 'tex').replace(/\.(png|jpe?g)$/i, '') + '.webp');
  gpu += w * h * 4 * 1.33; n++;
}
console.log('textures', n, 'gpu MB ~', (gpu / 1e6).toFixed(0));
await doc.transform(quantize({ quantizePosition: 16, quantizeNormal: 10, quantizeTexcoord: 12 }), prune());
await io.write(output, doc);
console.log('done', tris(), 'tris');
