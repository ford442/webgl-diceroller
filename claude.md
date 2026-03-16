# WebGL Dice Roller - Claude Session

## Project Overview
A Three.js/WebGL-based interactive dice rolling simulator with a tavern environment, physics engine (Ammo.js), and dynamic lighting effects.

## Current Issue: Table Lamp Height

### Problem
The billiard lamp hanging above the table has incorrect height positioning. It should hang properly above the table and cast light downward, but currently appears to have wrong height geometry or positioning.

### Current Setup
- **Lamp Position** (main.js:266): `y = 10` (hanging from ceiling)
- **Table Position** (Table.js:18): `y = -3` (table group center)
- **Table Surface**: `y ≈ -2.75` (at top of 0.5-unit floor)
- **Height Gap**: ~12.75 units from table surface to lamp position
- **Lamp Geometry**:
  - Target width: 22 units
  - Target height: 6 units (after scaling)
  - Transformed so top is at Y=0 locally, hangs downward
- **Light Positions** (Lamp.js:141): `lightY = -finalSize.y * 0.3` (positioned 30% down inside shade)

### Key Files
- `src/environment/Lamp.js` - Lamp model loading, geometry transformation, lighting
- `src/main.js` - Lamp instantiation at line 263-270
- `src/environment/Table.js` - Table dimensions and positioning

### Lamp Features
- 3 point lights inside billiard shade (Copper, Steel, Glass materials)
- Multiple light modes: NORMAL, UV, STROBE, RGB, LASER, CRITICAL
- Laser beam effects in certain modes
- Interactive toggle and mode switching via keys (1-5, C)

## Next Step
Adjust lamp height positioning so it properly illuminates the table surface with light casting downward.
