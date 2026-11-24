#!/bin/sh
set -eu

cd "$(dirname "$0")"

VERSION=$(sed -n 's/.*versionName = "\(.*\)"/\1/p' app/build.gradle.kts | head -1)
if [ -z "$VERSION" ]; then
  echo "读不到 versionName" >&2
  exit 1
fi

if [ -z "${JAVA_HOME:-}" ] && [ -d /opt/homebrew/opt/openjdk@17 ]; then
  JAVA_HOME=/opt/homebrew/opt/openjdk@17
  export JAVA_HOME
fi

./gradlew assembleRelease
mkdir -p dist
cp app/build/outputs/apk/release/app-release.apk "dist/77.Pet-${VERSION}-byd-car.apk"
echo "APK: $(pwd)/dist/77.Pet-${VERSION}-byd-car.apk"
