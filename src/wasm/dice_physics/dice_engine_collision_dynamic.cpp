/**
 * dice_engine_collision_dynamic.cpp — Uniform-grid broadphase helpers.
 * Pair enumeration lives in dice_physics_engine.hpp (templated forEachDiePair);
 * contact generation and the sequential-impulse solve live in
 * dice_engine_solver.cpp.
 */

#include "../dice_physics_engine.hpp"

#include <algorithm>
#include <cmath>

namespace dice_physics {

namespace {

// floor(rel / cell) clamped to [0, maxIndex], clamped *before* the int cast:
// a NaN/Inf or far-off position (a forged snapshot, a degenerate collider)
// must not hit the float->int UB the cast would otherwise be. Identical to
// clamp(int(floor(...))) for every in-range value, so pair order is unchanged.
int cellIndex(float rel, float cell, int maxIndex) {
    const float f = std::floor(rel / cell);
    if (!(f >= 0.0f)) return 0;
    if (f >= static_cast<float>(maxIndex)) return maxIndex;
    return static_cast<int>(f);
}

} // namespace

void DicePhysicsEngine::ensureDieGridDimensions() {
    if (gridCols_ > 0) return;
    gridOriginX_ = -tableHalfW_ - GRID_CELL_SIZE;
    gridOriginZ_ = -tableHalfD_ - GRID_CELL_SIZE;
    const float extentX = 2.0f * tableHalfW_ + 2.0f * GRID_CELL_SIZE;
    const float extentZ = 2.0f * tableHalfD_ + 2.0f * GRID_CELL_SIZE;
    gridCols_ = std::max(1, static_cast<int>(std::ceil(extentX / GRID_CELL_SIZE)));
    gridRows_ = std::max(1, static_cast<int>(std::ceil(extentZ / GRID_CELL_SIZE)));
}

int DicePhysicsEngine::bodyCellXMin(float x, float radius) const {
    const float rel = x - radius - gridOriginX_;
    return cellIndex(rel, GRID_CELL_SIZE, gridCols_ - 1);
}

int DicePhysicsEngine::bodyCellXMax(float x, float radius) const {
    const float rel = x + radius - gridOriginX_;
    return cellIndex(rel, GRID_CELL_SIZE, gridCols_ - 1);
}

int DicePhysicsEngine::bodyCellZMin(float z, float radius) const {
    const float rel = z - radius - gridOriginZ_;
    return cellIndex(rel, GRID_CELL_SIZE, gridRows_ - 1);
}

int DicePhysicsEngine::bodyCellZMax(float z, float radius) const {
    const float rel = z + radius - gridOriginZ_;
    return cellIndex(rel, GRID_CELL_SIZE, gridRows_ - 1);
}

} // namespace dice_physics
