import * as T from 'three';
import { BOARD_WAIST_M } from './snowboard-gear.ts';

type TrackSample = {
    x: number;
    d: number;
    heading: number;
    edgeAngle: number;
    skidAngle: number;
    depth: number;
};

const lanes = [-1, -.81, -.61, -.27, .27, .61, .81, 1];
const verticesPerSegment = lanes.length * 2;
const indicesPerSegment = (lanes.length - 1) * 6;
const capacity = 4095;
const spacing = .24;
const compacted = new T.Color(0x8ba6bd);
const cut = new T.Color(0x57738d);
const trench = new T.Color(0x7f9bba);
const powderLip = new T.Color(0xeaf7ff);

export class BoardTracks {
    readonly mesh: T.Mesh<T.BufferGeometry, T.MeshLambertMaterial>;
    private readonly positions = new T.BufferAttribute(new Float32Array(capacity * verticesPerSegment * 3), 3)
        .setUsage(T.DynamicDrawUsage);
    private readonly colors = new T.BufferAttribute(new Float32Array(capacity * verticesPerSegment * 4), 4)
        .setUsage(T.DynamicDrawUsage);
    private readonly normals = new T.BufferAttribute(new Float32Array(capacity * verticesPerSegment * 3), 3)
        .setUsage(T.DynamicDrawUsage);
    private previous?: TrackSample;
    private nextSegment = 0;
    private segmentCount = 0;
    private readonly tint = new T.Color();
    private readonly surface: (x: number, d: number) => number;

    constructor(surface: (x: number, d: number) => number) {
        this.surface = surface;
        const indices = new Uint16Array(capacity * indicesPerSegment);
        for (let segment = 0; segment < capacity; segment++) {
            const row = segment * verticesPerSegment;
            for (let lane = 0; lane < lanes.length - 1; lane++) {
                const a = row + lane, b = a + lanes.length;
                const index = segment * indicesPerSegment + lane * 6;
                indices[index] = a;
                indices[index + 1] = a + 1;
                indices[index + 2] = b;
                indices[index + 3] = a + 1;
                indices[index + 4] = b + 1;
                indices[index + 5] = b;
            }
        }
        const geometry = new T.BufferGeometry();
        geometry.setAttribute('position', this.positions);
        geometry.setAttribute('color', this.colors);
        geometry.setAttribute('normal', this.normals);
        geometry.setIndex(new T.BufferAttribute(indices, 1));
        geometry.setDrawRange(0, 0);
        const material = new T.MeshLambertMaterial({
            vertexColors: true,
            transparent: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -2,
        });
        this.mesh = new T.Mesh(geometry, material);
        this.mesh.frustumCulled = false;
        this.mesh.receiveShadow = true;
        this.mesh.renderOrder = 1;
    }

    breakTrail() {
        if (this.previous && this.segmentCount) {
            const segment = (this.nextSegment + capacity - 1) % capacity;
            const row = segment * verticesPerSegment + lanes.length;
            for (let lane = 0; lane < lanes.length; lane++) this.colors.setW(row + lane, 0);
            this.colors.addUpdateRange(row * 4, lanes.length * 4);
            this.colors.needsUpdate = true;
        }
        this.previous = undefined;
    }

    clear() {
        this.breakTrail();
        this.nextSegment = 0;
        this.segmentCount = 0;
        this.mesh.geometry.setDrawRange(0, 0);
    }

    record(sample: TrackSample) {
        const from = this.previous;
        if (!from) {
            this.previous = sample;
            return;
        }
        const distance = Math.hypot(sample.x - from.x, sample.d - from.d);
        if (distance > 2) {
            this.breakTrail();
            this.previous = sample;
            return;
        }
        if (distance < spacing) return;

