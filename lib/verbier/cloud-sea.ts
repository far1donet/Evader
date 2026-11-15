import * as T from 'three';

/**
 * Valley cloud sea: in clear winter weather, temperature inversions often fill the Rhône valley and its side valleys with
 * a flat sea of cloud while the ski area above is in sunshine. Drawn as a soft, slowly drifting layer at a fixed altitude
 * below the lowest station of the network (top at 1,250 m by default). Atmospheric dressing only: nothing collides with it.
 */
export function makeCloudSea(centre: T.Vector3, top = 1250, size = 26000) {
    const material = new T.ShaderMaterial({
        transparent: true, depthWrite: false, fog: true,
        uniforms: { ...T.UniformsUtils.clone(T.UniformsLib.fog), time: { value: 0 }, sunDirection: { value: new T.Vector3(-.6, .45, -.36).normalize() } },
        vertexShader: `
            #include <fog_pars_vertex>
            varying vec2 seaXZ;
            varying float seaEdge;
            void main() {
                vec4 world = modelMatrix * vec4(position, 1.);
                seaXZ = world.xz;
                seaEdge = length(position.xy) / ${(size / 2).toFixed(1)};
                vec4 mvPosition = viewMatrix * world;
                gl_Position = projectionMatrix * mvPosition;
                #include <fog_vertex>
            }`,
        fragmentShader: `
            #include <fog_pars_fragment>
            uniform float time;
            uniform vec3 sunDirection;
            varying vec2 seaXZ;
            varying float seaEdge;
            float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
                return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
            float fbm(vec2 p) { float v = 0., a = .5; for (int k = 0; k < 5; k++) { v += a * n(p); p = p * 2.03 + 7.1; a *= .5; } return v; }
            void main() {
                vec2 p = seaXZ / 1400. + vec2(time * .004, time * .0017);
                float billow = fbm(p), detail = fbm(p * 3.7 - time * .01);
                float cover = smoothstep(.28, .62, billow * .75 + detail * .35);
                float alpha = cover * (1. - smoothstep(.72, 1., seaEdge)) * .96;
                if (alpha < .01) discard;
                // tops lit by the low sun, hollows between billows in blue shade
                float lit = .78 + .3 * smoothstep(.35, .8, detail) + .08 * max(0., sunDirection.y);
                vec3 colour = mix(vec3(.70, .78, .90), vec3(1.0, 1.0, 1.0), clamp(lit - .2, 0., 1.)) * lit;
                gl_FragColor = vec4(colour, alpha);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
                #include <fog_fragment>
            }`,
    });
    const mesh = new T.Mesh(new T.CircleGeometry(size / 2, 96), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(centre.x, top, centre.z);
    mesh.renderOrder = 3;
    mesh.name = 'cloud-sea';
    mesh.frustumCulled = false;
    return mesh;
}
