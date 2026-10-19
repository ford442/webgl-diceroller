/**
 * make_seed_corpus.cpp — writes real serializeState() snapshots (dice, box
 * and hull dynamics, live manifolds) so fuzz_deserialize starts from inputs
 * that reach every section of the format instead of bouncing off the header.
 *
 *   ./make_seed_corpus <out-dir>
 */

#include "../dice_physics_engine.hpp"

#include <fstream>
#include <iostream>
#include <string>
#include <vector>

using namespace dice_physics;

namespace {

void write(const std::string& path, const std::vector<uint8_t>& bytes) {
    std::ofstream out(path, std::ios::binary);
    out.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
}

}  // namespace

int main(int argc, char** argv) {
    if (argc < 2) {
        std::cerr << "usage: make_seed_corpus <out-dir>" << std::endl;
        return 2;
    }
    const std::string dir = argv[1];

    DicePhysicsEngine engine;
    engine.init(-15.0f, -2.75f, 18.0f, 18.0f);
    engine.seedRNG(42);
    write(dir + "/empty.bin", engine.serializeState());

    const int sides[] = {4, 6, 8, 10, 12, 20};
    for (int i = 0; i < 6; ++i) {
        const int id = engine.addDie(sides[i], -4.0f + 1.6f * static_cast<float>(i), 2.0f, 0.0f);
        engine.applyImpulse(id, 1.0f, 0.0f, -2.0f);
    }
    engine.addDynamicBox(900, 2.0f, 0.0f, -2.0f, 3.0f, 0.5f, 0.5f, 0.5f, 0, 0, 0, 1, 2);
    engine.addDynamicHull(901, 1.0f, 3.0f, -2.0f, 3.0f, 0, 0, 0, 1,
                          {-0.4f, 0, -0.4f, 0.4f, 0, -0.4f, 0, 0.6f, 0, 0, 0, 0.4f}, 3);
    write(dir + "/airborne.bin", engine.serializeState());

    for (int i = 0; i < 240; ++i) engine.step(1.0f / 120.0f);
    write(dir + "/contacts.bin", engine.serializeState());
    std::cout << "[fuzz] seed corpus written to " << dir << std::endl;
    return 0;
}
