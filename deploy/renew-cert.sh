#!/usr/bin/env bash
# 藏币录 · 证书续期兜底
#   bash deploy/renew-cert.sh            # 剩余 < 21 天才续
#   FORCE=1 bash deploy/renew-cert.sh    # 强制续
# 走宝塔自带的 acme_v2（与面板申请证书同一实现），续完直接写回站点配置。
set -uo pipefail

DOMAIN="${DOMAIN:-coin.virtualman.top}"
APP_DIR="${APP_DIR:-/www/wwwroot/coin-ledger}"
CERT="/www/server/panel/vhost/cert/$DOMAIN/fullchain.pem"
PY="/www/server/panel/pyenv/bin/python"
LOG_TAG="[renew-cert]"

log() { echo "$LOG_TAG $(date -Is) $*"; }

[ -f "$CERT" ] || { log "未找到证书 $CERT，直接申请"; NEED=1; }
NEED="${NEED:-0}"

if [ "$NEED" = "0" ] && [ -z "${FORCE:-}" ]; then
  END="$(openssl x509 -in "$CERT" -noout -enddate 2>/dev/null | cut -d= -f2)"
  [ -n "$END" ] || { log "证书读取失败，跳过"; exit 1; }
  END_TS="$(date -d "$END" +%s)"
  NOW_TS="$(date +%s)"
  DAYS=$(( (END_TS - NOW_TS) / 86400 ))
  log "证书剩余 $DAYS 天"
  if [ "$DAYS" -gt 21 ]; then
    log "无需续期"
    exit 0
  fi
  NEED=1
fi

if [ ! -x "$PY" ]; then
  log "找不到宝塔 python（$PY），无法续期"
  exit 1
fi

log "开始续期 $DOMAIN"
"$PY" - <<PYEOF
import sys
sys.path[:0] = ['/www/server/panel', '/www/server/panel/class', '/www/server/panel/mod']
import acme_v2, panelSite

class Get(dict):
    def __getattr__(self, k):
        try: return self[k]
        except KeyError: raise AttributeError(k)
    def __setattr__(self, k, v): self[k] = v

a = acme_v2.acme_v2()
r = a.apply_cert(['$DOMAIN'], auth_type='http', auth_to='$APP_DIR/public', ca='letsencrypt')
if not r.get('status'):
    print('[renew-cert] 签发失败:', r.get('msg'))
    raise SystemExit(1)
cert = r['cert']
root = r.get('root') or ''
if 'BEGIN CERTIFICATE' in root and root.strip() not in cert:
    cert = cert.rstrip() + "\n" + root.strip() + "\n"
res = panelSite.panelSite().SetSSL(Get(siteName='$DOMAIN', key=r['private_key'], csr=cert))
print('[renew-cert] 安装结果:', res)
raise SystemExit(0 if res.get('status') else 1)
PYEOF

RC=$?
[ "$RC" -eq 0 ] && log "续期完成" || log "续期失败，退出码 $RC"
exit "$RC"
