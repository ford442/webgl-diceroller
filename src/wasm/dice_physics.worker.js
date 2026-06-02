/**
 * dice_physics.worker.js
 *
 * Web Worker that hosts the WASM physics engine.
 * Load this via: new Worker('/wasm/dice_physics.worker.js', { type: 'module' })
 *
 * Protocol:
 *   Main → Worker: { type: 'init', payload: { gravity, tableY, tableHalfW, tableHalfD } }
 *   Main → Worker: { type: 'addDie', payload: { sides, x, y, z, hull?: number[] } }
 *   Main → Worker: { type: 'removeDie', payload: { id } }
 *   Main → Worker: { type: 'clearAllDice' }
 *   Main → Worker: { type: 'setDieTransform', payload: { id, px,py,pz, qx,qy,qz,qw } }
 *   Main → Worker: { type: 'setDieVelocity', payload: { id, lvx,lvy,lvz, avx,avy,avz } }
 *   Main → Worker: { type: 'applyImpulse', payload: { id, fx, fy, fz } }
 *   Main → Worker: { type: 'applyTorqueImpulse', payload: { id, tx, ty, tz } }
 *   Main → Worker: { type: 'step', payload: { dt } }
 *   Main → Worker: { type: 'seedRNG', payload: { seed } }
 *   Main → Worker: { type: 'serializeState' }
 *   Main → Worker: { type: 'deserializeState', payload: { data: number[] } }
 *
 *   Worker → Main: { type: 'stepped', payload: { transforms: Float32Array, events: Float32Array } }
 *   Worker → Main: { type: 'state', payload: { data: Uint8Array } }
 *   Worker → Main: { type: 'error', payload: { message } }
 */

import DicePhysicsModule from './dice_physics.js';

let Module = null;
let engine = null;

async function ensureEngine() {
    if (engine) return;
    Module = await DicePhysicsModule();
    engine = new Module.DicePhysicsEngine();
}

self.onmessage = async (e) => {
    const { type, payload } = e.data;
    try {
        await ensureEngine();
        switch (type) {
            case 'init':
                engine.init(payload.gravity, payload.tableY, payload.tableHalfW, payload.tableHalfD);
                break;
            case 'addDie': {
                const id = engine.addDie(payload.sides, payload.x, payload.y, payload.z);
                if (payload.hull && id >= 0) {
                    const vec = new Module.VectorFloat();
                    for (const v of payload.hull) vec.push_back(v);
                    engine.setDieHull(id, vec);
                }
                self.postMessage({ type: 'dieAdded', payload: { id } });
                break;
            }
            case 'removeDie':
                engine.removeDie(payload.id);
                break;
            case 'clearAllDice':
                engine.clearAllDice();
                break;
            case 'setDieTransform':
                engine.setDieTransform(payload.id, payload.px, payload.py, payload.pz, payload.qx, payload.qy, payload.qz, payload.qw);
                break;
            case 'setDieVelocity':
                engine.setDieVelocity(payload.id, payload.lvx, payload.lvy, payload.lvz, payload.avx, payload.avy, payload.avz);
                break;
            case 'applyImpulse':
                engine.applyImpulse(payload.id, payload.fx, payload.fy, payload.fz);
                break;
            case 'applyTorqueImpulse':
                engine.applyTorqueImpulse(payload.id, payload.tx, payload.ty, payload.tz);
                break;
            case 'step':
                engine.step(payload.dt);
                const transforms = engine.getTransforms();
                const events = engine.getCollisionEvents();
                // Transfer buffers to avoid copy
                self.postMessage(
                    { type: 'stepped', payload: { transforms, events } },
                    [transforms.buffer, events.buffer]
                );
                break;
            case 'seedRNG':
                engine.seedRNG(payload.seed);
                break;
            case 'randomFloat': {
                const value = engine.randomFloat();
                self.postMessage({ type: 'random', payload: { value } });
                break;
            }
            case 'serializeState': {
                const vec = engine.serializeState();
                const arr = new Uint8Array(vec.size());
                for (let i = 0; i < vec.size(); i++) arr[i] = vec.get(i);
                self.postMessage({ type: 'state', payload: { data: arr } }, [arr.buffer]);
                break;
            }
            case 'deserializeState': {
                const vec = new Module.VectorU8();
                for (const b of payload.data) vec.push_back(b);
                engine.deserializeState(vec);
                break;
            }
            default:
                self.postMessage({ type: 'error', payload: { message: 'Unknown command: ' + type } });
        }
    } catch (err) {
        self.postMessage({ type: 'error', payload: { message: err.message || String(err) } });
    }
};
