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
    applyImpulse(id: number, fx: number, fy: number, fz: number): void;
    applyTorqueImpulse(id: number, tx: number, ty: number, tz: number): void;
    setDieTransform(id: number, px: number, py: number, pz: number, qx: number, qy: number, qz: number, qw: number): void;
    setDieVelocity(id: number, lvx: number, lvy: number, lvz: number, avx: number, avy: number, avz: number): void;
    getTransforms(): Float32Array;
    getDieIds(): Float32Array;
    getDieCount(): number;
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
    serializePhysicsState(): Uint8Array;
    deserializePhysicsState(data: Uint8Array): void;
    flushWorkerCommandBatch?(): void;
    getWorkerPhysicsStats?(): {
        usingCommandBatch: boolean;
        usingSAB: boolean;
        msgsPerSecond: number;
        batchRecords: number;
    } | null;
}
