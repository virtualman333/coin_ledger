#!/usr/bin/env bash
# 藏币录 · 一键安装/更新脚本（在服务器上以 root 执行）
#   bash deploy/install.sh                 # 安装并启动
#   APP_PASSWORD=xxx bash deploy/install.sh
# 幂等：可直接重复执行用于升级（不会覆盖已存在的口令与数据）
set -euo pipefail

APP_DIR="${APP_DIR:-/www/wwwroot/coin-ledger}"
APP_USER="${APP_USER:-www}"
APP_PORT="${APP_PORT:-3100}"
ENV_FILE="/etc/coin-ledger.env"
UNIT_FILE="/etc/systemd/system/coin-ledger.service"
NGINX_VHOST_DIR="${NGINX_VHOST_DIR:-/www/server/panel/vhost/nginx}"
SERVER_NAME="${SERVER_NAME:-47.119.132.60}"

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log()  { printf '\033[36m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[warn]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[error]\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请用 root 执行"

# ---------------------------------------------------------------
# 1. Node 运行时
# ---------------------------------------------------------------
find_node() {
  local c
  c="$(command -v node 2>/dev/null || true)"
  if [ -n "$c" ]; then echo "$c"; return; fi
  # 宝塔 Node 版本管理器
  c="$(ls -1d /www/server/nodejs/v*/bin/node 2>/dev/null | sort -V | tail -1 || true)"
  if [ -n "$c" ]; then echo "$c"; return; fi
  echo ""
}

install_node() {
  local ver="v20.18.0"
  local arch; arch="$(uname -m)"
  case "$arch" in
    x86_64)  arch="x64" ;;
    aarch64) arch="arm64" ;;
    *) die "不支持的架构：$arch" ;;
  esac
  local url="https://npmmirror.com/mirrors/node/${ver}/node-${ver}-linux-${arch}.tar.xz"
  local tmp="/tmp/node-${ver}.tar.xz"
  log "未检测到 Node，从 npmmirror 下载 ${ver}"
  if command -v curl >/dev/null 2>&1; then
    curl -fL --retry 2 -o "$tmp" "$url" || die "Node 下载失败，请检查网络或手动安装 Node 18+"
  else
    wget -O "$tmp" "$url" || die "Node 下载失败"
  fi
  mkdir -p /www/server/nodejs
  tar -xJf "$tmp" -C /www/server/nodejs
  ln -sf "/www/server/nodejs/node-${ver}-linux-${arch}/bin/node" /usr/local/bin/node
  ln -sf "/www/server/nodejs/node-${ver}-linux-${arch}/bin/npm"  /usr/local/bin/npm
  rm -f "$tmp"
}

NODE_BIN="$(find_node)"
if [ -z "$NODE_BIN" ]; then
  install_node
  NODE_BIN="$(find_node)"
fi
[ -n "$NODE_BIN" ] || die "Node 安装后仍未找到可执行文件"
NODE_VER="$("$NODE_BIN" -v)"
log "Node: $NODE_BIN ($NODE_VER)"
"$NODE_BIN" -e 'const m=+process.versions.node.split(".")[0]; if(m<18){console.error("需要 Node >= 18");process.exit(1)}'

# ---------------------------------------------------------------
# 2. 部署代码（保留 data/ 与 env）
# ---------------------------------------------------------------
[ -d "$APP_DIR" ] || mkdir -p "$APP_DIR"
log "部署到 $APP_DIR"

if [ "$SRC_DIR" != "$APP_DIR" ]; then
  # 用 rsync 更干净，没有就用 tar 管道
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete \
      --exclude 'data/' --exclude '.git/' --exclude 'node_modules/' \
      --exclude '.testdata/' --exclude '*.log' \
      "$SRC_DIR"/ "$APP_DIR"/
  else
    ( cd "$SRC_DIR" && tar -cf - \
        --exclude='./data' --exclude='./.git' --exclude='./node_modules' \
        --exclude='./.testdata' --exclude='*.log' . ) | ( cd "$APP_DIR" && tar -xf - )
  fi
fi

mkdir -p "$APP_DIR/data"
# 宝塔会在站点目录写 .user.ini 并 chattr +i，chown -R 会整体失败，这里跳过它
if ! chown -R "$APP_USER:$APP_USER" "$APP_DIR" 2>/dev/null; then
  find "$APP_DIR" ! -name '.user.ini' -exec chown -h "$APP_USER:$APP_USER" {} + 2>/dev/null || true
  warn "已跳过被面板锁定的 .user.ini（属主 root，属正常现象）"
