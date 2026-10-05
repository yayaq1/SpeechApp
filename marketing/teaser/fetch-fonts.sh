#!/usr/bin/env bash
# Downloads the open-licensed stand-ins for Apple's system faces (SF Pro -> Inter,
# New York -> Source Serif 4). Instrument Serif is read from the repo's font/ folder.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p fonts

css=$(curl -fsSL "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400&display=swap")

fetch() {
  local family="$1" weight="$2" out="$3"
  local url
  url=$(printf '%s\n' "$css" | awk -v fam="$family" -v w="$weight" '
    /font-family/ { f = index($0, fam) > 0 }
    /font-weight/ { gsub(/[^0-9]/, "", $0); wt = $0 }
    /src: url/ && f && wt == w { match($0, /https:[^)]+/); print substr($0, RSTART, RLENGTH); exit }')
  [[ -n "$url" ]] || { echo "No URL for $family $weight" >&2; exit 1; }
  curl -fsSL "$url" -o "fonts/$out"
  echo "fonts/$out"
}

fetch "Inter" 400 Inter-Regular.ttf
fetch "Inter" 500 Inter-Medium.ttf
fetch "Inter" 600 Inter-SemiBold.ttf
fetch "Source Serif 4" 400 SourceSerif4-Regular.ttf
