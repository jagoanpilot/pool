#!/usr/bin/env python3
"""Reference implementation of PHR-256-YP (PhantomRider, YesPower-style).

This is a slow, readable reference used to generate cross-platform test
vectors.  It is not a miner.

Usage:
    python phr_yp_ref.py <header_hex> <pers> [dataset_mib] [rounds]
"""

from __future__ import annotations

import hashlib
import struct
import sys

DATASET_MIB = 1
ROUNDS = 32


def _rotl32(v: int, n: int) -> int:
    return ((v << n) | (v >> (32 - n))) & 0xFFFFFFFF


def _quarter_round(x: list[int], a: int, b: int, c: int, d: int) -> None:
    x[a] = (x[a] + x[b]) & 0xFFFFFFFF
    x[d] = _rotl32(x[d] ^ x[a], 16)
    x[c] = (x[c] + x[d]) & 0xFFFFFFFF
    x[b] = _rotl32(x[b] ^ x[c], 12)
    x[a] = (x[a] + x[b]) & 0xFFFFFFFF
    x[d] = _rotl32(x[d] ^ x[a], 8)
    x[c] = (x[c] + x[d]) & 0xFFFFFFFF
    x[b] = _rotl32(x[b] ^ x[c], 7)


def chacha20_block(key: bytes, counter: int) -> bytes:
    """One ChaCha20 block with an all-zero 64-bit nonce.

    OpenSSL's EVP_chacha20 with an all-zero 16-byte IV and the classic
    ChaCha20 construction are identical for the first 2^32 blocks.
    """
    if len(key) != 32:
        raise ValueError("key must be 32 bytes")
    state = list(struct.unpack("<4I", b"expand 32-byte k"))
    state += list(struct.unpack("<8I", key))
    state += [counter & 0xFFFFFFFF, (counter >> 32) & 0xFFFFFFFF, 0, 0]
    working = state[:]

    for _ in range(10):
        _quarter_round(working, 0, 4, 8, 12)
        _quarter_round(working, 1, 5, 9, 13)
        _quarter_round(working, 2, 6, 10, 14)
        _quarter_round(working, 3, 7, 11, 15)
        _quarter_round(working, 0, 5, 10, 15)
        _quarter_round(working, 1, 6, 11, 12)
        _quarter_round(working, 2, 7, 8, 13)
        _quarter_round(working, 3, 4, 9, 14)

    out = [(working[i] + state[i]) & 0xFFFFFFFF for i in range(16)]
    return struct.pack("<16I", *out)


def chained_dataset(key: bytes, length: int) -> bytes:
    """Sequential, non-seekable 1 MiB fill.

    Each 64-byte line becomes the ChaCha20 key for the next line.  A miner
    cannot jump to a random line: producing line N requires every line before
    it.  This is what makes the per-hash dataset actually memory-hard.
    """
    out = bytearray()
    chain = key
    while len(out) < length:
        block = chacha20_block(chain, 0)
        out += block
        chain = block[:32]
    return bytes(out[:length])


def _tagged_hash(tag: bytes, *parts: bytes) -> bytes:
    h = hashlib.sha256()
    h.update(tag)
    h.update(b"\x00")
    for part in parts:
        h.update(part)
    return h.digest()


def phr_yp_hash(
    header: bytes,
    pers: bytes,
    dataset_bytes: int = DATASET_MIB * 1024 * 1024,
    rounds: int = ROUNDS,
) -> bytes:
    if dataset_bytes < 64 or dataset_bytes % 64:
        raise ValueError("dataset_bytes must be >= 64 and divisible by 64")
    if rounds == 0:
        raise ValueError("rounds must be > 0")

    dataset_key = _tagged_hash(b"PHR-YP-DATASET", header, pers)
    dataset = chained_dataset(dataset_key, dataset_bytes)

    state = _tagged_hash(b"PHR-YP-INIT", header, pers)
    lines = dataset_bytes // 64

    for r in range(rounds):
        idx = int.from_bytes(state[:8], "little") % lines
        line = dataset[idx * 64 : (idx + 1) * 64]
        selector = state[8] % 3
        msg = state + line + struct.pack("<I", r) + bytes([selector])
        if selector == 0:
            state = hashlib.sha256(msg).digest()
        elif selector == 1:
            state = hashlib.sha3_256(msg).digest()
        else:
            state = hashlib.blake2s(msg).digest()

    return _tagged_hash(b"PHR-YP-FINAL", state, header, pers)


def main(argv: list[str]) -> int:
    if len(argv) < 3:
        print(
            "usage: phr_yp_ref.py <header_hex> <pers> [dataset_mib] [rounds]",
            file=sys.stderr,
        )
        return 2

    header = bytes.fromhex(argv[1])
    pers = argv[2].encode()
    mib = int(argv[3]) if len(argv) > 3 else DATASET_MIB
    rounds = int(argv[4]) if len(argv) > 4 else ROUNDS
    digest = phr_yp_hash(header, pers, mib * 1024 * 1024, rounds)
    print(digest.hex())
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