fi
chmod -R u+rwX "$APP_DIR/data" 2>/dev/null || true

# ---------------------------------------------------------------
# 3. 环境变量（口令只生成一次，后续升级不动它）
# ---------------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  GEN_PW="${APP_PASSWORD:-$(head -c 12 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 12)}"
  GEN_SK="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 40)"
  umask 077
  cat > "$ENV_FILE" <<EOF
# 藏币录后端环境变量（chmod 600，勿提交到仓库）
NODE_ENV=production
PORT=$APP_PORT
HOST=127.0.0.1
APP_PASSWORD=$GEN_PW
SUPERADMIN_PASSWORD=$GEN_PW
SESSION_SECRET=$GEN_SK
COIN_DATA_DIR=$APP_DIR/data
EOF
  chmod 600 "$ENV_FILE"
  log "已生成 $ENV_FILE"
  echo
  echo "  ┌──────────────────────────────────────────────┐"
  echo "  │ 访问口令（请立即保存）：$GEN_PW"
  echo "  └──────────────────────────────────────────────┘"
  echo
else
  log "$ENV_FILE 已存在，保留原口令"
  if [ -n "${APP_PASSWORD:-}" ]; then
    sed -i "s|^APP_PASSWORD=.*|APP_PASSWORD=${APP_PASSWORD}|" "$ENV_FILE"
    log "已按参数更新访问口令"
  fi
fi

# ---------------------------------------------------------------
# 3.5 存储后端
#     默认 MySQL：自动建库建账号、装 mysql2、首次把 data/db.json 导进去
#     退回单文档模式：STORAGE=json bash deploy/install.sh
# ---------------------------------------------------------------
STORAGE="${STORAGE:-mysql}"
MYSQL_DB="${MYSQL_DB:-coin_ledger}"
MYSQL_USER="${MYSQL_USER:-coin_ledger}"
MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${MYSQL_PORT:-3306}"

set_env() {
  local k="$1" v="$2"
  if grep -q "^${k}=" "$ENV_FILE"; then
    sed -i "s|^${k}=.*|${k}=${v}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$k" "$v" >> "$ENV_FILE"
  fi
}

env_get() {
  sed -n "s|^$1=||p" "$ENV_FILE" 2>/dev/null | head -1
}

