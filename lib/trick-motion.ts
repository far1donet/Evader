// Deterministic trick rules in radians/metres; independent of rendering rate.
export const TAU = Math.PI * 2;
export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export function rotationStep(velocity: number, input: number, dt: number, flip = false, tucked = false) {
    // Exponential angular acceleration; release opens the body and brakes rotation.
    const rate = input === 0 ? 4.8 : 3.6, target = input * (flip ? 4.8 : 5.6) * (tucked ? 1.10 : 1);
    const decay = Math.exp(-rate * dt), next = target + (velocity - target) * decay;
    return { velocity: next, angle: target * dt + (velocity - target) * (1 - decay) / rate };
}
export function landingWindow(spin: number, flip: number, assisted: boolean) {
    const spinTarget = Math.round(spin / Math.PI) * Math.PI, flipTarget = Math.round(flip / TAU) * TAU;
    const spinError = Math.abs(spin - spinTarget), flipError = Math.abs(flip - flipTarget);
    // Assistance is a small correction, never a rescue from sideways or inverted.
    const limit = (assisted ? 32 : 18) * Math.PI / 180;
    return { valid: spinError <= limit && flipError <= limit, spinTarget, flipTarget, spinError, flipError };
}
export function completedRotation(angle: number, unit: number) {
    // Allow a tiny 5-degree measurement tolerance, not half a revolution.
    return Math.floor((Math.abs(angle) + 5 * Math.PI / 180) / unit);
}
export function landingTime(gap: number, relativeVelocity: number) {
    return Math.max(0, (relativeVelocity + Math.sqrt(relativeVelocity * relativeVelocity + 19.62 * Math.max(0, gap))) / 9.81);
}
export function airPhase(airTime: number, touchdown: number) {
    const pop = clamp(1 - airTime / .22, 0, 1), extension = 1 - clamp(touchdown / .38, 0, 1);
    return { pop, extension: extension * extension * (3 - 2 * extension) };
}
