#!/bin/bash
#
# cpm.sh  (Caddy Proxy Manager)
# 独立的 Caddy 反代工具：把任意端口的 ws/grpc/httpupgrade 节点反代成 443/TLS。
#
# 支持协议（按"传输层"判断，不是按协议名）:
#   ✅ VMess   ws / grpc / httpupgrade
#   ✅ VLESS   ws / grpc / httpupgrade
#   ✅ Trojan  ws / grpc
#   ✅ Shadowsocks + v2ray-plugin (ws)
#
# 不支持（脚本会拒绝，原因见 README 注释）:
#   ❌ raw TCP / mKCP / QUIC / Hysteria / Hysteria2 / TUIC / Reality
#   ❌ 原版 SS / 原版 Trojan-TLS（非 ws）
#
# 用法:
#   bash cpm.sh add          # 交互添加
#   bash cpm.sh list         # 列出
#   bash cpm.sh del <域名>   # 删除
#   bash cpm.sh              # 主菜单
#

set -u

red='\e[31m'; green='\e[92m'; yellow='\e[33m'; cyan='\e[96m'; gray='\e[90m'; none='\e[0m'
_red(){ echo -e "${red}$*${none}"; }
_green(){ echo -e "${green}$*${none}"; }
_yellow(){ echo -e "${yellow}$*${none}"; }
_cyan(){ echo -e "${cyan}$*${none}"; }
_gray(){ echo -e "${gray}$*${none}"; }
err(){ _red "错误: $*"; exit 1; }

[[ $EUID -ne 0 ]] && err "请使用 root 用户运行"

PKG=$(type -P apt-get || type -P yum || true)
[[ -z $PKG ]] && err "仅支持 apt-get / yum 包管理器"

CADDY_DIR=/etc/caddy
CADDY_MAIN=$CADDY_DIR/Caddyfile
SITES_DIR=$CADDY_DIR/sites
META_DIR=$CADDY_DIR/cpm-meta
mkdir -p "$SITES_DIR" "$META_DIR"

