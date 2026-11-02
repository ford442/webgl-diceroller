/** Shared interaction hook types for drag/levitation motion tracking. */
export interface InteractionHooks {
    onMotionActivityChange?: (active: boolean, reason: 'drag' | 'levitation') => void;
    /**
     * Whether the pointer may pick this die up. Absent means every die can be
     * grabbed; a game that owns the jail uses it to keep set-aside dice put.
     */
    isDieGrabbable?: (die: import('./dice').SpawnedDie) => boolean;
}
