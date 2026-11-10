#!/usr/bin/env bash
# 每日备份：MySQL 逻辑备份（mysqldump）+ JSON 单文档（若还在用）各一份，保留 14 天
# 由 cron 调用：20 3 * * * APP_DIR=/www/wwwroot/coin-ledger bash .../deploy/backup.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/www/wwwroot/coin-ledger}"
ENV_FILE="${ENV_FILE:-/etc/coin-ledger.env}"
DST="$APP_DIR/data/backups"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date +%Y%m%d)"

mkdir -p "$DST"

# 读取运行期配置（STORAGE / MYSQL_*）；没有 env 文件就只备份 JSON
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

SAVED=0

# ---------- 1. MySQL ----------
if [ "${STORAGE:-json}" = "mysql" ] && [ -n "${MYSQL_PASSWORD:-}" ] && command -v mysqldump >/dev/null 2>&1; then
  DUMP="$DST/mysql-$STAMP.sql"
  if MYSQL_PWD="$MYSQL_PASSWORD" mysqldump \
      -u"${MYSQL_USER:-coin_ledger}" -h"${MYSQL_HOST:-127.0.0.1}" -P"${MYSQL_PORT:-3306}" \
      --single-transaction --quick --skip-lock-tables --default-character-set=utf8mb4 \
      "${MYSQL_DB:-coin_ledger}" > "$DUMP.tmp" 2>/dev/null; then
    mv -f "$DUMP.tmp" "$DUMP"
    # 空文件或没有 CREATE TABLE 都算失败，别静默通过
    if [ ! -s "$DUMP" ] || ! grep -q 'CREATE TABLE' "$DUMP"; then
      echo "[backup] $(date -Is) mysqldump 结果异常：$DUMP" >&2
      exit 1
    fi
    gzip -f "$DUMP"
    SAVED=1
    echo "[backup] $(date -Is) 已备份 MySQL → $DUMP.gz"
  else
    rm -f "$DUMP.tmp"
    echo "[backup] $(date -Is) mysqldump 失败" >&2
    exit 1
  fi
fi

# ---------- 2. JSON 单文档（旧后端，或回退后仍在用） ----------
SRC="$APP_DIR/data/db.json"
if [ -f "$SRC" ]; then
  cp -f "$SRC" "$DST/db-$STAMP.json"
  if ! "$(command -v python3 || echo /usr/bin/python3)" -c "import json,sys;json.load(open('$DST/db-$STAMP.json'))" 2>/dev/null; then
    echo "[backup] $(date -Is) 备份文件解析失败：$DST/db-$STAMP.json" >&2
    exit 1
  fi
  SAVED=1
  echo "[backup] $(date -Is) 已备份 JSON → $DST/db-$STAMP.json"
fi

if [ "$SAVED" = "0" ]; then
  echo "[backup] $(date -Is) 没有可备份的数据源（STORAGE=${STORAGE:-json}）"
  exit 0
fi

find "$DST" -name 'db-*.json' -type f -mtime "+$KEEP_DAYS" -delete
find "$DST" -name 'mysql-*.sql.gz' -type f -mtime "+$KEEP_DAYS" -delete
echo "[backup] $(date -Is) 完成（保留 ${KEEP_DAYS} 天）"
