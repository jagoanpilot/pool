#ifndef PHR_YP_H
#define PHR_YP_H

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace phr {
namespace yp {

/** Consensus parameters for the YesPower-style PhantomRider variant. */
constexpr std::size_t kDatasetBytes = 1024 * 1024; // 1 MiB
constexpr std::uint32_t kRounds = 32;
constexpr const char* kPersonalization = "PHR";
constexpr std::size_t kDigestBytes = 32;

using Hash = std::array<std::uint8_t, kDigestBytes>;

/**
 * PHR-256-YP: stateless, memory-hard proof-of-work hash.
 *
 * The 1 MiB dataset is derived from header || pers for every call.  This is
 * the YesPower-style variant: no epoch dataset and no chain context are
 * required, so the function plugs directly into GetPoWHash().  The fill is
 * sequential (each 64-byte line keys the next), so it cannot be short-cut by
 * generating only the sampled lines.
 *
 * Output is a 32-byte big-endian digest.
 */
Hash HashHeader(const std::uint8_t* header, std::size_t header_len,
                const std::uint8_t* pers, std::size_t pers_len,
                std::size_t dataset_bytes = kDatasetBytes,
                std::uint32_t rounds = kRounds);

inline Hash HashHeader(const std::uint8_t* header, std::size_t header_len,
                       const char* pers,
                       std::size_t dataset_bytes = kDatasetBytes,
                       std::uint32_t rounds = kRounds) {
    return HashHeader(header, header_len,
                      reinterpret_cast<const std::uint8_t*>(pers),
                      std::strlen(pers), dataset_bytes, rounds);
}

} // namespace yp
} // namespace phr

#endif // PHR_YP_H
