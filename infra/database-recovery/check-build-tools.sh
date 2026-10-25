#!/usr/bin/env bash
# Sourced only by the build stage. Report every missing dependency together.
check_postgres_build_tools() {
  local tool
  local -a missing=()
  local -a required=(
    ar as awk basename bash bison bzip2 cat chmod cmp cp curl cut date diff dirname dpkg-deb dpkg-query
    expr find flex gcc grep gzip head id install ld ln make md5sum mkdir
    mv node perl pkg-config ranlib readelf rm sed sha256sum sort strip tail tar touch
    tr uname wc xargs xz
  )
  for tool in "${required[@]}"; do
    command -v "$tool" >/dev/null 2>&1 || missing+=("$tool")
  done
  if (( ${#missing[@]} )); then
    printf 'postgres_client_build_tools_missing:%s\n' "${missing[*]}" >&2
    return 1
  fi
}
