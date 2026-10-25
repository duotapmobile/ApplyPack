#!/usr/bin/env bash
set -euo pipefail
umask 022
source /client-build/client-build-inputs.env
export SOURCE_DATE_EPOCH LANG=C LC_ALL=C TZ=UTC
die() { printf '%s\n' "$1" >&2; exit 1; }
[[ $(id -u) == 0 && $(uname -m) == x86_64 ]] || die 'postgres_client_amd64_builder_required'
case "${1:-}" in
prepare)
  [[ ! -e /pg-source && ! -e /out ]] || die 'postgres_client_clean_builder_required'
  mkdir -p /pg-source /out/build-evidence /out/root/usr/share/applypack/postgresql
  curl --proto '=https' --tlsv1.2 --fail --silent --show-error --max-time 120 --max-filesize 33554432 \
    --output /postgresql.tar.bz2 "https://ftp.postgresql.org/pub/source/v${POSTGRES_VERSION}/postgresql-${POSTGRES_VERSION}.tar.bz2"
  printf '%s  %s\n' "$POSTGRES_SOURCE_SHA256" /postgresql.tar.bz2 | sha256sum --check --status
  tar -tjf /postgresql.tar.bz2 > /out/build-evidence/source-paths.txt
  awk -v root="postgresql-${POSTGRES_VERSION}/" 'index($0,root)!=1 || $0 ~ /(^|\/)\.\.(\/|$)/ {exit 1}' \
    /out/build-evidence/source-paths.txt || die 'postgres_client_source_path_invalid'
  tar -xjf /postgresql.tar.bz2 --directory=/pg-source --strip-components=1 --no-same-owner --no-same-permissions
  node /client-build/collect-notices.mjs
  # Build-only dependencies never enter the runtime. Their actual versions are
  # retained with the source/compiler evidence for this particular image build.
  apt-get update
  apt-get install -y --no-install-recommends bison flex libssl-dev zlib1g-dev
  dpkg-query -W > /out/build-evidence/build-packages.txt
  gcc --version > /out/build-evidence/compiler.txt
  cp /client-build/client-build-inputs.env /out/root/usr/share/applypack/postgresql/
  cp /pg-source/COPYRIGHT /out/root/usr/share/applypack/postgresql/COPYRIGHT
  ;;
compile)
  [[ -d /pg-source && ! -e /out/root/usr/lib/postgresql ]] || die 'postgres_client_prepared_builder_required'
  cd /pg-source
  # No interactive readline (and therefore no ncurses), ICU, LDAP, Kerberos or
  # XML stack. TLS and standard custom-format dump compression remain enabled.
  ./configure --prefix=/usr/lib/postgresql/17 --libdir=/opt/applypack/postgresql/lib \
    --without-readline --without-icu --with-openssl --with-zlib --without-ldap --without-gssapi \
    --without-libxml --without-libxslt --without-lz4 --without-zstd --disable-nls \
    CFLAGS='-O2 -fstack-protector-strong -fPIC -ffile-prefix-map=/pg-source=postgresql-17.11' \
    LDFLAGS='-Wl,-z,relro,-z,now' > /out/build-evidence/configure.log
  make -j2 > /out/build-evidence/compile.log
  make -C src/interfaces/libpq install DESTDIR=/out/install > /out/build-evidence/install.log
  make -C src/bin/psql install DESTDIR=/out/install >> /out/build-evidence/install.log
  make -C src/bin/pg_dump install DESTDIR=/out/install >> /out/build-evidence/install.log
  mkdir -p /out/packages/client/DEBIAN /out/packages/client/usr/lib/postgresql/17/bin \
    /out/packages/libpq/DEBIAN /out/packages/libpq/opt/applypack/postgresql/lib
  for binary in psql pg_dump pg_restore; do
    install -m 0755 "/out/install/usr/lib/postgresql/17/bin/$binary" "/out/packages/client/usr/lib/postgresql/17/bin/$binary"
  done
  cp -a /out/install/opt/applypack/postgresql/lib/libpq.so* /out/packages/libpq/opt/applypack/postgresql/lib/
  # Real local Debian packages built from unmodified upstream source. Preserve
  # package/source/version and file inventory for the runtime vulnerability scan.
  cat > /out/packages/client/DEBIAN/control <<EOF
Package: postgresql-client-17
Source: postgresql-17
Version: ${POSTGRES_VERSION}-0applypack1
Architecture: amd64
Maintainer: ApplyPack <admin@applypack.work>
Depends: libc6, libpq5 (= ${POSTGRES_VERSION}-0applypack1), zlib1g
Description: ApplyPack PostgreSQL clients built from checksum-verified upstream source
EOF
  cat > /out/packages/libpq/DEBIAN/control <<EOF
