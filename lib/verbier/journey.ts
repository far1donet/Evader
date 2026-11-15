import type { Resort, ResortLift, RouteSummary } from './terrain.ts';

/**
 * Getting from one station to another the way a skier does: lifts up, runs down. Shortest expected time on the real
 * network: a lift costs its ride time plus about 90 s of queue and boarding; a run costs its length at a typical riding
 * speed (8 m/s), weighted toward easier pistes (an itinerary counts 1.7 times its length).
 */
export type JourneyStep = { kind: 'lift'; lift: ResortLift } | { kind: 'run'; route: RouteSummary };
const RUN_WEIGHT: Record<string, number> = { blue: 1, red: 1.1, black: 1.35, itinerary: 1.7, park: 1.3, skicross: 1.3 };
export function planJourney(r: Resort, from: string, to: string, opts: { runs?: boolean } = {}): { steps: JourneyStep[]; seconds: number } | null {
    if (from === to) return { steps: [], seconds: 0 };
    const useRuns = opts.runs ?? true;
    const dist = new Map<string, number>([[from, 0]]), prev = new Map<string, { at: string; step: JourneyStep }>();
    const open = new Set([from]);
    while (open.size) {
        let u = '', best = Infinity;
        for (const s of open) { const d = dist.get(s)!; if (d < best) { best = d; u = s; } }
        open.delete(u);
        if (u === to) break;
        const edges: [string, number, JourneyStep][] = [];
        for (const l of r.lifts) if (l.from === u) edges.push([l.to, l.rideS + 90, { kind: 'lift', lift: l }]);
        if (useRuns) for (const x of r.routes) if (x.fromStation === u && x.toStation && !x.featured) edges.push([x.toStation, x.length / 8 * (RUN_WEIGHT[x.klass] ?? 1.2) + 20, { kind: 'run', route: x }]);
        for (const [v, c, step] of edges) {
            const nd = best + c;
            if (nd < (dist.get(v) ?? Infinity)) { dist.set(v, nd); prev.set(v, { at: u, step }); open.add(v); }
        }
    }
    if (!dist.has(to)) return null;
    const steps: JourneyStep[] = [];
    for (let s = to; s !== from;) { const p = prev.get(s)!; steps.unshift(p.step); s = p.at; }
    return { steps, seconds: Math.round(dist.get(to)!) };
}
