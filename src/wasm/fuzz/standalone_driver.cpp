/**
 * standalone_driver.cpp — main() for the fuzz targets when libFuzzer is not
 * linked (g++, or a clang without compiler-rt). Replays every file given on
 * the command line, then runs a seeded byte-mutation loop over them so the
 * targets still get ASan/UBSan coverage:
 *
 *   ./fuzz_deserialize_standalone [--iterations=N] [--seed=S] corpus/*
 */

#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>
#include <vector>

extern "C" int LLVMFuzzerTestOneInput(const uint8_t* data, size_t size);

namespace {

uint64_t splitmix(uint64_t& s) {
    uint64_t z = (s += 0x9E3779B97F4A7C15ull);
    z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9ull;
    z = (z ^ (z >> 27)) * 0x94D049BB133111EBull;
    return z ^ (z >> 31);
}

}  // namespace

int main(int argc, char** argv) {
    long iterations = 20000;
    uint64_t seed = 1;
    std::vector<std::vector<uint8_t>> corpus;
    for (int i = 1; i < argc; ++i) {
        const std::string arg = argv[i];
        if (arg.rfind("--iterations=", 0) == 0) {
            iterations = std::strtol(arg.c_str() + 13, nullptr, 10);
        } else if (arg.rfind("--seed=", 0) == 0) {
            seed = std::strtoull(arg.c_str() + 7, nullptr, 10);
        } else {
            std::ifstream in(arg, std::ios::binary);
            corpus.emplace_back(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
        }
    }
    if (corpus.empty()) corpus.emplace_back();

    for (const auto& input : corpus) LLVMFuzzerTestOneInput(input.data(), input.size());

    for (long it = 0; it < iterations; ++it) {
        std::vector<uint8_t> input = corpus[splitmix(seed) % corpus.size()];
        const int edits = 1 + static_cast<int>(splitmix(seed) % 8);
        for (int e = 0; e < edits; ++e) {
            const uint64_t r = splitmix(seed);
            switch (r % 4) {
                case 0:  // flip a byte
                    if (!input.empty()) input[(r >> 8) % input.size()] ^= static_cast<uint8_t>(r >> 32);
                    break;
                case 1:  // insert a random byte
                    input.insert(input.begin() + static_cast<long>(input.empty() ? 0 : (r >> 8) % (input.size() + 1)),
                                 static_cast<uint8_t>(r >> 40));
                    break;
                case 2:  // truncate
                    if (!input.empty()) input.resize((r >> 8) % input.size());
                    break;
                case 3:  // splat a 32-bit value (lengths, counts, floats)
                    if (input.size() >= 4) {
                        const uint32_t v = static_cast<uint32_t>(r >> 16);
                        std::memcpy(input.data() + (r >> 8) % (input.size() - 3), &v, 4);
                    }
                    break;
            }
        }
        LLVMFuzzerTestOneInput(input.data(), input.size());
    }
    std::cout << "[fuzz] " << corpus.size() << " corpus input(s) + " << iterations
              << " mutations: no sanitizer findings." << std::endl;
    return 0;
}
