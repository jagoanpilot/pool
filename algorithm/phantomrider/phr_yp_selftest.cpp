#include "phr_yp.h"

#include <cstdint>
#include <iostream>
#include <string>

namespace {

std::string Hex(const phr::yp::Hash& hash) {
    static const char* digits = "0123456789abcdef";
    std::string out;
    out.reserve(hash.size() * 2);
    for (std::uint8_t byte : hash) {
        out.push_back(digits[byte >> 4]);
        out.push_back(digits[byte & 0x0F]);
    }
    return out;
}

bool Check(const char* name, const phr::yp::Hash& actual,
           const char* expected) {
    const std::string got = Hex(actual);
    if (got == expected) {
        std::cout << "PASS " << name << " " << got << "\n";
        return true;
    }
    std::cout << "FAIL " << name << "\n  expected " << expected
              << "\n  actual   " << got << "\n";
    return false;
}

} // namespace

int main() {
    const std::uint8_t header[] = {0x00, 0x01, 0x02, 0x03};
    const std::uint8_t pers[] = {'P', 'H', 'R'};

    bool ok = true;
    ok &= Check("64B/1r",
                phr::yp::HashHeader(header, sizeof(header), pers, sizeof(pers),
                                    64, 1),
                "4363c05142a95741a8e0cb1d938e6b400cc41cb7d9bb247ac111404193eb4243");
    ok &= Check("1MiB/32r",
                phr::yp::HashHeader(header, sizeof(header), pers, sizeof(pers),
                                    1024 * 1024, 32),
                "6e1e85ee9a61847bef13adaa190635674bb2809332dca0ddd7707fa0fe8e3e1e");

    std::uint8_t long_header[80];
    for (int i = 0; i < 80; ++i) {
        long_header[i] = static_cast<std::uint8_t>(i);
    }
    ok &= Check("80B/1MiB/32r",
                phr::yp::HashHeader(long_header, sizeof(long_header), pers,
                                    sizeof(pers), 1024 * 1024, 32),
                "ade861711ac82e11193cbf03c6432f4eb23afb4a629d9e0b3fb20a86ed04eae2");
    return ok ? 0 : 1;
}
