/**
 * Happy-dom does not implement CanvasRenderingContext2D. Several prop modules
 * build procedural textures at import time, so the PropRegistry import test
 * needs a no-op 2D context (not factory mocks).
 */
function createStubContext2D(canvas) {
    const gradient = { addColorStop() {} };
    const imageData = {
        data: new Uint8ClampedArray(4),
        width: 1,
        height: 1,
        colorSpace: 'srgb',
    };
    return new Proxy(
        { canvas },
        {
            get(target, prop) {
                if (prop in target) return target[prop];
                if (prop === 'createRadialGradient' || prop === 'createLinearGradient') {
                    return () => gradient;
                }
                if (prop === 'createPattern') return () => null;
                if (prop === 'getImageData') return () => imageData;
                if (prop === 'measureText') return () => ({ width: 0 });
                if (typeof prop === 'symbol') return undefined;
                return () => undefined;
            },
            set(target, prop, value) {
                target[prop] = value;
                return true;
            },
        }
    );
}

HTMLCanvasElement.prototype.getContext = function getContext(type) {
    if (type === '2d') return createStubContext2D(this);
    return null;
};
