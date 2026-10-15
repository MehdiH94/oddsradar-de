#!/usr/bin/env bash
# A way out of Germany for the exchange's requests alone (src/reference/
# exchangeProxy.ts): the exchange refuses German IPs. A WireGuard tunnel to a
# VPN server abroad (a Surfshark configuration) lives in a network namespace of
# its own, "exchange", where an HTTP proxy (tinyproxy) is the only program; the
# proxy lets through the exchange's domain and nothing else. The worker reaches
# it over a veth pair: EXCHANGE_PROXY=http://10.200.0.2:8888. Everything else
# on the server, the bookmakers' requests among them, goes out as before.
#
# Run as root, once, with the WireGuard configuration the VPN gave (wg-quick
# format, with Address, DNS and the peer):
#   sudo bash deploy/exchange-vpn.sh install /home/ubuntu/surfshark.conf
# Then: sudo systemctl status oddsradar-exchange-vpn oddsradar-exchange-proxy
#
# The configuration holds a private key: it is moved to /etc/oddsradar/
# (root only) and never printed.
set -euo pipefail

NS=exchange
CONF_DIR=/etc/oddsradar
WG_CONF=$CONF_DIR/exchange-wg.conf
HOST_IP=10.200.0.1
NS_IP=10.200.0.2
PROXY_PORT=8888
# The only host the proxy reaches (the exchange of src/reference/exchange.ts).
ALLOWED_HOST='^exch\.piwi247\.com$'

log() { echo "[exchange-vpn] $*"; }
die() {
  echo "[exchange-vpn] ERROR: $*" >&2
  exit 1
}
[[ $EUID -eq 0 ]] || die "run as root"

# wg-quick's fields the kernel's interface doesn't take, from the configuration.
field() { sed -nE "s/^\s*$1\s*=\s*(.+)\s*$/\1/p" "$WG_CONF" | head -1; }

up() {
  ip netns list | grep -qw "$NS" && down
  ip netns add "$NS"
  ip -n "$NS" link set lo up
  # The tunnel's interface is made and set up here (the peer's name resolves
  # here, not in the empty namespace), then moved into the namespace: its
  # encrypted packets leave by the server's own route, its clear ones stay inside.
  ip link add wg-exchange type wireguard
  wg setconf wg-exchange <(wg-quick strip "$WG_CONF")
  ip link set wg-exchange netns "$NS"
  local address
  address=$(field Address | cut -d, -f1)
  [[ -n "$address" ]] || die "no Address in $WG_CONF"
  ip -n "$NS" addr add "$address" dev wg-exchange
  ip -n "$NS" link set wg-exchange up
  ip -n "$NS" route add default dev wg-exchange
  # The worker's way in.
  ip link add veth-exchange type veth peer name veth-ns
  ip link set veth-ns netns "$NS"
  ip addr add "$HOST_IP/30" dev veth-exchange
  ip link set veth-exchange up
  ip -n "$NS" addr add "$NS_IP/30" dev veth-ns
  ip -n "$NS" link set veth-ns up
  # The namespace's own resolver: the VPN's DNS, so that no name is asked in clear.
  mkdir -p "/etc/netns/$NS"
  echo "nameserver $(field DNS | cut -d, -f1 | tr -d ' ')" >"/etc/netns/$NS/resolv.conf"
  log "up: tunnel in namespace $NS, proxy at http://$NS_IP:$PROXY_PORT"
}

down() {
  ip link del veth-exchange 2>/dev/null || true
  ip netns del "$NS" 2>/dev/null || true
}

install_all() {
  local source=${1:-}
  [[ -f "$source" ]] || die "usage: exchange-vpn.sh install <wireguard.conf>"
  grep -q '^\s*\[Peer\]' "$source" || die "$source is not a WireGuard configuration"
  export DEBIAN_FRONTEND=noninteractive
  apt-get install -y -q wireguard-tools tinyproxy >/dev/null
  # Only the namespace's copy runs, under its own unit.
  systemctl disable --now tinyproxy >/dev/null 2>&1 || true

  install -d -m 700 "$CONF_DIR"
  install -m 600 -o root -g root "$source" "$WG_CONF"
  shred -u "$source" 2>/dev/null || rm -f "$source"

  echo "$ALLOWED_HOST" >"$CONF_DIR/exchange-proxy.filter"
  cat >"$CONF_DIR/exchange-proxy.conf" <<EOF
User tinyproxy
Group tinyproxy
Port $PROXY_PORT
Listen $NS_IP
Allow $HOST_IP
Timeout 60
MaxClients 20
ConnectPort 443
Filter "$CONF_DIR/exchange-proxy.filter"
FilterDefaultDeny Yes
FilterExtended Yes
FilterURLs No
LogLevel Warning
EOF
  chmod 644 "$CONF_DIR/exchange-proxy.conf" "$CONF_DIR/exchange-proxy.filter"
  chmod 755 "$CONF_DIR"
  chmod 600 "$WG_CONF"

  local self
  self=$(readlink -f "$0")
  install -m 755 "$self" /usr/local/sbin/oddsradar-exchange-vpn
  cat >/etc/systemd/system/oddsradar-exchange-vpn.service <<EOF
[Unit]
Description=OddsRadar: the exchange's way out of Germany (WireGuard in namespace $NS)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/local/sbin/oddsradar-exchange-vpn up
ExecStop=/usr/local/sbin/oddsradar-exchange-vpn down

[Install]
WantedBy=multi-user.target
EOF
  cat >/etc/systemd/system/oddsradar-exchange-proxy.service <<EOF
[Unit]
Description=OddsRadar: the exchange's proxy, inside namespace $NS
BindsTo=oddsradar-exchange-vpn.service
After=oddsradar-exchange-vpn.service

[Service]
ExecStart=/usr/bin/ip netns exec $NS /usr/bin/tinyproxy -d -c $CONF_DIR/exchange-proxy.conf
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now oddsradar-exchange-vpn oddsradar-exchange-proxy
  sleep 2
  check
}

check() {
  log "exit IP seen through the tunnel: $(ip netns exec "$NS" curl -4 -s --max-time 15 https://api.ipify.org || echo none)"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -x "http://$NS_IP:$PROXY_PORT" \
    -H 'Accept: application/json' 'https://exch.piwi247.com/customer/api/event/search?query=bayern' || true)
  log "exchange search through the proxy: HTTP $code"
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 -x "http://$NS_IP:$PROXY_PORT" https://www.betway.de/ || true)
  log "another host through the proxy (must be refused): HTTP $code"
}

case "${1:-}" in
  install) install_all "${2:-}" ;;
  up) up ;;
  down) down ;;
  check) check ;;
  *) die "usage: exchange-vpn.sh install <wireguard.conf> | up | down | check" ;;
esac
