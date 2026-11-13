import type * as T from 'three';

/**
 * Performance and hardware diagnostics overlay. Everything shown is measured in this browser session or reported by
 * the browser; nothing about the user's hardware is assumed. GPU time is not measurable without timer queries, so the
 * overlay reports CPU-side frame time, simulation time and renderer counters.
 */
export type HardwareReport = {
    gpuVendor: string; gpuRenderer: string; webgl2: boolean; webgpu: boolean; maxTexture: number; maxSamples: number;
    anisotropy: number; cores: number; memoryGB: string; pixelRatio: number; screen: string;
};
export function hardwareReport(renderer: T.WebGLRenderer): HardwareReport {
    const gl = renderer.getContext() as WebGL2RenderingContext;
    let gpuVendor = 'not exposed', gpuRenderer = 'not exposed';
    try {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        if (ext) { gpuVendor = String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)); gpuRenderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)); }
        else { gpuVendor = String(gl.getParameter(gl.VENDOR)); gpuRenderer = String(gl.getParameter(gl.RENDERER)); }
    } catch { /* keep defaults */ }
    const nav = navigator as Navigator & { deviceMemory?: number; gpu?: unknown };
    return {
        gpuVendor, gpuRenderer,
        webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
        webgpu: !!nav.gpu,
        maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
        maxSamples: (gl as WebGL2RenderingContext).MAX_SAMPLES ? gl.getParameter((gl as WebGL2RenderingContext).MAX_SAMPLES) as number : 0,
        anisotropy: renderer.capabilities.getMaxAnisotropy(),
        cores: nav.hardwareConcurrency ?? 0,
        memoryGB: nav.deviceMemory ? `${nav.deviceMemory}+ (browser-rounded)` : 'not exposed',
        pixelRatio: devicePixelRatio,
        screen: `${screen.width}×${screen.height}`,
    };
}

export type DiagInfo = {
    quality: string; renderer: T.WebGLRenderer; physicsMs: number; physics: string; particles: number;
    contacts: number; speed: number; slip: number; edge: number; legForce: number; balance: number; terrainEvals: number;
};

export class Diagnostics {
    el: HTMLDivElement;
    private canvas: HTMLCanvasElement;
    private text: HTMLPreElement;
    private times = new Float32Array(600); private n = 0; private i = 0; private acc = 0;
    private hw?: HardwareReport;
    visible = false;
    constructor(host: HTMLElement) {
        this.el = document.createElement('div');
        this.el.className = 'diagnostics';
        this.el.style.display = 'none';
        this.canvas = document.createElement('canvas');
        this.canvas.width = 240; this.canvas.height = 56;
        this.text = document.createElement('pre');
        this.el.append(this.canvas, this.text);
        host.appendChild(this.el);
    }
    setVisible(v: boolean) { this.visible = v; this.el.style.display = v ? 'block' : 'none'; }
    frame(dt: number, info: DiagInfo) {
        this.times[this.i] = dt * 1000; this.i = (this.i + 1) % this.times.length; this.n = Math.min(this.n + 1, this.times.length);
        this.acc += dt;
        if (!this.visible || this.acc < .25) return;
        this.acc = 0;
        this.hw ??= hardwareReport(info.renderer);
        const arr = Array.from(this.times.subarray(0, this.n)).sort((a, b) => a - b);
        const avg = arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length);
        const worst1 = arr.slice(Math.floor(arr.length * .99)); const low1 = 1000 / (worst1.reduce((a, b) => a + b, 0) / Math.max(1, worst1.length));
        const r = info.renderer, ri = r.info, c = r.domElement;
        const hw = this.hw;
        this.text.textContent = [
            `FPS ${(1000 / avg).toFixed(0)} avg · 1% low ${low1.toFixed(0)} · frame ${avg.toFixed(2)} ms`,
            `Render ${c.width}×${c.height} · ${info.quality.toUpperCase()} · draws ${ri.render.calls} · tris ${(ri.render.triangles / 1e6).toFixed(2)} M`,
            `Geometries ${ri.memory.geometries} · textures ${ri.memory.textures} · particles ${info.particles}`,
            `Physics ${info.physics} · ${info.physicsMs.toFixed(2)} ms/tick · terrain evals ${info.terrainEvals}`,
            `Contacts ${info.contacts} · speed ${(info.speed * 3.6).toFixed(0)} km/h · slip ${(info.slip * 57.3).toFixed(0)}° · edge ${(info.edge * 57.3).toFixed(0)}°`,
            `Leg force ${info.legForce.toFixed(0)} N · balance load ${info.balance.toFixed(2)}`,
            `GPU ${hw.gpuRenderer}`,
            `WebGL2 ${hw.webgl2 ? 'yes' : 'no'} · WebGPU API ${hw.webgpu ? 'present' : 'absent'} · max tex ${hw.maxTexture} · MSAA ${hw.maxSamples} · aniso ${hw.anisotropy}`,
            `CPU threads ${hw.cores} · memory ${hw.memoryGB} · DPR ${hw.pixelRatio} · screen ${hw.screen}`,
        ].join('\n');
        const g = this.canvas.getContext('2d');
        if (!g) return;
        g.clearRect(0, 0, 240, 56);
        g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, 240, 56);
        g.strokeStyle = 'rgba(255,255,255,.25)';
        for (const ms of [8.33, 16.67]) { const y = 56 - ms * 2; g.beginPath(); g.moveTo(0, y); g.lineTo(240, y); g.stroke(); }
        g.strokeStyle = '#7fe3d8'; g.beginPath();
        for (let k = 0; k < 240; k++) {
            const idx = (this.i - 240 + k + this.times.length) % this.times.length;
            const y = 56 - Math.min(56, this.times[idx] * 2);
            if (k === 0) g.moveTo(k, y); else g.lineTo(k, y);
        }
        g.stroke();
    }
    dispose() { this.el.remove(); }
}
