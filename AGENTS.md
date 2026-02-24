# WebGL Dice Roller - Agent Documentation

## Project Overview

This is a **WebGL-based 3D dice roller application** built with Three.js. The application simulates a tavern-themed environment where users can spawn, throw, and interact with various gaming dice (d4, d6, d8, d10, d12, d20) using realistic physics.

The project was originally built using the CubicVR engine (see `legacy/` directory) and has been migrated to a modern Three.js + Vite stack.

## Technology Stack

| Component | Technology |
|-----------|------------|
| 3D Engine | Three.js (r0.181.2) |
| Physics | ammo.js (Bullet Physics WASM port) |
| Build Tool | Vite (v7.3.1) |
| Rendering | WebGLRenderer with post-processing |
| Module System | ES Modules |

## Project Structure

```
webgl-diceroller/
├── src/                      # Main source code
│   ├── main.js               # Entry point: scene setup, render loop
│   ├── dice.js               # Dice loading, spawning, and throw logic
│   ├── physics.js            # ammo.js physics initialization and helpers
│   ├── interaction.js        # Mouse/raycaster interaction (drag, levitate)
│   ├── ui.js                 # DOM-based UI controls
│   ├── shaders/              # Custom GLSL shaders
│   │   ├── VignetteShader.js
│   │   └── GodRayShader.js
│   └── environment/          # Scene environment components
│       ├── Table.js          # Main dice table
│       ├── TavernWalls.js    # Room walls with fireplace
│       ├── TavernEnvironment.js  # Environment map for PBR
│       ├── Clutter.js        # Candle and small items
│       ├── Lamp.js           # Hanging billiard lamp
│       ├── Bookshelf.js, Chair.js, Chest.js, etc.  # Decor props
│       └── ...
├── public/                   # Static assets
│   ├── images/               # Dice models (Collada .dae), textures
│   │   ├── die_4.dae, die_6.dae, die_8.dae, etc.
│   │   ├── table_diff.jpg, table_nor.jpg, etc.
│   │   └── lamp/             # Lamp 3D model (OBJ)
│   └── js/ammo.js            # Physics engine (legacy placement)
├── raw_models/               # Source Blender files (.blend)
├── legacy/                   # Original CubicVR implementation
├── index.html                # HTML entry point
├── vite.config.js            # Vite configuration
├── package.json              # npm dependencies
└── deploy.py                 # SFTP deployment script
```

## Build and Development Commands

```bash
# Install dependencies
npm install

# Start development server (hot reload on http://localhost:5173)
npm run dev

# Build for production (outputs to dist/)
npm run build

# Preview production build locally
npm run preview
```

## Architecture Details

### Core Modules

#### `main.js`
- Initializes Three.js scene, WebGLRenderer, and EffectComposer
- Sets up lighting (warm candle point light, cool moonlight spotlight)
- Configures post-processing: UnrealBloomPass + VignetteShader + OutputPass
- Implements the "Eye-Head" camera control system with pointer lock
- Manages the dice focus state machine (IDLE → WAITING_FOR_STOP → FOCUSING → HOLDING → RETURNING)
- Main animation loop updates physics, visuals, atmosphere, and camera

#### `dice.js`
- Loads Collada (.dae) dice models from `public/images/`
- Converts materials to PBR MeshStandardMaterial
- Creates convex hull collision shapes for physics
- `spawnObjects()` - Spawns dice with random positions/rotations
- `throwDice()` - Applies random forces and torque for throwing
- `updateDiceVisuals()` - Syncs Three.js meshes with ammo.js physics bodies

#### `physics.js`
- Initializes ammo.js (Bullet Physics) world with gravity (-15 Y)
- `createConvexHullShape()` - Generates collision shapes from mesh geometry
- `createFloorAndWalls()` - Creates physics boundaries for the table
- `spawnDicePhysics()` - Configures rigid body properties (mass=5, friction=0.6, restitution=0.2)

