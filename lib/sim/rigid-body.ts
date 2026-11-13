import { type Q4, type V3, cross, dot, qIdentity, qIntegrate, qRotate, qRotateInv, qToMat, v3 } from './math3.ts';

/**
 * Six-degree-of-freedom rigid body.
 *
 * State is position of the centre of mass, linear velocity, orientation (unit
 * quaternion) and WORLD-FRAME ANGULAR MOMENTUM L. Angular velocity is derived
 * as w = I_world^-1 L. Integrating L directly (dL/dt = torque) means angular
 * momentum is conserved when torque is zero, and changing the inertia tensor
 * (a rider tucking or extending) changes w without changing L.
 * The inertia tensor is diagonal in the body frame, about the centre of mass.
 */
export class RigidBody {
    p: V3 = v3(); v: V3 = v3(); q: Q4 = qIdentity(); L: V3 = v3(); w: V3 = v3();
    force: V3 = v3(); torque: V3 = v3();
    mass: number;
    invMass: number;
    inertia: [number, number, number];
    private R: number[] = new Array(9).fill(0);
    // No parameter properties: the repo runs tests with node --experimental-strip-types.
    constructor(mass: number, inertia: [number, number, number]) {
        this.mass = mass; this.invMass = 1 / mass; this.inertia = [...inertia];
        this.refresh();
    }
    /** Recompute rotation matrix and angular velocity from L (call after editing q, L or inertia). */
    refresh() {
        qToMat(this.q, this.R);
        const R = this.R, [Ix, Iy, Iz] = this.inertia;
        const bx = R[0] * this.L.x + R[3] * this.L.y + R[6] * this.L.z;
        const by = R[1] * this.L.x + R[4] * this.L.y + R[7] * this.L.z;
        const bz = R[2] * this.L.x + R[5] * this.L.y + R[8] * this.L.z;
        const wx = bx / Ix, wy = by / Iy, wz = bz / Iz;
        this.w.x = R[0] * wx + R[1] * wy + R[2] * wz;
        this.w.y = R[3] * wx + R[4] * wy + R[5] * wz;
        this.w.z = R[6] * wx + R[7] * wy + R[8] * wz;
    }
    setAngularVelocity(w: V3) {
        qToMat(this.q, this.R);
        const R = this.R, [Ix, Iy, Iz] = this.inertia;
        const bx = (R[0] * w.x + R[3] * w.y + R[6] * w.z) * Ix;
        const by = (R[1] * w.x + R[4] * w.y + R[7] * w.z) * Iy;
        const bz = (R[2] * w.x + R[5] * w.y + R[8] * w.z) * Iz;
        this.L.x = R[0] * bx + R[1] * by + R[2] * bz;
        this.L.y = R[3] * bx + R[4] * by + R[5] * bz;
        this.L.z = R[6] * bx + R[7] * by + R[8] * bz;
        this.refresh();
    }
    /** Change the inertia (posture change) while conserving world angular momentum. */
    setInertia(inertia: [number, number, number]) { this.inertia = [...inertia]; this.refresh(); }
    toWorld(local: V3, o: V3 = v3()): V3 { qRotate(this.q, local, o); o.x += this.p.x; o.y += this.p.y; o.z += this.p.z; return o; }
    dirToWorld(local: V3, o: V3 = v3()): V3 { return qRotate(this.q, local, o); }
    dirToLocal(world: V3, o: V3 = v3()): V3 { return qRotateInv(this.q, world, o); }
    velocityAt(world: V3, o: V3 = v3()): V3 {
        const rx = world.x - this.p.x, ry = world.y - this.p.y, rz = world.z - this.p.z;
        o.x = this.v.x + this.w.y * rz - this.w.z * ry;
        o.y = this.v.y + this.w.z * rx - this.w.x * rz;
        o.z = this.v.z + this.w.x * ry - this.w.y * rx;
        return o;
    }
    applyForce(f: V3) { this.force.x += f.x; this.force.y += f.y; this.force.z += f.z; }
    applyForceAtPoint(f: V3, point: V3) {
        this.applyForce(f);
        const r = v3(point.x - this.p.x, point.y - this.p.y, point.z - this.p.z);
        const t = cross(r, f); this.torque.x += t.x; this.torque.y += t.y; this.torque.z += t.z;
    }
    applyTorque(t: V3) { this.torque.x += t.x; this.torque.y += t.y; this.torque.z += t.z; }
    /** Apply an impulse at a world point (changes v and L immediately). */
    applyImpulseAtPoint(j: V3, point: V3) {
        this.v.x += j.x * this.invMass; this.v.y += j.y * this.invMass; this.v.z += j.z * this.invMass;
        const r = v3(point.x - this.p.x, point.y - this.p.y, point.z - this.p.z);
        const t = cross(r, j); this.L.x += t.x; this.L.y += t.y; this.L.z += t.z;
        this.refresh();
    }
    /** Inverse-inertia applied to a world vector: R I^-1 R^T u. */
    invInertiaMul(u: V3, o: V3 = v3()): V3 {
        const R = this.R, [Ix, Iy, Iz] = this.inertia;
        const bx = (R[0] * u.x + R[3] * u.y + R[6] * u.z) / Ix;
        const by = (R[1] * u.x + R[4] * u.y + R[7] * u.z) / Iy;
        const bz = (R[2] * u.x + R[5] * u.y + R[8] * u.z) / Iz;
        o.x = R[0] * bx + R[1] * by + R[2] * bz; o.y = R[3] * bx + R[4] * by + R[5] * bz; o.z = R[6] * bx + R[7] * by + R[8] * bz;
        return o;
    }
    clearForces() { this.force.x = this.force.y = this.force.z = 0; this.torque.x = this.torque.y = this.torque.z = 0; }
    private qMid: Q4 = qIdentity();
    private wMid: V3 = v3();
    /** World angular velocity for a given orientation and the current L (does not touch this.q / this.w). */
    private omegaFor(q: Q4, o: V3): V3 {
        const R = qToMat(q, this.scratchR), [Ix, Iy, Iz] = this.inertia, L = this.L;
        const bx = (R[0] * L.x + R[3] * L.y + R[6] * L.z) / Ix;
        const by = (R[1] * L.x + R[4] * L.y + R[7] * L.z) / Iy;
        const bz = (R[2] * L.x + R[5] * L.y + R[8] * L.z) / Iz;
        o.x = R[0] * bx + R[1] * by + R[2] * bz; o.y = R[3] * bx + R[4] * by + R[5] * bz; o.z = R[6] * bx + R[7] * by + R[8] * bz;
        return o;
    }
    private scratchR: number[] = new Array(9).fill(0);
    /**
     * Translation: position advances with the constant-acceleration solution over the step
     * (exact for gravity-only flight), velocity then updates.
     * Rotation: momentum form. L integrates torque; orientation advances with the angular
     * velocity evaluated at the midpoint orientation (second order, fixed-point iterated),
     * which keeps torque-free tumbling energy stable over long flights.
     */
    integrate(dt: number) {
        const ax = this.force.x * this.invMass, ay = this.force.y * this.invMass, az = this.force.z * this.invMass;
        this.p.x += (this.v.x + .5 * ax * dt) * dt; this.p.y += (this.v.y + .5 * ay * dt) * dt; this.p.z += (this.v.z + .5 * az * dt) * dt;
        this.v.x += ax * dt; this.v.y += ay * dt; this.v.z += az * dt;
        this.L.x += this.torque.x * dt; this.L.y += this.torque.y * dt; this.L.z += this.torque.z * dt;
        // fixed-point midpoint: w_mid = omega(q advanced by w_mid * dt/2)
        this.omegaFor(this.q, this.wMid);
        for (let k = 0; k < 3; k++) {
            this.qMid.x = this.q.x; this.qMid.y = this.q.y; this.qMid.z = this.q.z; this.qMid.w = this.q.w;
            qIntegrate(this.qMid, this.wMid, dt / 2);
            this.omegaFor(this.qMid, this.wMid);
        }
        qIntegrate(this.q, this.wMid, dt);
        this.refresh();
    }
    kineticEnergy() {
        return .5 * this.mass * dot(this.v, this.v) + .5 * dot(this.w, this.L);
    }
}
