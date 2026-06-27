# AGENTS.md — Jinovel (jinovel.com) Parser Knowledge

คู่มือดูแล `plugin/js/parsers/JinovelParser.js` — เก็บความรู้ที่ได้จากการ reverse-engineer เว็บ jinovel.com
เพื่อให้ agent คนต่อไป (หรือตัวเองในอนาคต) ซ่อม/อัปเดตได้โดยไม่ต้องเริ่มไข่ใหม่

## TL;DR — โครงสร้างโดยรวม
- Jinovel = Nuxt 2 SPA เซิร์ฟเวอร์ส่ง HTML เปล่า + เนื้อหาเข้ารหัสผ่าน API
- เนื้อหาตอนถูกเข้ารหัส **AES-256-ECB** คีย์มาจาก hash ของ `temporaryKey` (ตอนฟรี) หรือ `userId` (ตอนเสียเงิน)
- มี anti-scrape 2 ชั้น: (1) เข้ารหัสเนื้อหา (2) ฟอนต์ CSPraJad เก็บไทยใน codepoint สงวน
- Parser ใช้ **วิธี B** (ดึง API + ถอดรหัสเอง) เป็นหลัก, **วิธี A** (render ใน tab) เป็น fallback

---

## API endpoints (api.jinovel.com)
| endpoint | ใช้ทำอะไร | auth? |
|---|---|---|
| `GET /v1/l/books/{novelId}/chapters?page={n}` | รายชื่อตอน (`{data:[{id,name,isFree,price,canRead}]}`) | ไม่ต้อง |
| `GET /v1/l/chapters/{chapterId}` | metadata ตอน (name, preview, ...) | ไม่ต้อง |
| `GET /v1/l/chapters/{chapterId}/content` | **เนื้อหาเข้ารหัส** `{data:{content(base64), temporaryKey, contents, contentUrls, pageSpacing}}` | ตอนฟรีไม่ต้อง / ตอนเสียเงินต้อง `Authorization: Bearer <accessToken>` (ไม่มี = 403) |

- `novelId` = UUID จาก URL `/novel/{novelId}` (เช่น `00183892-ad2f-4edc-9366-6b4402600bd1`)
- `chapterId` = UUID จาก `/novel/chapter/{chapterId}`

## อัลกอริทึมถอดรหัส (reverse จาก bundle)
สรุปในบรรทัดเดียว (`JinovelParser.decryptContent`):
```
keyStr = userId (login) หรือ  temporaryKey (free)
key    = sha256(keyStr).slice(32)            # 32 hex chars -> ASCII = 32 bytes (AES-256)
plain  = AES-256-ECB.decrypt(key, base64decode(content))
plain  = plain.replace(/[\u0001-\u0010]/g,"").trim()   # ตัด PKCS7 padding leftover
```
- key คือ **32 hex chars ที่เป็น ASCII** (ไม่ใช่ hex->bytes) → ใช้เป็น AES key ตรงๆ 32 bytes
- AES **ECB** (Web Crypto `subtle` ไม่รองรับ ECB → ต้องเขียน pure JS `JinovelAes`)
- ตรวจแล้ว byte-exact ตรงกับ `aes-js` ของเว็บ และ FIPS-197 C.3 test vector

### bundle ที่เป็นต้นฉบับ (อาจเปลี่ยน hash ตามเวอร์ชัน)
- **อัลกอริทึม decrypt**: webpack chunk ที่มี module exports `{decrypt, encContent}` (module ~928)
  - `decrypt(content, key)`: `sha256(key).substr(32) -> AES-ECB (aes-js, module ~1437/1139)`
  - `encContent(html)`: ขั้นตอบสร้าง tofu (เรา **ข้าม** ขั้นนี้ ได้ HTML ไทยสะอาด)
- **reader component** (`getContent`): `html = decrypt(content.content, userId || temporaryKey); if(userId) html = he.decode(html); encContent(html)`
- `userId = $store.getters["auth/profile"].id`
- ค้นหา chunk ที่ถูกด้วย keyword: `temporaryKey`, `pageSpacing`, `csprajad`, `decrypt`

## Auth / login state (สำหรับตอนเสียเงิน)
- vuex-persistedstate เก็บ state ใน **localStorage key `"jinovel"`** (ไม่ใช่ cookie — ค้นพบหลังจาก cookie อ่านไม่ได้)
  - `JSON.parse(localStorage.jinovel)` = `{auth:{accessToken, refreshToken, profile:{...}}, setting:{...}}`
  - `accessToken` = JWT (ส่งเป็น `Authorization: Bearer`)
  - `userId` = `profile.id` (ลองหลายที่: `profile.id/_id/core.id/library.id`)
