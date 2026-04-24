# Cloudflare Worker: OG Preview for Bots

Intercepts `/pay/*`, `/claim/*`, `/g/*`, and `/app/send` requests. Bot crawlers
(Telegram / Twitter / Slack / WhatsApp / etc.) get OG HTML from the API; humans
pass through to the SPA.

## How it works

1. Request hits `iusd-pay.xyz/<route>`
2. Worker checks `User-Agent` against known bot patterns
3. **Bot** → fetches `https://api.iusd-pay.xyz/v1/og/<type>/<id>` and returns OG HTML
4. **Human** → `fetch(request)` passes through to the SPA origin

## Routes handled

| Pattern | OG source |
|---|---|
| `/pay/:id` | `/v1/og/pay/:id` |
| `/claim/:id` | `/v1/og/pay/:id` (legacy) |
| `/g/:code` | `/v1/og/gift/:code/meta` (accepts base64url group code) |
| `/app/send` | static payment-request OG |

## Deploy (automated)

```bash
# One-time: save token to file with strict perms
echo -n "<cloudflare-api-token>" > ~/.cloudflare_token
chmod 600 ~/.cloudflare_token

# Deploy
./deploy-local.sh cf
```

Or via env var:

```bash
CLOUDFLARE_API_TOKEN=<token> ./deploy-local.sh cf
```

## Token permissions

Create at Cloudflare Dashboard → My Profile → API Tokens → Create Token →
"Edit Cloudflare Workers" template. Needs:

- **Account** → Workers Scripts:Edit
- **Zone** → Workers Routes:Edit (for `iusd-pay.xyz`)

## Test

```bash
# Bot UA — should return OG meta tags
curl -A "TelegramBot" https://iusd-pay.xyz/g/<code> | grep og:

# Normal browser — should return SPA
curl https://iusd-pay.xyz/g/<code> | head
```

## Bot patterns detected

slackbot, facebookexternalhit, facebot, twitterbot, whatsapp, telegrambot,
linkedinbot, discordbot, applebot, googlebot, bingbot, pinterest, iMessagePreview.
