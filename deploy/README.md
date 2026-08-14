# Reverse proxy setup

`docker-compose.yml` deliberately only exposes LibreChat on
`127.0.0.1:3080` — nothing internal to the stack is reachable from the
internet. You need a reverse proxy on the VM to get real HTTPS traffic to
it. **Which path applies depends on what's already running on your VM.**

Check first:
```bash
apache2ctl -M | grep -E 'proxy|rewrite'   # which modules are already on
sudo systemctl status apache2
sudo ss -tlnp | grep -E ':80|:443'        # confirm Apache is actually what's bound there
```

---

## Path A — nginx (or Apache) is already serving your other websites

Don't run a second web server on 80/443 — add a new site to the one you
already have.

**nginx:**
```bash
sudo cp deploy/nginx-aischolarhub.conf /etc/nginx/sites-available/aischolarhub
# Edit that file first: replace aischolarhub.yourcollege.edu with your real subdomain
sudo ln -s /etc/nginx/sites-available/aischolarhub /etc/nginx/sites-enabled/
sudo nginx -t          # check for syntax errors before reloading
sudo systemctl reload nginx
```

Then get a certificate for just this subdomain (won't touch your existing
sites' certs):
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d aischolarhub.yourcollege.edu
```
Certbot edits the site file in place to add the TLS block and sets up
auto-renewal via a systemd timer — no cron job needed.

**Apache** (this is the actual path if your VM runs Apache+PHP for its
other sites — common, and worth checking first since PHP hosting doesn't
require the proxy modules by default, so they're often just sitting
disabled):

```bash
# Check what's already enabled
apache2ctl -M | grep -E 'proxy|rewrite'

# Enable what's missing — proxy_wstunnel specifically matters here, since
# LibreChat streams chat responses over websockets and plain proxy_http
# alone won't carry the upgrade correctly (responses hang or arrive all
# at once instead of streaming)
sudo a2enmod proxy proxy_http proxy_wstunnel rewrite headers
sudo systemctl restart apache2

sudo cp deploy/apache-aischolarhub.conf /etc/apache2/sites-available/aischolarhub.conf
# Edit that file first: replace aischolarhub.yourcollege.edu with your real subdomain
sudo a2ensite aischolarhub
sudo systemctl reload apache2

sudo apt install -y certbot python3-certbot-apache
sudo certbot --apache -d aischolarhub.yourcollege.edu
```
Same as nginx — certbot edits the vhost in place to add TLS and sets up
its own renewal timer, and this doesn't touch your existing sites' certs
or vhosts.

---

## Path B — nothing is currently serving 80/443 on this VM

Caddy is the simplest option here — automatic HTTPS with zero certbot
babysitting, one config file.

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy

sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
# Edit that file first: replace aischolarhub.yourcollege.edu with your real subdomain
sudo systemctl reload caddy
```

Caddy handles the Let's Encrypt certificate automatically on first request
to the domain — no separate certbot step.

If you later add more websites to this same VM, add more blocks to the
same `/etc/caddy/Caddyfile` rather than running a second proxy.

---

## Either way: DNS first

Both paths assume `aischolarhub.yourcollege.edu` (or whatever subdomain you
pick) already points at this VM's public IP — an A record, set up wherever
your institution manages DNS, ideally a few minutes before you run certbot
so propagation has time to land (Caddy retries on its own if it's not
ready yet; certbot will just fail and needs re-running).

## After the reverse proxy is up

Update `.env`'s `DOMAIN_CLIENT` / `DOMAIN_SERVER` to
`https://aischolarhub.seedsnet.org` (not `http://localhost:3080`), then:
```bash
docker compose restart api
```
And don't forget the Google OAuth redirect URI needs this same real domain
added in Google Cloud Console — see the earlier conversation on that.