if [ "$STORAGE" = "mysql" ]; then
  command -v mysql >/dev/null 2>&1 || die "未找到 mysql 客户端；请先在宝塔「软件商店」安装 MySQL 8"

  # root 连接方式：环境变量 → 免密 → 宝塔面板里存的 root 口令
  ROOT_PW="${MYSQL_ROOT_PASSWORD:-}"
  if [ -z "$ROOT_PW" ] && mysql -uroot -N -e 'SELECT 1' >/dev/null 2>&1; then
    ROOT_PW="__EMPTY__"
  fi
  if [ -z "$ROOT_PW" ] && [ -f /www/server/panel/data/default.db ]; then
    ROOT_PW="$(python3 -c "import sqlite3;c=sqlite3.connect('/www/server/panel/data/default.db');r=c.execute('select mysql_root from config limit 1').fetchone();print(r[0] if r else '')" 2>/dev/null || true)"
    if [ -n "$ROOT_PW" ] && ! MYSQL_PWD="$ROOT_PW" mysql -uroot -N -e 'SELECT 1' >/dev/null 2>&1; then
      ROOT_PW=""
    fi
  fi
  if [ -z "$ROOT_PW" ]; then
    die "无法以 root 连接 MySQL。请用：MYSQL_ROOT_PASSWORD=xxx bash deploy/install.sh"
  fi

  mysql_admin() {
    if [ "$ROOT_PW" = "__EMPTY__" ]; then mysql -uroot -e "$1"
    else MYSQL_PWD="$ROOT_PW" mysql -uroot -e "$1"; fi
  }
  mysql_app() {
    MYSQL_PWD="$MYSQL_PW" mysql -u"$MYSQL_USER" -h"$MYSQL_HOST" -P"$MYSQL_PORT" "$MYSQL_DB" -N -e "$1"
  }

  # 账号口令只生成一次，之后从 env 复用
  MYSQL_PW="$(env_get MYSQL_PASSWORD)"
  if [ -z "$MYSQL_PW" ]; then
    MYSQL_PW="$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)"
  fi

  log "配置 MySQL：库 $MYSQL_DB，账号 $MYSQL_USER"
  mysql_admin "CREATE DATABASE IF NOT EXISTS \`$MYSQL_DB\` DEFAULT CHARACTER SET utf8mb4;"
  for h in localhost 127.0.0.1; do
    mysql_admin "CREATE USER IF NOT EXISTS '$MYSQL_USER'@'$h' IDENTIFIED BY '$MYSQL_PW';"
    mysql_admin "ALTER USER '$MYSQL_USER'@'$h' IDENTIFIED BY '$MYSQL_PW';"
    mysql_admin "GRANT ALL PRIVILEGES ON \`$MYSQL_DB\`.* TO '$MYSQL_USER'@'$h';"
  done
  mysql_admin "FLUSH PRIVILEGES;"

  set_env STORAGE mysql
  set_env MYSQL_HOST "$MYSQL_HOST"
  set_env MYSQL_PORT "$MYSQL_PORT"
  set_env MYSQL_DB "$MYSQL_DB"
  set_env MYSQL_USER "$MYSQL_USER"
  set_env MYSQL_PASSWORD "$MYSQL_PW"

  # 运行依赖（mysql2）。node_modules 会被上面的同步逻辑排除，不会互相覆盖
  if grep -q '"mysql2"' "$APP_DIR/package.json" 2>/dev/null; then
    log "安装 Node 依赖（mysql2）"
    if ! ( cd "$APP_DIR" && npm install --omit=dev --no-audit --no-fund --loglevel=error \
             --registry="${NPM_REGISTRY:-https://registry.npmmirror.com}" ); then
      die "npm install 失败；可手动执行后重试：cd $APP_DIR && npm install --omit=dev"
    fi
    chown -R "$APP_USER:$APP_USER" "$APP_DIR/node_modules" 2>/dev/null || true
  else
    die "package.json 缺少 mysql2 依赖"
  fi

  # 首次切换：库里还没有账号时，把 JSON 数据导进去（原文件保留，不删）
  ROWS="$(mysql_app 'SELECT COUNT(*) FROM cl_users' 2>/dev/null || echo 0)"
  if [ "${ROWS:-0}" = "0" ]; then
    if [ -f "$APP_DIR/data/db.json" ]; then
      # 迁移期间必须停写：否则旧进程还在往 db.json 落盘，切完库就丢那几条
      log "暂停服务以保证 JSON 快照一致"
      systemctl stop coin-ledger >/dev/null 2>&1 || true
      log "检测到 data/db.json，导入 MySQL（原文件保留）"
      if ! ( cd "$APP_DIR" && set -a && . "$ENV_FILE" && set +a && \
             node tools/migrate-to-mysql.js --write ); then
        warn "数据导入失败，回退到 JSON 后端"
        set_env STORAGE json
        systemctl restart coin-ledger >/dev/null 2>&1 || true
        die "数据导入失败，已回退 JSON；数据未受影响，可修正后重跑"
      fi
    else
      log "没有历史 JSON 数据，MySQL 从空库开始"
    fi
  else
    log "MySQL 已有 ${ROWS} 个账号，跳过导入"
    JSON_REV="$(python3 -c "import json;print(json.load(open('$APP_DIR/data/db.json')).get('rev',0))" 2>/dev/null || echo '?')"
    DB_REV="$(mysql_app "SELECT v FROM cl_meta WHERE k='rev'" 2>/dev/null || echo '?')"
    if [ "$JSON_REV" != "$DB_REV" ]; then
      warn "库内 rev=$DB_REV 与 db.json rev=$JSON_REV 不一致（正常：切换后 JSON 已冻结不再写入）"
    fi
  fi
else
  set_env STORAGE json
  log "存储后端：JSON 单文档（$APP_DIR/data/db.json）"
fi

