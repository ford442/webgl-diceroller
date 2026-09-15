# Dice set format (v1)

A **dice set** is a portable, versioned description of what a player's dice look
like and how their faces are numbered. It is plain data — no Three.js, no DOM,
no GLB references beyond a shape id — so it can be hashed, shared as a link,
stored, sent over multiplayer presence, and read by a headless consumer.

- `src/dice/DiceSetFormat.ts` — the types, defaults, normalisation and hash.
- `src/dice/ShareableDiceSet.ts` — URL token, `localStorage`, presence payload.
- `src/dice/DiceFaceGlyphs.ts` — which glyph each face shows.
- `src/dice/DiceShadingParams.ts` — the numbers the two material twins shade from.
- `src/dice/LegacyDiceLook.ts` — decoder for the v0 `?dice-look=` short code.
- `src/dice/DiceSetRuntime.ts` — the live set: resolve, patch, notify, presence.

All of these are dependency-free and import cleanly in Node with no renderer in
the module graph. The renderer side is `DiceMaterials` and its two twins.

## Shape

```ts
interface DiceSet {
    version: 1;
    id: string; // content hash, derived — never authored
    name: string;
    dice: Record<
        DieKey,
        {
            shape: DieShapeId; // which mesh the die rides on
            body: MaterialSpec; // preset, colours, translucency, inclusion
            faces: FaceMarkingSpec; // engraved | inlaid | painted, glyph set, font, depth
            numbering: NumberingSpec; // start/step, or an explicit per-face sequence
        }
    >;
}
```

`DieKey` is the die as a player names it (`d6`, `dF`). `DieShapeId` is the
physical mesh it uses (`d4` `d6` `d8` `d10` `d12` `d20`) — the two are not the
same thing, and that gap is what lets new die types ship without new assets.

## Content hash

`id` is an FNV-1a/64 hash of the canonical JSON form (keys sorted recursively,
`id` itself excluded). Identical content always produces an identical id,
independent of key order or how the set was built, so sets are cacheable,
comparable across peers, and tamper-evident: `parseDiceSetPresencePayload`
drops a peer's payload whose advertised id disagrees with its content.

Always derive it with `withComputedId()` / `computeDiceSetId()` after editing a
set rather than carrying a stale value.

## Numbering, and dice with no mesh of their own

`NumberingSpec.sequence` maps each natural face (the value the mesh's face map
reads, `1..faceCount`) to the value that face actually shows. That turns a new
die type into a table entry instead of an authoring task — `DIE_TYPE_CATALOG`
already derives `dF`, `d2`, `d3`, `d5` and `d100` from meshes we ship:

| key  | shape | sequence             |
| ---- | ----- | -------------------- |
| `dF` | `d6`  | `-1, 0, 1, -1, 0, 1` |
| `d2` | `d6`  | `1, 2, 1, 2, 1, 2`   |
| `d3` | `d6`  | `1, 2, 3, 1, 2, 3`   |

Use `resolveFaceValue(entry, naturalValue)` on the read path; never assume the
face value equals the number the player sees.

## Transport

| Hop            | Call                                                                   |
| -------------- | ---------------------------------------------------------------------- |
| URL            | `buildDiceSetShareUrl` / `parseDiceSetFromParams` (`?dice-set=`)       |
| `localStorage` | `persistDiceSet` / `loadStoredDiceSet`                                 |
| Presence       | `buildDiceSetPresencePayload` / `parseDiceSetPresencePayload`          |
| All three      | `resolveDiceSet(searchParams)` — URL wins, then storage, then defaults |

The token is base64url over the canonical JSON, so a set survives every hop
byte-for-byte and keeps its id.

## Compatibility with v0

`DiceAppearanceConfig.js` is gone — v1 is the only appearance system — but every
v0 payload it could produce is still read. `loadStoredDiceSet()` reads the old
`dice-roller-appearance` key and migrates it when no v1 set is present,
`resolveDiceSet()` overlays a v0 `?dice-look=` token onto whatever the browser
already has, and `toLegacyAppearanceConfig()` projects a set back onto the v0
shape for anything that still speaks it. Share links carry `?dice-set=`; none
are written with the v0 short code any more. `normalizeMaterialSpec` also
accepts `pipColor` as a spelling of `markingColor`, so old payloads decode
without loss.

Every parser is total: `normalizeDiceSet()` never throws and fills each gap
with that die's curated default.

## How a set reaches the table

`DiceSetRuntime` owns the live set. Nothing else keeps a copy: the renderer, the
dice case, presence and share links all read it, and `updateDieEntry()` is the
only way it changes. Every consumer that used to take a
`{ preset, bodyColor, pipColor }` triple now takes a `DiceSetEntry`.

### Markings are data

Face markings are drawn by the die material, not carried by the mesh:

1. `planFaceGlyphs(entry)` turns `numbering` + `faces.glyphs` into one glyph per
   natural face — numerals, pips, or the Fudge `+ / 0 / −` set, falling back to
   numerals for any value a glyph set cannot express.
2. `DiceGlyphAtlas` rasterises each distinct glyph once into a signed-distance
   atlas, built at runtime from the `faces.font` key. Changing the font, the
   glyph set or the numbering rebuilds that texture; it never fetches an asset.
3. `DiceFaceFrames` derives each face's centre, inradius and an upright tangent
   frame from the hull's own triangles, so the material can find which face a
   fragment is on and where the glyph sits.
4. The material samples the atlas and shades the result. `faces.style` is three
   parameter sets of one material — `engraved` cuts and shadows, `inlaid` fills
   and dips, `painted` fills flat — not three meshes.

`body.translucency` maps onto transmission and thickness (composed with whatever
the preset already asked for), and `body.inclusion` is a domain-warped noise term
in the body colour: `swirl`, `galaxy` and `glitter` cost no extra geometry.

### Two twins, one descriptor

- `DiceFaceMarkingMaterial.js` — GLSL, patched into `MeshPhysicalMaterial` for
  `WebGLRenderer`.
- `DiceFaceMarkingNodeMaterial.js` — TSL `MeshPhysicalNodeMaterial` for
  `WebGPURenderer`, lazily imported so the WebGL path never loads the node system.

Both read `diceShadingParams(entry)`, so neither can drift into shading the same
descriptor differently. `setDiceMaterialBackend()` picks one; nothing outside
`DiceMaterials` knows which.

### Derived die types are rollable

`DIE_TYPE_CATALOG` is now the only list of which dice exist. Notation's supported
sides are derived from it (so `d2`, `d3` and `d5` parse), `dF` is spelled out in
the grammar, and the spawn path maps a die key to the hull it rides on before it
talks to physics. The engine and the face-normal clusterer still speak natural
faces; `readDiceValue()` resolves those through `resolveFaceValue` so a dF that
settles on natural face 6 reports `+1`.

## Still owed to the asset pipeline

The shipped hulls carry their numerals as recessed geometry, in a second draw
group. Two consequences:

- Where the descriptor asks for exactly what the mesh was authored with —
  numerals, natural numbering, the default font — the material uses that relief
  directly (`canUseBakedMarkings`). That is why the default set renders
  identically to before this change.
- Where it asks for anything else, the atlas draws the real glyphs and the
  material flattens the stale relief's _marking_ group back into its face. The
  recess itself is body geometry, so a faint ghost of the authored numerals
  remains under a non-default glyph plan.

Re-exporting the hulls with flat faces (and per-face UV islands, to skip the
runtime projection) removes that ghost. It needs the Blender/Collada sources
re-authored, so it is asset work, not renderer work — and it is the last thing
standing between the descriptor and the table.
