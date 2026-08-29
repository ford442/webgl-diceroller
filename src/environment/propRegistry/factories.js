// Side-effect imports ensure eager glob discovers factories defined in these modules.
import '../Bone.js';
import '../Cauldron.js';
import '../BreadLoaf.js';
import '../Chalk.js';
import '../Quill.js';

const environmentModules = import.meta.glob('../*.js', { eager: true });

export const PROP_FACTORIES = {};

for (const [path, mod] of Object.entries(environmentModules)) {
    const baseName = path.split('/').pop().replace('.js', '');
    for (const [exportName, value] of Object.entries(mod)) {
        if (typeof value !== 'function' || !exportName.startsWith('create')) continue;
        const factoryName = exportName.slice('create'.length);
        PROP_FACTORIES[factoryName] = value;
        if (!PROP_FACTORIES[baseName]) {
            PROP_FACTORIES[baseName] = value;
        }
    }
}

export const getPropFactory = (name) => {
    const factory = PROP_FACTORIES[name];
    if (!factory) {
        throw new Error(`Missing prop factory "${name}"`);
    }
    return factory;
};
