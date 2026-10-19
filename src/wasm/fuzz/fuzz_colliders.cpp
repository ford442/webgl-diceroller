/**
 * fuzz_colliders.cpp — libFuzzer target over collider registration.
 *
 * The input is read as a little op stream (opcode byte + raw floats), so the
 * fuzzer reaches every addStatic* / addDynamic* entry point with arbitrary
 * values — NaN, Inf, zero or negative extents, degenerate hulls — and then
 * steps a die through the result. The engine may reject a collider; it must
 * never read out of bounds or hit UB doing so.
 *
 *   npm run fuzz:solver            (clang + libFuzzer, see build_fuzz.sh)
 */

#include "../dice_physics_engine.hpp"

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <vector>

using namespace dice_physics;

namespace {

struct Reader {
    const uint8_t* data;
    size_t size;
    size_t off = 0;

    bool empty() const { return off >= size; }

    uint8_t byte() { return off < size ? data[off++] : 0; }

    float f32() {
        float v = 0.0f;
        if (off + sizeof(v) <= size) {
            std::memcpy(&v, data + off, sizeof(v));
            off += sizeof(v);
        } else {
            off = size;
        }
        return v;
    }

    int i32() { return static_cast<int>(static_cast<int8_t>(byte())); }

    std::vector<float> verts() {
        const size_t count = static_cast<size_t>(byte() % 48) * 3;
        std::vector<float> out;
        out.reserve(count);
        for (size_t i = 0; i < count; ++i) out.push_back(f32());
        return out;
    }
};

}  // namespace

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size) {
    DicePhysicsEngine engine;
    engine.init(-15.0f, -2.75f, 18.0f, 18.0f);
    Reader r{data, size};

    for (int op = 0; op < 64 && !r.empty(); ++op) {
        switch (r.byte() % 9) {
            case 0:
                engine.addStaticBox(r.i32(), r.f32(), r.f32(), r.f32(), r.f32(), r.f32(),
                                    r.f32(), r.f32(), r.f32(), r.f32(), r.f32(), r.i32());
                break;
            case 1:
                engine.addStaticPlane(r.i32(), r.f32(), r.f32(), r.f32(), r.f32(), r.i32());
                break;
            case 2: {
                const int id = r.i32();
                const float cx = r.f32(), cy = r.f32(), cz = r.f32();
                const float qx = r.f32(), qy = r.f32(), qz = r.f32(), qw = r.f32();
                const std::vector<float> v = r.verts();
                engine.addStaticConvexHull(id, cx, cy, cz, qx, qy, qz, qw, v, r.i32());
                break;
            }
            case 3:
                engine.addStaticOpenCylinder(r.i32(), r.f32(), r.f32(), r.f32(), r.f32(),
                                             r.f32(), r.i32(), (r.byte() & 1) != 0, r.i32());
                break;
            case 4:
                engine.addDynamicBox(r.i32(), r.f32(), r.f32(), r.f32(), r.f32(), r.f32(),
                                     r.f32(), r.f32(), r.f32(), r.f32(), r.f32(), r.f32(),
                                     r.i32());
                break;
            case 5: {
                const int id = r.i32();
                const float mass = r.f32();
                const float cx = r.f32(), cy = r.f32(), cz = r.f32();
                const float qx = r.f32(), qy = r.f32(), qz = r.f32(), qw = r.f32();
                const std::vector<float> v = r.verts();
                engine.addDynamicHull(id, mass, cx, cy, cz, qx, qy, qz, qw, v, r.i32());
                break;
            }
            case 6: {
                const int id = engine.addDie(4 + 2 * (r.byte() % 9), r.f32(), r.f32(), r.f32());
                const std::vector<float> v = r.verts();
                if (id >= 0 && !v.empty()) engine.setDieHull(id, v);
                break;
            }
            case 7: {
                std::vector<float> planes = r.verts();
                engine.setContainerPlanes(planes);
                engine.setContainerActive((r.byte() & 1) != 0);
                break;
            }
            case 8:
                engine.removeStatic(r.i32());
                break;
        }
    }

    for (int i = 0; i < 8; ++i) engine.step(1.0f / 120.0f);
    engine.buildTransformBuffer();
    engine.buildDynamicTransformBuffer();
    return 0;
}
