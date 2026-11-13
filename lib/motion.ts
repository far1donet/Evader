import * as T from 'three';
export type Spring = {
    value: number;
    velocity: number;
};
// Closed-form critically damped spring: consistent at 30, 60 and 144 Hz,
// with no numerical overshoot or frame-rate-dependent damping.
export function springStep(s: Spring, target: number, frequency: number, dt: number) { const w = 2 * Math.PI * frequency, e = Math.exp(-w * dt), offset = s.value - target, v = s.velocity + w * offset; s.value = target + (offset + v * dt) * e; s.velocity = (s.velocity - w * v * dt) * e; return s.value; }
export class VectorSpring {
    x: Spring = { value: 0, velocity: 0 };
    y: Spring = { value: 0, velocity: 0 };
    z: Spring = { value: 0, velocity: 0 };
    reset(p: T.Vector3) { this.x = { value: p.x, velocity: 0 }; this.y = { value: p.y, velocity: 0 }; this.z = { value: p.z, velocity: 0 }; }
    step(target: T.Vector3, frequency: number, dt: number, out: T.Vector3) { return out.set(springStep(this.x, target.x, frequency, dt), springStep(this.y, target.y, frequency, dt), springStep(this.z, target.z, frequency, dt)); }
}
export function solveTwoBone(start: T.Vector3, target: T.Vector3, pole: T.Vector3, upper: number, lower: number) {
    const direction = target.clone().sub(start), requested = direction.length();
    if (requested < 1e-8)
        direction.set(0, -1, 0);
    else
        direction.multiplyScalar(1 / requested);
    const distance = T.MathUtils.clamp(requested, Math.abs(upper - lower) + .001, upper + lower - .001);
    const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
    const outward = pole.clone().sub(start);
    outward.addScaledVector(direction, -outward.dot(direction));
    if (outward.lengthSq() < 1e-8)
        outward.crossVectors(direction, new T.Vector3(1, 0, 0));
    if (outward.lengthSq() < 1e-8)
        outward.set(0, 0, 1);
    outward.normalize();
    const joint = start.clone().addScaledVector(direction, along).addScaledVector(outward, Math.sqrt(Math.max(0, upper * upper - along * along)));
    const end = start.clone().addScaledVector(direction, distance);
    return { joint, end };
}
export class ClothedLimb {
    mesh: T.SkinnedMesh;
    upper = new T.Bone();
    lower = new T.Bone();
    tip = new T.Bone();
    skeleton: T.Skeleton;
    upperLength: number;
    lowerLength: number;
    constructor(upperLength: number, lowerLength: number, radius: number, material: T.Material, kind: 'arm' | 'leg') {
        this.upperLength = upperLength;
        this.lowerLength = lowerLength;
        const length = upperLength + lowerLength, rows = 42, columns = 32;
        const trouser = kind === 'leg';
        const positions: number[] = [], uvs: number[] = [], skin: number[] = [], weights: number[] = [], indices: number[] = [];
        for (let i = 0; i <= rows; i++) {
            const t = i / rows, y = t * length;
            const shoulder = trouser ? 0 : 1 - T.MathUtils.smoothstep(t, 0, .16);
            const taper = trouser ? .66 + .45 * T.MathUtils.smoothstep(t, .08, .29) - .35 * t
                + .11 * Math.sin(t * Math.PI) + .15 * T.MathUtils.smoothstep(t, .72, .96)
                : 1.05 - .31 * t + .045 * Math.sin(t * Math.PI) - .29 * shoulder;
            const joint = Math.exp(-Math.pow((t - .51) * 7, 2));
            const cuff = Math.exp(-Math.pow((t - .90) * 13, 2));
            const mix = T.MathUtils.smoothstep(y, upperLength - .12, upperLength + .12);
            for (let j = 0; j <= columns; j++) {
                const a = j / columns * Math.PI * 2;
                const sin = Math.sin(a), cos = Math.cos(a);
                const front = Math.max(0, -sin), back = Math.max(0, sin);
                const knee = trouser ? joint * .010 * front * front : 0;
                const crease = Math.sin(t * 49 - a * 3) * joint * (.002 + .005 * back);
                const bootFold = Math.sin(t * 76 + a * 2) * cuff * (trouser ? .0052 : .0031);
                const drape = Math.cos(a * 3 - t * 2.8) * (trouser ? .007 : .004) * Math.sin(t * Math.PI);
                const r = radius * taper + crease + bootFold + drape + knee;
                const panelX = Math.sign(cos) * Math.abs(cos) ** (trouser ? .84 : .90);
                const panelZ = Math.sign(sin) * Math.abs(sin) ** .94;
                positions.push(panelX * r, -y + shoulder * .054, panelZ * r * (trouser ? .99 : .87));
                uvs.push(j / columns, t);
                skin.push(0, 1, 0, 0);
                weights.push(1 - mix, mix, 0, 0);
                if (i < rows && j < columns) {
                    const index = i * (columns + 1) + j;
                    indices.push(index, index + 1, index + columns + 1, index + 1, index + columns + 2, index + columns + 1);
                }
            }
        }
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
        g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
        g.setAttribute('skinIndex', new T.Uint16BufferAttribute(skin, 4));
        g.setAttribute('skinWeight', new T.Float32BufferAttribute(weights, 4));
        g.setIndex(indices);
        g.computeVertexNormals();
        this.mesh = new T.SkinnedMesh(g, material);
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
        this.mesh.frustumCulled = false;
        this.lower.position.set(0, -upperLength, 0);
        this.tip.position.set(0, -lowerLength, 0);
        this.upper.add(this.lower);
        this.lower.add(this.tip);
        this.mesh.add(this.upper);
        this.skeleton = new T.Skeleton([this.upper, this.lower, this.tip]);
        this.mesh.bind(this.skeleton);
    }
    pose(start: T.Vector3, target: T.Vector3, pole: T.Vector3) { const ik = solveTwoBone(start, target, pole, this.upperLength, this.lowerLength); this.mesh.position.copy(start); const down = new T.Vector3(0, -1, 0), upperQ = new T.Quaternion().setFromUnitVectors(down, ik.joint.clone().sub(start).normalize()), lowerQ = new T.Quaternion().setFromUnitVectors(down, ik.end.clone().sub(ik.joint).normalize()); this.upper.quaternion.copy(upperQ); this.lower.quaternion.copy(upperQ.clone().invert().multiply(lowerQ)); return ik; }
    dispose() { this.skeleton.dispose(); }
}
