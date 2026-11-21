// Sun position for light studies.
// NOAA solar position algorithm (Meeus): azimuth and elevation for any UTC time and place,
// accurate to well under 0.1° for years 1900-2100. Elevation includes atmospheric refraction.

const RAD = Math.PI / 180, DEG = 180 / Math.PI;

/** Sun position at a UTC instant. Azimuth: degrees clockwise from true north. Elevation: degrees above the horizon. */
export function sunPosition(utcMs, lat, lon) {
  const jd = utcMs / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;                                  // Julian centuries since J2000
  const L0 = mod(280.46646 + t * (36000.76983 + t * 0.0003032), 360); // geometric mean longitude
  const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);            // mean anomaly
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);       // orbit eccentricity
  const C = Math.sin(M * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * M * RAD) * (0.019993 - 0.000101 * t) + Math.sin(3 * M * RAD) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD); // apparent longitude
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * RAD);                 // corrected obliquity
  const decl = Math.asin(Math.sin(eps * RAD) * Math.sin(lambda * RAD)) * DEG;
  const y = Math.tan((eps / 2) * RAD) ** 2;
  const eqTime = 4 * DEG * (y * Math.sin(2 * L0 * RAD) - 2 * e * Math.sin(M * RAD)
    + 4 * e * y * Math.sin(M * RAD) * Math.cos(2 * L0 * RAD)
    - 0.5 * y * y * Math.sin(4 * L0 * RAD) - 1.25 * e * e * Math.sin(2 * M * RAD));  // minutes

  const d = new Date(utcMs);
  const minutesUtc = d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 + d.getUTCMilliseconds() / 60000;
  const trueSolar = mod(minutesUtc + eqTime + 4 * lon, 1440);
  const ha = trueSolar / 4 < 0 ? trueSolar / 4 + 180 : trueSolar / 4 - 180;   // hour angle

  const cosZen = Math.sin(lat * RAD) * Math.sin(decl * RAD) + Math.cos(lat * RAD) * Math.cos(decl * RAD) * Math.cos(ha * RAD);
  const zen = Math.acos(clamp(cosZen, -1, 1)) * DEG;
  let az;
  const den = Math.cos(lat * RAD) * Math.sin(zen * RAD);
  if (Math.abs(den) > 1e-6) {
    const c = clamp((Math.sin(lat * RAD) * Math.cos(zen * RAD) - Math.sin(decl * RAD)) / den, -1, 1);
    az = ha > 0 ? mod(Math.acos(c) * DEG + 180, 360) : mod(540 - Math.acos(c) * DEG, 360);
  } else az = lat > 0 ? 180 : 0;

  const el = 90 - zen;
  return { azimuth: az, elevation: el + refraction(el), geometric: el, declination: decl };
}

// atmospheric refraction, degrees (NOAA approximation)
function refraction(el) {
  if (el > 85) return 0;
  const te = Math.tan(el * RAD);
  let r;
  if (el > 5) r = 58.1 / te - 0.07 / te ** 3 + 0.000086 / te ** 5;
  else if (el > -0.575) r = 1735 + el * (-518.2 + el * (103.4 + el * (-12.79 + el * 0.711)));
  else r = -20.774 / te;
  return r / 3600;
}

// ---------------------------------------------------------------- local clock time in a time zone

/** UTC milliseconds for a wall-clock date and time in an IANA time zone (e.g. "Europe/Stockholm"). */
export function zonedToUtc(dateStr, minutes, timeZone) {
  const [Y, Mo, D] = dateStr.split('-').map(Number);
  const wall = Date.UTC(Y, Mo - 1, D, 0, 0, 0) + minutes * 60000;
  // guess, then correct by the zone's offset at that instant (twice, for DST edges)
  let utc = wall - tzOffset(wall, timeZone);
  utc = wall - tzOffset(utc, timeZone);
  return utc;
}

/** Offset of the zone from UTC at a given instant, in ms (Stockholm in summer: +7 200 000). */
export function tzOffset(utcMs, timeZone) {
  try {
    const f = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return asUtc - Math.floor(utcMs / 1000) * 1000;
  } catch { return 0; }
}

