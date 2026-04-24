# i18n Preview Setup — `https://i18n.iusd-pay.xyz`

One-time setup for the self-hosted i18n preview deployment. Runs **side
by side** with prod: separate PM2 process (`ipay-app-i18n` :3204),
separate dist directory (`/home/jack_initia_xyz/ipay-deploy/frontend-i18n`),
separate Cloudflare Tunnel public hostname. Prod (`ipay-app` :3201) is
not touched.

## 1. Cloudflare Tunnel — add public hostname

Cloudflare Zero Trust → Networks → Tunnels → pick the existing tunnel
(running as `cloudflared.service` on the box) → **Public Hostname** tab
→ **Add a public hostname**:

| Field | Value |
| --- | --- |
| Subdomain | `i18n` |
| Domain | `iusd-pay.xyz` |
| Type | `HTTP` |
| URL | `localhost:3204` |
| Additional → HTTP Host Header | `localhost` (default OK) |

Save. Cloudflare auto-provisions the DNS record (CNAME proxied).

## 2. (One-time) Re-deploy the API with new CORS allowlist

`packages/api/src/index.ts` adds `https://i18n.iusd-pay.xyz` to the
allowlist. Without this the preview will fail every API call with CORS.

```bash
# Trigger Deploy Backend workflow on main, OR manually:
cd /home/jack_initia_xyz/ipay-deploy/repo
git pull
cd packages/api && pnpm build && cp -r dist /home/jack_initia_xyz/ipay-deploy/api/
pm2 restart ipay-api
```

## 3. First deploy — let the workflow do it

Push to `feat/i18n` (or trigger `Deploy Frontend (i18n preview)` via
workflow_dispatch) and the `deploy-frontend-i18n.yml` workflow will:

1. Build the frontend with prod env vars
2. rsync to `/home/jack_initia_xyz/ipay-deploy/frontend-i18n/`
3. `pm2 start npx serve -s . -l 3204 --name ipay-app-i18n` (only the first
   time — subsequent runs `pm2 restart`)
4. `pm2 save` so the process persists across reboot
5. Health-check `http://127.0.0.1:3204`

After step 3, `pm2 list` should show `ipay-app-i18n` alongside `ipay-app`.

## 4. Verify

- `curl -I https://i18n.iusd-pay.xyz` → `200 OK` (Cloudflare cert)
- Open in a browser, confirm LangSwitcher in the top-right shows the
  18 locale list and changing it persists across reload.
- Set Chrome's preferred language to `العربية`, refresh the landing
  page → page should flip RTL automatically.

## Rollback

If anything goes wrong, removing it leaves prod untouched:

```bash
pm2 delete ipay-app-i18n   # stop preview server
pm2 save
# (optional) rm -rf /home/jack_initia_xyz/ipay-deploy/frontend-i18n
# (optional) Cloudflare Tunnel → delete the i18n public hostname
```

## Ports / paths reference

| Resource | Prod | i18n preview |
| --- | --- | --- |
| PM2 process | `ipay-app` | `ipay-app-i18n` |
| Port | `3201` | `3204` |
| Dist dir | `…/ipay-deploy/frontend` | `…/ipay-deploy/frontend-i18n` |
| Hostname | `iusd-pay.xyz` | `i18n.iusd-pay.xyz` |
| Branch | `main` | `feat/i18n` |
| Workflow | `deploy-frontend.yml` | `deploy-frontend-i18n.yml` |
