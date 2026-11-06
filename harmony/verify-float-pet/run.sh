#!/bin/bash
# 77 Pet 鸿蒙版构建/安装/启动脚本。
#
#   ./run.sh assets    # 从宠物包生成 alpha 轮廓 + 动画配置，并复制素材
#   ./run.sh build     # 编译
#   ./run.sh install   # 安装到设备
#   ./run.sh start     # 重启应用
#   ./run.sh log       # 抓 Pet77 日志
#   ./run.sh shot      # 截图
#   ./run.sh all       # assets + build + install + start
set -euo pipefail

DEVECO=/Applications/DevEco-Studio.app/Contents
SDK=$DEVECO/sdk
HDC=$SDK/default/openharmony/toolchains/hdc
PROJ="$(cd "$(dirname "$0")" && pwd)"
HAP="$PROJ/entry/build/default/outputs/default/entry-default-unsigned.hap"
BUNDLE=app.pet77.multiplatform
RAW="$PROJ/entry/src/main/resources/rawfile/pet"
PACKS_ROOT="${PET_PACKS_ROOT:-$HOME/Desktop/workspace/77-pet-packs}"
PACKS_DIR="$PACKS_ROOT/pets"

export JAVA_HOME=$DEVECO/jbr/Contents/Home
export DEVECO_SDK_HOME=$SDK
export PATH="$DEVECO/tools/node/bin:$PATH"

do_assets() {
  if [ ! -d "$PACKS_DIR" ]; then
    echo "找不到宠物包目录：$PACKS_DIR" >&2
    echo "可用 PET_PACKS_ROOT=<77-pet-packs 目录> ./run.sh assets 指定" >&2
    exit 1
  fi
  rm -rf "$RAW/packs" "$RAW/webm" "$RAW/memes"
  mkdir -p "$RAW/packs"
  for pack_dir in "$PACKS_DIR"/*/; do
    pack_dir="${pack_dir%/}"
    id="$(basename "$pack_dir")"
    if [ ! -f "$pack_dir/config.jsonc" ] || [ ! -d "$pack_dir/webm" ]; then
      continue
    fi
    out="$RAW/packs/$id"
    mkdir -p "$out"
    echo "→ $id: alpha 轮廓"
    node "$PROJ/pets/gen-alpha-mask.mjs" --pack "$pack_dir/webm" --out "$out/alpha-masks.json"
    echo "→ $id: 动画配置与素材"
    node "$PROJ/pets/gen-anim-config.mjs" --pack "$pack_dir" \
      --out "$out/anim-config.json" --copy-webm "$out/webm"
    if [ -f "$pack_dir/preview.png" ]; then
      cp "$pack_dir/preview.png" "$out/preview.png"
    fi
  done
  node "$PROJ/pets/gen-packs-index.mjs" --root "$PACKS_DIR" \
    --catalog "$PACKS_ROOT/catalog.json" --out "$RAW/packs.json"
  du -sh "$RAW/packs"
}

case "${1:-build}" in
  assets)
    do_assets
    ;;
  build)
    node "$DEVECO/tools/hvigor/bin/hvigorw.js" --mode module -p product=default assembleHap --no-daemon
    ;;
  install)
    "$HDC" install -r "$HAP"
    ;;
  start)
    "$HDC" shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
    "$HDC" shell "aa start -a EntryAbility -b $BUNDLE"
    ;;
  weights)
    # 临时改漫游权重做验证，例如：./run.sh weights 5 5 50（idle turn move）
    python3 - "$RAW/packs" "${2:-10}" "${3:-5}" "${4:-5}" <<'PY'
import glob, json, sys
root, idle, turn, move = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
for path in glob.glob(root + '/*/anim-config.json'):
    d = json.load(open(path))
    d['weights'] = {'idle': idle, 'turn': turn, 'move': move}
    json.dump(d, open(path, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(path, '->', d['weights'])
PY
    ;;
  log)
    "$HDC" shell "hilog -x -T Pet77"
    ;;
  release)
    # 产出可分发的 HAP。有签名配置就签，没有就只出 unsigned 并提示。
    node "$DEVECO/tools/hvigor/bin/hvigorw.js" --mode module -p product=default assembleHap --no-daemon
    mkdir -p "$PROJ/dist"
    VER=$(python3 - "$PROJ/AppScope/app.json5" <<'PY'
import re, sys
t = open(sys.argv[1]).read()
m = re.search(r'"versionName"\s*:\s*"([^"]+)"', t)
print(m.group(1) if m else '0.0.0')
PY
)
    OUT="$PROJ/dist/pet77-$VER-unsigned.hap"
    cp "$HAP" "$OUT"
    echo "→ $OUT ($(du -h "$OUT" | cut -f1))"
    echo "  未签名。签名需要 build-profile.json5 里配好 signingConfigs（AGC 调试证书 + Profile）。"
    ;;
  shot)
    out="${2:-/tmp/pet-shot.jpeg}"
    "$HDC" shell "snapshot_display -f /data/local/tmp/shot.jpeg" >/dev/null
    "$HDC" file recv /data/local/tmp/shot.jpeg "$out" >/dev/null
    echo "$out"
    ;;
  all)
    do_assets
    node "$DEVECO/tools/hvigor/bin/hvigorw.js" --mode module -p product=default assembleHap --no-daemon
    "$HDC" install -r "$HAP"
    "$HDC" shell "aa force-stop $BUNDLE" >/dev/null 2>&1 || true
    "$HDC" shell "aa start -a EntryAbility -b $BUNDLE"
    ;;
  *)
    echo "usage: $0 [assets|build|install|start|log|shot|release|all]" >&2
    exit 1
    ;;
esac
