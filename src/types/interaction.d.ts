/** Shared interaction hook types for drag/levitation motion tracking. */
export interface InteractionHooks {
    onMotionActivityChange?: (active: boolean, reason: 'drag' | 'levitation') => void;
}
