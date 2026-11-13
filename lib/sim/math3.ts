// Minimal 3D math for the deterministic physics core. No dependencies, so the
// simulation can run in Node tests, a Web Worker, or the browser unchanged.
// Conventions: right-handed, +Y up. Quaternions are {x,y,z,w}, unit length.
export type V3 = { x: number; y: number; z: number };
export type Q4 = { x: number; y: number; z: number; w: number };
export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const qIdentity = (): Q4 => ({ x: 0, y: 0, z: 0, w: 1 });
export const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a: V3) => Math.hypot(a.x, a.y, a.z);
export function cross(a: V3, b: V3, o: V3 = v3()): V3 {
    const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x;
    o.x = x; o.y = y; o.z = z; return o;
}
export function set(o: V3, x: number, y: number, z: number) { o.x = x; o.y = y; o.z = z; return o; }
export function copy(o: V3, a: V3) { o.x = a.x; o.y = a.y; o.z = a.z; return o; }
export function addScaled(o: V3, a: V3, s: number) { o.x += a.x * s; o.y += a.y * s; o.z += a.z * s; return o; }
export function normalize(o: V3) { const l = Math.hypot(o.x, o.y, o.z) || 1; o.x /= l; o.y /= l; o.z /= l; return o; }
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const smoothstep = (x: number, a: number, b: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function qNormalize(q: Q4) {
    const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
    q.x /= l; q.y /= l; q.z /= l; q.w /= l; return q;
}
export function qMul(a: Q4, b: Q4, o: Q4 = qIdentity()): Q4 {
    const x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
    const y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x;
    const z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w;
    const w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
    o.x = x; o.y = y; o.z = z; o.w = w; return o;
}
export function qFromAxisAngle(axis: V3, angle: number, o: Q4 = qIdentity()): Q4 {
    const s = Math.sin(angle / 2), l = Math.hypot(axis.x, axis.y, axis.z) || 1;
    o.x = axis.x / l * s; o.y = axis.y / l * s; o.z = axis.z / l * s; o.w = Math.cos(angle / 2); return o;
}
/** Rotate v by q (q v q*). */
export function qRotate(q: Q4, v: V3, o: V3 = v3()): V3 {
    const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
    o.x = v.x + q.w * tx + (q.y * tz - q.z * ty);
    o.y = v.y + q.w * ty + (q.z * tx - q.x * tz);
    o.z = v.z + q.w * tz + (q.x * ty - q.y * tx);
    return o;
}
export function qRotateInv(q: Q4, v: V3, o: V3 = v3()): V3 {
    return qRotate({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v, o);
}
/** Integrate orientation by world angular velocity w over dt (exponential map, exact for constant w). */
export function qIntegrate(q: Q4, w: V3, dt: number) {
    const mag = Math.hypot(w.x, w.y, w.z), half = mag * dt / 2;
    if (half < 1e-12) return q;
    const s = Math.sin(half) / mag;
    const dq: Q4 = { x: w.x * s, y: w.y * s, z: w.z * s, w: Math.cos(half) };
    qMul(dq, q, q); return qNormalize(q);
}
/** Rotation matrix (row-major m[r*3+c]) from quaternion. */
export function qToMat(q: Q4, m: number[]) {
    const { x, y, z, w } = q;
    m[0] = 1 - 2 * (y * y + z * z); m[1] = 2 * (x * y - z * w); m[2] = 2 * (x * z + y * w);
    m[3] = 2 * (x * y + z * w); m[4] = 1 - 2 * (x * x + z * z); m[5] = 2 * (y * z - x * w);
    m[6] = 2 * (x * z - y * w); m[7] = 2 * (y * z + x * w); m[8] = 1 - 2 * (x * x + y * y);
    return m;
}
