/**
 * Canonical inventory of external prop geometry and shared PBR texture sets.
 * Procedural props (inline BufferGeometry in src/environment/*.js) have no
 * external mesh source and are listed under proceduralProps for documentation.
 */

export const PROP_MESH_SOURCES = [
    {
        id: 'billiard_lamp',
        label: 'Billiard Lamp',
        srcRel: 'public/images/lamp/RenderStuff_Breckenridge_triple_billiard_lamp.obj',
        outRel: 'public/images/props/billiard_lamp.glb',
        loader: 'obj',
        runtimeModule: 'src/environment/Lamp.js',
    },
];

export const TEXTURE_ENTRIES = [
  // Wood set
  { set: 'wood', role: 'diffuse', src: 'wood_diffuse.jpg', linear: false, colorSpace: 'srgb' },
  { set: 'wood', role: 'roughness', src: 'wood_roughness.jpg', linear: true, colorSpace: 'linear' },
  { set: 'wood', role: 'bump', src: 'wood_bump.jpg', linear: true, colorSpace: 'linear' },
  // Table set
  { set: 'table', role: 'diffuse', src: 'table_diff.jpg', linear: false, colorSpace: 'srgb' },
  { set: 'table', role: 'roughness', src: 'table_rough.jpg', linear: true, colorSpace: 'linear' },
  { set: 'table', role: 'normal', src: 'table_nor.jpg', linear: true, colorSpace: 'linear' },
  { set: 'table', role: 'ao', src: 'table_ao.jpg', linear: true, colorSpace: 'linear' },
  // Brick set
  { set: 'brick', role: 'diffuse', src: 'brick_diffuse.jpg', linear: false, colorSpace: 'srgb' },
  { set: 'brick', role: 'bump', src: 'brick_bump.jpg', linear: true, colorSpace: 'linear' },
  { set: 'brick', role: 'roughness', src: 'brick_roughness.jpg', linear: true, colorSpace: 'linear' },
  // Lamp textures
  { set: 'lamp', role: 'copper', src: 'lamp/RenderStuff_Breckenridge_triple_billiard_lamp_cooper.jpg', linear: false, colorSpace: 'srgb' },
  { set: 'lamp', role: 'glass', src: 'lamp/RenderStuff_Breckenridge_triple_billiard_lamp_glass.jpg', linear: false, colorSpace: 'srgb' },
  { set: 'lamp', role: 'glass_bump', src: 'lamp/RenderStuff_Breckenridge_triple_billiard_lamp_glass_bump.jpg', linear: true, colorSpace: 'linear' },
  { set: 'lamp', role: 'steel', src: 'lamp/RenderStuff_Breckenridge_triple_billiard_lamp_steel.jpg', linear: false, colorSpace: 'srgb' },
  { set: 'lamp', role: 'wood', src: 'lamp/RenderStuff_Breckenridge_triple_billiard_lamp_wood.jpg', linear: false, colorSpace: 'srgb' },
];

/** Props built from inline THREE.BufferGeometry (no external mesh file in repo). */
export const PROCEDURAL_PROP_MODULES = [
    'Table', 'TavernWalls', 'Room', 'Bookshelf', 'Chair', 'Chest', 'Fire',
    'AleKeg', 'DiceBag', 'DiceJail', 'DiceTower', 'DiceTray', 'DMScreen', 'Lute',
    'Gong', 'Runecircle', 'Atmosphere', 'TarotDeck', 'PlayingCards', 'Flute',
    // clutter/* and remaining tier-2/3 props
];
