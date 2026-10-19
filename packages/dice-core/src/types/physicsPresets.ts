export interface PhysicsPreset {
    mass: number;
    friction: number;
    rollingFriction: number;
    restitution?: number;
    linearDamping?: number;
    angularDamping?: number;
    dragFactor?: number;
}
