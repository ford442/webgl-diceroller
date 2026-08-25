// Shared contracts for the physics layer (issue #192). `PhysicsEngine` is the
// low-level object each bridge drives (the Embind surface of dice_physics.cpp,
// or a proxy/stub with the same shape). `PhysicsBridgeModule` is the shape
// PhysicsBridge.js, WasmPhysicsBridge.js, and WorkerPhysicsBridge.js must all
// export so they stay drop-in compatible with each other.

export interface PhysicsEngine {
    setFlags(flags: number): void;
    init(gravity: number, tableY: number, tableHalfW: number, tableHalfD: number): void;
    reset(): void;
    step(dt?: number): void;
    addDie(sides: number, x: number, y: number, z: number): number;
    removeDie(id: number): void;
    clearAllDice(): void;
    setDieMaterial(id: number, friction: number, rollingFriction: number): void;
    setDieDrag(id: number, drag: number): void;
    setDieHull(id: number, sidesOrHull: number | unknown): void;
    setDieFaceTable?(id: number, packed: unknown): void;
    getDieFaceValue?(id: number): number;
    getFaceValues?(): Int32Array;
    applyImpulse(id: number, fx: number, fy: number, fz: number): void;
    applyTorqueImpulse(id: number, tx: number, ty: number, tz: number): void;
    setDieTransform(
        id: number,
        px: number,
        py: number,
        pz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number
    ): void;
    setDieVelocity(
        id: number,
        lvx: number,
        lvy: number,
        lvz: number,
        avx: number,
        avy: number,
        avz: number
    ): void;
    setDieKinematic(id: number, kinematic: boolean): void;
    setContainerActive(active: boolean): void;
    setContainerPlanes(planes: Float32Array | number[]): void;
    clearStatics(): void;
    removeStatic(userId: number): boolean;
    addStaticBox(
        userId: number,
        cx: number,
        cy: number,
        cz: number,
        hx: number,
        hy: number,
        hz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number,
        materialTag: number
    ): number;
    addStaticPlane(
        userId: number,
        nx: number,
        ny: number,
        nz: number,
        dist: number,
        materialTag: number
    ): number;
    addStaticConvexHull(
        userId: number,
        cx: number,
        cy: number,
        cz: number,
        qx: number,
        qy: number,
        qz: number,
        qw: number,
        flatVerts: number[] | Float32Array,
        materialTag: number
    ): number;
    addStaticOpenCylinder(
        userId: number,
        cx: number,
        cy: number,
        cz: number,
        radius: number,
        halfHeight: number,
        segments: number,
        closedBottom: boolean,
        materialTag: number
    ): number;
    getTransforms(): Float32Array;
    getDieIds(): Float32Array;
    getDieCount(): number;
    getLastStepStats(): {
        pairCandidates: number;
        sphereTests: number;
        satTests: number;
        contacts: number;
    };
    /**
     * Cumulative count of addStatic* calls rejected because MAX_STATICS was
     * reached. Not available synchronously on the worker bridge (fire-and-
     * forget commands can't report engine state back) — undefined there.
     */
    getStaticCapacityDroppedCount?(): number;
    areAllSettled(): boolean;
    seedRNG(seed: number): void;
    randomFloat(): number;
    getCollisionEvents(): Float32Array;
    serializeState(): Uint8Array;
    deserializeState(data: unknown): void;
}

export interface CollisionEvent {
    idA: number;
    idB: number;
    impactSpeed: number;
    mass: number;
    inertiaScalar: number;
    linearSpeedSq: number;
    angularSpeedSq: number;
    staticColliderId?: number;
    materialTag?: number;
}

export interface PhysicsBridgeModule {
    loadWasmEngine(): Promise<boolean>;
    isWasmAvailable(): boolean;
    isWasmInitialized(): boolean;
    getWasmEngine(): PhysicsEngine;
    loadHullForDie(wasmId: number, sides: number): void;
    pollCollisionEvents(): CollisionEvent[];
    seedPhysicsRNG(seed: number): void;
    randomPhysicsFloat(): number;
    serializePhysicsState(): Promise<Uint8Array>;
    seededPhysicsThrow(
        seed: number,
        dice: { id: number; index: number }[],
        tableSurfaceY: number
    ): void;
    deserializePhysicsState(data: Uint8Array): void;
    setContainerActive(isActive: boolean): void;
    setContainerPlanes(planes: Float32Array | number[]): void;
    flushWorkerCommandBatch?(): void;
    getPhysicsStepStats?(): {
        pairCandidates: number;
        sphereTests: number;
        satTests: number;
        contacts: number;
    } | null;
    getWorkerPhysicsStats?(): {
        usingCommandBatch: boolean;
        usingSAB: boolean;
        msgsPerSecond: number;
        batchRecords: number;
        stepStats?: {
            pairCandidates: number;
            sphereTests: number;
            satTests: number;
            contacts: number;
        } | null;
    } | null;
}
