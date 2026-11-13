/**
 * Gamepad reading for the W3C "standard" mapping (Xbox / PlayStation layouts in Chromium, Firefox and Edge).
 * Sticks get a radial dead zone (no cross-shaped snapping), a power response curve and a sensitivity scale.
 */
export type PadConfig = { deadzone: number; curve: number; sensitivity: number; invertLean: boolean };
export const DEFAULT_PAD: PadConfig = { deadzone: .12, curve: 1.5, sensitivity: 1, invertLean: false };
export type PadState = {
    id: string;
    lx: number; ly: number; rx: number; ry: number; lt: number; rt: number;
    a: boolean; b: boolean; x: boolean; y: boolean; lb: boolean; rb: boolean;
    select: boolean; start: boolean; up: boolean; down: boolean; left: boolean; right: boolean;
};

/** Radial dead zone + response curve. Returns a vector of length <= 1. */
export function shapeStick(x: number, y: number, cfg: Pick<PadConfig, 'deadzone' | 'curve' | 'sensitivity'>): [number, number] {
    const m = Math.hypot(x, y);
    if (m <= cfg.deadzone || m === 0) return [0, 0];
    const t = Math.min(1, (m - cfg.deadzone) / (1 - cfg.deadzone));
    const shaped = Math.min(1, Math.pow(t, cfg.curve) * cfg.sensitivity);
    return [x / m * shaped, y / m * shaped];
}
/** Trigger with a small dead zone; buttons without analog values report 0 or 1. */
const trigger = (b?: GamepadButton) => !b ? 0 : Math.max(0, Math.min(1, ((b.value ?? (b.pressed ? 1 : 0)) - .04) / .96));

export function readGamepad(cfg: PadConfig): PadState | null {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const p = Array.from(pads || []).find(g => g && g.connected);
    if (!p) return null;
    const [lx, ly] = shapeStick(p.axes[0] ?? 0, p.axes[1] ?? 0, cfg);
    const [rx, ry] = shapeStick(p.axes[2] ?? 0, p.axes[3] ?? 0, cfg);
    const btn = (i: number) => !!p.buttons[i]?.pressed;
    return {
        id: p.id, lx, ly: cfg.invertLean ? -ly : ly, rx, ry, lt: trigger(p.buttons[6]), rt: trigger(p.buttons[7]),
        a: btn(0), b: btn(1), x: btn(2), y: btn(3), lb: btn(4), rb: btn(5), select: btn(8), start: btn(9),
        up: btn(12), down: btn(13), left: btn(14), right: btn(15),
    };
}
