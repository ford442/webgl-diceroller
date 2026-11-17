/**
 * The scenes the app can load, and how one is chosen.
 *
 * `?scene=<id>` picks a document. An unknown id logs and gets the tavern, so a
 * stale or mistyped link still opens a table. Documents are plain data:
 * adding a room is a new file here plus a line in `SCENES`, never an edit to
 * `main.js`.
 */
import { CHART_ROOM_SCENE } from './chartRoom';
import type { SceneDocument } from './SceneDocument';
import { TAVERN_SCENE } from './tavern';

export const DEFAULT_SCENE_ID = 'tavern';

export const SCENES: Readonly<Record<string, SceneDocument>> = {
    [TAVERN_SCENE.id]: TAVERN_SCENE,
    [CHART_ROOM_SCENE.id]: CHART_ROOM_SCENE,
};

export const SCENE_IDS: readonly string[] = Object.keys(SCENES);

export const DEFAULT_SCENE: SceneDocument = TAVERN_SCENE;

/** The document for `id`, or the default scene when `id` is missing or unknown. */
export function getSceneDocument(id: string | null | undefined): SceneDocument {
    const wanted = id?.trim().toLowerCase();
    if (!wanted) return DEFAULT_SCENE;
    const found = Object.hasOwn(SCENES, wanted) ? SCENES[wanted] : undefined;
    if (found) return found;
    console.warn(
        `[Scene] Unknown scene "${id}"; loading "${DEFAULT_SCENE_ID}". Known: ${SCENE_IDS.join(', ')}.`
    );
    return DEFAULT_SCENE;
}

/** The scene a URL asks for (`?scene=`), falling back to the tavern. */
export function resolveSceneDocument(
    search: string | URLSearchParams = typeof window !== 'undefined' ? window.location.search : ''
): SceneDocument {
    const params = typeof search === 'string' ? new URLSearchParams(search) : search;
    return getSceneDocument(params.get('scene'));
}
