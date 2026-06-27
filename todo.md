# WebToEpub — Jinovel Parser — TODO

## Status: both methods complete ✅
- Branch: `jinovel-parser` (pushed to fork `hiiamtin/WebToEpub`)
- origin -> fork, upstream -> dteviot/WebToEpub
- **Method B (API + AES decrypt)** = primary: supports both free (`temporaryKey`) and
  paid (`userId` + accessToken) chapters.
- **Method A (render-in-tab)** = automatic fallback when method B fails.
- Fallback chain: `userId` -> `temporaryKey` -> method A.

## Relevant files
- `plugin/js/parsers/JinovelParser.js` — the whole parser (AES + API + render-in-tab + CSPraJad maps)
- `plugin/popup.html` — added `<script src="js/parsers/JinovelParser.js"></script>`
- `AGENTS.md` — **reverse-engineering knowledge** (algorithm/endpoints/cookies etc.)

## Remaining TODO
- [ ] commit + push the cleaned-up (English comments, debug logs removed) version

## How to test
1. `chrome://extensions` -> reload WebToEpub
2. Open the popup from a **logged-in jinovel tab** (so `?id=<tabId>` is set and localStorage auth can be read)
3. Inspect popup -> Console, watch `[Jinovel]`
4. Expected logs: `Method B (API) failed...` only appears for genuinely problematic chapters;
   successful chapters fetch silently now.

## Future maintenance
- If method B starts falling back to method A often (visible in console) -> jinovel changed
  its bundle/algorithm. Re-reverse following `AGENTS.md` (section "If it breaks in the future").
- `temporaryKey` already changes every request -> not a concern (code reads it fresh per response).
