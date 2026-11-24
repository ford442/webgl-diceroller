import { describe, expect, it, vi } from 'vitest';
import { watchForServiceWorkerUpdate } from '../../src/core/UpdateNotice.js';

function fakeContainer(controller: unknown) {
    const target = new EventTarget();
    return Object.assign(target, { controller }) as unknown as ServiceWorkerContainer;
}

describe('watchForServiceWorkerUpdate', () => {
    it('announces a takeover only when the page already had a controller (an update)', () => {
        const notify = vi.fn();
        const sw = fakeContainer({});
        watchForServiceWorkerUpdate({ serviceWorker: sw, notify });
        sw.dispatchEvent(new Event('controllerchange'));
        sw.dispatchEvent(new Event('controllerchange'));
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it('stays silent on the first takeover of a page that started with no controller', () => {
        const notify = vi.fn();
        const sw = fakeContainer(null);
        watchForServiceWorkerUpdate({ serviceWorker: sw, notify });
        sw.dispatchEvent(new Event('controllerchange')); // clientsClaim on first install
        expect(notify).not.toHaveBeenCalled();
    });

    it('announces the next takeover of a first-visit page that stayed open across a deploy', () => {
        const notify = vi.fn();
        const sw = fakeContainer(null);
        watchForServiceWorkerUpdate({ serviceWorker: sw, notify });
        sw.dispatchEvent(new Event('controllerchange')); // install
        sw.dispatchEvent(new Event('controllerchange')); // update
        sw.dispatchEvent(new Event('controllerchange'));
        expect(notify).toHaveBeenCalledTimes(1);
    });

    it('is a no-op without service workers', () => {
        expect(() =>
            watchForServiceWorkerUpdate({ serviceWorker: null, notify: vi.fn() })()
        ).not.toThrow();
    });
});
