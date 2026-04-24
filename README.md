## Initia Hackathon Submission

| | |
|---|---|
| **Project name** | iUSD Pay |
| **Track** | DeFi |
| **Mainnet chain** | `interwoven-1` |
| **Live** | **https://iusd-pay.xyz** |
| **Submission manifest** | [`.initia/submission.json`](.initia/submission.json) |

---

### TL;DR

iUSD Pay is a privacy-preserving consumer payments app on Initia. It gives
stablecoin users a Venmo-grade phone-browser experience — **send**, **request
via QR / invoice**, and **share on-chain gift packets** — with cryptographic
privacy on amount, sender, recipient, and memo. The full stack is deployed
and live on mainnet. Click the thumbnail below for a 2-minute walkthrough.

> 🚀 **Production live on mainnet → https://iusd-pay.xyz**

### 🎥 Demo Video

[![iUSD Pay — full walkthrough](resource/nice_app.jpg)](https://www.youtube.com/watch?v=jcYN0fOw0NA)

▶ Click the thumbnail, or open directly: <https://www.youtube.com/watch?v=jcYN0fOw0NA>

---

## Hackathon requirement checklist

| Requirement | Status | Evidence |
|---|---|---|
| Deployed on Initia appchain / rollup | ✅ | Production live on `interwoven-1` mainnet; dedicated Move rollup `iusd-pay-rollup-1` also launched on `initiation-2` testnet for submission compliance (see note below) |
| Uses `@initia/interwovenkit-react` for wallet / signing | ✅ | Every send / claim / refund / bridge call goes through `requestTxBlock` |
| Implements at least one Initia-native feature | ✅ | **Interwoven Bridge** — deposit / withdraw / same-chain DEX swap |
| `.initia/submission.json` present | ✅ | [`.initia/submission.json`](.initia/submission.json) |
| README with overview + implementation detail + how-to-run | ✅ | Below, organized to the 5 scoring criteria |
| Demo video (1–3 min YouTube / Loom) | ✅ | [YouTube walkthrough](https://www.youtube.com/watch?v=jcYN0fOw0NA) |

#### Note on rollup deployment vs. live demo

The public demo at <https://iusd-pay.xyz> and the YouTube walkthrough run
against **Initia L1 mainnet (`interwoven-1`)** — that's where real users and
real iUSD live, and where the UX shines. We did not rewire the app to point
at our own rollup because the production deployment, relayer, indexer, and
brand partners all sit on mainnet.

To satisfy the "own Initia appchain / rollup" submission requirement, we
launched a dedicated Move rollup via `weave` and re-deployed the same
contracts onto it. Both sides of the submission are therefore complete:

| | Production demo | Hackathon rollup |
|---|---|---|
| Chain ID | `interwoven-1` (L1 mainnet) | `iusd-pay-rollup-1` (Move L2 on `initiation-2`) |
| Deployed address | `0x6f12953441a068ea4cfded5cca2b90d2f25a9273` | `0x7c5d5b1dd602fe033ba17bfbbe741e328adfef72` |
| Modules | `common` + `pay_v3` + `gift_v3` | `common` + `pay_v3` + `gift_v3` (same source) |
| Public L1 evidence | — | Bridge ID **1863**, [creation tx](https://scan.testnet.initia.xyz/initiation-2/txs/6EA3FF3C01C9596D255C306A6816E037B04F5470DAC4C5033F7466883B815FCC), [batch submitter account](https://scan.testnet.initia.xyz/initiation-2/accounts/init19esesu3nqgrks9ke7k4dy2kxtmk8697af9g0y0/txs) (ongoing submissions) |

Reviewers verifying submission compliance should point at
`.initia/submission.json` and the L1 links above; reviewers watching the
product work as a real payments app should point at
<https://iusd-pay.xyz>.

### Beyond the minimum — what over-delivers

- **Compliance + privacy in the same envelope** — not either/or
- **Gift-packet primitive** on top of payments (not a feature most payments apps ship at v1)
- **Brand-partnership revenue model** already wired in (Fly Coffee 50% discount for gift-card holders) — proves it's a product, not a demo
- **24 on-chain gift boxes** registered and live, with admin catalog, image hosting, featured ordering
- **Merchant invoice mode** with invoice number, due date, PDF export, and refund button — a full business workflow, not a dev toy
- **Cloudflare Worker** rewriting OG meta for Telegram / Twitter / WhatsApp share previews
- **Custom InterwovenKit network-footprint patch** that strips 5 of 7 background hooks for faster mobile cold loads
- **PWA-installable** — deployable to iOS / Android home screens without app-store friction
- **Five-tier production CI/CD** — db / api / worker / frontend / admin, each independently deployed
- **First-class internationalization** — 19 locales shipped (EN + ZH-CN/TW, JA, KO, TH, ES, IT, FR, DE, PT, HI, AR, TR, EL, RU, MS, ID, FIL), ~976 translation keys per locale, browser auto-detect + manual switcher in Settings, RTL layout for Arabic, server-side `Accept-Language` error translation, CI consistency check to prevent drift

---

## 1. Originality & Track Fit

**The problem.** Crypto payments today are either (a) fully public — every
amount, counterparty, and memo visible on the explorer, which is a dealbreaker
for day-to-day consumer use — or (b) locked inside custodial apps that defeat
the point of being on-chain in the first place. Venmo has 80M+ users because
it just *works*. No on-chain equivalent has shipped a UX that matches.

**Our point of view.** The gap isn't "add complex cryptography for the sake of it". It's a
**product gap**: the primitives (on-chain payments, stablecoins, bridges,
privacy) already exist. What's missing is a consumer app that treats privacy,
cross-chain delivery, and gas sponsorship as invisible plumbing, and puts
social primitives (**gifts**, **red envelopes**, **thank-you notes**) on top
so the UX actually feels good.

**What's distinct about iUSD Pay:**

- **Dual-recipient ECIES envelopes.** Every on-chain payment carries an
  AES-256-GCM ciphertext wrapped for *two* viewers — the recipient's viewing
  key **and** an admin audit key. Compliance-ready privacy, not yolo privacy.
- **Gift packets as a new social channel.** Not just "transfer + memo" but
  an on-chain object that unlocks a whole category of social interaction
  that wallets simply don't support: wrap + unwrap animations, mystery-box
  share previews, group red-envelopes (equal or random), thank-you letters,
  public reactions, encrypted sponsor-to-claimer chat — all layered on the
  same stablecoin payment rail. **iUSD Pay turns stablecoin payments into a
  social network, not a spreadsheet.** (See §3 for the deep dive.)
- **Venmo-speed from a phone browser.** No app install, QR-first, three-step
  send flow, PWA-installable. Every flow is built to be one tap from a phone.
- **Single-signature flows.** Deposit via Interwoven Bridge, claim, refund,
  gift wrap, gift open, reply — all one signature through InterwovenKit.

**Track.** DeFi (payments + stablecoins).

---

## 2. Technical Execution & Initia Integration

### 2.1 Custom Move contracts

Two original modules published to
`0x6f12953441a068ea4cfded5cca2b90d2f25a9273` on `interwoven-1`:

| Module | Responsibility |
|---|---|
| [`pay_v3.move`](packages/contracts/move/sources/pay_v3.move) | Deposit / claim / revoke / refund. Per-payment ECIES envelopes. `sha256(plain)` payment-id hiding. Frozen registry for compliance. |
| [`gift_v3.move`](packages/contracts/move/sources/gift_v3.move) | Gift packets — direct or group red-envelope with Equal / Random split modes. Admin-curated box catalog. Sponsor allowlist. |
| [`common.move`](packages/contracts/move/sources/common.move) | Shared error codes + constants. |

**Live on-chain object addresses** (verify on explorer):

| Env var | Value |
|---|---|
| `MODULE_ADDRESS`     | `0x6f12953441a068ea4cfded5cca2b90d2f25a9273` |
| `IPAY_POOL_ADDRESS`  | `0x8db784f6c0e70ca1925338361efa0b784e81c42fd0943852bfcb13e2caa41d62` |
| `GIFT_POOL_ADDRESS`  | `0x2531b15e90f10a51c965cd749c7e30952cdc9163da4dd962127e40a0e7f67ca9` |
| `IUSD_FA`            | `0x6c69733a9e722f3660afb524f89fce957801fa7e4408b8ef8fe89db9627b570e` (real mainnet iUSD) |

### 2.2 Privacy layer

Every on-chain payment stores an AES-256-GCM ciphertext whose symmetric key
is wrapped via ECIES (secp256k1) **twice** — once for the recipient's viewing
key, once for an admin audit key. The ciphertext covers sender, recipient,
amount, memo, and the claim key. The outside world sees only opaque bytes;
the payee and the admin can decrypt. Reference:
[`packages/api/src/services/security/encryption.ts`](packages/api/src/services/security/encryption.ts).

The admin viewing key is baked into every payload at build time
(`VITE_ADMIN_VIEWING_PK`) so compliance audit is always possible without
trusting the frontend to cooperate at write-time.

**This is not a theoretical claim** — the admin console in
[`packages/admin/`](packages/admin/) uses exactly this path to resolve the
plaintext sender, recipient, amount, and memo for any payment. Scene 4 of
the demo video shows it live: an auditor searches a payment ID and sees the
decrypted sender / recipient bech32 addresses + nicknames + amount, even
though those fields never appear in the transaction payload on chain.

### 2.3 The Initia-native feature: **Interwoven Bridge**

iUSD is a cross-rollup asset, so Interwoven Bridge is the data plane for
every cross-chain money movement in iUSD Pay:

- **Deposit** — frontend queries `router-api.initia.xyz` (the same router
  that backs InterwovenKit's bridge widget), builds IBC `MsgTransfer`
  routes via `fetchBridgeMsgs` / `decodeCosmosAminoMessages`, and hands them
  to InterwovenKit for signing. Full path:
  [`packages/app/src/services/deposit.ts`](packages/app/src/services/deposit.ts).
- **Withdraw** — same router, reverse direction. The modal shows every
  candidate destination chain (not just ones where the user already holds
  balance) and validates locally against the source chain's balance before
  submitting.
- **One-click fallback** — `useInterwovenKit().openBridge()` gives users the
  official IK bridge modal as a one-click alternative.
- **DEX swap on-chain** — iUSD ↔ INIT and other rollup assets via the same
  router's `/v2/fungible/msgs` endpoint, with Move `MsgExecute` args properly
  decoded from base64 to bytes for InterwovenKit's protobuf encoder.

This makes iUSD Pay reachable from **any** Interwoven rollup without the
user hand-crafting IBC transfers.

### 2.4 InterwovenKit network-footprint optimization

Out of the box, `@initia/interwovenkit-react@2.5.1` issues a fan-out of
background requests on every page load:
`usePrefetchBridgeData` → `router-api.initia.xyz/v2/info/chains` +
`/v2/fungible/assets`, `useInitiaRegistry` → `registry.initia.xyz/profiles.json`
+ `chains.json`, plus `usePortfolioSSE`, `useL1PositionsTotal`,
`useAllChainsAssetsQueries`. For a payments app that never needs the full
Interwoven topology at boot, that's dead weight on every cold load and
wallet reconnect.

We ship a post-install patch
([`scripts/patch-ik.sh`](scripts/patch-ik.sh)) that surgically rewrites the
IK runtime to keep only the two hooks we actually need —
`useClearWalletsOnAddressChange` and `useInitializeAutoSign` — and strips
the other five. Result: **zero background fetches on cold load**, faster
first-meaningful-paint on mobile, and lower egress at the Cloudflare edge
in front of the SPA.

### 2.5 Internationalization (i18n) — 19 locales, end-to-end

iUSD Pay ships fully localized for **19 languages** out of the box, covering
the top consumer-finance markets across the Americas, Europe, Middle East,
and Asia-Pacific. This is not a "we translated the home page" gesture —
every page, modal, toast, gift box name/description, error, and
server-returned message is translated, and drift is prevented in CI.

| Area | Coverage |
|---|---|
| Locales shipped | `en`, `zh-CN`, `zh-TW`, `ja`, `ko`, `th`, `es`, `it`, `fr`, `de`, `pt`, `hi`, `ar`, `tr`, `el`, `ru`, `ms`, `id`, `fil` (19 total) |
| Translation keys | **~976 per locale**, fully parallel across all 19 files |
| Detection | `i18next-browser-languagedetector` auto-detects browser language, falls back to `en`, persisted in `localStorage` |
| Manual switch | **LangSwitcher** in Settings — live switch without reload |
| RTL | First-class right-to-left layout for Arabic (`dir="rtl"`) — not just mirrored CSS, also re-ordered icons and form affordances |
| Server errors | Fastify `preSerialization` hook reads `Accept-Language` and returns **translated error bodies** — the 22 error codes are localized on the API side, not just the client |
| Rich content | All **24 on-chain gift-box names + museum-grade descriptions** translated across 19 locales (not machine-output — hand-authored per locale) |
| CI guard | [`packages/app/scripts/check-i18n.mjs`](packages/app/scripts/check-i18n.mjs) runs in CI and fails the build on any missing or orphaned key across locales |
| Preview | Staging build with language switcher front-and-center at <https://i18n.iusd-pay.xyz> |

Implementation lives in
[`packages/app/src/i18n/`](packages/app/src/i18n/) (React side, `i18next` +
`react-i18next`) and [`packages/api/src/lib/i18n.ts`](packages/api/src/lib/i18n.ts)
(API side).

### 2.6 Backend, infra, and CI/CD

- **Fastify API** with ECIES viewing-key custody, OFAC screening, OG meta
  endpoints, SSE streams, and 40+ PostgreSQL tables
- **Background worker** that drains gift/payment claim queues and submits
  on-chain TXs through a relayer pool (9 workers — pay / gift / sweep)
- **PostgreSQL** schema covering accounts, contacts, payments, gifts,
  invoices, comments, reactions, notifications
- **Cloudflare Worker** that rewrites OG meta so gift links preview correctly
  in Telegram / Twitter / WhatsApp / Slack bot UAs
- **Five independent GitHub Actions deploy workflows** — one per tier
  (db / api / relayer / frontend / admin) with `paths:` filters so each
  service is only re-shipped when its own code changes

---

## 3. Product Value & UX

### Core user journeys (all one signature)

| Flow | What the user does | How Initia makes it better |
|---|---|---|
| **Send**    | Pick contact → amount → confirm | On-chain privacy, single IK signature |
| **Request** | Enter amount → share QR / short link | Real-time chain status + optional invoice |
| **Gift**    | Pick box → memo → recipient / Anyone → confirm | On-chain gift packet, equal / random split, viral share link |
| **Claim**   | Open link → sign | Viewing-key session, instant unwrap animation |
| **Invoice refund** | Any paid invoice → "↩ Refund Payer" | Direct `pay_v3::refund` TX, no backend round-trip |
| **Deposit / Withdraw** | Pick chain + amount → sign | Interwoven Bridge router, any rollup |

### Home screen at a glance

- DNA-colored identity card (avatar + short-id `INIT1...XXXX`) generated
  from the user's address
- Live iUSD balance with inline Deposit / Withdraw (Interwoven Bridge)
- **Inbox** — incoming payments with auto-claim (on by default for new
  accounts) or manual claim
- **History** — date-grouped, searchable, with per-row revoke / refund /
  receipt / invoice PDF
- **Gifts** — gallery of 24 on-chain boxes plus Sent / Received / Reactions
  tabs
- **Contacts** — auto-seeded from activity, search-to-send
- **PWA-installable** on iOS Safari and Android Chrome

### Gifts — a brand-new social channel on top of stablecoin payments

This is the piece we're most excited about. Every other on-chain payment
product in the market today stops at "transfer + optional memo". iUSD Pay
turns the payment object itself into a **social surface** — a shareable,
programmable artifact that both sides of the transaction can talk around,
react to, and build relationships through.

Gift packets are not a virality hack layered on top of payments. They are
**a new category of social interaction that only becomes possible once
you have privacy-preserving stablecoin rails underneath**:

- **The gift is a first-class on-chain object**, not a transaction meta
  field. It has its own ID, its own box art, its own memo, its own
  equal / random split mode, its own share URL, its own state machine
  (wrapped → shared → claimed → thanked → revoked).
- **A gift is a conversation starter, not a transfer receipt.** Sender
  picks a museum-grade box (`Watch`, `Music Box`, `Dragonfly Brooch`,
  `Crown of the Andes` …), writes a handwritten memo in a chosen font,
  picks equal or random for group mode, and ships it. Recipient gets a
  shareable link before even opening it.
- **Social primitives that rails don't have:**
    - **Mystery-box OG previews** — the share link renders as a sealed
      present across Telegram / Twitter / WhatsApp / Slack (a CF Worker
      rewrites OG meta; contents are never leaked before claim).
    - **Wrap / unwrap animations** — the claim flow is a multi-stage
      montage (ribbon untie → lid lift → memo reveal → amount counter)
      that makes opening a gift feel like opening a gift, not signing a
      TX.
    - **Thank-you replies + reactions** — claimer can emoji-react and
      send a letter back. Third parties who see the share link can
      react too, so the surface is feed-like, not 1-to-1.
    - **Encrypted private chat between sponsor and claimer** — layered
      on the exact same viewing-key infrastructure used by the payment
      envelopes. The sender can DM the recipient privately, post-claim,
      without leaking anything on chain.
    - **Group red envelopes with equal / random modes** — 1 gift can be
      claimed by N people, either evenly or with a programmable random
      split. Chinese New Year 红包 culture as a first-class on-chain
      object.
- **Viral by construction.** A gift link is also an invite link. The
  first gift a user receives is the same click that signs them up.
  Zero-CAC acquisition — the network grows by how much value circulates
  through it, not by how much is spent on ads.
- **Gift + brand = a new commerce category.** A brand gift card (e.g.
  **Fly Coffee**) is both a payment **and** a loyalty voucher — the
  holder gets in-store discounts on top of the wrap value. This is
  only possible because the gift object persists on-chain and can be
  queried by any redemption partner.

**In one line:** iUSD Pay isn't using gifts to grow payments. iUSD Pay
is turning on-chain stablecoin payments into the backbone of a social
network that didn't exist before.

---

## 4. Working Demo & How to Verify

### Fastest path for a judge (< 60 seconds)

1. **Open** https://iusd-pay.xyz on a phone browser (desktop works too).
2. **Sign in** with any Initia wallet — InterwovenKit handles Initia
   Username / WalletConnect / Mobile Wallet Protocol.
3. Land on the home screen and explore the Inbox / History / Gifts tabs.
4. Scan the [demo video](https://www.youtube.com/watch?v=KfkLL-dfhfs) above
   for the full 2-minute walkthrough.

### Why "clone & run" is not the verification path

iUSD Pay is not a single-process toy app. It is a **five-tier production
deployment**:

1. **PostgreSQL** — accounts, payments, gifts, viewing keys, background queues
2. **API** (`packages/api`) — Fastify HTTP, ECIES key custody, OFAC screening,
   OG meta, SSE
3. **Background worker** (`packages/api` → `relayer-main.js`) — drains
   claim queues and submits on-chain TXs against the Move pools
4. **Frontend** (`packages/app`) — React 19 + InterwovenKit web app
5. **Admin panel** (`packages/admin`) — internal merchant / compliance console

The API and worker share state through PostgreSQL, the worker holds its own
funded mnemonic, and the frontend builds against a live Move deployment.
Production CI under [`.github/workflows/`](.github/workflows/) builds and
ships each tier independently (`deploy-db.yml`, `deploy-backend.yml`,
`deploy-relayer.yml`, `deploy-frontend.yml`, `deploy-admin.yml`). Judges
verify via the **live URL above**, not a local clone.

---

## 5. Market Understanding

### Target user

- **Primary** — stablecoin-holding crypto natives (tens of millions globally)
  who currently use Venmo / PayPal / Revolut for fiat P2P and are frustrated
  that their on-chain USD has no equivalent UX.
- **Secondary** — small merchants and freelancers who want to invoice in
  iUSD (business invoice mode ships in v1 with invoice number, due date,
  PDF export, and merchant profile).
- **Tertiary** — gift-native cultures. Chinese New Year and birthday red
  envelopes, wedding cash, Mother's Day — where "send a gift" matches
  existing behaviour better than "send a payment".

### Go-to-market

- **Viral by design.** Every gift is a share link, so iUSD Pay spreads by
  recipients, not marketing. The first gift a user receives is also their
  sign-up path, with no app-store friction.
- **Mobile-first PWA.** Install to home screen in two taps. No TestFlight,
  no Google Play review, no platform tax.
- **Cross-rollup reach.** Interwoven Bridge means every chain in the
  Interwoven ecosystem is a valid source and destination — iUSD Pay is
  the common consumer surface for the entire rollup stack.

### Revenue model — not just a payment rail

iUSD Pay is designed to make money on two axes, *not* on transaction gas:

1. **Tiered gift-box fees.** We shipped 24 museum-grade collectible gift
   boxes (watches, paintings, instruments, jewelry) — each one is a
   first-class on-chain object with its own configurable `fee_bps`. A
   "Standard" wrap is 0.5%, a "Crown of the Andes" premium wrap can be
   higher. The gift itself becomes the unit economy — users pay for
   delight, not for moving bytes.
2. **Brand partnerships on top of gift cards.** Scene 6 of the demo shows
   the play: a real merchant (**Fly Coffee**) lists a branded gift box. Any
   user who holds that box can redeem a 50% discount in store. The merchant
   subsidizes the discount to acquire crypto-native customers; iUSD Pay
   takes a cut of each wrap. This is Groupon × Venmo × stablecoin payments
   — a category no one else has shipped on Initia.

Both axes exist today in the live app. The box catalog is hot-editable by
admin without code changes, so onboarding a new brand partner is a
copy-paste job.

### Competitive landscape

| Category | Example | Why iUSD Pay is distinct |
|---|---|---|
| Fiat P2P | Venmo, PayPal, Revolut | Custodial, US-/EU-only, no programmable on-chain primitives |
| On-chain USDC wallets | Circle Pay, Phantom Pay | On-chain but **no privacy**, no gift primitive, wallet-first UX |
| Privacy coins | Zcash, Monero wallets | Privacy but **no stablecoin**, no request / invoice / gift object |
| Mixers | Tornado-style | Opaque but **not compliant** — no admin audit envelope |
| Consumer crypto pay apps on Initia | — | iUSD Pay is the **first consumer payments app** shipped on `interwoven-1` |

### Why it's defensible

- **Privacy + compliance** is a rare combination — most privacy apps pick
  one. Dual-recipient ECIES gives you both without a trust tradeoff.
- **Gift virality** creates a zero-CAC acquisition channel that wallet-first
  competitors can't match without adding a social layer.
- **PWA-first** sidesteps every app-store gatekeeper simultaneously.
- **Initia-native** means first-mover advantage as the consumer surface for
  the entire Interwoven rollup ecosystem.

---

## Repository guide

| Path | Contents |
|---|---|
| `packages/contracts/move/sources/` | `pay_v3.move`, `gift_v3.move`, `common.move` |
| `packages/api/` | Fastify API + background worker + ECIES services |
| `packages/app/` | React 19 + Vite + InterwovenKit frontend |
| `packages/admin/` | Internal compliance / merchant console |
| `cf-worker/` | Cloudflare Worker for OG meta rewriting |
| `scripts/deploy/` | Build + deploy + init + re-register scripts |
| `.github/workflows/` | Five independent deploy pipelines |
| `.initia/submission.json` | Machine-readable hackathon manifest |

---

Submission manifest → [`.initia/submission.json`](.initia/submission.json)