Package: libpq5
Source: postgresql-17
Version: ${POSTGRES_VERSION}-0applypack1
Architecture: amd64
Maintainer: ApplyPack <admin@applypack.work>
Depends: libc6, libssl3t64
Description: ApplyPack PostgreSQL libpq built from checksum-verified upstream source
EOF
  mkdir -p /out/root/var/lib/dpkg/status.d /out/root/var/lib/dpkg/info
  for pair in 'client postgresql-client-17' 'libpq libpq5'; do
    read -r directory package <<< "$pair"
    (cd "/out/packages/$directory"; find . -type f ! -path './DEBIAN/*' -print0 | sort -z | xargs -0 md5sum | sed 's|  ./|  |') \
      > "/out/packages/$directory/DEBIAN/md5sums"
    dpkg-deb --root-owner-group --build "/out/packages/$directory" "/out/build-evidence/$package.deb"
    dpkg-deb --extract "/out/build-evidence/$package.deb" /out/root
    { dpkg-deb --field "/out/build-evidence/$package.deb"; printf 'Status: install ok installed\n'; } \
      > "/out/root/var/lib/dpkg/status.d/$package"
    cp "/out/packages/$directory/DEBIAN/md5sums" "/out/root/var/lib/dpkg/info/$package.md5sums"
    (cd "/out/packages/$directory"; find . -mindepth 1 ! -path "./DEBIAN*" -printf "/%P\n" | sort) \
      > "/out/root/var/lib/dpkg/info/$package.list"
  done
  # Reject an unexpected runtime dependency rather than copying untracked .so
  # files. The pinned distroless base supplies and inventories libc/OpenSSL/zlib.
  : > /out/root/usr/share/applypack/postgresql/elf-needed.txt
  while IFS= read -r binary; do
    readelf -d "$binary" | sed -n 's/.*Shared library: \[\(.*\)\].*/\1/p' \
      >> /out/root/usr/share/applypack/postgresql/elf-needed.txt
  done < <(find /out/root/usr/lib/postgresql /out/root/opt/applypack/postgresql -type f)
  sort -u -o /out/root/usr/share/applypack/postgresql/elf-needed.txt /out/root/usr/share/applypack/postgresql/elf-needed.txt
  while read -r library; do
    case "$library" in libpq.so.5|libssl.so.3|libcrypto.so.3|libz.so.1|libm.so.6|libc.so.6|ld-linux-x86-64.so.2) ;;
      *) die "postgres_client_untracked_dependency:$library";; esac
  done < /out/root/usr/share/applypack/postgresql/elf-needed.txt
  for binary in psql pg_dump pg_restore; do
    [[ $(LD_LIBRARY_PATH=/out/root/opt/applypack/postgresql/lib "/out/root/usr/lib/postgresql/17/bin/$binary" --version) == "$binary (PostgreSQL) $POSTGRES_VERSION" ]] \
      || die 'postgres_client_version_mismatch'
  done
  mkdir -p /out/root/opt/applypack
  node --input-type=module - "$POSTGRES_VERSION" "${RUNTIME_IMAGE##*@}" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const header = readFileSync('/pg-source/src/include/pg_config.h', 'utf8');
const enabled = (name) => new RegExp('^#define ' + name + ' 1$', 'm').test(header);
const features = { openssl: enabled('USE_OPENSSL'), zlib: enabled('HAVE_LIBZ'), readline: enabled('HAVE_LIBREADLINE'), icu: enabled('USE_ICU') };
if (!features.openssl || !features.zlib || features.readline || features.icu) throw new Error('POSTGRES_BUILD_FEATURES');
writeFileSync('/out/root/usr/share/applypack/postgresql/features.json', JSON.stringify(features) + '\n');
const hash = (name) => createHash('sha256').update(readFileSync('/out/root/usr/lib/postgresql/17/bin/' + name)).digest('hex');
writeFileSync('/out/root/opt/applypack/database-recovery-runtime.json', JSON.stringify({
  schemaVersion: 'applypack-database-recovery-runtime-v1', postgresMajor: 17,
  clientVersion: process.argv[2], baseImageDigest: process.argv[3], psqlSha256: hash('psql'), pgDumpSha256: hash('pg_dump'),
}, null, 2) + '\n');
JS
  cp config.log /out/build-evidence/
  find /out/root -type f -print0 | sort -z | xargs -0 sha256sum > /out/build-evidence/installed-files.sha256
  ;;
*) die 'expected_prepare_or_compile';;
esac
