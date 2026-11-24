/**
 * "A new version is ready" (#383).
 *
 * The service worker uses `skipWaiting` + `clientsClaim`, so after a redeploy
 * the new worker takes over open tabs at once. The page in memory is still the
 * old build, though, and its lazy chunks now resolve against the new precache.
 * We do not reload under the player (a roll may be in flight); we say so and
 * offer the reload. The first-ever install also fires `controllerchange`, which
 * is not an update, so the first takeover of a page that started with no
 * controller is skipped and only a later one is announced.
 */

export interface UpdateNoticeOptions {
    serviceWorker?: Pick<ServiceWorkerContainer, 'addEventListener' | 'controller'> | null;
    notify: () => void;
}

/** Returns a disposer. A no-op where service workers do not exist. */
export function watchForServiceWorkerUpdate(options: UpdateNoticeOptions): () => void {
    const sw = options.serviceWorker ?? null;
    if (!sw) return () => {};
    // A page that loaded with no controller is on a first visit: the worker's first
    // takeover (clientsClaim) is the install, the next one is an update.
    let pending = sw.controller ? 0 : 1;
    let announced = false;
    const onChange = () => {
        if (pending > 0) {
            pending -= 1;
            return;
        }
        if (announced) return;
        announced = true;
        options.notify();
    };
    sw.addEventListener('controllerchange', onChange);
    return () => (sw as ServiceWorkerContainer).removeEventListener?.('controllerchange', onChange);
}