#### `interaction.js`
- Raycasting for dice selection and dragging
- Point-to-point constraint-based dragging (drag dice with mouse)
- Double-click to trigger levitation effect (kinematic animation with blue glow)
- `registerInteractiveObject()` API for static prop interaction

#### `ui.js`
- Creates DOM overlay for dice count inputs (d4-d20)
- "Roll All" button triggers physics throw
- Crosshair element for pointer lock navigation

### Environment System

Environment components are modular and export factory functions:
- Each returns `{ mesh/group, physicsBody?, update?, ... }`
- Physics bodies registered with physics world
- Some provide `update(deltaTime)` for animations (flickering lights, particles)

Key environment features:
- **Table**: 20x20 unit surface with raised rims, physics bounds
- **TavernAtmosphere**: Dust motes particle system
- **Lighting**: Candle (warm, flickering), fireplace (animated), moonlight (cool spotlight)
- **Props**: Bookshelf, chairs, chest, dice tower, dice jail, potion set, etc.

### Post-Processing Pipeline

1. **RenderPass** - Renders the scene
2. **UnrealBloomPass** - Glow effect for flames/lights (threshold=0.6, strength=0.6)
3. **ShaderPass (Vignette)** - Darkens screen corners
4. **OutputPass** - Color space conversion

Disable with URL param: `?no-post`

## Asset Pipeline

### Dice Models
- Format: Collada (.dae) files in `public/images/`
- Source: Blender files in `raw_models/`
- Geometry is centered and rotated on load to ensure proper physics center of mass
- Future plan: Convert to glTF/GLB with Draco compression (see `plan.md`)

### Textures
- PBR workflow: diffuse, roughness, normal, AO maps
- Table surface uses dedicated texture set (`table_*.jpg`)
- Wood props use shared wood texture set (`wood_*.jpg`)
- All textures use `RepeatWrapping` with appropriate repeat counts

## Development Conventions

### Code Style
- ES6 modules with named exports
- Functions use camelCase, constants are UPPER_SNAKE_CASE
- Physics-related objects store references in `userData` (e.g., `mesh.userData.body`)

### Physics Tuning
- Gravity: -15 Y (reduced from -20 for better feel)
- Dice mass: 5
- Friction: 0.6
- Restitution (bounciness): 0.2
- Linear damping: 0.05, Angular damping: 0.1
- Collision margin: 0.01 (tight for edge stability)

### Adding New Environment Props
1. Create new file in `src/environment/PropName.js`
2. Export a function that takes `(scene, physicsWorld?, position?, rotation?)`
3. Return object with at least `{ group }`, optionally `{ update }` for animations
4. Import and call in `main.js` init function
5. Use `registerInteractiveObject(mesh, callback)` for clickable items

### Lighting Guidelines
- Use PointLight for warm candle/fire sources (intensity 2-5, distance 20)
- Use SpotLight for directional moonlight (blue tint)
- All lights should cast shadows with bias (-0.0001 to -0.001) to prevent acne
- Shadow map size: 2048x2048 for quality

## Deployment

The `deploy.py` script uploads the `dist/` directory via SFTP:
```bash
# 1. Build first
npm run build

# 2. Deploy (requires paramiko)
python deploy.py
```

Server details are hardcoded in `deploy.py` (test.1ink.us/dice-roller).

## Security Considerations

- `deploy.py` contains hardcoded credentials - these should be moved to environment variables
- No user input is processed server-side (pure client-side application)
- Physics simulation runs locally only

## Future Roadmap

See `plan.md` for detailed plans including:
- Result determination (which face is up after roll)
- Asset conversion from Collada to glTF/GLB
- WebGPU compute shaders for GPU physics
- Enhanced throwing mechanics (drag-and-release vector)

## Known Limitations

- Result determination (reading dice values) is not yet implemented
- ColladaLoader is deprecated; migration to GLTFLoader recommended
- Physics runs on CPU (ammo.js WASM) - could be GPU-accelerated
- No unit tests currently implemented
