// Walk for real: the phone's camera tracks how it moves through the room (8th Wall SLAM, real-world
// scale), and the virtual camera follows. The camera image itself is never shown.
//
// The 8th Wall engine (lib/xr8) is © Niantic Spatial, Inc., used under the XR Engine License Agreement
// (lib/xr8/LICENSE). It is loaded only when someone turns this on.

import { Gyro } from './gyro.js';

let loading = null;

// Which way the screen is turned, as the tracking engine will see it. Some devices (the foldable
// iPhone, some tablets and browsers) report an angle a quarter turn off from the motion sensors,
// and the engine then sees the world on its side. The angle is read from gravity instead (as for
// look-with-phone) and handed to the engine in place of the browser's own value.
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let angles = null, lastAngle = null, watch = null;
async function fixScreenAngle() {
  if (angles) return;
  const g = new Gyro();
  try { await g.enable(0); } catch { return; }      // no sensor: leave the browser's value
  const t0 = performance.now();
  while (!g._sure && performance.now() - t0 < 1200) await new Promise((r) => setTimeout(r, 40));
  angles = g;
  const deg = () => g.angle;                         // window.orientation convention: 90 = top of the phone to the left
  try { Object.defineProperty(window, 'orientation', { configurable: true, get: deg }); } catch { /* read-only here */ }
  if (screen.orientation) {
    // the engine reads screen.orientation.angle on Android, and on iPhone counts it the other way round
    try { Object.defineProperty(screen.orientation, 'angle', { configurable: true, get: () => (isIOS ? (360 - deg()) % 360 : deg()) }); } catch { /* read-only */ }
  }
  lastAngle = deg();
  // when the angle settles on a new value, tell the engine the screen turned
  watch = setInterval(() => {
    if (g.angle !== lastAngle) { lastAngle = g.angle; window.dispatchEvent(new Event('orientationchange')); }
  }, 100);
}

function loadEngine(base) {
  if (window.XR8) return Promise.resolve(window.XR8);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('xr.js', base).href;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.setAttribute('data-preload-chunks', 'slam');
    const done = () => (window.XR8 ? resolve(window.XR8) : null);
    window.addEventListener('xrloaded', done, { once: true });
    window.addEventListener('XRloaded', done, { once: true });
    s.onerror = () => { loading = null; reject(new Error('engine')); };
    document.head.appendChild(s);
    // the engine announces itself with an event; poll as well in case it fired early
    const t0 = performance.now();
    const poll = () => { if (window.XR8) resolve(window.XR8); else if (performance.now() - t0 < 60000) setTimeout(poll, 100); else reject(new Error('engine')); };
    poll();
  });
  return loading;
}

// Ask for motion sensors while the tap that started this is still "fresh" (iPhone needs that).
export function askMotionPermission() {
  const asks = [];
  for (const E of [window.DeviceMotionEvent, window.DeviceOrientationEvent]) {
    if (E && typeof E.requestPermission === 'function') asks.push(E.requestPermission().catch(() => 'denied'));
  }
  return Promise.all(asks).then((r) => r.every((x) => x === 'granted'));
}

export class XrWalk {
  // base: URL of the folder holding xr.js
  constructor(base) {
    this.base = base;
    this.on = false;
    this.pose = null;          // latest { p: [x,y,z], q: [x,y,z,w], t }
    this.tracking = 'off';     // off | starting | limited | normal
    this.onStatus = null;
    this._canvas = null;
  }

  // phones and tablets with a camera; laptops and desktops are left out
  static get supported() {
    const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    return touch && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
  }

  async start() {
    if (this.on) return;
    this._set('starting');
    const [XR8] = await Promise.all([loadEngine(this.base), fixScreenAngle()]);
    // The engine needs a canvas of its own for its image processing. It stays invisible:
    // the 3D view is drawn by the viewer on its own canvas.
    if (!this._canvas) {
      const c = document.createElement('canvas');
      c.className = 'xr-engine-canvas';
      c.setAttribute('aria-hidden', 'true');
      document.body.appendChild(c);
      this._canvas = c;
    }
    XR8.XrController.configure({ scale: 'absolute', disableWorldTracking: false });
    XR8.clearCameraPipelineModules?.();
    XR8.addCameraPipelineModules([
      XR8.XrController.pipelineModule(),
      {
        name: 'experi3d',
        onUpdate: ({ processCpuResult }) => {
          const r = processCpuResult?.reality;
          if (!r?.position || !r?.rotation) return;
          this.pose = {
            p: [r.position.x, r.position.y, r.position.z],
            q: [r.rotation.x, r.rotation.y, r.rotation.z, r.rotation.w],
            t: performance.now(),
          };
        },
        onCameraStatusChange: ({ status }) => {
          if (status === 'failed') this._fail('camera');
        },
        onException: (e) => { console.warn('[experi3d] XR', e); this._fail(e?.type === 'permission' ? 'permission' : 'engine'); },
        listeners: [{
          event: 'reality.trackingstatus',
          process: ({ detail }) => this._set(detail?.status === 'NORMAL' ? 'normal' : 'limited'),
        }],
      },
    ]);
    const devices = XR8.XrConfig?.device?.();
    XR8.run({
      canvas: this._canvas,
      allowedDevices: devices?.MOBILE_AND_HEADSETS || devices?.MOBILE || devices?.ANY,
    });
    this.on = true;
  }

  stop() {
    if (!window.XR8) return;
    try { window.XR8.stop(); window.XR8.clearCameraPipelineModules?.(); } catch { /* already stopped */ }
    this.on = false; this.pose = null;
    this._set('off');
  }

  _set(s) { if (this.tracking !== s) { this.tracking = s; this.onStatus?.(s); } }
  _fail(why) { this.stop(); this.onStatus?.('failed', why); }
}

export const XR_CREDIT = {
  short: 'Tracking by 8th Wall',
  long: 'Walking for real uses the 8th Wall engine, © 2026 Niantic Spatial, Inc. All rights reserved. '
    + 'Used under the XR Engine License Agreement, provided "as is" without warranties of any kind.',
  licenseUrl: 'lib/xr8/LICENSE',
};