# ---------- 依赖 ----------
ensure_pkg(){
    local missing=()
    for p in "$@"; do
        type -P "$p" >/dev/null 2>&1 || missing+=("$p")
    done
    if (( ${#missing[@]} )); then
        _yellow "安装依赖: ${missing[*]}"
        if [[ $PKG =~ apt ]]; then
            apt-get update -y >/dev/null 2>&1 || true
            apt-get install -y "${missing[@]}" >/dev/null
        else
            yum install -y "${missing[@]}" >/dev/null || {
                yum install -y epel-release >/dev/null 2>&1
                yum install -y "${missing[@]}" >/dev/null
            }
        fi
    fi
}

ensure_caddy(){
    type -P caddy >/dev/null 2>&1 && return
    _yellow "安装 Caddy..."
    if [[ $PKG =~ apt ]]; then
        ensure_pkg curl gnupg ca-certificates debian-keyring debian-archive-keyring apt-transport-https
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
            | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
        curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
            > /etc/apt/sources.list.d/caddy-stable.list
        apt-get update -y >/dev/null
        apt-get install -y caddy
    else
        yum install -y 'dnf-command(copr)' >/dev/null 2>&1 || yum install -y yum-plugin-copr >/dev/null 2>&1 || true
        yum copr enable -y @caddy/caddy >/dev/null
        yum install -y caddy
    fi
    type -P caddy >/dev/null 2>&1 || err "Caddy 安装失败"
}

ensure_main_caddyfile(){
    if [[ ! -f $CADDY_MAIN ]] || ! grep -q "import .*sites/\*\.caddy" "$CADDY_MAIN"; then
        cat > "$CADDY_MAIN" <<EOF
# 由 cpm.sh 生成
{
    email admin@example.com
}
import $SITES_DIR/*.caddy
EOF
    fi
}

# ---------- base64 / URL 工具 ----------
b64_pad(){
    local s=$1 mod
    s=${s//-/+}; s=${s//_//}
    mod=$(( ${#s} % 4 ))
    (( mod )) && s="$s$(printf '=%.0s' $(seq 1 $((4-mod))))"
    printf '%s' "$s"
}
b64d(){ echo -n "$(b64_pad "$1")" | base64 -d 2>/dev/null; }
b64e(){
    local out
    out=$(printf '%s' "$1" | base64 -w0 2>/dev/null) || out=$(printf '%s' "$1" | base64 | tr -d '\n')
    printf '%s' "$out"
}
urldecode(){ printf '%b' "${1//%/\\x}"; }
urlencode(){ jq -rn --arg s "$1" '$s|@uri'; }
# ---------- 协议解析 ----------
# 输出统一字段到全局变量:
#   P_PROTO  vmess|vless|trojan|ss
#   P_NET    ws|grpc|httpupgrade
#   P_ADD    原服务器地址
#   P_PORT   原端口
#   P_ID     UUID 或 password / SS 的 method:password
#   P_PATH   ws/httpupgrade 的 path, 或 grpc 的 serviceName(以 / 开头存)
#   P_HOST   原 Host header (可空)
#   P_PS     备注名
#   P_AID    vmess alterId
#   P_SCY    vmess scy
#   P_FLOW   vless flow (可空, 但 xtls-rprx-vision 会被拒绝)
#   P_SS_M   ss method
#   P_SS_P   ss password
parse_link(){
    local url=$1
    P_PROTO=""; P_NET=""; P_ADD=""; P_PORT=""; P_ID=""; P_PATH="/"; P_HOST=""
    P_PS=""; P_AID="0"; P_SCY="auto"; P_FLOW=""; P_SS_M=""; P_SS_P=""

    case $url in
        vmess://*) parse_vmess "$url" ;;
        vless://*) parse_vless_or_trojan vless "$url" ;;
        trojan://*) parse_vless_or_trojan trojan "$url" ;;
        ss://*) parse_ss "$url" ;;
        *) err "无法识别的链接，仅支持 vmess:// / vless:// / trojan:// / ss://" ;;
    esac
}

parse_vmess(){
    ensure_pkg jq
    local raw=${1#vmess://}
    local json
    json=$(b64d "$raw") || err "vmess 解码失败"
    [[ -z $json ]] && err "vmess 解码后为空"
    P_PROTO=vmess
    P_PS=$(jq -r '.ps  // ""' <<<"$json")
    P_ADD=$(jq -r '.add // ""' <<<"$json")
    P_PORT=$(jq -r '.port // ""' <<<"$json")
    P_ID=$(jq -r '.id // ""' <<<"$json")
    P_AID=$(jq -r '.aid // "0"' <<<"$json")
    P_NET=$(jq -r '.net // ""' <<<"$json")
    P_PATH=$(jq -r '.path // "/"' <<<"$json")
    P_HOST=$(jq -r '.host // ""' <<<"$json")
    P_SCY=$(jq -r '.scy // "auto"' <<<"$json")
    # grpc 的 serviceName 在 path 字段
    [[ $P_NET == "grpc" && $P_PATH == "/" ]] && P_PATH=$(jq -r '.path // ""' <<<"$json")
}

parse_vless_or_trojan(){
    local proto=$1 url=$2
    P_PROTO=$proto
    # 形如 vless://uuid@host:port?params#ps  trojan://password@host:port?params#ps
    local body=${url#${proto}://}
    local frag="" query="" userinfo="" hostport=""
    if [[ $body == *"#"* ]]; then
        frag=${body##*#}
        body=${body%#*}
    fi
    if [[ $body == *"?"* ]]; then
        query=${body#*\?}
        body=${body%%\?*}
    fi
    userinfo=${body%%@*}
    hostport=${body#*@}
    P_ID=$(urldecode "$userinfo")
    P_ADD=${hostport%:*}
    P_PORT=${hostport##*:}
    P_PS=$(urldecode "$frag")
    # 解析 query
    local IFS='&' kv k v
    for kv in $query; do
        k=${kv%%=*}; v=${kv#*=}
        v=$(urldecode "$v")
        case $k in
            type) P_NET=$v ;;
            path|serviceName) P_PATH=$v ;;
            host) P_HOST=$v ;;
            flow) P_FLOW=$v ;;
        esac
    done
    [[ -z $P_NET ]] && P_NET="tcp"
    # grpc 的 serviceName 不带 /, 统一加上方便后续 Caddy path 匹配
    if [[ $P_NET == "grpc" && $P_PATH != /* ]]; then
        P_PATH="/$P_PATH"
    fi
    [[ -z $P_PATH ]] && P_PATH="/"
}

parse_ss(){
    # ss://BASE64(method:password)@host:port#ps
    # 或 ss://BASE64(method:password@host:port)#ps
    # 或带 plugin: ss://...@host:port?plugin=v2ray-plugin;...#ps
    local body=${1#ss://}
    local frag="" query=""
    if [[ $body == *"#"* ]]; then
        frag=${body##*#}; body=${body%#*}
    fi
    if [[ $body == *"?"* ]]; then
        query=${body#*\?}; body=${body%%\?*}
    fi

    local userinfo hostport
    if [[ $body == *@* ]]; then
        userinfo=${body%@*}
        hostport=${body##*@}
        # userinfo 可能是 base64 也可能是明文 method:password
        if [[ $userinfo != *:* ]]; then
            userinfo=$(b64d "$userinfo")
        fi
    else
        # 整体 base64
        local decoded
        decoded=$(b64d "$body")
        userinfo=${decoded%@*}
        hostport=${decoded##*@}
    fi
    P_PROTO=ss
    P_SS_M=${userinfo%%:*}
    P_SS_P=${userinfo#*:}
    P_ID="$P_SS_M:$P_SS_P"
    P_ADD=${hostport%:*}
    P_PORT=${hostport##*:}
    P_PS=$(urldecode "$frag")
    # plugin
    local plugin="" pluginopts=""
    local IFS='&' kv k v
    for kv in $query; do
        k=${kv%%=*}; v=${kv#*=}
        v=$(urldecode "$v")
        [[ $k == plugin ]] && plugin=$v
    done
    [[ -z $plugin ]] && err "原版 SS 不支持反代，需要 v2ray-plugin/ws 形式"
    [[ $plugin != v2ray-plugin* && $plugin != xray-plugin* ]] && \
        err "仅支持 v2ray-plugin / xray-plugin 的 ws 模式 (当前: $plugin)"
    # plugin opts: 如 v2ray-plugin;mode=websocket;path=/xxx;host=xxx
    pluginopts=${plugin#*;}
    P_NET=tcp
    local IFS=';' opt
    for opt in $pluginopts; do
        case $opt in
            mode=websocket) P_NET=ws ;;
            path=*) P_PATH=${opt#path=} ;;
            host=*) P_HOST=${opt#host=} ;;
        esac
    done
    [[ $P_NET != ws ]] && err "SS plugin 必须为 mode=websocket"
}
# ---------- 校验传输层 ----------
validate_net(){
    case $P_NET in
        ws|httpupgrade|grpc) ;;
        tcp|raw) err "不支持 net=tcp/raw (非 HTTP)" ;;
        kcp|mkcp|quic) err "不支持 net=$P_NET (UDP 协议无法 HTTP 反代)" ;;
        "") err "链接缺少传输层信息" ;;
        *) err "不支持的 net=$P_NET" ;;
    esac
    [[ $P_FLOW == xtls* ]] && err "不支持 XTLS/Reality flow=$P_FLOW (Reality 自带 TLS)"
    [[ $P_PROTO == trojan && $P_NET != ws && $P_NET != grpc ]] && err "Trojan 仅支持 ws/grpc"
}

# ---------- 生成 Caddy 站点片段 ----------
build_caddy_site(){
    local domain=$1 email=$2 site_file=$3
    local upstream="${P_ADD}:${P_PORT}"
    {
        echo "# 由 cpm.sh 生成 $(date '+%F %T' 2>/dev/null || true)"
        echo "# 协议: $P_PROTO  传输: $P_NET  上游: $upstream  路径: $P_PATH"
        echo "$domain {"
        [[ -n $email ]] && echo "    tls $email"
        echo "    encode gzip"

        case $P_NET in
            ws|httpupgrade)
                echo "    @proxy {"
                echo "        path $P_PATH"
                echo "    }"
                echo "    reverse_proxy @proxy $upstream {"
                echo "        header_up Host {upstream_hostport}"
                echo "        header_up X-Real-IP {remote_host}"
                echo "    }"
                ;;
            grpc)
                echo "    @grpc {"
                echo "        path ${P_PATH}/*"
                echo "        header Content-Type application/grpc*"
                echo "    }"
                echo "    reverse_proxy @grpc h2c://${upstream} {"
                echo "        header_up Host {upstream_hostport}"
                echo "        header_up X-Real-IP {remote_host}"
                echo "    }"
                ;;
        esac

        echo "    handle {"
        echo "        respond \"It works.\" 200"
        echo "    }"
        echo "}"
    } > "$site_file"
}

# ---------- 生成新链接（443/TLS） ----------
build_new_link(){
    local domain=$1
    local new_ps="${P_PS:-$P_PROTO}-443@${domain}"
    case $P_PROTO in
        vmess) build_new_vmess "$domain" "$new_ps" ;;
        vless) build_new_vless "$domain" "$new_ps" ;;
        trojan) build_new_trojan "$domain" "$new_ps" ;;
        ss) build_new_ss "$domain" "$new_ps" ;;
    esac
}

build_new_vmess(){
    local domain=$1 ps=$2
    local json
    json=$(jq -n \
        --arg v "2" --arg ps "$ps" --arg add "$domain" --arg port "443" \
        --arg id "$P_ID" --arg aid "$P_AID" --arg scy "$P_SCY" \
        --arg net "$P_NET" --arg type "none" \
        --arg host "$domain" --arg path "$P_PATH" \
        --arg tls "tls" --arg sni "$domain" \
        '{v:$v, ps:$ps, add:$add, port:$port, id:$id, aid:$aid, scy:$scy,
          net:$net, type:$type, host:$host, path:$path, tls:$tls, sni:$sni}')
    printf 'vmess://%s\n' "$(b64e "$json")"
}

build_new_vless(){
    local domain=$1 ps=$2
    local q="encryption=none&security=tls&sni=${domain}&type=${P_NET}&host=${domain}"
    if [[ $P_NET == grpc ]]; then
        local svc=${P_PATH#/}
        q="${q}&serviceName=$(urlencode "$svc")&mode=gun"
    else
        q="${q}&path=$(urlencode "$P_PATH")"
    fi
    printf 'vless://%s@%s:443?%s#%s\n' "$P_ID" "$domain" "$q" "$(urlencode "$ps")"
}

build_new_trojan(){
    local domain=$1 ps=$2
    local q="security=tls&sni=${domain}&type=${P_NET}&host=${domain}"
    if [[ $P_NET == grpc ]]; then
        local svc=${P_PATH#/}
        q="${q}&serviceName=$(urlencode "$svc")&mode=gun"
    else
        q="${q}&path=$(urlencode "$P_PATH")"
    fi
    printf 'trojan://%s@%s:443?%s#%s\n' "$(urlencode "$P_ID")" "$domain" "$q" "$(urlencode "$ps")"
}

build_new_ss(){
    local domain=$1 ps=$2
    # SS 用 v2ray-plugin/ws+tls
    local userinfo
    userinfo=$(b64e "${P_SS_M}:${P_SS_P}")
    userinfo=${userinfo//=/}
    local plugin="v2ray-plugin;tls;mode=websocket;host=${domain};path=${P_PATH}"
    printf 'ss://%s@%s:443?plugin=%s#%s\n' \
        "$userinfo" "$domain" "$(urlencode "$plugin")" "$(urlencode "$ps")"
}
# ---------- 命令: add ----------
cmd_add(){
    ensure_pkg jq curl
    local link=${1:-}
    if [[ -z $link ]]; then
        read -rp "$(_cyan '请输入要反代的链接 (vmess/vless/trojan/ss): ')" link
    fi
    [[ -z $link ]] && err "未输入链接"

    parse_link "$link"
    validate_net

    [[ -z $P_ADD || -z $P_PORT || -z $P_ID ]] && err "链接缺少必要字段 (add/port/id)"

    echo
    _green "解析结果:"
    printf "  %-8s %s\n" "协议:"  "$P_PROTO"
    printf "  %-8s %s\n" "传输:"  "$P_NET"
    printf "  %-8s %s\n" "备注:"  "$P_PS"
    printf "  %-8s %s\n" "地址:"  "$P_ADD"
    printf "  %-8s %s\n" "端口:"  "$P_PORT"
    printf "  %-8s %s\n" "凭证:"  "$P_ID"
    printf "  %-8s %s\n" "路径:"  "$P_PATH"
    printf "  %-8s %s\n" "Host:"  "$P_HOST"
    echo

    local domain email
    read -rp "$(_cyan '请输入你的域名 (已解析到本机 IP): ')" domain
    [[ -z $domain ]] && err "域名不能为空"
    if [[ -f "$SITES_DIR/${domain}.caddy" ]]; then
        read -rp "$(_yellow "$domain 已存在配置, 是否覆盖? [y/N]: ")" yn
        [[ ${yn,,} != y ]] && { _yellow "已取消"; return; }
    fi
    read -rp "$(_cyan '邮箱(用于 Let'\''s Encrypt, 回车跳过): ')" email

    local site_file=$SITES_DIR/${domain}.caddy
    build_caddy_site "$domain" "$email" "$site_file"

    cat > "$META_DIR/${domain}.json" <<EOF
{
  "domain": "$domain",
  "proto": "$P_PROTO",
  "net": "$P_NET",
  "upstream": "${P_ADD}:${P_PORT}",
  "path": "$P_PATH",
  "ps": "$P_PS"
}
EOF

    ensure_main_caddyfile
    if ! caddy validate --config "$CADDY_MAIN" --adapter caddyfile >/dev/null 2>&1; then
        _red "Caddyfile 校验失败:"
        caddy validate --config "$CADDY_MAIN" --adapter caddyfile || true
        rm -f "$site_file" "$META_DIR/${domain}.json"
        err "已回滚"
    fi
    # 注意: Caddy 的启停由调用方管理 (Web 后端按需启动)
    # 如果在 Docker 容器外独立使用，请取消注释下面两行:
    # systemctl enable caddy >/dev/null 2>&1 || true
    # systemctl restart caddy

    local new_link
    new_link=$(build_new_link "$domain")

    echo
    _green "================ 完成 ================"
    _green "新的 ${P_PROTO} 链接 (443/TLS):"
    echo
    echo "$new_link"
    echo
    _gray "原始链接: $link"
    _gray "Caddy 站点: $site_file"
    _gray "重启:     systemctl restart caddy"
    _gray "看日志:   journalctl -u caddy -f"
    echo
    _yellow "首次访问需等 Caddy 申请证书 (5~30 秒)"
}

cmd_list(){
    shopt -s nullglob
    local files=("$META_DIR"/*.json)
    if (( ${#files[@]} == 0 )); then
        _yellow "暂无已配置的反代"
        return
    fi
    ensure_pkg jq
    printf "%-28s %-8s %-6s %-25s %s\n" "DOMAIN" "PROTO" "NET" "UPSTREAM" "PATH"
    printf "%-28s %-8s %-6s %-25s %s\n" "------" "-----" "---" "--------" "----"
    local f d pr n u p
    for f in "${files[@]}"; do
        d=$(jq -r .domain "$f")
        pr=$(jq -r .proto "$f")
        n=$(jq -r .net "$f")
        u=$(jq -r .upstream "$f")
        p=$(jq -r .path "$f")
        printf "%-28s %-8s %-6s %-25s %s\n" "$d" "$pr" "$n" "$u" "$p"
    done
}

cmd_del(){
    local domain=${1:-}
    [[ -z $domain ]] && err "用法: $0 del <域名>"
    local site_file=$SITES_DIR/${domain}.caddy
    local meta=$META_DIR/${domain}.json
    [[ ! -f $site_file && ! -f $meta ]] && err "未找到 $domain 的配置"
    rm -f "$site_file" "$meta"
    # 注意: Caddy 的 reload/stop 由调用方管理
    # systemctl reload caddy 2>/dev/null || systemctl restart caddy
    _green "已删除 $domain"
}

cmd_menu(){
    echo
    _cyan "================================="
    _cyan "  Proxy-CDN  (vmess/vless/trojan/ss → 443)"
    _cyan "================================="
    echo "  1) 添加反代"
    echo "  2) 列出反代"
    echo "  3) 删除反代"
    echo "  0) 退出"
    echo
    read -rp "请选择: " choice
    case $choice in
        1) cmd_add ;;
        2) cmd_list ;;
        3) read -rp "要删除的域名: " d; cmd_del "$d" ;;
        0) exit 0 ;;
        *) _red "无效选择" ;;
    esac
}

# ---------- 入口 ----------
ensure_caddy
ensure_main_caddyfile

case "${1:-menu}" in
    add) shift; cmd_add "${1:-}" ;;
    list|ls) cmd_list ;;
    del|rm|remove) shift; cmd_del "${1:-}" ;;
    menu|"") cmd_menu ;;
    -h|--help|help) sed -n '2,30p' "$0" ;;
    *) err "未知命令: $1 (使用 -h 查看帮助)" ;;
esac
