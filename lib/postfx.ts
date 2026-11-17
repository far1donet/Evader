import * as T from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';

/**
 * High-end image pipeline for strong GPUs (High: haze, bloom, grade; Ultra and Extreme: + ambient occlusion; Cinematic: more samples). Standard real-time techniques, tuned
 * for bright alpine snow:
 *  1. the scene into a 4x multisampled half-float buffer with depth;
 *  2. atmosphere: height-dependent haze integrated along each view ray (thick in the valleys, thin on the summits), aerial
 *     perspective toward the horizon colour, and sunlight scattered forward in the haze around the sun;
 *  3. ground-truth ambient occlusion (GTAO): contact shading where boots, trees, buildings and towers meet the snow;
 *  4. bloom on true highlights only (the sun, ice glints, hot specular), never on the snowfield itself;
 *  5. filmic tone mapping (the renderer's: ACES at a high-key exposure);
 *  6. a display-space grade: a gentle S-curve, cool-blue lift in the shadows, warm highlights, slight vignette.
 * Nothing here changes the simulation; all of it can be switched off by choosing High or below.
 */
export type PostLevel = 'high' | 'ultra' | 'cinematic';
export type Atmosphere = { color: T.Color; sun: T.Vector3; sunColor: T.Color; density: number; base: number; falloff: number; max: number };

const AtmosphereShader = {
    uniforms: {
        tDiffuse: { value: null as T.Texture | null }, tDepth: { value: null as T.Texture | null },
        projInv: { value: new T.Matrix4() }, camWorld: { value: new T.Matrix4() }, camPos: { value: new T.Vector3() },
        fogColor: { value: new T.Color() }, sunDir: { value: new T.Vector3(0, 1, 0) }, sunColor: { value: new T.Color() },
        density: { value: .0005 }, base: { value: 1500 }, falloff: { value: 1 / 650 }, maxFog: { value: .93 },
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
        uniform sampler2D tDiffuse, tDepth; uniform mat4 projInv, camWorld; uniform vec3 camPos, fogColor, sunDir, sunColor;
        uniform float density, base, falloff, maxFog; varying vec2 vUv;
        void main() {
            vec4 col = texture2D(tDiffuse, vUv);
            float depth = texture2D(tDepth, vUv).x;
            if (depth >= .99999) { gl_FragColor = col; return; }                  // the sky has its own haze
            vec4 v = projInv * vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0); v /= v.w;
            vec3 wp = (camWorld * v).xyz, ray = wp - camPos;
            float dist = length(ray); vec3 dir = ray / dist;
            // optical depth of an exponential height fog along the ray: integral of density * exp(-falloff (y - base))
            float h0 = camPos.y - base, dy = ray.y * falloff;
            float shape = abs(dy) > 1e-4 ? (1.0 - exp(-dy)) / dy : 1.0 - .5 * dy;
            float optical = density * exp(-falloff * h0) * shape * dist;
            float fog = min(maxFog, 1.0 - exp(-optical));
            // forward scattering: the haze glows toward the sun
            float cs = max(dot(dir, sunDir), 0.0);
            vec3 haze = fogColor + sunColor * (.45 * pow(cs, 6.0) + .75 * pow(cs, 48.0));
            gl_FragColor = vec4(mix(col.rgb, haze, fog), col.a);
        }`,
};
class AtmospherePass extends Pass {
    material = new T.ShaderMaterial({ ...AtmosphereShader, uniforms: T.UniformsUtils.clone(AtmosphereShader.uniforms), depthTest: false, depthWrite: false });
    quad = new FullScreenQuad(this.material);
    camera: T.PerspectiveCamera;
    constructor(camera: T.PerspectiveCamera) { super(); this.camera = camera; }
    render(renderer: T.WebGLRenderer, writeBuffer: T.WebGLRenderTarget, readBuffer: T.WebGLRenderTarget) {
        const u = this.material.uniforms;
        u.tDiffuse.value = readBuffer.texture; u.tDepth.value = readBuffer.depthTexture;
        u.projInv.value.copy(this.camera.projectionMatrixInverse); u.camWorld.value.copy(this.camera.matrixWorld);
        u.camPos.value.setFromMatrixPosition(this.camera.matrixWorld);
        renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); this.quad.render(renderer);
    }
    dispose() { this.material.dispose(); this.quad.dispose(); }
}
const GradeShader = {
    uniforms: { tDiffuse: { value: null as T.Texture | null }, vignette: { value: .14 }, contrast: { value: .12 }, saturation: { value: 1.08 }, coolShadows: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
        uniform sampler2D tDiffuse; uniform float vignette, contrast, saturation, coolShadows; varying vec2 vUv;
        void main() {
            vec3 c = texture2D(tDiffuse, vUv).rgb;                               // display-referred (after tone mapping)
            float l = dot(c, vec3(.2126, .7152, .0722));
            c = mix(vec3(l), c, saturation);
            c = c + contrast * (c - c * c) * (2.0 * c - 1.0) * 2.0;                // gentle S-curve around mid-grey
            float sh = (1.0 - smoothstep(.15, .7, l)) * coolShadows;
            c += sh * vec3(-.018, .004, .045);                                    // cool, blue shadows on snow
            c += smoothstep(.7, 1.0, l) * vec3(.012, .006, -.01);                 // faintly warm sunlit highlights
            vec2 q = vUv - .5; c *= 1.0 - vignette * smoothstep(.25, .85, dot(q, q) * 2.2);
            gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
        }`,
};

