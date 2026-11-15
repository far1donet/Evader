/**
 * Procedural sound for riding and lifts (Web Audio, no samples): every layer is filtered noise or a simple oscillator whose
 * level and colour follow the simulation each frame.
 *   - snow: the base gliding on snow, darker and softer in powder, brighter on firm groomed snow;
 *   - edge: the scrape of a skidded or hard-carved edge (high, grainy), from the slip angle and the edge angle at speed;
 *   - wind: air past the helmet, rising with the square of speed, with slow gusts; also in the air;
 *   - cloth: loose jacket and trousers flapping, an amplitude flutter that speeds up with speed;
 *   - lift: the rope and sheaves humming while riding a lift, and a clunk each time the vehicle crosses a tower.
 */
export type SoundFrame = {
    volume: number; riding: boolean; ground: boolean; speed: number;
    /** Board edge angle, rad, and slip angle between board and travel, rad. */ edge: number; slip: number;
    /** 0 firm .. 1 fresh powder. */ soft: number;
    lift: boolean; liftSpeed: number;
};
export class Soundscape {
    private readonly ctx: AudioContext;
    private readonly master: GainNode;
    private layers: Record<'snow' | 'edge' | 'wind' | 'cloth' | 'lift', { gain: GainNode; filter: BiquadFilterNode }>;
    private flutter: GainNode; private flutterLfo: OscillatorNode;
    private hum: OscillatorNode; private humGain: GainNode;
    private gust = 0;
    constructor(ctx: AudioContext) {
        this.ctx = ctx;
        this.master = ctx.createGain(); this.master.gain.value = 1; this.master.connect(ctx.destination);
        const noise = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate), data = noise.getChannelData(0);
        // pink-ish noise (a cheap 3-pole filter on white noise): sounds like air and snow rather than hiss
        let b0 = 0, b1 = 0, b2 = 0;
        for (let i = 0; i < data.length; i++) {
            const w = Math.random() * 2 - 1; b0 = .99765 * b0 + w * .099046; b1 = .963 * b1 + w * .2965164; b2 = .57 * b2 + w * 1.0526913;
            data[i] = (b0 + b1 + b2 + w * .1848) * .2;
        }
        const source = () => { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true; s.loopStart = Math.random(); s.start(0, Math.random() * 2); return s; };
        const layer = (type: BiquadFilterType, f: number, q: number) => {
            const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = f; filter.Q.value = q;
            const gain = ctx.createGain(); gain.gain.value = 0;
            source().connect(filter).connect(gain).connect(this.master);
            return { gain, filter };
        };
        this.layers = { snow: layer('bandpass', 700, .7), edge: layer('bandpass', 3200, 1.6), wind: layer('lowpass', 500, .5), cloth: layer('bandpass', 260, 1.2), lift: layer('lowpass', 180, .7) };
        // cloth flutter: an LFO modulating the cloth layer's level
        this.flutter = ctx.createGain(); this.flutter.gain.value = 0;
        this.flutterLfo = ctx.createOscillator(); this.flutterLfo.frequency.value = 9;
        this.flutterLfo.connect(this.flutter).connect(this.layers.cloth.gain.gain); this.flutterLfo.start();
        // lift drive hum (rope over sheaves)
        this.hum = ctx.createOscillator(); this.hum.type = 'sawtooth'; this.hum.frequency.value = 62;
        const humFilter = ctx.createBiquadFilter(); humFilter.type = 'lowpass'; humFilter.frequency.value = 240;
        this.humGain = ctx.createGain(); this.humGain.gain.value = 0;
        this.hum.connect(humFilter).connect(this.humGain).connect(this.master); this.hum.start();
    }
    update(f: SoundFrame, dt: number) {
        const t = this.ctx.currentTime, k = .12, v = f.volume, set = (p: AudioParam, x: number) => p.setTargetAtTime(x, t, k);
        const L = this.layers, speed = f.riding ? f.speed : 0, onSnow = f.riding && f.ground;
        this.gust += dt; const gust = .8 + .2 * Math.sin(this.gust * .7) * Math.sin(this.gust * .29 + 1);
        // snow under the board
        set(L.snow.gain.gain, onSnow ? v * Math.min(.12, .012 + speed * .006) : 0);
        set(L.snow.filter.frequency, 380 + 520 * (1 - f.soft) + speed * 18);
        // edge scrape: slipping edge (skid) or a high edge at speed on firm snow
        const scrape = onSnow ? Math.min(1, Math.abs(f.slip) / .5) * Math.min(1, speed / 8) + Math.min(1, Math.abs(f.edge) / .9) * Math.min(1, speed / 16) * .35 * (1 - f.soft) : 0;
        set(L.edge.gain.gain, v * .09 * scrape);
        set(L.edge.filter.frequency, 2200 + 1800 * Math.min(1, Math.abs(f.slip)));
        // wind past the helmet
        const air = Math.min(1, (speed / 22) ** 2) * gust;
        set(L.wind.gain.gain, v * .10 * air);
        set(L.wind.filter.frequency, 280 + 900 * air);
        // cloth flapping
        const flap = Math.min(1, Math.max(0, (speed - 4) / 18));
        set(L.cloth.gain.gain, v * .025 * flap); set(this.flutter.gain, v * .022 * flap);
        set(this.flutterLfo.frequency, 6 + speed * .7);
        // lift
        set(this.humGain.gain, f.lift ? v * .018 : 0); set(L.lift.gain.gain, f.lift ? v * .05 : 0);
        set(this.hum.frequency, 48 + f.liftSpeed * 4);
    }
    /** A vehicle crossing a tower's sheave train: a short double thump. */
    clunk(volume: number) {
        const t = this.ctx.currentTime;
        for (const [dt, f] of [[0, 110], [.09, 85]] as const) {
            const o = this.ctx.createOscillator(), g = this.ctx.createGain();
            o.frequency.setValueAtTime(f, t + dt); o.frequency.exponentialRampToValueAtTime(f * .45, t + dt + .16);
            g.gain.setValueAtTime(0, t); g.gain.setValueAtTime(volume * .16, t + dt); g.gain.exponentialRampToValueAtTime(.0005, t + dt + .2);
            o.connect(g).connect(this.master); o.start(t + dt); o.stop(t + dt + .22);
        }
    }
}
