#include "phr_yp.h"

#include <cstdint>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

using Bytes = std::vector<std::uint8_t>;

Bytes Unhex(const std::string& text) {
    if (text.size() % 2 != 0) {
        throw std::runtime_error("hex length must be even");
    }
    Bytes out(text.size() / 2);
    for (std::size_t i = 0; i < out.size(); ++i) {
        unsigned value = 0;
        std::istringstream input(text.substr(i * 2, 2));
        input >> std::hex >> value;
        if (!input) {
            throw std::runtime_error("invalid hex");
        }
        out[i] = static_cast<std::uint8_t>(value);
    }
    return out;
}

std::string Hex(const std::uint8_t* data, std::size_t len) {
    static const char* digits = "0123456789abcdef";
    std::string out;
    out.reserve(len * 2);
    for (std::size_t i = 0; i < len; ++i) {
        out.push_back(digits[data[i] >> 4]);
        out.push_back(digits[data[i] & 0x0F]);
    }
    return out;
}

// Helper protocol (stdin/stdout, line-based):
//   H <id> <header_hex>  -> H <id> <hash_hex>
//   Q                    -> quit
// Hash is PHR-256-YP digest in big-endian byte order (as returned by HashHeader).
// This is the canonical PoW hash for PhantomRider (80-byte block header, pers "PHR").
void RunServer() {
    std::string line;
    while (std::getline(std::cin, line)) {
        if (line.empty()) continue;
        if (line == "Q" || line == "q") break;
        std::istringstream in(line);
        std::string cmd, id, headerHex;
        in >> cmd >> id >> headerHex;
        if (cmd != "H" || id.empty() || headerHex.empty()) {
            if (!id.empty()) {
                std::cout << "H " << id << " err\n" << std::flush;
            }
            continue;
        }
        try {
            const Bytes header = Unhex(headerHex);
            const phr::yp::Hash hash = phr::yp::HashHeader(header.data(), header.size(), phr::yp::kPersonalization);
            std::cout << "H " << id << ' ' << Hex(hash.data(), hash.size()) << "\n" << std::flush;
        } catch (...) {
            std::cout << "H " << id << " err\n" << std::flush;
        }
    }
}

} // namespace

int main(int argc, char** argv) {
    try {
        // One-shot mode: phr_hash <header_hex>
        if (argc == 2) {
            const Bytes header = Unhex(argv[1]);
            const phr::yp::Hash hash = phr::yp::HashHeader(header.data(), header.size(), phr::yp::kPersonalization);
            std::cout << Hex(hash.data(), hash.size()) << "\n";
            return 0;
        }
        // Server mode (for pool integration)
        RunServer();
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "error: " << e.what() << "\n";
        return 1;
    }
}
