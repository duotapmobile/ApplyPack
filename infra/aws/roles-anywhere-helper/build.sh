#!/usr/bin/env bash
# Shared by the standalone proof build and Dockerfile.launch. No runtime downloads.
set -euo pipefail
umask 022
source /helper-build/inputs.env
export SOURCE_DATE_EPOCH
export LANG=C LC_ALL=C TZ=UTC GOENV=off GOTOOLCHAIN=local GOTELEMETRY=off
export GOOS=linux GOARCH=amd64 GOAMD64=v1 CGO_ENABLED=1
export GOPROXY=https://proxy.golang.org GOSUMDB=sum.golang.org GOVCS='*:off'
export GOPRIVATE= GONOPROXY= GONOSUMDB= GOINSECURE=
export GOCACHE=/build/cache/objects GOMODCACHE=/build/cache/modules GOPATH=/build/cache/gopath
export GOFLAGS='-mod=readonly -buildvcs=false'
export CC=gcc CXX=g++ CGO_CFLAGS='-O2 -g' CGO_CPPFLAGS= CGO_CXXFLAGS='-O2 -g' CGO_LDFLAGS='-O2 -g'

die() { printf '%s\n' "$1" >&2; exit 1; }
check_hash() { printf '%s  %s\n' "$1" "$2" | sha256sum --check --status || die "integrity_check_failed:$2"; }
assert_patched() {
  check_hash "$PATCHED_MOD_SHA256" /build/source/go.mod
  check_hash "$PATCHED_SUM_SHA256" /build/source/go.sum
}

[[ $(id -u) == 0 && $(uname -m) == x86_64 ]] || die 'linux_amd64_root_builder_required'
[[ $(go version) == "go version $GO_VERSION linux/amd64" ]] || die 'toolchain_mismatch'
check_hash "$ORIGINAL_MOD_SHA256" /helper-build/go.mod.upstream
check_hash "$ORIGINAL_SUM_SHA256" /helper-build/go.sum.upstream
check_hash "$PATCHED_MOD_SHA256" /helper-build/go.mod.patched
check_hash "$PATCHED_SUM_SHA256" /helper-build/go.sum.patched
check_hash "$PATCH_SHA256" /helper-build/dependency.patch
check_hash "$LICENSE_SHA256" /helper-build/UPSTREAM_LICENSE
check_hash "$NOTICE_SHA256" /helper-build/UPSTREAM_NOTICE

