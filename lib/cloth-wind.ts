import * as T from 'three';

/**
 * Wind on the rider's clothes. The relative air flow is the rider's own motion through the air plus a light breeze; it
 * blows loose fabric downwind (the jacket's back and hem, the lower legs of baggy trousers, the sleeve ends) and makes it
 * flutter in ripples that run along the garment, faster and wider with speed, as fabric does at 30-80 km/h.
 *
 * Done in the vertex shader, in world space, for the drawn garment AND its shadow (a matching depth material), so the
 * shadow moves with the fabric. Each garment carries a `clothLoose` attribute, 0 where the fabric is held (shoulders,
 * waistband, cuffs) to 1 where it hangs free. Fabric facing the wind is pressed flat rather than pushed in, and nothing is
 * displaced downward, so hems cannot sink into the board. Shapes and rigging are untouched: physics and poses are the same.
 */
export const clothWind = {
    windWorld: { value: new T.Vector3(0, 0, -1) },
    windSpeed: { value: 0 },
    clothTime: { value: 0 },
};
const HEAD = 'attribute float clothLoose;\nuniform vec3 windWorld;\nuniform float windSpeed;\nuniform float clothTime;\n';
const displacement = (withNormal: boolean) => `
    float s = clamp(windSpeed / 18.0, 0.0, 1.5);
    vec3 wDir = windSpeed > 0.01 ? normalize(windWorld) : vec3(0.0);
    ${withNormal ? 'vec3 nW = normalize(mat3(modelMatrix) * objectNormal); float facing = dot(nW, wDir);' : 'vec3 nW = wDir; float facing = 0.5;'}
    float freq = 6.5 + 1.5 * windSpeed;
    float phase = clothTime * freq - dot(position, vec3(11.0, 17.0, 9.0));
    float flap = sin(phase) * 0.62 + sin(phase * 2.31 + 1.7) * 0.28 + sin(phase * 0.47 + 4.1) * 0.25;
    // leeward fabric lifts off and streams; windward fabric is pressed flat (moves less)
    float stream = loose * (0.01 + 0.055 * s * s) * (0.35 + 0.65 * max(0.0, facing));
    float amp = loose * (0.003 + 0.024 * s) * (0.55 + 0.45 * max(0.0, facing));
    vec3 disp = wDir * stream + nW * flap * amp;
    disp.y = max(disp.y, 0.0);                              // never pushed down (hems stay above the board)
`;
const GLSL = (withNormal: boolean) => `
{
    float loose = clothLoose;
    if (loose > 0.0) {
        ${displacement(withNormal)}
        vec4 wp = modelMatrix * vec4(transformed, 1.0);
        wp.xyz += disp;
        mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
    }
}
`;
function patch(material: T.Material, withNormal: boolean, tag: string) {
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
        previous?.call(material, shader, renderer);
        shader.uniforms.windWorld = clothWind.windWorld; shader.uniforms.windSpeed = clothWind.windSpeed; shader.uniforms.clothTime = clothWind.clothTime;
        shader.vertexShader = HEAD + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + GLSL(withNormal));
    };
    const key = material.customProgramCacheKey?.bind(material);
    material.customProgramCacheKey = () => (key ? key() : '') + tag;
    material.needsUpdate = true;
    return material;
}
/** Make a garment material react to the wind (keeps any onBeforeCompile already set). */
export function windy<M extends T.Material>(material: M): M { return patch(material, true, '|cloth-wind') as M; }
/** Shadow depth material that moves like the garment (assign as mesh.customDepthMaterial). */
let depth: T.MeshDepthMaterial | undefined;
export function windyDepth() { return depth ??= patch(new T.MeshDepthMaterial({ depthPacking: T.RGBADepthPacking }), false, '|cloth-wind-depth') as T.MeshDepthMaterial; }

/** Looseness per vertex from a function of the vertex index. */
export function setLooseness(geometry: T.BufferGeometry, f: (i: number) => number) {
    const n = geometry.attributes.position.count, a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = Math.min(1, Math.max(0, f(i)));
    geometry.setAttribute('clothLoose', new T.BufferAttribute(a, 1));
}

const air = new T.Vector3(), gust = new T.Vector3();
/** Per frame: `velocity` is the rider's velocity (world, m/s). Adds a light, gusting breeze from the north-west. */
export function updateClothWind(velocity: T.Vector3, _camera: T.Camera, time: number) {
    const g = .6 + .4 * Math.sin(time * .7) * Math.sin(time * .23 + 1.3);
    gust.set(1.6, 0, 1.1).multiplyScalar(g);
    air.copy(velocity).multiplyScalar(-1).add(gust);
    clothWind.windSpeed.value = air.length();
    clothWind.windWorld.value.copy(air).normalize();
    clothWind.clothTime.value = time;
}
