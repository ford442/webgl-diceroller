/**
 * The host surface dice-core touches, declared at exactly the width it uses.
 *
 * The package compiles against `lib: ["ES2022"]` + Node types and no DOM lib
 * (tsconfig.json), so `document`, `window`, `HTMLElement` and friends are
 * compile errors here. What is left is what a page *and* a worker *and* Node
 * share closely enough for the engine: the global `self` (page or worker),
 * module workers, WebAssembly validation and Web Crypto. Adding a name to this
 * file widens the package boundary; prefer an injected dependency.
 */

/** Page or worker global, narrowed to what the bridge and worker read. */
interface DiceCoreHostGlobal {
    readonly name?: string;
    readonly location?: { readonly href?: string; readonly search?: string };
    readonly crossOriginIsolated?: boolean;
    postMessage(message: unknown, transfer?: Transferable[]): void;
    onmessage: ((event: { data: any }) => void) | null;
}

declare const self: DiceCoreHostGlobal;

/** Defined only inside a dedicated/shared worker. */
declare const WorkerGlobalScope: (abstract new () => unknown) | undefined;

type Transferable = ArrayBuffer | MessagePort;

type BufferSource = ArrayBufferView | ArrayBuffer;

interface ErrorEvent extends Event {
    readonly message: string;
    readonly error: unknown;
}

/** Module worker handle, as the page-side WorkerPhysicsBridge uses it. */
declare class Worker {
    constructor(url: URL | string, options?: { type?: 'module' | 'classic'; name?: string });
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: ErrorEvent) => void) | null;
    postMessage(message: unknown, transfer?: Transferable[]): void;
    addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
    addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
    removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
    removeEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
    terminate(): void;
}

declare namespace WebAssembly {
    function validate(bytes: BufferSource): boolean;
}

type Crypto = import('node:crypto').webcrypto.Crypto;

interface ImportMeta {
    /** Vite's injected env; absent under plain Node. */
    readonly env?: { readonly BASE_URL?: string; readonly [key: string]: unknown };
}
