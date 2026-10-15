#!/usr/bin/env bash
# First setup of a fresh Hetzner Cloud server (Ubuntu 24.04), run once as root
# from a machine holding the server's SSH key:
#
#   ssh root@<ip> 'bash -s' < deploy/setup-vps.sh
#
# It installs what the two services need (Node.js 24, git, sqlite3 for the
# backups, Caddy for HTTPS), creates their user (oddsradar, who logs in with
# root's keys and may restart its own services only, for deploy/deploy.sh) and
# their folder (/opt/oddsradar), and closes the server: SSH by key only, a
# firewall letting in SSH, HTTP and HTTPS, security updates applied on their
# own. Running it again changes nothing that is already in place.
#
# The application itself comes after (README, "Déploiement"): clone the
# repository into /opt/oddsradar as oddsradar, build, install the units.
set -euo pipefail

APP_USER=oddsradar
APP_DIR=/opt/oddsradar
NODE_MAJOR=24
SERVICES="oddsradar-worker oddsradar-web"

log() { echo "[setup] $*"; }
[[ $EUID -eq 0 ]] || {
  echo "[setup] run as root" >&2
  exit 1
}
[[ -s /root/.ssh/authorized_keys ]] || {
  echo "[setup] /root/.ssh/authorized_keys is empty: add the SSH key when creating the server" >&2
  exit 1
}
export DEBIAN_FRONTEND=noninteractive

log "system packages"
apt-get update -q
apt-get upgrade -y -q
apt-get install -y -q curl ca-certificates gnupg git sqlite3 ufw unattended-upgrades \
  debian-keyring debian-archive-keyring apt-transport-https

if ! node --version 2>/dev/null | grep -q "^v${NODE_MAJOR}\."; then
  log "Node.js ${NODE_MAJOR}"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -q nodejs
fi

if ! command -v caddy >/dev/null; then
  log "Caddy"
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key |
    gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt >/etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -y -q caddy
fi

log "user ${APP_USER} and ${APP_DIR}"
id "$APP_USER" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$APP_USER"
install -d -m 700 -o "$APP_USER" -g "$APP_USER" "/home/$APP_USER/.ssh"
if [[ ! -s "/home/$APP_USER/.ssh/authorized_keys" ]]; then
  install -m 600 -o "$APP_USER" -g "$APP_USER" /root/.ssh/authorized_keys "/home/$APP_USER/.ssh/authorized_keys"
fi
install -d -m 755 -o "$APP_USER" -g "$APP_USER" "$APP_DIR"

# deploy/deploy.sh restarts the services with `sudo -n`: that and nothing else.
# Checked by visudo before going in place, so a typo can't break sudo.
sudoers=$(mktemp)
echo "$APP_USER ALL=(root) NOPASSWD: /usr/bin/systemctl restart $SERVICES" >"$sudoers"
visudo -cf "$sudoers" >/dev/null
install -m 440 -o root -g root "$sudoers" /etc/sudoers.d/oddsradar-deploy
rm -f "$sudoers"

log "SSH: keys only"
cat >/etc/ssh/sshd_config.d/10-oddsradar.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
sshd -t
systemctl reload ssh

log "firewall: SSH, HTTP, HTTPS"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

log "automatic security updates"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

timedatectl set-timezone Europe/Berlin

log "done: node $(node --version), $(caddy version | cut -d' ' -f1), $(git --version)"
log "public IPv4: $(curl -4 -fsS https://api.ipify.org || echo unknown)"
