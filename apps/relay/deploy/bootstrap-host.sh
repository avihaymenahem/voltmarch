#!/usr/bin/env bash
set -Eeuo pipefail

# One-time, idempotent Ubuntu VPS bootstrap. Before running it, point the relay
# hostname directly at this VPS (Cloudflare DNS-only/grey cloud) so Let's
# Encrypt can perform its first HTTP challenge. Proxy it after this succeeds.

die() { printf '[relay-bootstrap] %s\n' "$*" >&2; exit 1; }
[[ ${EUID:-$(id -u)} -eq 0 ]] || die 'run as root'

: "${RELAY_HOSTNAME:?set RELAY_HOSTNAME, for example relay.voltmarch.com}"
: "${GAME_ORIGINS:?set GAME_ORIGINS, for example https://play.voltmarch.com}"
: "${LETSENCRYPT_EMAIL:?set LETSENCRYPT_EMAIL}"
: "${DEPLOY_PUBLIC_KEY:?set DEPLOY_PUBLIC_KEY to the dedicated ssh-ed25519 public key}"

[[ $RELAY_HOSTNAME =~ ^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$ ]] || die 'invalid relay hostname'
[[ $LETSENCRYPT_EMAIL == *@*.* ]] || die "invalid Let's Encrypt email"
[[ $DEPLOY_PUBLIC_KEY == ssh-ed25519\ * ]] || die 'deployment key must be ssh-ed25519'
IFS=',' read -ra origins <<< "$GAME_ORIGINS"
origin_pattern='^https://[A-Za-z0-9.-]+(:[0-9]+)?$'
for origin in "${origins[@]}"; do
  [[ $origin =~ $origin_pattern ]] || die "invalid HTTPS game origin: $origin"
done

readonly SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ -f $SCRIPT_DIR/deploy-release.sh && -f $SCRIPT_DIR/nginx.conf ]] \
  || die 'run from the checked-out apps/relay/deploy directory'

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl git nginx ufw certbot python3-certbot-nginx

node_ok=0
if command -v node >/dev/null 2>&1; then
  node_major=$(node -p 'Number(process.versions.node.split(".")[0])')
  node_minor=$(node -p 'Number(process.versions.node.split(".")[1])')
  if (( node_major > 20 || (node_major == 20 && node_minor >= 19) )); then
    node_ok=1
  fi
fi
if (( node_ok == 0 )); then
  curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
  bash /tmp/nodesource_setup.sh
  rm -f /tmp/nodesource_setup.sh
  apt-get install -y nodejs
fi
node -e 'const [ma,mi]=process.versions.node.split(".").map(Number); if(ma<20||(ma===20&&mi<19)) process.exit(1)' \
  || die 'Node.js 20.19 or newer is required'
node_binary=$(command -v node)
[[ $node_binary == /* && -x $node_binary ]] || die 'could not resolve an executable Node.js path'

id -u voltmarch >/dev/null 2>&1 \
  || useradd --system --no-create-home --home-dir /opt/voltmarch-relay --shell /usr/sbin/nologin voltmarch
id -u voltmarch-deploy >/dev/null 2>&1 \
  || useradd --create-home --shell /bin/bash voltmarch-deploy

install -d -o voltmarch -g voltmarch -m 0750 /opt/voltmarch-relay /opt/voltmarch-relay/releases
install -d -o voltmarch -g voltmarch -m 0750 /var/cache/voltmarch-npm
install -d -o voltmarch-deploy -g voltmarch-deploy -m 0700 /home/voltmarch-deploy/.ssh
printf '%s\n' "no-agent-forwarding,no-port-forwarding,no-X11-forwarding,no-user-rc $DEPLOY_PUBLIC_KEY" \
  > /home/voltmarch-deploy/.ssh/authorized_keys
chown voltmarch-deploy:voltmarch-deploy /home/voltmarch-deploy/.ssh/authorized_keys
chmod 0600 /home/voltmarch-deploy/.ssh/authorized_keys

install -o root -g root -m 0755 "$SCRIPT_DIR/deploy-release.sh" /usr/local/sbin/voltmarch-relay-deploy
printf '%s\n' 'voltmarch-deploy ALL=(root) NOPASSWD: /usr/local/sbin/voltmarch-relay-deploy' \
  > /etc/sudoers.d/voltmarch-deploy
chmod 0440 /etc/sudoers.d/voltmarch-deploy
visudo -cf /etc/sudoers.d/voltmarch-deploy >/dev/null

required_build=''
if [[ -f /etc/voltmarch-relay.env && ! -L /etc/voltmarch-relay.env ]]; then
  required_build=$(sed -n 's/^VM_REQUIRE_BUILD=//p' /etc/voltmarch-relay.env | head -n1)
fi
cat > /etc/voltmarch-relay.env <<EOF
NODE_ENV=production
VM_HOST=127.0.0.1
VM_PORT=8787
VM_TRUSTED_PROXIES=127.0.0.1,::1,::ffff:127.0.0.1
VM_ORIGINS=$GAME_ORIGINS
VM_REQUIRE_BUILD=$required_build
EOF
chown root:voltmarch /etc/voltmarch-relay.env
chmod 0640 /etc/voltmarch-relay.env
sed "s|__NODE_BINARY__|$node_binary|g" "$SCRIPT_DIR/voltmarch-relay.service" \
  > /etc/systemd/system/voltmarch-relay.service
chown root:root /etc/systemd/system/voltmarch-relay.service
chmod 0644 /etc/systemd/system/voltmarch-relay.service
systemctl daemon-reload

# Give Certbot a valid port-80 virtual host for the first certificate request.
cat > /etc/nginx/sites-available/voltmarch-relay <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $RELAY_HOSTNAME;
    location / { return 404; }
}
EOF
ln -sfn /etc/nginx/sites-available/voltmarch-relay /etc/nginx/sites-enabled/voltmarch-relay
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

certbot certonly --nginx --non-interactive --agree-tos --no-eff-email \
  --email "$LETSENCRYPT_EMAIL" -d "$RELAY_HOSTNAME"

# Trust Cloudflare's visitor header only when the TCP peer is a published
# Cloudflare edge. This preserves the relay's per-player connection limits.
realip_tmp=$(mktemp)
printf 'real_ip_header CF-Connecting-IP;\nreal_ip_recursive on;\n' > "$realip_tmp"
for family in ips-v4 ips-v6; do
  while IFS= read -r cidr; do
    [[ $cidr =~ ^[0-9A-Fa-f:.]+/[0-9]{1,3}$ ]] || die "Cloudflare returned an invalid CIDR: $cidr"
    printf 'set_real_ip_from %s;\n' "$cidr" >> "$realip_tmp"
  done < <(curl -fsSL "https://www.cloudflare.com/$family")
done
install -o root -g root -m 0644 "$realip_tmp" /etc/nginx/conf.d/cloudflare-realip.conf
rm -f "$realip_tmp"

sed "s|relay.example.com|$RELAY_HOSTNAME|g" \
  "$SCRIPT_DIR/nginx.conf" > /etc/nginx/sites-available/voltmarch-relay

nginx -t
systemctl reload nginx

ufw allow 22/tcp
ufw allow 'Nginx Full'
ufw --force enable

printf '\n[relay-bootstrap] host is ready for its first release\n'
printf '[relay-bootstrap] now switch %s to Proxied and set Cloudflare TLS to Full (strict)\n' "$RELAY_HOSTNAME"