        const count = Math.floor(distance / spacing);
        const blend = T.MathUtils.lerp;
        let previous = from;
        for (let i = 1; i <= count; i++) {
            const t = i * spacing / distance;
            const point = {
                x: blend(from.x, sample.x, t),
                d: blend(from.d, sample.d, t),
                heading: blend(from.heading, sample.heading, t),
                edgeAngle: blend(from.edgeAngle, sample.edgeAngle, t),
                skidAngle: blend(from.skidAngle, sample.skidAngle, t),
                depth: blend(from.depth, sample.depth, t),
            };
            this.append(previous, point);
            previous = point;
        }
        this.previous = previous;
    }

    private append(from: TrackSample, to: TrackSample) {
        const first = this.nextSegment * verticesPerSegment;
        this.writeRow(first, from);
        this.writeRow(first + lanes.length, to);
        for (const attribute of [this.positions, this.colors, this.normals]) {
            attribute.addUpdateRange(first * attribute.itemSize, verticesPerSegment * attribute.itemSize);
            attribute.needsUpdate = true;
        }
        this.nextSegment = (this.nextSegment + 1) % capacity;
        this.segmentCount = Math.min(capacity, this.segmentCount + 1);
        this.mesh.geometry.setDrawRange(0, this.segmentCount * indicesPerSegment);
    }

    private writeRow(first: number, sample: TrackSample) {
        const powder = T.MathUtils.smoothstep(sample.depth, .05, .45);
        const slip = Math.abs(Math.sin(sample.skidAngle));
        const edge = T.MathUtils.smoothstep(Math.abs(sample.edgeAngle), .045, .48);
        // In powder the board leaves a trench wider than the board (snow pushed aside), shaded blue inside, with bright lips.
        const halfWidth = BOARD_WAIST_M / 2 + .2 * powder + .36 * slip;
        const sideX = Math.cos(sample.heading), sideD = -Math.sin(sample.heading);
        const chatter = .93 + Math.sin(sample.d * 9.4 + sample.x * 12.7) * .07;

        for (const [i, lane] of lanes.entries()) {
            const offset = lane * halfWidth;
            const x = sample.x + sideX * offset, d = sample.d + sideD * offset;
            const y = this.surface(x, d);
            const dx = (this.surface(x + .12, d) - this.surface(x - .12, d)) / .24;
            const dd = (this.surface(x, d + .12) - this.surface(x, d - .12)) / .24;
            const length = Math.hypot(dx, 1, dd);
            const isLip = Math.abs(lane) === .81 || Math.abs(lane) === 1;
            this.positions.setXYZ(first + i, x, y + .017 + .009 * powder + (isLip ? .045 * powder : 0), -d);
            const onEdge = lane * sample.edgeAngle > 0 ? edge : edge * .25;
            // The trench walls face the middle of the track and the lips face outward, so the sun shades them like a
            // groove in the snow (the strip itself is thin; the depth is in the lighting).
            const wall = Math.abs(lane) === .61 ? -(.9 * powder + .55 * onEdge) : Math.abs(lane) === .81 ? .6 * powder : 0, sgn = Math.sign(lane);
            const nx = -dx / length + sgn * wall * sideX, ny = 1 / length, nz = dd / length - sgn * wall * sideD, nl = Math.hypot(nx, ny, nz);
            this.normals.setXYZ(first + i, nx / nl, ny / nl, nz / nl);

            const cutProfile = Math.abs(lane) === .61 ? .46 + .54 * onEdge : .17;
            const isRim = Math.abs(lane) === .81;
            const alpha = Math.abs(lane) === 1 ? 0 : isRim
                ? powder * (.3 + .2 * onEdge)
                : (.17 + .2 * powder + .13 * cutProfile + .08 * slip) * chatter;
            this.tint.copy(compacted).lerp(isRim ? powderLip : cut, isRim ? powder : cutProfile);
            if (!isRim) this.tint.lerp(trench, powder * .5);
            this.colors.setXYZW(first + i, this.tint.r, this.tint.g, this.tint.b, alpha);
        }
    }
}
