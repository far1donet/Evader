import * as T from 'three';

export type ParkRail = {
    x: number;
    d: number;
    end: number;
    width: number;
    top: number;
    slope: number;
    name: string;
    mesh: T.Group;
};

export function boardAcrossRail(angle: number) {
    return Math.abs(Math.sin(angle)) > Math.SQRT1_2;
}

const styles = [
    { name: 'WIDE BOX', length: 6, width: .94, depth: .21, clearance: .37, extraGrade: 0, round: false, color: 0xca443a },
    { name: 'LONG TUBE', length: 17, width: .28, depth: .28, clearance: .62, extraGrade: 0, round: true, color: 0xa9c4d1 },
    { name: 'DOWN RAIL', length: 10, width: .34, depth: .25, clearance: .35, extraGrade: -.055, round: false, color: 0x2cc4be },
    { name: 'FLAT BOX', length: 11.5, width: .65, depth: .24, clearance: .51, extraGrade: .035, round: false, color: 0xe69a52 },
];

export function railTop(rail: ParkRail, d: number) {
    return rail.top + (d - rail.d) * rail.slope;
}

export function railRideHeight(rail: ParkRail, d: number) {
    // The board's base is 5.5 cm above the articulated rider's root.
    return railTop(rail, d) - .055 * Math.hypot(1, rail.slope);
}

export function crossesRail(
    rail: ParkRail,
    start: { x: number; d: number; y: number },
    end: { x: number; d: number; y: number },
    dt: number,
) {
    if (end.d < rail.d || end.d > rail.end) return false;
    const above = start.y - railRideHeight(rail, start.d);
    const below = end.y - railRideHeight(rail, end.d);
    const drop = above - below;
    if (above < 0 || below > 0 || drop <= 0 || drop > 7 * dt * Math.hypot(1, rail.slope)) return false;
    const t = above / drop;
    const d = T.MathUtils.lerp(start.d, end.d, t);
    const x = T.MathUtils.lerp(start.x, end.x, t);
    return d >= rail.d && Math.abs(x - rail.x) <= rail.width / 2 + .14;
}

export function makeParkRails(
    course: { id: number; length: number; rails: number; classicFeatures?: boolean },
    center: (d: number) => number,
    height: (x: number, d: number) => number,
    support: T.Material,
): ParkRail[] {
    if (!course.rails) return [];
    const materials = course.classicFeatures
        ? [new T.MeshStandardMaterial({ color: course.id === 1 ? 0x21aba4 : 0xadc6d8, metalness: .42, roughness: .29 })]
        : styles.slice(0, course.rails).map(style =>
            new T.MeshStandardMaterial({ color: style.color, roughness: .27, metalness: .57 }),
        );
    return Array.from({ length: course.rails }, (_, index) => {
        const side = index % 2 === 0 ? 1 : -1;
        const d = 160 + index * (course.length - 300) / Math.max(1, course.rails - 1);
        const x = center(d) + side * (course.classicFeatures ? 10 : 20);
        const mesh = new T.Group();
        const addMesh = (geometry: T.BufferGeometry, material: T.Material, y: number, z: number) => {
            const part = new T.Mesh(geometry, material);
            part.position.set(x, y, -z);
            part.castShadow = true;
            part.receiveShadow = true;
            mesh.add(part);
            return part;
        };
        if (course.classicFeatures) {
            const y = height(x, d);
            const deck = addMesh(new T.BoxGeometry(.38, .28, 15), materials[0], y + .75, d + 7.5);
            deck.rotation.x = -Math.atan(.26);
            for (const z of [d, d + 7.5, d + 15])
                addMesh(new T.BoxGeometry(.16, .85, .16), support, height(x, z) + .36, z);
            return { x, d, end: d + 15, width: .38, top: y + .89 + 7.5 * .26, slope: -.26, name: '50–50', mesh };
        }

        const style = styles[index % styles.length];
        const end = d + style.length;
        const base = height(x, d);
        const slope = (height(x, end) - base) / style.length + style.extraGrade;
        let top = base + style.clearance;
        // A straight deck must stay above even the highest snow between its posts.
        for (let offset = 1; offset <= style.length; offset++)
            top = Math.max(top, height(x, d + offset) + style.clearance - offset * slope);
        top = Math.max(top, height(x, end) + style.clearance - style.length * slope);
        const rail = { x, d, end, width: style.width, top, slope, name: style.name, mesh };
        const geometry = style.round
            ? new T.CylinderGeometry(style.width / 2, style.width / 2, style.length, 16).rotateX(Math.PI / 2)
            : new T.BoxGeometry(style.width, style.depth, style.length);
        const vertices = geometry.attributes.position;
        for (let vertex = 0; vertex < vertices.count; vertex++)
            vertices.setY(vertex, vertices.getY(vertex) - vertices.getZ(vertex) * slope);
        geometry.computeVertexNormals();
        const middle = (d + end) / 2;
        addMesh(geometry, materials[index % styles.length], railTop(rail, middle) - style.depth / 2, middle);

        const posts = Math.max(2, Math.ceil(style.length / 5) + 1);
        for (let i = 0; i < posts; i++) {
            const z = T.MathUtils.lerp(d + .4, end - .4, i / (posts - 1));
            const foot = height(x, z) - .08;
            const cap = railTop(rail, z) - style.depth + .045;
            const width = style.round ? .15 : style.width * .65;
            addMesh(new T.BoxGeometry(width, cap - foot, .23), support, (foot + cap) / 2, z);
        }
        return rail;
    });
}
