import * as T from 'three';
import { GRAVITY } from './alpine.ts';

const budgets: Record<string, { capacity: number; rate: number }> = {
    low: { capacity: 260, rate: 150 },
    balanced: { capacity: 560, rate: 300 },
    high: { capacity: 1100, rate: 560 },
    ultra: { capacity: 1800, rate: 860 },
    extreme: { capacity: 2600, rate: 1200 },
    cinematic: { capacity: 3600, rate: 1600 },
};
const clamp = T.MathUtils.clamp;
const lerp = T.MathUtils.lerp;
const smoothstep = T.MathUtils.smoothstep;

type SprayContact = {
    x: number;
    y: number;
    z: number;
    heading: number;
    speed: number;
    edge: number;
    skid: number;
    depth: number;
    landing: number;
    slopeX: number;
    slopeZ: number;
    grounded: boolean;
};

function sprayMaterial() {
    return new T.ShaderMaterial({
        uniforms: { ...T.UniformsUtils.clone(T.UniformsLib.fog), pixelScale: { value: 360 }, sunDirection: { value: new T.Vector3(-.6, .45, -.36).normalize() } },
        transparent: true,
        depthWrite: false,
        fog: true,
        vertexShader: `
            #include <fog_pars_vertex>
            uniform float pixelScale;
            uniform vec3 sunDirection;
            attribute vec4 particleStyle;
            varying vec3 sprayStyle;
            varying float sunScatter;
            void main() {
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.);
                // Forward scattering: snow dust glows when the camera looks toward the sun through it.
                vec3 sunView = normalize((viewMatrix * vec4(sunDirection, 0.)).xyz);
                sunScatter = pow(max(0., dot(normalize(mvPosition.xyz), sunView)), 5.);
                gl_Position = projectionMatrix * mvPosition;
                gl_PointSize = clamp(particleStyle.x * pixelScale * projectionMatrix[1][1] / max(.08, -mvPosition.z), 1., 128.);
                sprayStyle = particleStyle.yzw;
                #include <fog_vertex>
            }
        `,
        fragmentShader: `
            #include <fog_pars_fragment>
            varying vec3 sprayStyle;
            varying float sunScatter;
            void main() {
                vec2 uv = gl_PointCoord - .5;
                float angle = sprayStyle.z * 6.283185;
                float s = sin(angle), c = cos(angle);
                vec2 p = mat2(c, -s, s, c) * uv;
                float drift = sin(p.x * 18. + angle) * cos(p.y * 15. - angle);
                float cloudRadius = length(p * vec2(.84, 1.19)) + drift * .038;
                float cloud = exp(-9. * cloudRadius * cloudRadius) * (1. - smoothstep(.27, .49, cloudRadius));
                float flake = 1. - smoothstep(.17, .47, length(p));
                float alpha = sprayStyle.x * mix(flake, cloud, sprayStyle.y) * (1. + sunScatter * .6);
                if (alpha < .008) discard;
                // lit from above, shaded blue underneath (self-shadowing), bright and warm toward the sun
                vec3 ice = mix(vec3(.62, .74, .90), vec3(.98, .99, 1.), .55 - .55 * p.y);
                ice = mix(ice, vec3(1.25, 1.2, 1.12), sunScatter * .75);
                gl_FragColor = vec4(ice, alpha);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
                #include <fog_fragment>
            }
        `,
    });
}

export class PowderSpray {
    readonly points: T.Points<T.BufferGeometry, T.ShaderMaterial>;
    private readonly geometry = new T.BufferGeometry();
    private readonly material = sprayMaterial();
    private readonly positions = new Float32Array(budgets.cinematic.capacity * 3);
    private readonly velocities = new Float32Array(budgets.cinematic.capacity * 3);
    private readonly planes = new Float32Array(budgets.cinematic.capacity * 3);
    private readonly style = new Float32Array(budgets.cinematic.capacity * 4);
    private readonly size = new Float32Array(budgets.cinematic.capacity);
    private readonly age = new Float32Array(budgets.cinematic.capacity);
    private readonly lifetime = new Float32Array(budgets.cinematic.capacity);
    private readonly opacity = new Float32Array(budgets.cinematic.capacity);
    private previous?: SprayContact;
    private budget = budgets.high;
    private count = 0;
    /** Live particles, for the diagnostics overlay. */
    activeCount() { return this.count; }
    private carry = 0;

