export interface AmmoMotionState {
    getWorldTransform(transform: unknown): void;
    setWorldTransform(transform: unknown): void;
}

/** Opaque ammo.js rigid body handle (Embind object with optional ptr). */
export interface AmmoRigidBody {
    ptr?: number;
    a?: number;
    _centerOfMassOffset?: { x: number; y: number; z: number };
    _ownedCollisionShape?: unknown;
    getMotionState?(): AmmoMotionState;
    getLinearVelocity?(): AmmoVector3;
    getAngularVelocity?(): AmmoVector3;
    setFriction?(value: number): void;
    setRollingFriction?(value: number): void;
    setRestitution?(value: number): void;
    setDamping?(linear: number, angular: number): void;
    setActivationState?(state: number): void;
    applyCentralImpulse?(impulse: AmmoVector3): void;
    applyTorqueImpulse?(impulse: AmmoVector3): void;
    activate?(): void;
    setWorldTransform?(transform: unknown): void;
    getWorldTransform?(transform: unknown): void;
    setCollisionFlags?(flags: number): void;
    getCollisionFlags?(): number;
    setLinearVelocity?(v: AmmoVector3): void;
    setAngularVelocity?(v: AmmoVector3): void;
}

export interface AmmoVector3 {
    x(): number;
    y(): number;
    z(): number;
}

export interface AmmoWorld {
    stepSimulation(dt: number, maxSubSteps: number, fixedTimeStep: number): void;
    addRigidBody(body: AmmoRigidBody): void;
    removeRigidBody?(body: AmmoRigidBody): void;
    addConstraint?(constraint: AmmoPoint2PointConstraint): void;
    removeConstraint?(constraint: AmmoPoint2PointConstraint): void;
    setGravity?(gravity: unknown): void;
    getDispatcher?(): {
        getNumManifolds(): number;
        getManifoldByIndexInternal(i: number): AmmoManifold | null;
    };
}

export interface AmmoCollisionShape {
    setMargin(m: number): void;
    calculateLocalInertia(mass: number, inertia: unknown): void;
    addPoint?(v: unknown): void;
    addChildShape?(transform: unknown, shape: unknown): void;
    recalculateLocalAabb?(): void;
}

export interface AmmoManifold {
    getNumContacts(): number;
    getBody0(): unknown;
    getBody1(): unknown;
    getContactPoint(i: number): {
        getDistance(): number;
        getAppliedImpulse?(): number;
    };
}

export interface BodyAudioMeta {
    id: number;
    type?: string;
    mass?: number;
    inertiaScalar?: number;
    surface?: string;
}

export interface BodyDragMeta {
    dragFactor: number;
}

export interface AmmoPoint2PointConstraint {
    setPivotB(v: AmmoVector3): void;
    get_m_setting?(): AmmoConstraintSettings;
    m_setting?: AmmoConstraintSettings;
}

export interface AmmoConstraintSettings {
    set_m_impulseClamp?(value: number): void;
    set_m_tau?(value: number): void;
    set_m_damping?(value: number): void;
    m_impulseClamp?: number;
    m_tau?: number;
    m_damping?: number;
}

export interface AmmoTransform {
    setIdentity(): void;
    setOrigin(v: unknown): void;
    setRotation(q: unknown): void;
}

export interface AmmoModule {
    btVector3: new (x?: number, y?: number, z?: number) => AmmoVector3 & { x(): number; y(): number; z(): number };
    btQuaternion: new (x: number, y: number, z: number, w: number) => unknown;
    btTransform: new () => AmmoTransform;
    btDefaultCollisionConfiguration: new () => unknown;
    btCollisionDispatcher: new (config: unknown) => unknown;
    btDbvtBroadphase: new () => unknown;
    btSequentialImpulseConstraintSolver: new () => unknown;
    btDiscreteDynamicsWorld: new (
        dispatcher: unknown,
        broadphase: unknown,
        solver: unknown,
        config: unknown
    ) => AmmoWorld;
    btBoxShape: new (halfExtents: unknown) => AmmoCollisionShape;
    btCylinderShape: new (halfExtents: unknown) => AmmoCollisionShape;
    btCompoundShape: new () => AmmoCollisionShape;
    btConvexHullShape: new () => AmmoCollisionShape;
    btDefaultMotionState: new (transform: unknown) => unknown;
    btRigidBodyConstructionInfo: new (
        mass: number,
        motionState: unknown,
        shape: unknown,
        inertia: unknown
    ) => unknown;
    btRigidBody: new (info: unknown) => AmmoRigidBody;
    btSphereShape: new (radius: number) => AmmoCollisionShape;
    btPoint2PointConstraint: new (
        bodyA: AmmoRigidBody,
        bodyB: AmmoRigidBody | AmmoVector3,
        pivotA?: unknown,
        pivotB?: unknown
    ) => AmmoPoint2PointConstraint;
    btGeneric6DofConstraint: new (
        bodyA: AmmoRigidBody,
        bodyB: AmmoRigidBody,
        transformA: unknown,
        transformB: unknown,
        useLinearReferenceFrameA: boolean
    ) => unknown;
    castObject(obj: unknown, type: unknown): AmmoRigidBody;
    wrapPointer?(ptr: number, type: unknown): AmmoRigidBody;
    destroy(obj: unknown): void;
}

declare module 'ammo.js' {
    function Ammo(): Promise<AmmoModule>;
    export default Ammo;
}