# ---------------------------------------------------------------
# 4. systemd
# ---------------------------------------------------------------
log "配置 systemd 服务"
sed -e "s|^WorkingDirectory=.*|WorkingDirectory=$APP_DIR|" \
    -e "s|^ExecStart=.*|ExecStart=$NODE_BIN server/index.js|" \
    -e "s|^User=.*|User=$APP_USER|" \
    -e "s|^Group=.*|Group=$APP_USER|" \
    -e "s|^ReadWritePaths=.*|ReadWritePaths=$APP_DIR/data|" \
    "$SRC_DIR/deploy/coin-ledger.service" > "$UNIT_FILE"

systemctl daemon-reload
systemctl enable coin-ledger >/dev/null 2>&1 || true
systemctl restart coin-ledger
sleep 1

if ! systemctl is-active --quiet coin-ledger; then
  warn "服务未启动，最近日志："
  journalctl -u coin-ledger -n 30 --no-pager || true
  die "启动失败"
fi
log "服务已启动"

# ---------------------------------------------------------------
# 5. Nginx
#    两种模式：
#      baota —— 域名已在宝塔「网站」登记，把配置片段 include 进宝塔生成的 conf
#      standalone —— 没有宝塔站点，自己写一个完整 server 块
# ---------------------------------------------------------------
PRIMARY_DOMAIN="${PRIMARY_DOMAIN:-coin.virtualman.top}"
SNIPPET="$NGINX_VHOST_DIR/coin-ledger.locations.conf"
BAOTA_CONF="$NGINX_VHOST_DIR/$PRIMARY_DOMAIN.conf"
LEGACY_CONF="$NGINX_VHOST_DIR/coin-ledger.conf"
NGINX_MODE="skip"

if [ -d "$NGINX_VHOST_DIR" ]; then
  # 限流 zone / UA 规则必须在 http 上下文，且先于站点块被 include
  install -m 644 "$SRC_DIR/deploy/nginx-zones.conf" "$NGINX_VHOST_DIR/0.coin-ledger.zones.conf"
  log "已写入限流规则 $NGINX_VHOST_DIR/0.coin-ledger.zones.conf"

  if [ -f "$BAOTA_CONF" ]; then
    NGINX_MODE="baota"
    log "检测到宝塔站点 $PRIMARY_DOMAIN，采用扩展目录模式"

    # 1) 校验宝塔站点的「网站目录」是否已指向应用前端
    #    该值在面板「网站 → 设置 → 网站目录」里改，脚本不擅自改它：
    #    Baota 会给站点目录写 .user.ini 并 chattr +i，替换目录会留下删不掉的残留。
    SITE_ROOT="$(grep -m1 -E '^[[:space:]]*root[[:space:]]' "$BAOTA_CONF" | sed -E 's/^[[:space:]]*root[[:space:]]*//; s/;.*$//' | tr -d ' ')"
    if [ "$SITE_ROOT" = "$APP_DIR/public" ]; then
      log "网站目录已指向 $APP_DIR/public"
    else
      warn "宝塔站点「$PRIMARY_DOMAIN」的网站目录是 $SITE_ROOT，不是 $APP_DIR/public"
      warn "请在面板 网站 → $PRIMARY_DOMAIN → 设置 → 网站目录 中改为 $APP_DIR/public"
    fi

    # 2) /api 反代等指令放进宝塔的 extension 目录，面板重新生成配置也不会丢
    EXT_DIR="$NGINX_VHOST_DIR/extension/$PRIMARY_DOMAIN"
    install -d "$EXT_DIR"
    install -m 644 "$SRC_DIR/deploy/nginx-locations.conf" "$EXT_DIR/coin-ledger.conf"
    log "已写入扩展配置 $EXT_DIR/coin-ledger.conf"

    # 独立模式的旧配置会和宝塔站点抢同一个 server_name，必须清掉
    [ -f "$LEGACY_CONF" ] && rm -f "$LEGACY_CONF" && log "已移除独立模式旧配置 $LEGACY_CONF"
  else
    NGINX_MODE="standalone"
    log "未找到宝塔站点配置，使用独立 server 块"
    install -m 644 "$SRC_DIR/deploy/nginx-locations.conf" "$SNIPPET"
    sed -e "s|^    server_name .*|    server_name $PRIMARY_DOMAIN $SERVER_NAME;|" \
        -e "s|/www/wwwroot/coin-ledger/public|$APP_DIR/public|g" \
        "$SRC_DIR/deploy/nginx.conf" > "$LEGACY_CONF"
  fi

  if nginx -t >/dev/null 2>&1; then
    nginx -s reload 2>/dev/null || systemctl reload nginx
    log "Nginx 已重载（模式：$NGINX_MODE）"
  else
    warn "nginx -t 未通过，配置已写入但未生效："
    nginx -t || true
  fi
