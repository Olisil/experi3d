// Image quality for Experi3D: ambient occlusion, anti-aliasing, gentle bloom (CameraFrame), and a
// room reflection probe that also lends the room its own bounced light. Nothing here needs anything
// special in the GLB: it works on whatever model is loaded.

export function setupFrame(pc, app, cameraComponent, { touch, toneMapping }) {
  const cf = new pc.CameraFrame(app, cameraComponent);
  cf.rendering.toneMapping = toneMapping;
  cf.rendering.samples = 1;                       // TAA smooths edges on computers; phones stay light
  cf.rendering.renderTargetScale = 1;
  cf.ssao.type = pc.SSAOTYPE_LIGHTING;            // darkens ambient light in corners and contacts, never the sun
  // Kept close to real rooms: a soft darkening reaching about 0.4 m into inside corners and under
  // things, nothing on flat walls or outside corners (bounced light fills most of a real corner).
  cf.ssao.intensity = 0.35;
  cf.ssao.radius = 0.4;                           // metres
  cf.ssao.samples = touch ? 8 : 16;
  cf.ssao.power = 1.5;
  cf.ssao.minAngle = 22;                          // ignore near-flat geometry: no haze on walls
  cf.ssao.scale = touch ? 0.5 : 1;
  cf.ssao.blurEnabled = true;
  cf.taa.enabled = !touch;
  cf.taa.jitter = 1;
  cf.rendering.sharpness = touch ? 0 : 0.45;       // TAA softens; sharpen back a little
  cf.bloom.intensity = 0.012;
  cf.bloom.blurLevel = 14;
  cf.update?.();
  return cf;
}

// Cubemap camera orientations for the faces +X, -X, +Y, -Y, +Z, -Z (as in PlayCanvas' cubemap renderer)
const FACES = [[0, 90, 180], [0, -90, 180], [90, 0, 0], [-90, 0, 0], [0, 180, 180], [0, 0, 180]];

export class RoomProbe {
  // materials: the model's StandardMaterials; layers: layer ids to capture; cast(origin, dir) -> distance
  constructor(pc, app, { touch, materials, layers, cast }) {
    this.pc = pc; this.app = app; this.materials = materials; this.cast = cast;
    const device = app.graphicsDevice;
    const size = touch ? 64 : 128;
    const hdr = device.textureHalfFloatRenderable;
    this.cube = new pc.Texture(device, {
      name: 'room-probe', cubemap: true, width: size, height: size, mipmaps: false,
      format: hdr ? pc.PIXELFORMAT_RGBA16F : pc.PIXELFORMAT_RGBA8,
      minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR, addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE,
    });
    this.root = new pc.Entity('room-probe');
    app.root.addChild(this.root);
    this.cams = FACES.map((e, i) => {
      const c = new pc.Entity(`probe-${i}`);
      c.addComponent('camera', {
        fov: 90, aspectRatioMode: pc.ASPECT_MANUAL, aspectRatio: 1, nearClip: 0.05, farClip: 500,
        priority: -10, layers, toneMapping: pc.TONEMAP_LINEAR, gammaCorrection: pc.GAMMA_NONE,
        renderTarget: new pc.RenderTarget({ colorBuffer: this.cube, face: i, depth: true, flipY: true }),
      });
      c.setLocalEulerAngles(...e);
      c.enabled = false;
      this.root.addChild(c);
      return c;
    });
    this.atlas = null; this.src = null;
    this.box = null; this.at = null; this.pending = false; this.lastT = 0;
  }

  // the room around a point: how far the walls, floor and ceiling are in the six directions
  roomBox(p) {
    const pc = this.pc;
    const d = (x, y, z) => Math.min(30, Math.max(0.3, this.cast(p, { x, y, z }) ?? 30));
    const min = new pc.Vec3(p.x - d(-1, 0, 0), p.y - d(0, -1, 0), p.z - d(0, 0, -1));
    const max = new pc.Vec3(p.x + d(1, 0, 0), p.y + d(0, 1, 0), p.z + d(0, 0, 1));
    const box = new pc.BoundingBox();
    box.setMinMax(min, max);
    return box;
  }

  // capture from p (eye position); the result is applied after the frame has rendered
  capture(p) {
    if (this.pending) return;
    this.pending = true;
    this.at = p.clone();
    const box = this.roomBox(p);
    this.root.setPosition(p);
    for (const c of this.cams) c.enabled = true;
    this.app.once('frameend', () => {
      for (const c of this.cams) c.enabled = false;
      const pc = this.pc;
      try {
        this.src = pc.EnvLighting.generateLightingSource(this.cube, this.src ? { target: this.src } : { size: 128 });
        const first = !this.atlas;
        this.atlas = pc.EnvLighting.generateAtlas(this.src, this.atlas ? { target: this.atlas } : { size: 256 });
        const sameBox = this.box && this.box.center.distance(box.center) < 0.05 && this.box.halfExtents.distance(box.halfExtents) < 0.05;
        this.box = box;
        if (first || !sameBox) {
          for (const m of this.materials) {
            m.envAtlas = this.atlas;
            m.cubeMapProjection = pc.CUBEPROJ_BOX;
            m.cubeMapProjectionBox = box;
            m.update();
          }
        }
      } catch (e) { console.warn('[experi3d] room probe', e); }
      this.pending = false;
      this.lastT = performance.now();
    });
  }

  // call every frame: recapture when you have moved into another part of the house, or the light changed
  update(eye, lightChanged) {
    const now = performance.now();
    if (this.pending) return;
    if (!this.at) { this.capture(eye); return; }
    const moved = this.at.distance(eye);
    if (moved > 1.8 && now - this.lastT > 400) { this.capture(eye); return; }
    if (lightChanged && now - this.lastT > 350) this.capture(eye);
  }

  off() {
    for (const m of this.materials) { m.envAtlas = null; m.cubeMapProjection = this.pc.CUBEPROJ_NONE; m.update(); }
  }
}
