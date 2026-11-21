#!/usr/bin/env bash
# 鸿蒙端命令行构建（不打开 DevEco Studio 也能出包）
#   bash harmony/build.sh            # debug HAP
#   bash harmony/build.sh release    # release HAP（仍需要签名配置才能安装）
#
# 依赖：DevEco Studio 6.0+（内置 SDK / hvigor / JBR）
set -euo pipefail

cd "$(dirname "$0")"

DEVECO_HOME="${DEVECO_HOME:-D:/Program Files/Huawei/DevEco Studio}"
export DEVECO_SDK_HOME="${DEVECO_SDK_HOME:-$DEVECO_HOME/sdk}"
export JAVA_HOME="${JAVA_HOME:-$DEVECO_HOME/jbr}"
export PATH="$JAVA_HOME/bin:$PATH"

MODE="${1:-debug}"
HVIGOR="$DEVECO_HOME/tools/hvigor/bin/hvigorw.js"

if [ ! -f "$HVIGOR" ]; then
  echo "找不到 hvigor：$HVIGOR"
  echo "请设置 DEVECO_HOME 指向 DevEco Studio 安装目录"
  exit 1
fi

echo "==> 同步品种目录数据"
node ../tools/build_harmony_data.js

echo "==> 构建（$MODE）"
if [ "$MODE" = "release" ]; then
  node "$HVIGOR" assembleHap --mode module -p product=default -p module=entry@default \
    -p buildMode=release --no-daemon
else
  node "$HVIGOR" assembleHap --mode module -p product=default -p module=entry@default --no-daemon
fi

echo "==> 产物"
find . -name "*.hap" -not -path "*/build/*/intermediates/*" -print
