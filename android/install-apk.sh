#!/bin/sh
set -eu

cd "$(dirname "$0")"

ADB=${ADB:-/opt/homebrew/share/android-commandlinetools/platform-tools/adb}
APK=${1:-$(ls dist/77.Pet-*-byd-car.apk 2>/dev/null | tail -1)}

if [ -z "${APK:-}" ] || [ ! -f "$APK" ]; then
  echo "先运行 ./build-apk.sh 生成安装包" >&2
  exit 1
fi

"$ADB" install -r "$APK"
"$ADB" shell appops set app.pet77.car SYSTEM_ALERT_WINDOW allow
"$ADB" shell pm grant app.pet77.car android.permission.POST_NOTIFICATIONS 2>/dev/null || true
"$ADB" shell am start -n app.pet77.car/.MainActivity
echo "已安装：$APK"
