# Dice set format (v1)

A **dice set** is a portable, versioned description of what a player's dice look
like and how their faces are numbered. It is plain data — no Three.js, no DOM,
no GLB references beyond a shape id — so it can be hashed, shared as a link,
stored, sent over multiplayer presence, and read by a headless consumer.

- `src/dice/DiceSetFormat.ts` — the types, defaults, normalisation and hash.
- `src/dice/ShareableDiceSet.ts` — URL token, `localStorage`, presence payload.

Both modules are dependency-free and import cleanly in Node with no renderer in
the module graph.

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

The v0 `{ preset, bodyColor, pipColor }` config in `DiceAppearanceConfig.js`
still works. `loadStoredDiceSet()` reads the old `dice-roller-appearance` key
and migrates it when no v1 set is present, and `toLegacyAppearanceConfig()`
projects a set back onto the v0 shape for `DiceMaterials` and the per-type
short code. `normalizeMaterialSpec` also accepts `pipColor` as a spelling of
`markingColor`, so old payloads decode without loss.

Every parser is total: `normalizeDiceSet()` never throws and fills each gap
with that die's curated default.

## Not yet wired

The descriptor is ahead of the renderer, deliberately.

- `faces` (style, glyph set, font, depth) is carried and hashed but not yet
  consumed — that needs the MSDF atlas and the TSL material work.
- `body.translucency` and `body.inclusion` are likewise descriptor-only.
- The derived die types are expressible but not yet selectable: notation's
  `SUPPORTED_SIDES` and the spawn path still need to read `DIE_TYPE_CATALOG`
  before `dF` or `d2` can be rolled at the table.
