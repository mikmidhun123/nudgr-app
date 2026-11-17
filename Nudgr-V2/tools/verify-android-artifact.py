"""Check every packaged 64-bit ELF and APK's uncompressed native ZIP offsets.

This is a static packaging check, not a substitute for a 16 KB runtime test.
Usage: python tools/verify-android-artifact.py app.apk [app.aab ...]
"""
import collections
import hashlib
import json
from pathlib import Path
import struct
import sys
import zipfile


def verify(filename):
    artifact = Path(filename)
    counts = collections.Counter()
    checked = 0
    failures = []
    with zipfile.ZipFile(artifact) as archive, artifact.open('rb') as stream:
        for entry in archive.infolist():
            if not entry.filename.endswith('.so'):
                continue
            abi = entry.filename.split('/')[-2]
            counts[abi] += 1
            if abi not in ('arm64-v8a', 'x86_64'):
                continue
            checked += 1
            data = archive.read(entry)
            if data[:5] != b'\x7fELF\x02':
                failures.append(f'{entry.filename}: expected ELF64')
                continue
            endian = '<' if data[5] == 1 else '>'
            offset = struct.unpack_from(endian + 'Q', data, 32)[0]
            size, number = struct.unpack_from(endian + 'HH', data, 54)
            loads = []
            for index in range(number):
                at = offset + index * size
                if struct.unpack_from(endian + 'I', data, at)[0] == 1:
                    file_offset, virtual = struct.unpack_from(endian + 'QQ', data, at + 8)
                    alignment = struct.unpack_from(endian + 'Q', data, at + 48)[0]
                    loads.append(alignment >= 16384 and (virtual - file_offset) % 16384 == 0)
            if not loads or not all(loads):
                failures.append(f'{entry.filename}: ELF LOAD segments are not 16 KB aligned')
            if artifact.suffix == '.apk' and entry.compress_type == zipfile.ZIP_STORED:
                stream.seek(entry.header_offset)
                local = stream.read(30)
                name_length, extra_length = struct.unpack_from('<HH', local, 26)
                if (entry.header_offset + 30 + name_length + extra_length) % 16384:
                    failures.append(f'{entry.filename}: uncompressed APK ZIP offset is not 16 KB aligned')
    if not checked or not counts['arm64-v8a'] or not counts['x86_64']:
        failures.append('Expected ARM64 and x86_64 native libraries are missing')
    with artifact.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    return {'artifact': str(artifact.resolve()), 'sha256': digest, 'bytes': artifact.stat().st_size,
            'librariesByAbi': dict(counts), 'checked64BitLibraries': checked,
            'elfAndApkZipAlignmentPassed': not failures, 'failures': failures,
            'runtime16KbTestPerformed': False}


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit('Pass at least one APK or AAB path.')
    results = [verify(filename) for filename in sys.argv[1:]]
    print(json.dumps(results, indent=2))
    raise SystemExit(0 if all(result['elfAndApkZipAlignmentPassed'] for result in results) else 1)