case "${1:-}" in
prepare)
  [[ ! -e /build/source && ! -e /out ]] || die 'clean_builder_required'
  mkdir -p /build/source /build/cache /out/provenance /out/licenses /out/build-evidence /tests
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error --max-time 120 --max-filesize 1048576 \
    --output /build/source.tar.gz "https://codeload.github.com/aws/rolesanywhere-credential-helper/tar.gz/$SOURCE_COMMIT"
  [[ $(stat -c '%s' /build/source.tar.gz) == "$SOURCE_ARCHIVE_BYTES" ]] || die 'source_size_mismatch'
  check_hash "$SOURCE_ARCHIVE_SHA256" /build/source.tar.gz
  # Reject paths outside the single expected archive root before extraction.
  tar -tzf /build/source.tar.gz > /out/provenance/source-archive-paths.txt
  awk -v root="rolesanywhere-credential-helper-$SOURCE_COMMIT/" \
    'index($0, root) != 1 || $0 ~ /(^|\/)\.\.(\/|$)/ { exit 1 }' \
    /out/provenance/source-archive-paths.txt || die 'source_archive_path_invalid'
  tar --extract --gzip --file=/build/source.tar.gz --directory=/build/source \
    --strip-components=1 --no-same-owner --no-same-permissions
  cd /build/source
  check_hash "$ORIGINAL_MOD_SHA256" go.mod
  check_hash "$ORIGINAL_SUM_SHA256" go.sum
  check_hash "$LICENSE_SHA256" LICENSE
  check_hash "$NOTICE_SHA256" NOTICE
  find . -type f ! -path './go.mod' ! -path './go.sum' -print0 | sort -z | \
    xargs -0 sha256sum > /out/provenance/unmodified-upstream-files.sha256
  git apply --check --whitespace=error /helper-build/dependency.patch
  git apply --whitespace=error /helper-build/dependency.patch
  assert_patched
  # Start without go.sum in an isolated module so Go must authenticate the
  # public checksum-database records itself, including the x/net graph's x/text.
  # The cold GOMODCACHE is shared with compilation only after this succeeds.
  mkdir /build/checksum-authentication
  cp go.mod /build/checksum-authentication/go.mod
  (
    cd /build/checksum-authentication
    go mod edit -require=golang.org/x/text@v0.42.0
    # An otherwise empty module's bare download may authenticate only go.mod
    # files. Explicit versions force each reviewed root requirement's ZIP to
    # be authenticated from the fresh checksum database before cache reuse.
    mapfile -t authenticated_modules < <(awk '$2 ~ /^v[0-9]/ { print $1 "@" $2 }' go.mod)
    [[ ${#authenticated_modules[@]} -gt 0 ]] || die 'authentication_module_list_empty'
    go mod download -json "${authenticated_modules[@]}" > /out/provenance/authenticated-module-downloads.jsonstream
  )
  cp /build/checksum-authentication/go.mod /out/provenance/checksum-authentication.go.mod
  cp /build/checksum-authentication/go.sum /out/provenance/checksum-authentication.go.sum
  authenticated_zip_count=0
  while IFS= read -r checksum; do
    [[ "$checksum" == *'/go.mod h1:'* ]] && continue
    grep -Fqx -- "$checksum" go.sum || die 'authenticated_zip_not_in_reviewed_sums'
    authenticated_zip_count=$((authenticated_zip_count + 1))
  done < /build/checksum-authentication/go.sum
  [[ "$authenticated_zip_count" -gt 0 ]] || die 'authenticated_zip_records_missing'
  go mod download
  go mod verify | tee /out/provenance/module-verification.txt
  assert_patched
  go list -m -json all > /out/provenance/modules.json
  go mod graph > /out/provenance/module-graph.txt
  go list -m -f '{{if not .Main}}{{.Path}} {{.Version}} {{.Dir}}{{end}}' all > /out/provenance/module-directories.txt
  assert_patched
  cp /helper-build/dependency.patch /helper-build/inputs.env /helper-build/MODIFICATIONS.md /out/provenance/
  cp LICENSE /out/licenses/AWS-HELPER-LICENSE
  cp NOTICE /out/licenses/AWS-HELPER-NOTICE
  cp /usr/local/go/LICENSE /out/licenses/GO-LICENSE
  if [[ -f /usr/local/go/PATENTS ]]; then cp /usr/local/go/PATENTS /out/licenses/GO-PATENTS; fi
  find /helper-build -type f -print0 | sort -z | xargs -0 sha256sum > /out/provenance/build-inputs.sha256
  printf '%s\n' "$BUILDER_IMAGE" > /out/provenance/builder-image.txt
  printf '%s\n' "$SOURCE_COMMIT" > /out/provenance/source-commit.txt
  go version > /out/provenance/go-version.txt
  gcc --version > /out/provenance/gcc-version.txt
  ld --version > /out/provenance/linker-version.txt
  dpkg-query -W gcc libc6-dev binutils make > /out/provenance/build-package-versions.txt
  ;;
compile)
  [[ -d /build/source && ! -e /out/aws_signing_helper ]] || die 'prepared_clean_output_required'
  # Docker invokes this phase with --network=none. Go also has no download fallback.
  export GOPROXY=off
  cd /build/source
  assert_patched
  go mod verify
  make release VERSION="$HELPER_VERSION"
  assert_patched
  sha256sum --check --status /out/provenance/unmodified-upstream-files.sha256 || die 'upstream_source_changed'
  install -m 0755 build/bin/aws_signing_helper /out/aws_signing_helper
  [[ $(/out/aws_signing_helper version) == "$HELPER_VERSION" ]] || die 'rebuild_version_mismatch'
  go version -m /out/aws_signing_helper > /out/provenance/binary-go-metadata.txt
  # Preserve every linked module's license. Historical unused graph entries are
  # still recorded above; they are not downloaded or distributed in this binary.
  awk '$1 == "dep" { print $2 " " $3 }' /out/provenance/binary-go-metadata.txt > /out/provenance/linked-modules.txt
  [[ -s /out/provenance/linked-modules.txt ]] || die 'linked_module_metadata_missing'
  : > /out/provenance/linked-module-notice-files.sha256
  while read -r module version; do
    # Upstream builds main.go rather than the package, so Go reports its own
    # source module as a (devel) dependency. Its exact commit and LICENSE/NOTICE
    # are already verified and preserved separately above.
    if [[ "$module" == github.com/aws/rolesanywhere-credential-helper ]]; then
      [[ "$version" == '(devel)' && $(go list -m -f '{{.Main}}' "$module") == true ]] || die 'source_module_identity_mismatch'
      continue
    fi
    linked_sum=$(awk -v module="$module" -v version="$version" '$1 == "dep" && $2 == module && $3 == version { print $2 " " $3 " " $4 }' /out/provenance/binary-go-metadata.txt)
    [[ -n "$linked_sum" ]] || die "linked_module_checksum_missing:$module"
    grep -Fqx -- "$linked_sum" /out/provenance/checksum-authentication.go.sum || die "linked_module_not_independently_authenticated:$module"
    grep -Fqx -- "$linked_sum" go.sum || die "linked_module_not_in_reviewed_sums:$module"
    directory=$(go list -m -f '{{.Dir}}' "$module")
    [[ $(go list -m -f '{{.Version}}' "$module") == "$version" ]] || die "module_version_mismatch:$module"
    [[ "$directory" == /build/cache/modules/* && -d "$directory" ]] || die "module_directory_missing:$module"
    license_dir="/out/licenses/modules/$module/$version"
    mkdir -p "$license_dir"
    while IFS= read -r -d '' license; do
      relative="${license#"$directory"/}"
      mkdir -p "$license_dir/$(dirname "$relative")"
      cp "$license" "$license_dir/$relative"
      sha256sum "$license" >> /out/provenance/linked-module-notice-files.sha256
    done < <(find "$directory" -type f \( -iname 'LICENSE*' -o -iname 'NOTICE*' -o -iname 'COPYING*' -o -iname 'PATENTS*' -o -iname 'COPYRIGHT*' -o -iname 'AUTHORS*' \) -print0 | sort -z)
    [[ -n $(find "$license_dir" -type f -print -quit) ]] || die "module_license_missing:$module"
  done < /out/provenance/linked-modules.txt
  readelf -h -l -d /out/aws_signing_helper > /out/provenance/binary-elf.txt
  grep -q 'Type:.*DYN' /out/provenance/binary-elf.txt || die 'pie_required'
  ldd /out/aws_signing_helper > /out/provenance/binary-shared-libraries.txt
  if grep -q 'not found' /out/provenance/binary-shared-libraries.txt; then die 'shared_library_missing'; fi
  sha256sum /out/aws_signing_helper > /out/provenance/binary.sha256
  stat -c '%s' /out/aws_signing_helper > /out/provenance/binary-size.txt
  # Upstream command parsing suite is entirely local. Hardware/provider suites
  # are separate; this receipt does not claim the full upstream test matrix.
  go test -count=1 -json ./cmd > /out/provenance/upstream-cmd-tests.jsonl
  assert_patched
  sha256sum --check --status /out/provenance/unmodified-upstream-files.sha256 || die 'upstream_source_changed_after_tests'
  go build -trimpath -buildvcs=false -o /tests/helper-offline-test /helper-build/offline-self-test.go
  chmod 0755 /tests/helper-offline-test
  find /out/licenses -type f -print0 | sort -z | xargs -0 sha256sum > /out/provenance/distributed-licenses.sha256
  # Detailed source/test manifests remain evidence, not installed runtime package
  # source. Runtime provenance keeps the binary's actual compiled inventory.
  for evidence in source-archive-paths.txt unmodified-upstream-files.sha256 \
    module-verification.txt modules.json module-graph.txt module-directories.txt \
    checksum-authentication.go.mod checksum-authentication.go.sum authenticated-module-downloads.jsonstream dependency.patch \
    inputs.env build-inputs.sha256 gcc-version.txt linker-version.txt \
    build-package-versions.txt upstream-cmd-tests.jsonl linked-module-notice-files.sha256; do
    mv "/out/provenance/$evidence" /out/build-evidence/
  done
  ;;
*) die 'expected_prepare_or_compile' ;;
esac
