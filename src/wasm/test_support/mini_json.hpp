/**
 * mini_json.hpp — just enough JSON for solver_tests.cpp to read checked-in
 * fixtures (tests/fixtures/tavern-world.json, public/wasm/hulls.json).
 *
 * Test-only: not part of the engine, not compiled into the WASM module.
 * Objects, arrays, numbers, strings (no \u escapes beyond pass-through),
 * true/false/null. Throws std::runtime_error on malformed input.
 */

#pragma once

#include <cctype>
#include <cstdlib>
#include <fstream>
#include <map>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace mini_json {

struct Value {
    enum class Kind { Null, Bool, Number, String, Array, Object };
    Kind kind = Kind::Null;
    bool boolean = false;
    double number = 0.0;
    std::string string;
    std::vector<Value> array;
    std::map<std::string, Value> object;

    bool has(const std::string& key) const {
        return kind == Kind::Object && object.count(key) > 0;
    }
    const Value& operator[](const std::string& key) const {
        auto it = object.find(key);
        if (kind != Kind::Object || it == object.end()) {
            throw std::runtime_error("mini_json: missing key '" + key + "'");
        }
        return it->second;
    }
    const Value& operator[](size_t index) const {
        if (kind != Kind::Array || index >= array.size()) {
            throw std::runtime_error("mini_json: index out of range");
        }
        return array[index];
    }
    size_t size() const { return kind == Kind::Array ? array.size() : object.size(); }
    float f() const { return static_cast<float>(number); }
    int i() const { return static_cast<int>(number); }
    std::vector<float> floats() const {
        std::vector<float> out;
        out.reserve(array.size());
        for (const auto& v : array) out.push_back(v.f());
        return out;
    }
};

class Parser {
public:
    explicit Parser(const std::string& text) : s_(text) {}

    Value parse() {
        Value v = value();
        ws();
        if (pos_ != s_.size()) fail("trailing characters");
        return v;
    }

private:
    const std::string& s_;
    size_t pos_ = 0;

    [[noreturn]] void fail(const char* what) const {
        throw std::runtime_error(std::string("mini_json: ") + what + " at offset " +
                                 std::to_string(pos_));
    }
    void ws() {
        while (pos_ < s_.size() && std::isspace(static_cast<unsigned char>(s_[pos_]))) ++pos_;
    }
    bool eat(char c) {
        ws();
        if (pos_ < s_.size() && s_[pos_] == c) {
            ++pos_;
            return true;
        }
        return false;
    }
    void expect(char c) {
        if (!eat(c)) fail("unexpected character");
    }
    bool literal(const char* word) {
        const std::string w(word);
        if (s_.compare(pos_, w.size(), w) == 0) {
            pos_ += w.size();
            return true;
        }
        return false;
    }

    Value value() {
        ws();
        if (pos_ >= s_.size()) fail("unexpected end");
        Value v;
        const char c = s_[pos_];
        if (c == '{') {
            ++pos_;
            v.kind = Value::Kind::Object;
            if (eat('}')) return v;
            do {
                ws();
                std::string key = str();
                expect(':');
                v.object[key] = value();
            } while (eat(','));
            expect('}');
        } else if (c == '[') {
            ++pos_;
            v.kind = Value::Kind::Array;
            if (eat(']')) return v;
            do {
                v.array.push_back(value());
            } while (eat(','));
            expect(']');
        } else if (c == '"') {
            v.kind = Value::Kind::String;
            v.string = str();
        } else if (literal("true")) {
            v.kind = Value::Kind::Bool;
            v.boolean = true;
        } else if (literal("false")) {
            v.kind = Value::Kind::Bool;
        } else if (literal("null")) {
            v.kind = Value::Kind::Null;
        } else {
            const char* begin = s_.c_str() + pos_;
            char* end = nullptr;
            v.number = std::strtod(begin, &end);
            if (end == begin) fail("bad value");
            v.kind = Value::Kind::Number;
            pos_ += static_cast<size_t>(end - begin);
        }
        return v;
    }

    std::string str() {
        if (pos_ >= s_.size() || s_[pos_] != '"') fail("expected string");
        ++pos_;
        std::string out;
        while (pos_ < s_.size() && s_[pos_] != '"') {
            if (s_[pos_] == '\\' && pos_ + 1 < s_.size()) ++pos_;
            out.push_back(s_[pos_++]);
        }
        if (pos_ >= s_.size()) fail("unterminated string");
        ++pos_;
        return out;
    }
};

inline Value parse(const std::string& text) { return Parser(text).parse(); }

/** Parse a file; throws when it cannot be read. */
inline Value parseFile(const std::string& path) {
    std::ifstream in(path);
    if (!in) throw std::runtime_error("mini_json: cannot open " + path);
    std::stringstream buf;
    buf << in.rdbuf();
    return parse(buf.str());
}

} // namespace mini_json
