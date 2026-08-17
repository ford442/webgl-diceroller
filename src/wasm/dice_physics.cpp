/**
 * dice_physics.cpp — Emscripten Embind bindings for DicePhysicsEngine.
 *
 * Build:
 *   npm run build:wasm
 */

#include "dice_physics_engine.hpp"

#include <emscripten/bind.h>

using namespace emscripten;
using dice_physics::DicePhysicsEngine;

EMSCRIPTEN_BINDINGS(stl_support) {
    register_vector<float>("VectorFloat");
    register_vector<uint8_t>("VectorU8");
}

EMSCRIPTEN_BINDINGS(step_stats) {
    value_object<dice_physics::StepStats>("StepStats")
        .field("pairCandidates", &dice_physics::StepStats::pairCandidates)
        .field("sphereTests", &dice_physics::StepStats::sphereTests)
        .field("satTests", &dice_physics::StepStats::satTests)
        .field("contacts", &dice_physics::StepStats::contacts);
}

EMSCRIPTEN_BINDINGS(dice_physics) {
    class_<DicePhysicsEngine>("DicePhysicsEngine")
        .constructor()
        .function("setFlags",          &DicePhysicsEngine::setFlags)
        .function("init",              &DicePhysicsEngine::init)
        .function("reset",             &DicePhysicsEngine::reset)
        .function("addDie",            &DicePhysicsEngine::addDie)
        .function("removeDie",         &DicePhysicsEngine::removeDie)
        .function("clearAllDice",      &DicePhysicsEngine::clearAllDice)
        .function("setDieMaterial",    &DicePhysicsEngine::setDieMaterial)
        .function("setDieDrag",        &DicePhysicsEngine::setDieDrag)
        .function("setDieHull",        &DicePhysicsEngine::setDieHull)
        .function("setDieFaceTable",   &DicePhysicsEngine::setDieFaceTable)
        .function("getDieFaceValue",   &DicePhysicsEngine::getDieFaceValue)
        .function("applyImpulse",      &DicePhysicsEngine::applyImpulse)
        .function("applyTorqueImpulse",&DicePhysicsEngine::applyTorqueImpulse)
        .function("setDieTransform",   &DicePhysicsEngine::setDieTransform)
        .function("setDieVelocity",    &DicePhysicsEngine::setDieVelocity)
        .function("setDieKinematic",   &DicePhysicsEngine::setDieKinematic)
        .function("setContainerActive",&DicePhysicsEngine::setContainerActive)
        .function("setContainerPlanes",&DicePhysicsEngine::setContainerPlanes)
        .function("clearStatics",         &DicePhysicsEngine::clearStatics)
        .function("removeStatic",         &DicePhysicsEngine::removeStatic)
        .function("addStaticBox",         &DicePhysicsEngine::addStaticBox)
        .function("addStaticPlane",       &DicePhysicsEngine::addStaticPlane)
        .function("addStaticConvexHull",  &DicePhysicsEngine::addStaticConvexHull)
        .function("addStaticOpenCylinder",&DicePhysicsEngine::addStaticOpenCylinder)
        .function("step",              &DicePhysicsEngine::step)
        .function("getDieCount",       &DicePhysicsEngine::getDieCount)
        .function("getLastStepStats",  &DicePhysicsEngine::getLastStepStats)
        .function("areAllSettled",     &DicePhysicsEngine::areAllSettled)
        .function("getTransforms",     +[](DicePhysicsEngine& e) {
            const auto& buf = e.buildTransformBuffer();
            return val(typed_memory_view(buf.size(), buf.data()));
        })
        .function("getDieIds",         +[](DicePhysicsEngine& e) {
            const auto& buf = e.buildDieIdBuffer();
            return val(typed_memory_view(buf.size(), buf.data()));
        })
        .function("seedRNG",           &DicePhysicsEngine::seedRNG)
        .function("randomFloat",       &DicePhysicsEngine::randomFloat)
        .function("getCollisionEvents",+[](DicePhysicsEngine& e) {
            const auto& buf = e.buildCollisionEventBuffer();
            return val(typed_memory_view(buf.size(), buf.data()));
        })
        .function("getFaceValues",     +[](DicePhysicsEngine& e) {
            const auto& buf = e.buildFaceValueBuffer();
            return val(typed_memory_view(buf.size(), buf.data()));
        })
        .function("serializeState",    &DicePhysicsEngine::serializeState)
        .function("deserializeState",  &DicePhysicsEngine::deserializeState)
        ;
}