- Parser อ่านจาก localStorage ของ **tab jinovel** ผ่าน `chrome.scripting.executeScript` (รองด้วย `chrome.cookies` ถ้ามี)
  - ต้องเปิด popup จาก tab jinovel ที่ login อยู่ (เพื่อมี `?id=<tabId>`)
- config ใน app chunk: `vuex-persistedstate({key:"jinovel", paths:["auth","setting"]})`

## 2 วิธีใน parser (`fetchChapter`)
1. **วิธี B (หลัก)** `fetchChapterViaApi`: GET API → อ่าน auth → decrypt (userId→temporaryKey) → DOM
   - เร็ว (~0.3s/ตอน) + batch + ไม่แย่ง tab
   - validity gate `htmlLooksValid` (ต้องมี `<p>`) กัน garbage จาก key ผิด
2. **วิธี A (fallback)** `fetchChapterInTab`: `chrome.tabs.update` นำทาง → poll `executeScript` จนเจอ `div.text-grey-800.bg-yellow-300` → ดึง outerHTML
   - ช้า (~1.5s/ตอน) แต่ได้เสมอเพราะ tab login อยู่
   - ใช้ตอนวิธี B throw (API error / decrypt fail / auth ไม่ได้)

## Anti-scrape ชั้นฟอนต์ (CSPraJad) — มีผลเฉพาะวิธี A
- เว็บใช้ฟอนต์ CSPraJad1/2 เก็บพยัญชนะไทยใน codepoint สงวน Thai block **U+0E5C–U+0E7F** → reader ปกติไม่มี glyph = tofu (สี่เหลี่ยม)
- `JinovelParser.CSPRAJAD1_MAP` / `CSPRAJAD2_MAP`: แมป codepoint สงวน → Thai มาตรฐาน (ได้จาก parse glyph outline ด้วย fontTools)
- `fixCspPrajad`: remap ใน `<span class="font-csprajad*">` — เรียกใน `findContent`
- **วิธี B ไม่ต้องใช้** เพราะได้ HTML สะอาดก่อน encContent
- ฟอนต์โหลดได้ที่ `https://www.jinovel.com/_nuxt/fonts/CSPraJad{1,2}.{hash}.woff2`

## ถ้าพังในอนาคต (jinovel เปลี่ยนเวอร์ชัน)
อาการ: console ขึ้น `วิธี B ล้มเหลว ใช้วิธี A` บ่อย (แต่ยังโหลดได้เพราะ fallback)

ขั้นตอน reverse ใหม่:
1. โหลด entry chunks จาก SSR HTML (`/_nuxt/*.js` ใน `<script src>`)
2. หา webpack runtime chunk → extract chunk manifest `{chunkId: hash}` (pattern `n.p+""+({...})[e]`)
3. ดาวน์โหลด chunks ทั้งหมด → grep keyword: `temporaryKey`, `pageSpacing`, `csprajad`, `decrypt`, `AES`
4. chunk ที่ match หลาย keyword = reader component → อ่าน `getContent`/`decrypt`
5. ถอด algorithm ใหม่ (cipher mode? key derivation? path endpoint?)
6. เทียบกับ node `crypto` ก่อน port (verify ก่อนเสมอ)

เครื่องมือ: Python+pycryptodome (verify ด่วน), node `crypto` (เทียบ byte-exact), fontTools (parse woff2 ถ้า CSPraJad เปลี่ยน)

## ข้อควรระวัง / gotchas
- `chrome.scripting.executeScript` ใน ISOLATED world อ่าน `localStorage` ได้ (แชร์กัน) แต่อ่านตัวแปร Vue/`$nuxt` ไม่ได้
- อย่าใช้ `chrome.tabs.onUpdated` complete เพื่อรอ SPA load (Nuxt ไม่ fire น่าเชื่อถือ → เคยค้าง 5 นาที) ใช้ poll content แทน
- HttpClient: ถ้าส่ง `fetchOptions` เข้า `fetchJson` ต้องใส่ `credentials:"include"` เอง (`makeOptions()` จะไม่ถูกเรียก)
- content div จริง = `div.text-grey-800.bg-yellow-300` (ปุ่มปรับขนาดก็มี `bg-yellow-300` แต่ไม่มี `text-grey-800`)
