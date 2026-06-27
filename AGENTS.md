# AGENTS.md — Jinovel (jinovel.com) Parser Knowledge

Maintenance guide for `plugin/js/parsers/JinovelParser.js`. Captures knowledge gained
from reverse-engineering jinovel.com so the next agent (or future self) can fix/update
without starting from scratch.

## TL;DR
- Jinovel = Nuxt 2 SPA; server ships an empty shell + encrypted content via API.
- Chapter content is encrypted with **AES-256-ECB**; the key is derived from a hash of
  `temporaryKey` (free chapters) or `userId` (paid chapters).
- Two anti-scrape layers: (1) content encryption, (2) CSPraJad font storing Thai in
  reserved codepoints.
- Parser uses **Method B** (fetch API + decrypt ourselves) as primary, **Method A**
  (render in a real tab) as automatic fallback.

---

## API endpoints (api.jinovel.com)
| endpoint | purpose | auth? |
|---|---|---|
| `GET /v1/l/books/{novelId}/chapters?page={n}` | chapter list (`{data:[{id,name,isFree,price,canRead}]}`) | no |
| `GET /v1/l/chapters/{chapterId}` | chapter metadata (name, preview, ...) | no |
| `GET /v1/l/chapters/{chapterId}/content` | **encrypted content** `{data:{content(base64), temporaryKey, contents, contentUrls, pageSpacing}}` | free=no / paid=`Authorization: Bearer <accessToken>` (without it = 403) |

- `novelId` = UUID from URL `/novel/{novelId}` (e.g. `00183892-ad2f-4edc-9366-6b4402600bd1`)
- `chapterId` = UUID from `/novel/chapter/{chapterId}`

## Decryption algorithm (reverse-engineered from bundle)
One-liner summary (`JinovelParser.decryptContent`):
```
keyStr = userId (logged in) OR temporaryKey (free)
key    = sha256(keyStr).slice(32)            # last 32 hex chars -> ASCII = 32 bytes (AES-256)
plain  = AES-256-ECB.decrypt(key, base64decode(content))
plain  = plain.replace(/[\u0001-\u0010]/g,"").trim()   # strip PKCS7 padding leftover
```
- The key is the **32 hex chars used as ASCII** (not hex->bytes) -> used directly as a 32-byte AES key.
- AES **ECB** (Web Crypto `subtle` does not support ECB -> pure-JS `JinovelAes` is required).
- Verified byte-exact against the site's `aes-js` and the FIPS-197 C.3 test vector.

### Source bundles (hashes change per release)
- **decrypt algorithm**: the webpack chunk exporting `{decrypt, encContent}` (module ~928)
  - `decrypt(content, key)`: `sha256(key).substr(32) -> AES-ECB (aes-js, modules ~1437/1139)`
  - `encContent(html)`: the tofu-generating step (we **skip** it -> clean Thai HTML)
- **reader component** (`getContent`): `html = decrypt(content.content, userId || temporaryKey); if(userId) html = he.decode(html); encContent(html)`
- `userId = $store.getters["auth/profile"].id`
- Find the right chunk via keywords: `temporaryKey`, `pageSpacing`, `csprajad`, `decrypt`

## Auth / login state (for paid chapters)
- vuex-persistedstate stores state in **localStorage key `"jinovel"`** (NOT a cookie —
  discovered after cookie reading failed)
  - `JSON.parse(localStorage.jinovel)` = `{auth:{accessToken, refreshToken, profile:{...}}, setting:{...}}`
  - `accessToken` = JWT (sent as `Authorization: Bearer`)
  - `userId` = `profile.id` (tries several locations: `profile.id/_id/core.id/library.id`)
- Parser reads it from the localStorage of the **jinovel tab** via `chrome.scripting.executeScript`
  (cookie fallback), so the popup must be opened from a logged-in jinovel tab (to have `?id=<tabId>`).
- Config in app chunk: `vuex-persistedstate({key:"jinovel", paths:["auth","setting"]})`

## Two methods in the parser (`fetchChapter`)
1. **Method B (primary)** `fetchChapterViaApi`: GET API -> read auth -> decrypt (userId->temporaryKey) -> DOM
   - Fast (~0.3s/chapter), batchable, no tab hijack.
   - validity gate `htmlLooksValid` (must contain `<p>`) guards against garbage from a wrong key.
2. **Method A (fallback)** `fetchChapterInTab`: `chrome.tabs.update` navigates -> poll `executeScript`
   until `div.text-grey-800.bg-yellow-300` appears -> grab outerHTML.
   - Slower (~1.5s/chapter) but always works because the tab is logged in.
   - Used when method B throws (API error / decrypt fail / auth unavailable).

## Font anti-scrape layer (CSPraJad) — affects Method A only
- The site uses CSPraJad1/2 fonts storing Thai consonants in reserved Thai-block codepoints
  **U+0E5C–U+0E7F** -> normal readers have no glyph = tofu (squares).
- `JinovelParser.CSPRAJAD1_MAP` / `CSPRAJAD2_MAP`: reserved codepoint -> standard Thai
  (derived by parsing glyph outlines with fontTools).
- `fixCspPrajad`: remaps inside `<span class="font-csprajad*">` — called from `findContent`.
- **Method B does not need it** because it gets clean HTML before encContent.
- Fonts downloadable at `https://www.jinovel.com/_nuxt/fonts/CSPraJad{1,2}.{hash}.woff2`

## If it breaks in the future (jinovel releases a new version)
Symptom: console repeatedly shows `Method B (API) failed, falling back to method A`
(but still loads thanks to fallback).

Steps to re-reverse:
1. Download entry chunks from the SSR HTML (`/_nuxt/*.js` in `<script src>`).
2. Find the webpack runtime chunk -> extract the chunk manifest `{chunkId: hash}`
   (pattern `n.p+""+({...})[e]`).
3. Download all chunks -> grep keywords: `temporaryKey`, `pageSpacing`, `csprajad`, `decrypt`, `AES`.
4. The chunk matching multiple keywords is the reader component -> read `getContent`/`decrypt`.
5. Work out the new algorithm (cipher mode? key derivation? endpoint path?).
6. Compare against node `crypto` before porting (always verify first).

Tools: Python+pycryptodome (quick verify), node `crypto` (byte-exact compare), fontTools
(parse woff2 if CSPraJad changed).

## Gotchas
- `chrome.scripting.executeScript` in ISOLATED world can read `localStorage` (shared) but
  cannot read Vue/`$nuxt` variables.
- Do not use `chrome.tabs.onUpdated` complete to wait for an SPA load (Nuxt does not fire it
  reliably -> once hung for 5 min). Poll content instead.
- HttpClient: when passing `fetchOptions` to `fetchJson`, include `credentials:"include"`
  yourself (`makeOptions()` will not be called).
- The real content div = `div.text-grey-800.bg-yellow-300` (the font-size buttons also have
  `bg-yellow-300` but lack `text-grey-800`).