/** The wall-clock date (YYYY-MM-DD) and minutes after midnight of a UTC instant in a time zone. */
export function utcToZoned(utcMs, timeZone) {
  const local = new Date(utcMs + tzOffset(utcMs, timeZone));
  const date = local.toISOString().slice(0, 10);
  return { date, minutes: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

/** Sunrise, solar noon and sunset for a local date, as minutes after local midnight (null when the sun doesn't rise or set). */
export function sunTimes(dateStr, lat, lon, timeZone) {
  const at = (m) => sunPosition(zonedToUtc(dateStr, m, timeZone), lat, lon).geometric;
  const H = -0.833;  // geometric elevation when the sun's upper edge appears on the horizon (refraction + half the disc)
  let noon = 0, best = -99;
  for (let m = 0; m <= 1440; m += 10) { const e = at(m); if (e > best) { best = e; noon = m; } }
  for (let step = 5; step >= 0.25; step /= 2) {  // refine the highest point
    const a = at(noon - step), b = at(noon + step);
    if (a > best) { best = a; noon -= step; } else if (b > best) { best = b; noon += step; }
  }
  const cross = (lo, hi, rising) => {
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if ((at(mid) > H) === rising) hi = mid; else lo = mid;
    }
    return (lo + hi) / 2;
  };
  const low = Math.min(at(noon - 720), at(noon + 720));
  const rise = best > H && at(Math.max(0, noon - 720)) < H ? cross(Math.max(0, noon - 720), noon, true) : null;
  const set = best > H && at(Math.min(1440, noon + 720)) < H ? cross(noon, Math.min(1440, noon + 720), false) : null;
  return { sunrise: rise, noon, sunset: set, maxElevation: best, polarDay: low > H, polarNight: best < H };
}

/**
 * Direction towards the sun in the model's coordinates (+Y up).
 * north: where true north points in the model, in degrees clockwise from the model's -Z axis seen from above.
 * (glTF from Blender: Blender's +Y becomes -Z, so north = 0 means north is Blender's +Y.)
 */
export function sunDirection(azimuth, elevation, north = 0) {
  const n = north * RAD, a = azimuth * RAD, e = elevation * RAD;
  const N = [Math.sin(n), 0, -Math.cos(n)], E = [Math.cos(n), 0, Math.sin(n)];
  const h = Math.cos(e);
  return [h * (Math.sin(a) * E[0] + Math.cos(a) * N[0]), Math.sin(e), h * (Math.sin(a) * E[2] + Math.cos(a) * N[2])];
}

/**
 * Sun and sky colours for an elevation (degrees): a simple physically-inspired model,
 * warm and dim near the horizon, white at height; twilight fades the sky to dusk blue and night.
 */
export function daylight(elevation) {
  const e = elevation;
  const up = smooth(-1, 6, e);               // sun disc above the horizon
  const high = smooth(0, 35, e);             // low warm sun -> high white sun
  // air mass makes low sun redder and weaker
  const sunColor = mix3([1.0, 0.52, 0.26], [1.0, 0.96, 0.9], high);
  const sunIntensity = up * (0.3 + 1.9 * smooth(-2, 50, e));
  const dayness = smooth(-8, 12, e);         // civil twilight -> day
  const zenith = mix3(mix3([0.015, 0.02, 0.045], [0.16, 0.22, 0.42], smooth(-12, -2, e)), [0.32, 0.54, 0.9], dayness);
  const horizon = mix3(mix3([0.03, 0.035, 0.06], [0.78, 0.48, 0.34], smooth(-10, -1, e) * (1 - smooth(4, 20, e))), [0.72, 0.82, 0.94], smooth(2, 25, e));
  const ambient = mix3([0.02, 0.025, 0.045], [0.42, 0.46, 0.55], dayness).map((v) => v * (0.35 + 0.65 * dayness));
  return { sunColor, sunIntensity, zenith, horizon, ambient, dayness };
}

/** "07:42" from minutes after midnight. */
export const hhmm = (m) => {
  if (m === null || m === undefined || !isFinite(m)) return '–';
  const r = Math.round(m);
  return `${String(Math.floor(r / 60) % 24).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`;
};

function mod(a, b) { return ((a % b) + b) % b; }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function smooth(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
function mix3(a, b, t) { return a.map((v, i) => v + (b[i] - v) * t); }
