import { MathUtils } from 'three';

export const FIRST_KICKER = 100;

const small = { lip: 20, knuckle: 32, runout: 72, rise: 6.3, width: 6.2, shoulder: 11.5, lipTangent: 1.49 };
const medium = { lip: 23, knuckle: 38, runout: 83, rise: 7.8, width: 7.5, shoulder: 13.5, lipTangent: 1.47 };
const large = { lip: 26, knuckle: 44, runout: 88, rise: 9.2, width: 8.5, shoulder: 15, lipTangent: 1.45 };
const classic = { lip: 18, knuckle: 30, runout: 66, rise: 4, width: 5, shoulder: 10, lipTangent: 2 };
const lines = [[medium, large, small], [medium, small, large], [large, medium]];
const originalProfiles = new Map([
    [small, { ...small, runout: 67, lipTangent: 2 }],
    [medium, { ...medium, runout: 79, lipTangent: 2 }],
    [large, { ...large, lipTangent: 2 }],
]);

type JumpCourse = { id: number; spacing: number; length: number; classicFeatures?: boolean; originalKickers?: boolean };

export function kickerAt(d: number, course: JumpCourse) {
    const index = Math.floor((d - FIRST_KICKER) / course.spacing);
    const base = FIRST_KICKER + index * course.spacing;
    const line = lines[course.id] ?? lines[0];
    const current = line[MathUtils.euclideanModulo(index, line.length)];
    const profile = course.classicFeatures ? classic : course.originalKickers ? originalProfiles.get(current)! : current;
    const exists = course.classicFeatures || (index >= 0 && base + profile.runout < course.length - 12);
    return { base, profile, exists };
}

export function kickerRise(distance: number, offset: number, profile: typeof small) {
    if (distance < 0 || distance > profile.runout || offset >= profile.shoulder) return 0;
    const t = distance / profile.lip;
    const section = distance < profile.lip ? t * t * (3 - profile.lipTangent + (profile.lipTangent - 2) * t)
        : 1 - MathUtils.smoothstep(distance, profile.knuckle, profile.runout);
    return profile.rise * section * (1 - MathUtils.smoothstep(offset, profile.width, profile.shoulder));
}

export type ParkFlight = {
    duration: number;
    originX: number;
    lateralSpeed: number;
    targetX: number;
    targetLateralSpeed: number;
    downhillSpeed: number;
    landingPitch: number;
    alignment?: {
        start: number;
        spin: number;
        spinRate: number;
        spinTarget: number;
        flip: number;
        flipRate: number;
        flipTarget: number;
    };
};

// Cubic interpolation that preserves the velocity on entry and exit.
export function approach(from: number, fromSpeed: number, to: number, toSpeed: number, time: number, duration: number) {
    const t = MathUtils.clamp(time / duration, 0, 1);
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * from + (t3 - 2 * t2 + t) * duration * fromSpeed
        + (-2 * t3 + 3 * t2) * to + (t3 - t2) * duration * toSpeed;
}

export function parkFlightX(flight: ParkFlight, time: number) {
    if (time >= flight.duration) return flight.targetX + (time - flight.duration) * flight.targetLateralSpeed;
    return approach(flight.originX, flight.lateralSpeed, flight.targetX, flight.targetLateralSpeed, time, flight.duration);
}

export function parkFlightSideSpeed(flight: ParkFlight, time: number) {
    const t = MathUtils.clamp(time / flight.duration, 0, 1);
    return 6 * t * (1 - t) * (flight.targetX - flight.originX) / flight.duration
        + (1 - t) * (1 - 3 * t) * flight.lateralSpeed + t * (3 * t - 2) * flight.targetLateralSpeed;
}