    constructor(quality: string) {
        this.geometry.setAttribute('position', new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage));
        this.geometry.setAttribute('particleStyle', new T.BufferAttribute(this.style, 4).setUsage(T.DynamicDrawUsage));
        this.points = new T.Points(this.geometry, this.material);
        this.points.frustumCulled = false;
        this.points.renderOrder = 2;
        this.setQuality(quality);
        this.clear();
    }

    setQuality(quality: string) {
        this.budget = budgets[quality] ?? budgets.high;
        this.count = Math.min(this.count, this.budget.capacity);
        this.geometry.setDrawRange(0, this.count);
    }

    clear() {
        this.count = 0;
        this.carry = 0;
        this.previous = undefined;
        this.geometry.setDrawRange(0, 0);
        this.points.visible = false;
    }

    update(dt: number, contact: SprayContact, drawingHeight: number) {
        this.material.uniforms.pixelScale.value = drawingHeight * .5;
        this.advance(dt);
        const previous = this.previous;
        this.previous = contact;
        if (contact.grounded) {
            const speed = smoothstep(contact.speed, 1.5, 12);   // m/s: full spray from ~43 km/h
            const carve = smoothstep(Math.abs(contact.edge), .08, .58);
            const skid = smoothstep(Math.abs(contact.skid), .045, .7);
            const powder = smoothstep(contact.depth, .025, .43);
            const force = Math.min(1, .26 * carve + .54 * skid + .63 * powder);
            this.carry += dt * this.budget.rate * speed * (.03 + 1.1 * force);
            const generated = Math.floor(this.carry);
            this.carry -= generated;
            const moving = previous?.grounded ? previous : contact;
            for (let i = 0; i < generated; i++)
                this.emit(contact, moving, (i + Math.random()) / generated, force, powder, 0);
            if (previous && !previous.grounded && contact.landing > .13) {
                const burst = Math.ceil(this.budget.rate * (.035 + powder * .033) * contact.landing);
                for (let i = 0; i < burst; i++)
                    this.emit(contact, contact, 1, Math.max(.45, force), powder, contact.landing);
            }
        } else {
            // Existing spray continues under gravity while the rider is airborne.
            this.carry = 0;
        }
        this.geometry.setDrawRange(0, this.count);
        this.points.visible = this.count > 0;
        if (this.count > 0) {
            const position = this.geometry.attributes.position as T.BufferAttribute;
            const style = this.geometry.attributes.particleStyle as T.BufferAttribute;
            position.clearUpdateRanges();
            style.clearUpdateRanges();
            position.addUpdateRange(0, this.count * 3);
            style.addUpdateRange(0, this.count * 4);
            position.needsUpdate = style.needsUpdate = true;
        }
    }

    private emit(contact: SprayContact, previous: SprayContact, sample: number, force: number, powder: number, landing: number) {
        if (this.count >= this.budget.capacity) return;
        const index = this.count++;
        const point = index * 3, style = index * 4;
        const cloud = Math.random() < .21 + powder * .32 + force * .20;
        const side = Math.abs(contact.skid) > .10 ? -Math.sign(contact.skid)
            : Math.abs(contact.edge) > .11 ? -Math.sign(contact.edge) : (Math.random() < .5 ? -1 : 1);
        const sine = Math.sin(contact.heading), cosine = Math.cos(contact.heading);
        const offset = side * (.09 + Math.random() * (.21 + powder * .24));
        const tail = .30 + Math.random() * .43;
        const x = lerp(previous.x, contact.x, sample), y = lerp(previous.y, contact.y, sample);
        const z = lerp(previous.z, contact.z, sample);
        this.positions[point] = x - sine * tail + cosine * offset;
        this.positions[point + 2] = z + cosine * tail + sine * offset;
        this.positions[point + 1] = y + contact.slopeX * (-sine * tail + cosine * offset)
            + contact.slopeZ * (cosine * tail + sine * offset) + .025 + Math.random() * (.085 + powder * .13);
        // Thrown snow keeps little of the rider's speed (it is kicked off the edge, not carried): it hangs where it was thrown.
        const forward = contact.speed * (.05 + Math.random() * .17) - 1.2 * landing;
        const skidWall = smoothstep(Math.abs(contact.skid), .35, 1.0) * smoothstep(contact.speed, 4, 12);
        const lateral = side * (.34 + Math.random() * (1.20 + force * 4.0 + landing * 3.0 + skidWall * 3.5));
        this.velocities[point] = sine * forward + cosine * lateral;
        this.velocities[point + 2] = -cosine * forward + sine * lateral;
        // powder rooster tail and skid-stop walls rise to roughly rider height
        this.velocities[point + 1] = .38 + .9 * powder + Math.random() * (.76 + powder * 2.1 + force * 2.6 + landing * 3.1 + skidWall * 2.4)
            + contact.slopeX * this.velocities[point] + contact.slopeZ * this.velocities[point + 2];
        this.planes[point] = y - x * contact.slopeX - z * contact.slopeZ;
        this.planes[point + 1] = contact.slopeX;
        this.planes[point + 2] = contact.slopeZ;
        this.age[index] = 0;
        // Lingering snow dust: clouds 0.2-1.5 m that keep growing and hang for 0.7-2.5 s (powder plumes, skid walls).
        this.lifetime[index] = cloud ? .7 + Math.random() * (.55 + powder * 1.25 + skidWall * .7) : .3 + Math.random() * .4;
        this.size[index] = cloud ? .2 + Math.random() * (.32 + powder * .62 + skidWall * .45) : .027 + Math.random() * .05;
        this.opacity[index] = cloud ? (.2 + force * .2 + powder * .2 + skidWall * .16) : .36 + Math.random() * .39;
        this.style[style] = this.size[index];
        this.style[style + 1] = this.opacity[index] * (cloud ? .8 : 1);
        this.style[style + 2] = cloud ? 1 : 0;
        this.style[style + 3] = Math.random();
    }

    private advance(dt: number) {
        const flakeDrag = Math.exp(-dt * 1.1), mistDrag = Math.exp(-dt * 2.8);
        for (let i = 0; i < this.count;) {
            const point = i * 3, style = i * 4, cloud = this.style[style + 2] > .5;
            this.age[i] += dt;
            const progress = this.age[i] / this.lifetime[i];
            const drag = cloud ? mistDrag : flakeDrag;
            this.velocities[point] *= drag;
            this.velocities[point + 2] *= drag;
            this.velocities[point + 1] = this.velocities[point + 1] * drag - GRAVITY * dt * (cloud ? .12 : 1);
            this.positions[point] += this.velocities[point] * dt;
            this.positions[point + 1] += this.velocities[point + 1] * dt;
            this.positions[point + 2] += this.velocities[point + 2] * dt;
            const floor = this.planes[point] + this.positions[point] * this.planes[point + 1]
                + this.positions[point + 2] * this.planes[point + 2];
            if (progress >= 1 || (!cloud && this.positions[point + 1] < floor)) {
                this.remove(i);
                continue;
            }
            if (cloud && this.positions[point + 1] < floor + .065) {
                this.positions[point + 1] = floor + .065;
                this.velocities[point + 1] = 0;
            }
            this.style[style] = this.size[i] * (cloud ? 1 + progress * 2.5 : 1);
            this.style[style + 1] = this.opacity[i] * (1 - progress) ** (cloud ? 1.5 : .65)
                * (cloud ? lerp(.8, 1, clamp(progress * 6, 0, 1)) : 1);
            i++;
        }
    }

    private remove(index: number) {
        const last = --this.count;
        if (index === last) return;
        this.positions.copyWithin(index * 3, last * 3, last * 3 + 3);
        this.velocities.copyWithin(index * 3, last * 3, last * 3 + 3);
        this.planes.copyWithin(index * 3, last * 3, last * 3 + 3);
        this.style.copyWithin(index * 4, last * 4, last * 4 + 4);
        this.size[index] = this.size[last];
        this.age[index] = this.age[last];
        this.lifetime[index] = this.lifetime[last];
        this.opacity[index] = this.opacity[last];
    }

    /** World direction toward the sun (for forward scattering in the snow dust). */
    setSun(direction: T.Vector3) { this.material.uniforms.sunDirection.value.copy(direction).normalize(); }

    dispose() {
        this.points.removeFromParent();
        this.geometry.dispose();
        this.material.dispose();
    }
}
