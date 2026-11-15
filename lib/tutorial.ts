/**
 * Interactive tutorial, played in free ride from Les Ruinettes (wide blue pistes and lifts at hand). Six steps, each
 * completed by doing it, detected from what the rider actually does (not from key presses alone):
 *   carve both edges, stop, skate, ollie, spin, take a lift.
 * The spin step asks for 90° of rotation, not a full 180: flat-ground 180s fall short in this physics model (about
 * 115-125° measured; see docs/KNOWN_ISSUES.md).
 * Pure logic (no Three.js), so it is tested in Node with the real physics.
 */
export type TutorialStepId = 'carve' | 'stop' | 'skate' | 'pop' | 'spin' | 'lift';
export type TutorialStep = { id: TutorialStepId; title: string; keys: string; phone: string; goal: string };
export const TUTORIAL_STEPS: TutorialStep[] = [
    { id: 'carve', title: 'Carve on both edges', keys: 'A / D roll the board onto the toe and heel edges. Hold an edge and the sidecut turns you.',
        phone: 'Tilt the phone left and right.', goal: 'Hold each edge for 1.5 s above 15 km/h' },
    { id: 'stop', title: 'Stop', keys: 'Hold S. The board swings across the slope and the uphill edge scrubs your speed.',
        phone: 'Hold the brake button.', goal: 'Stop from above 20 km/h' },
    { id: 'skate', title: 'Skate', keys: 'On the flat, at walking pace, hold W: your free back foot pushes, like leaving a lift station.',
        phone: 'Tilt forward at walking pace.', goal: 'Push for 2 s' },
    { id: 'pop', title: 'Ollie', keys: 'Hold SPACE to load the tail, release to spring off it.',
        phone: 'Hold the jump button, release to pop.', goal: 'Leave the snow for 0.3 s and land on your board' },
    { id: 'spin', title: 'Spin', keys: 'Hold Q or E to wind up your shoulders, pop, then let go: the board follows the upper body round.',
        phone: 'Hold a spin button, pop, then let go.', goal: 'Turn 90° or more in the air and land (full 180s need a kicker)' },
    { id: 'lift', title: 'Take a lift', keys: 'Stop at a lift’s loading area: the HUD offers it. Take it to the top.',
        phone: 'Stop near a lift and tap Take.', goal: 'Ride a lift' },
];

export type TutorialSample = {
    dt: number; speed: number; steer: number; brake: number; tuck: boolean; ground: boolean;
    /** Riding (not crashed, not on a lift). */ riding: boolean; onLift: boolean;
};
export type TutorialEvent = { type: 'landed'; air: number; /** measured yaw rotation in the air */ rotationDeg: number } | { type: 'crash' } | { type: 'takeoff' };

export class Tutorial {
    step = 0;
    /** 0..1 within the current step. */
    progress = 0;
    finished = false;
    /** Set for one update when a step completes (for the toast). */
    justDone: TutorialStep | null = null;
    private left = 0; private right = 0; private armed = false; private skate = 0;
    get current(): TutorialStep | null { return this.finished ? null : TUTORIAL_STEPS[this.step]; }
    skip() { this.complete(); }
    private complete() {
        this.justDone = TUTORIAL_STEPS[this.step];
        this.step++; this.progress = 0; this.left = this.right = this.skate = 0; this.armed = false;
        if (this.step >= TUTORIAL_STEPS.length) { this.finished = true; this.step = TUTORIAL_STEPS.length - 1; }
    }
    update(s: TutorialSample) {
        this.justDone = null;
        const st = this.current; if (!st) return;
        switch (st.id) {
            case 'carve':
                if (s.riding && s.ground && s.speed > 15 / 3.6) { if (s.steer > .35) this.right += s.dt; else if (s.steer < -.35) this.left += s.dt; }
                this.progress = (Math.min(this.left, 1.5) + Math.min(this.right, 1.5)) / 3;
                if (this.left >= 1.5 && this.right >= 1.5) this.complete();
                break;
            case 'stop':
                if (s.riding && s.speed > 20 / 3.6) this.armed = true;
                this.progress = this.armed ? Math.min(.99, Math.max(.1, 1 - s.speed / (20 / 3.6))) : 0;
                if (this.armed && s.riding && s.brake > .5 && s.speed < 1) this.complete();
                break;
            case 'skate':
                if (s.riding && s.ground && s.tuck && s.speed < 5) this.skate += s.dt;
                this.progress = Math.min(1, this.skate / 2);
                if (this.skate >= 2) this.complete();
                break;
            case 'lift':
                this.progress = s.onLift ? 1 : 0;
                if (s.onLift) this.complete();
                break;
            default: break;
        }
    }
    event(e: TutorialEvent) {
        const st = this.current; if (!st) return;
        if (e.type !== 'landed') return;
        if (st.id === 'pop' && e.air >= .3) this.complete();
        else if (st.id === 'spin' && Math.abs(e.rotationDeg) >= 90) this.complete();
    }
    hud() {
        const st = TUTORIAL_STEPS[this.step];
        return { step: this.step + 1, total: TUTORIAL_STEPS.length, title: st.title, keys: st.keys, phone: st.phone, goal: st.goal, progress: this.finished ? 1 : this.progress, finished: this.finished };
    }
}
