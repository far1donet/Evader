import * as T from 'three';
/** Rendering presets never change simulation geometry or the physics timestep. */
export const PRESETS = {
 // shadowRange: half-width of the sun's shadow box around the rider, m (bigger maps cover more ground at similar sharpness)
 low: { pixel: 1, shadow: 1024, step: 3, trees: 300, ridge: 64, shadowRange: 92 },
 balanced: { pixel: 1.25, shadow: 2048, step: 2, trees: 600, ridge: 96, shadowRange: 100 },
 high: { pixel: 1.75, shadow: 2048, step: 1.5, trees: 1000, ridge: 128, shadowRange: 120 },
 ultra: { pixel: 2, shadow: 4096, step: 1, trees: 1800, ridge: 192, shadowRange: 180 },
 extreme: { pixel: 2.5, shadow: 4096, step: .75, trees: 2600, ridge: 216, shadowRange: 220 },
 // Image quality first: 8K shadow map (about 256 MB of depth), half-metre terrain rows, the densest forest.
 cinematic: { pixel: 3, shadow: 8192, step: .5, trees: 3600, ridge: 256, shadowRange: 300 },
};
export const preset = (q: string) => PRESETS[q as keyof typeof PRESETS] ?? PRESETS.high;
export const GRAVITY = 9.81;
export function groundAcceleration(slope: number, speed: number, tuck: boolean, brakeGrip: number, edge: number, powder: number) {
 // Horizontal component of gravity projected onto the path tangent. Air drag
 // uses a reference 80 kg rider; tuck lowers CdA instead of adding engine thrust.
 const normal = GRAVITY / Math.sqrt(1 + slope * slope);
 const friction = (.025 + .081 * powder) * normal;
 const drag = .5 * 1.0 * (tuck ? .28 : .62) / 80 * speed * speed;
 const plowing = powder * speed * (.035 + Math.abs(edge) * .024);
 return -GRAVITY * slope / (1 + slope * slope) - friction - drag - plowing - Math.abs(edge) * .28 - normal * brakeGrip;
}
export function snowMaterial(length: number, spacing: number, park: boolean, detail: boolean) {
 const material = new T.MeshStandardMaterial({ vertexColors: true, roughness: .79, metalness: 0, envMapIntensity: .55 });
 material.onBeforeCompile = shader => {
  shader.uniforms.courseLength = { value: length };
  shader.uniforms.jumpSpacing = { value: spacing };
  shader.uniforms.parkDye = { value: park ? .62 : .34 };
  shader.vertexShader = 'attribute vec2 pisteCenters; attribute vec3 kickerPaint; attribute float snowDepth; varying vec2 alpineCenters; varying vec3 alpinePosition, jumpPaint; varying float alpineDepth;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nalpinePosition = position; alpineCenters = pisteCenters; jumpPaint = kickerPaint; alpineDepth = snowDepth;');
  shader.fragmentShader = 'varying vec2 alpineCenters; varying vec3 alpinePosition, jumpPaint; varying float alpineDepth; uniform float courseLength, jumpSpacing, parkDye;\n' + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
   vec2 snowXY = vec2(alpinePosition.x, -alpinePosition.z);
   float offset = abs(snowXY.x - alpineCenters.x);
   float powder = smoothstep(.065, .43, alpineDepth);
   float piste = (1.0 - smoothstep(17.0, 23.0, offset)) * (1.0 - powder);
   float footprint = length(fwidth(snowXY));
   float nearDetail = 1.0 - smoothstep(.025, .13, footprint);
   float windPhase = snowXY.x * 1.16 - snowXY.y * .29 + 1.45 * sin(snowXY.y * .20 + snowXY.x * .09);
   float drift = sin(windPhase) * (.58 + .42 * sin(snowXY.y * .41 + snowXY.x * .31));
   float smallerDrift = sin(windPhase * 2.31 + sin(snowXY.x * .58)) * sin(snowXY.y * 1.27);
   float grain = sin(snowXY.x * 88.0 + snowXY.y * 35.0) * sin(snowXY.y * 97.0 - snowXY.x * 53.0);
   // Groomed corduroy: ~4.5 cm tiller ridges along the fall line, in ~4.2 m groomer passes with a slight seam ridge.
   // Fades out before it can alias (it is far finer than a pixel beyond a few metres).
   float cordDetail = 1.0 - smoothstep(.006, .03, footprint);
   float passX = snowXY.x + sin(snowXY.y * .045) * 1.6;
   float groom = cos(passX * 139.6 + sin(snowXY.y * .5) * .18);
   float seam = 1.0 - smoothstep(.0, .22, abs(fract(passX / 4.2) - .5) * 4.2 - 1.88);
   float snowRelief = (.008 + .058 * powder) * drift + smallerDrift * powder * .019
      + .0011 * grain * nearDetail + (.0016 * groom * cordDetail + .006 * seam * nearDetail) * piste;
   diffuseColor.rgb *= .99 + powder * (.044 * drift + .018 * smallerDrift)
      + nearDetail * .017 * grain + piste * (.03 * groom * cordDetail - .018 * seam * nearDetail);
   diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(.93, .97, 1.04), piste * cordDetail * (.5 - .5 * groom) * .5);
   float jumpBase = snowXY.y - mod(snowXY.y - 100.0, jumpSpacing);
   float jumpD = snowXY.y - jumpBase;
   float jumpOffset = abs(snowXY.x - alpineCenters.y);
   float dyeWidth = max(.075, footprint * .7);
   float lip = (1.0 - smoothstep(.08, dyeWidth + .19, abs(jumpD - (jumpPaint.x - .32))))
       * (1.0 - smoothstep(jumpPaint.y - .5, jumpPaint.y + .3, jumpOffset));
   float edgeMark = (1.0 - smoothstep(.09, dyeWidth + .18, abs(jumpOffset - (jumpPaint.y + .4))))
       * smoothstep(5.0, 7.0, jumpD) * (1.0 - smoothstep(jumpPaint.z + 6.0, jumpPaint.z + 10.0, jumpD));
   float dye = max(lip, edgeMark) * parkDye * step(0.0, jumpPaint.x)
       * step(100.0, jumpBase) * step(jumpBase, courseLength - 50.0);
   diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.76, .065, .22), dye);
  `);
  shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
   roughnessFactor = mix(roughnessFactor, .94, powder);
  `);
  // Snow sparkle: individual ice crystals catching the sun. A crystal glints only for one viewing direction, so the
  // glints twinkle as the camera moves; close range only.
  shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
   vec2 crystal = floor(alpinePosition.xz * 55.0);
   vec3 viewQ = floor(normalize(vViewPosition) * 9.0);
   float glintSeed = fract(sin(dot(crystal, vec2(12.9898, 78.233)) + dot(viewQ, vec3(3.1, 5.7, 1.9))) * 43758.5453);
   float glint = smoothstep(.9965, 1.0, glintSeed) * (1.0 - smoothstep(.004, .02, length(fwidth(alpinePosition.xz))));
   totalEmissiveRadiance += vec3(1.0, .98, .95) * glint * 2.2;
  `);
  if (detail) shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
   vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
   vec3 bx = cross(sy, normal), by = cross(normal, sx);
   float det = dot(sx, bx);
   vec3 gradient = sign(det) * (dFdx(snowRelief) * bx + dFdy(snowRelief) * by);
   normal = normalize(max(abs(det), 1e-9) * normal - gradient);
  `);
 };
 material.customProgramCacheKey = () => detail ? 'alpine-snow-relief-2' : 'alpine-snow-color-2';
 return material;
}
export function makeAlpineSky() {
 const material = new T.ShaderMaterial({
  side: T.BackSide,
  depthWrite: false,
  uniforms: {
   zenith: { value: new T.Color(0x4985be) },
   horizon: { value: new T.Color(0xd8e8f4) },
   sunDirection: { value: new T.Vector3() },
   clouds: { value: .58 },
   sunStrength: { value: 1 },
  },
  vertexShader: `
   varying vec3 skyRay;
   void main() {
    skyRay = position;
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = clip.xyww;
   }
  `,
  fragmentShader: `
   varying vec3 skyRay;
   uniform vec3 zenith, horizon, sunDirection;
   uniform float clouds, sunStrength;
   float skyHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
   }
   float skyNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f*f*(3.0-2.0*f);
    return mix(mix(skyHash(i), skyHash(i + vec2(1,0)), f.x),
      mix(skyHash(i + vec2(0,1)), skyHash(i + vec2(1,1)), f.x), f.y);
   }
   void main() {
    vec3 ray = normalize(skyRay);
    vec3 light = normalize(sunDirection);
    float angle = max(0.0, dot(ray, light));
    vec3 air = mix(horizon, zenith, pow(smoothstep(-.09, .85, ray.y), .62));
    vec2 cloudUV = ray.xz / (max(ray.y, 0.0) + .23) * vec2(2.5, 3.4);
    float vapor = skyNoise(cloudUV) * .58 + skyNoise(cloudUV * 2.13 + 8.2) * .26
      + skyNoise(cloudUV * 4.71) * .11 + skyNoise(cloudUV * 9.67 - 4.0) * .05;
    float cover = smoothstep(clouds - .16, clouds + .14, vapor) * smoothstep(.01, .16, ray.y);
    vec3 litCloud = mix(vec3(.67,.77,.91), vec3(1.14,1.19,1.24), smoothstep(.43,.72,vapor));
    air = mix(air, litCloud, cover * .85);
    air += sunStrength * (pow(angle, 4.0) * .07 + pow(angle, 16.0) * .2 + pow(angle, 180.0) * .75
      + smoothstep(.99975,.99994,angle) * (1.0-cover) * 5.0) * vec3(1.0,.88,.70);
    gl_FragColor = vec4(air, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
   }
  `,
 });
 const sky = new T.Mesh(new T.SphereGeometry(1, 24, 16), material);
 sky.scale.setScalar(3200);
 sky.frustumCulled = false;
 sky.renderOrder = 100;
 return sky;
}
export function ridgeHeight(x: number, d: number) {
 let n = 0, amplitude = 1, frequency = .003;
 for(let i=0;i<5;i++) {
  n += amplitude * Math.abs(Math.sin(x*frequency + Math.sin(d*frequency*.73))*Math.cos(d*frequency*1.13));
  frequency *= 2.07; amplitude *= .48;
 }
 return n;
}
