#!/usr/bin/env bash
# The ONLY supported way to build the desktop binary: stamps the bundled
# frontend first, so the Setup footer always shows which UI is inside.
set -e
cd "$(dirname "$0")/.."
SHA=$(git rev-parse --short HEAD 2>/dev/null || echo nogit)
printf '{"build":"%s","at":"%s"}\n' "$SHA" "$(date -u +%FT%TZ)" > src/bundle.json
cargo build --manifest-path src-tauri/Cargo.toml
echo "bundled UI: $(cat src/bundle.json)"
git rev-parse HEAD > src-tauri/target/debug/profiles.srcsha 2>/dev/null || true