else
  warn "未找到 $NGINX_VHOST_DIR，跳过 Nginx 配置"
fi

# ---------------------------------------------------------------
# 6. 日志轮转 + 每日备份
# ---------------------------------------------------------------
if [ -d /etc/logrotate.d ]; then
  cat > /etc/logrotate.d/coin-ledger <<EOF
/www/wwwlogs/coin-ledger*.log {
    daily
    rotate 14
    missingok
    notifempty
    compress
    delaycompress
    sharedscripts
    postrotate
        nginx -s reopen 2>/dev/null || true
    endscript
}
EOF
  log "已配置日志轮转（/etc/logrotate.d/coin-ledger，保留 14 天）"
fi

if [ -f "$APP_DIR/deploy/backup.sh" ]; then
  chmod +x "$APP_DIR/deploy/backup.sh"
  CRON_LINE="20 3 * * * APP_DIR=$APP_DIR bash $APP_DIR/deploy/backup.sh >> /www/wwwlogs/coin-ledger-backup.log 2>&1"
  if crontab -l 2>/dev/null | grep -q "deploy/backup.sh"; then
    log "备份计划任务已存在"
  else
    (crontab -l 2>/dev/null; echo "$CRON_LINE") | crontab -
    log "已添加每日 03:20 数据备份计划任务"
  fi
fi

if [ -f "$APP_DIR/deploy/renew-cert.sh" ]; then
  chmod +x "$APP_DIR/deploy/renew-cert.sh"
  RENEW_LINE="40 4 * * 1 DOMAIN=$PRIMARY_DOMAIN APP_DIR=$APP_DIR bash $APP_DIR/deploy/renew-cert.sh >> /www/wwwlogs/coin-ledger-cert.log 2>&1"
  if crontab -l 2>/dev/null | grep -q "deploy/renew-cert.sh"; then
    log "证书续期计划任务已存在"
  else
    (crontab -l 2>/dev/null; echo "$RENEW_LINE") | crontab -
    log "已添加每周一 04:40 证书续期检查（剩余 <21 天才真正续）"
  fi
fi

# ---------------------------------------------------------------
# 7. 自检
# ---------------------------------------------------------------
sleep 1
if command -v curl >/dev/null 2>&1; then
  HEALTH="$(curl -fsS "http://127.0.0.1:$APP_PORT/api/health" 2>/dev/null || true)"
  if [ -n "$HEALTH" ]; then
    log "后端自检通过：$HEALTH"
  else
    warn "后端自检失败，请查看：journalctl -u coin-ledger -n 50"
  fi

  # 经 Nginx 再验一次，确认反代链路通
  # HTTP 侧允许 301（强制跳 HTTPS），接口走 HTTPS 直连本机验证
  FRONT_CODE="$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $PRIMARY_DOMAIN" "http://127.0.0.1/" 2>/dev/null || echo 000)"
  API_CODE="$(curl -sk -o /dev/null -w '%{http_code}' --resolve "$PRIMARY_DOMAIN:443:127.0.0.1" "https://$PRIMARY_DOMAIN/api/health" 2>/dev/null || echo 000)"
  case "$FRONT_CODE" in
    200|301|302) FRONT_OK=1 ;;
    *) FRONT_OK=0 ;;
  esac
  if [ "$FRONT_OK" = "1" ] && [ "$API_CODE" = "200" ]; then
    log "Nginx 链路自检通过（首页 $FRONT_CODE，HTTPS 接口 $API_CODE）"
  else
    warn "Nginx 链路异常（首页 $FRONT_CODE，HTTPS 接口 $API_CODE），请检查站点配置"
  fi
fi

echo
log "完成。"
echo "  站点      https://$PRIMARY_DOMAIN/   （HTTP 自动跳转）"
echo "  健康检查  https://$PRIMARY_DOMAIN/api/health"
echo "  面板      「网站」列表中的 $PRIMARY_DOMAIN（wwwroot/coin-ledger）"
echo "  口令文件  $ENV_FILE"
echo "  日志      journalctl -u coin-ledger -f"