export class PostFX {
    readonly composer: EffectComposer;
    readonly level: PostLevel;
    private atmosphere: AtmospherePass;
    private gtao?: GTAOPass;
    private bloom: UnrealBloomPass;
    private grade: ShaderPass;
    private renderer: T.WebGLRenderer;
    constructor(renderer: T.WebGLRenderer, scene: T.Scene, camera: T.PerspectiveCamera, level: PostLevel) {
        this.renderer = renderer; this.level = level;
        const size = renderer.getDrawingBufferSize(new T.Vector2());
        const target = new T.WebGLRenderTarget(size.x, size.y, { type: T.HalfFloatType, samples: level === 'cinematic' ? 8 : 4 });
        target.depthTexture = new T.DepthTexture(size.x, size.y); target.depthTexture.type = T.FloatType;
        this.composer = new EffectComposer(renderer, target);
        this.composer.addPass(new RenderPass(scene, camera));
        this.atmosphere = new AtmospherePass(camera); this.composer.addPass(this.atmosphere);
        if (level !== 'high') {
            const gt = new GTAOPass(scene, camera, size.x, size.y);
            gt.blendIntensity = .85;
            gt.updateGtaoMaterial({ radius: 1.4, distanceExponent: 2, thickness: 1.5, scale: 1, distanceFallOff: 1, samples: level === 'cinematic' ? 24 : 12 });
            gt.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: level === 'cinematic' ? 16 : 8 });
            this.gtao = gt; this.composer.addPass(gt);
        }
        // threshold well above sunlit snow (about 2.3 in linear light): only the sun, glints and hot specular bloom
        this.bloom = new UnrealBloomPass(new T.Vector2(size.x, size.y), .22, .5, 2.8);
        this.composer.addPass(this.bloom);
        this.composer.addPass(new OutputPass());
        this.grade = new ShaderPass(GradeShader); this.composer.addPass(this.grade);
    }
    /** Haze and sun for the current weather (colours in linear RGB, as THREE.Color stores them). */
    setAtmosphere(a: Atmosphere) {
        const u = this.atmosphere.material.uniforms;
        u.fogColor.value.copy(a.color); u.sunDir.value.copy(a.sun).normalize(); u.sunColor.value.copy(a.sunColor);
        u.density.value = a.density; u.base.value = a.base; u.falloff.value = a.falloff; u.maxFog.value = a.max;
    }
    setGrade(o: { vignette?: number; contrast?: number; saturation?: number; coolShadows?: number }) {
        const u = this.grade.material.uniforms;
        for (const [k, v] of Object.entries(o)) if (v !== undefined && u[k]) u[k].value = v;
    }
    setSize(width: number, height: number, pixelRatio: number) {
        this.composer.setPixelRatio(pixelRatio); this.composer.setSize(width, height);
    }
    render(dt: number) { this.composer.render(dt); }
    dispose() { this.atmosphere.dispose(); this.gtao?.dispose(); this.bloom.dispose(); this.composer.dispose(); }
}
/** Which presets get the pipeline, and at what level. */
export function postLevel(quality: string): PostLevel | null {
    return quality === 'high' ? 'high' : quality === 'ultra' || quality === 'extreme' ? 'ultra' : quality === 'cinematic' ? 'cinematic' : null;
}
