# Experi3D

Walk a 3D world exported from Blender, with the real sun for any place, date and time — and on phones,
walk for real: the phone's camera tracks how you move through the room and the view follows.

Built on the same viewer as Intus (PlayCanvas, Rapier collision, joystick, look-with-phone).

## Worlds

A world is a folder in `public/worlds/<id>/` (or in the bucket named by `<meta name="experi3d-worlds">`):

```
world.json   settings (below)
model.glb    the world, one GLB (keep it under 25 MB for Webflow Cloud: see tools/)
```

`worlds/index.json` lists them and names the default. Open one with `?w=<id>`.

```json
{
  "title": "Stora Mossen",
  "subtitle": "Shown on the start card",
  "model": "model.glb",
  "location": { "lat": 59.3333, "lon": 17.9621, "timeZone": "Europe/Stockholm", "north": 0, "name": "Stora Mossen" },
  "spawn": { "position": [x, y, z], "yaw": 0 },
  "eyeHeight": 1.6,
  "collision": "collision.glb",
  "splat": "context.sog",
  "skyLight": 0.45
}
```

- **location.north**: where true north points in the model, degrees clockwise from −Z seen from above.
  From Blender (glTF +Y up), 0 means north is Blender's +Y — as with BlenderGIS/Blosm scenes.
- **spawn**: optional. Otherwise an empty named `spawn` in the GLB (its −Z/Blender +Y is the view), otherwise outside the model.
- Lat/lon can also come from the Blender scene's custom properties `lat`, `lon`, `north`, `timeZone`
  (export with *Include › Custom Properties*).
- Objects named `…_nc` or containing `nocollide` are left out of walking collision.
- **collision**: optional separate, simpler GLB to walk against (needed if the model is Draco/meshopt compressed).
- **splat**: optional Gaussian splat as context. It keeps the light it was captured with; only geometry gets the sun.
- **skyLight**: how strongly the sky lights the scene (0–1, default 0.45; lower for darker interiors).

## From Blender to the web

1. Export glTF *Separate* (`.gltf` + `.bin` + textures), visible objects, modifiers applied.
2. `cd tools && npm install && node web-glb.mjs export.gltf ../public/worlds/<id>/model.glb`
   — merges duplicates, simplifies dense meshes, quantizes geometry, WebP textures (1024 px for big surfaces, 512/256 for the rest).

## URL

`?w=<id>` world · `?date=2026-06-21&time=15:30` · `?lat=&lon=&north=&tz=&place=` — the page keeps these updated,
so a link shares the exact study. `?edit` shows position/FPS (F fly, G collision wireframe, Shift+P copy spawn). `?lang=sv|en`.

Keys: WASD walk, drag to look, `,` `.` ±10 min (Shift ±1 h), P play the day, F full screen, R back to start, Esc pause.

## Sun

`public/sun.js`: NOAA/Meeus solar position (azimuth, elevation with refraction), checked against the `astral` library
to 0.01°; sunrise/sunset within a minute. The time is the local clock of the world's time zone, daylight saving included.
Light: a shadow-casting sun (cascaded shadows) plus sky light from a small sky painted from the sun's position.
There is no bounced light, so interiors are an approximation; sun angles and shadow lines are exact.

## Walking for real (phones)

`public/xrwalk.js` runs the 8th Wall engine's camera tracking (SLAM, absolute scale) on a hidden canvas and moves the
camera through the world by how the phone moves. Walls in the model still stop you. The joystick still moves you further,
"Recenter" re-anchors. Needs HTTPS, camera and motion permission.

The engine in `public/lib/xr8/` is © Niantic Spatial, Inc., used under the XR Engine License Agreement
(`public/lib/xr8/LICENSE`): it may be distributed unmodified with apps that use it, with attribution (shown on the start
card and while tracking). It may not be used in a paid product whose value comes mainly from the engine.

## Deploy (Webflow Cloud)

Like Intus: connect this repo as a Webflow Cloud app (framework Astro), mount it at e.g. `/experi3d`.
Static files must stay under 25 MB each; larger worlds go in an R2 bucket named by `<meta name="experi3d-worlds">`.
