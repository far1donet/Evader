import * as T from 'three';

/**
 * Wind on the rider's clothes. The relative air flow is the rider's own motion through the air plus a light breeze; it
 * blows loose fabric downwind (the jacket's back and hem, the lower legs of baggy trousers, the sleeve ends) and makes it
 * flutter in ripples that run along the garment, faster and wider with speed, as fabric does at 30-80 km/h.
 *
 * Done in the vertex shader (no simulation cost). Each garment carries a `clothLoose` attribute, 0 where the fabric is
 * held (shoulders, waistband, cuffs) to 1 where it hangs free. Shapes and rigging are untouched, so the physics and the
 * poses are the same; only the drawn surface moves. Shadows use the undisplaced shape.
 */
export const clothWind = {
    windView: { value: new T.Vector3(0, 0, -1) },
    windSpeed: { value: 0 },
    clothTime: { value: 0 },
};

const GLSL = `
{
    float loose = clothLoose;
    if (loose > 0.0) {
        float s = clamp(windSpeed / 18.0, 0.0, 1.5);
        vec3 nV = normalize(normalMatrix * objectNormal);
        vec3 wDir = windSpeed > 0.01 ? normalize(windView) : vec3(0.0);
        float facing = dot(nV, wDir);                       // > 0: leeward side (fabric lifts off), < 0: windward (pressed)
        float stream = loose * (0.01 + 0.055 * s * s);      // blown downwind
        float freq = 6.5 + 1.5 * windSpeed;                 // flutter rate rises with air speed
        float phase = clothTime * freq - dot(position, vec3(11.0, 17.0, 9.0));
        float flap = sin(phase) * 0.62 + sin(phase * 2.31 + 1.7) * 0.28 + sin(phase * 0.47 + 4.1) * 0.25;
        float amp = loose * (0.003 + 0.024 * s) * (0.55 + 0.45 * max(0.0, facing));
        mvPosition.xyz += wDir * stream + nV * (flap * amp - max(0.0, -facing) * stream * 0.35);
    }
}
gl_Position = projectionMatrix * mvPosition;
`;

/** Make a garment material react to the wind (keeps any onBeforeCompile already set). */
export function windy<M extends T.Material>(material: M): M {
    const previous = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
        previous?.call(material, shader, renderer);
        shader.uniforms.windView = clothWind.windView; shader.uniforms.windSpeed = clothWind.windSpeed; shader.uniforms.clothTime = clothWind.clothTime;
        shader.vertexShader = 'attribute float clothLoose;\nuniform vec3 windView;\nuniform float windSpeed;\nuniform float clothTime;\n'
            + shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + GLSL);
    };
    const key = material.customProgramCacheKey?.bind(material);
    material.customProgramCacheKey = () => (key ? key() : '') + '|cloth-wind';
    material.needsUpdate = true;
    return material;
}

/** Looseness per vertex from a function of the vertex index. */
export function setLooseness(geometry: T.BufferGeometry, f: (i: number) => number) {
    const n = geometry.attributes.position.count, a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = Math.min(1, Math.max(0, f(i)));
    geometry.setAttribute('clothLoose', new T.BufferAttribute(a, 1));
}

const air = new T.Vector3(), gust = new T.Vector3();
/**
 * Per frame: `velocity` is the rider's velocity (world, m/s). Adds a light, gusting breeze from the north-west so the
 * clothes still move a little when standing still.
 */
export function updateClothWind(velocity: T.Vector3, camera: T.Camera, time: number) {
    const g = .6 + .4 * Math.sin(time * .7) * Math.sin(time * .23 + 1.3);
    gust.set(1.6, 0, 1.1).multiplyScalar(g);
    air.copy(velocity).multiplyScalar(-1).add(gust);
    clothWind.windSpeed.value = air.length();
    camera.updateMatrixWorld();
    clothWind.windView.value.copy(air).transformDirection(camera.matrixWorldInverse);
    clothWind.clothTime.value = time;
}
