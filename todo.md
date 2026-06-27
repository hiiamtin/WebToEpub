# WebToEpub — Jinovel Parser — TODO

## สถานะ: เสร็จแล้วทั้งสองวิธี ✅
- Branch: `jinovel-parser` (push ที่ fork `hiiamtin/WebToEpub`)
- origin → fork, upstream → dteviot/WebToEpub
- **วิธี B (API + AES decrypt)** = เมธอดหลัก: รองรับทั้งตอนฟรี (`temporaryKey`) และตอนเสียเงิน (`userId` + accessToken)
- **วิธี A (render-in-tab)** = fallback อัตโนมัติเมื่อวิธี B พัง
- fallback chain: `userId` → `temporaryKey` → วิธี A

## ไฟล์ที่เกี่ยวข้อง
- `plugin/js/parsers/JinovelParser.js` — parser ทั้งหมด (AES + API + render-in-tab + CSPraJad map)
- `plugin/popup.html` — เพิ่ม `<script src="js/parsers/JinovelParser.js"></script>`
- `AGENTS.md` — **ความรู้ด้าน reverse-engineering** (อัลกอริทึม/endpoint/cookie ฯลฯ) ย้ายไปที่นั่น

## TODO ที่เหลือ
- [ ] commit + push hybrid (userId/paid) version

## วิธีทดสอบ
1. `chrome://extensions` → reload WebToEpub
2. เปิด popup จาก **tab jinovel ที่ login อยู่** (เพื่อให้ `?id=<tabId>` และอ่าน localStorage auth ได้)
3. Inspect popup → Console ดู `[Jinovel]`
4. คาดหวัง log: `auth: logged-in userId=...` → `usedKey=userId/temporaryKey valid(<p>)=true`

## ดูแลในอนาคต
- ถ้าวันหน้าวิธี B เริ่มตกไปวิธี A บ่อย (เห็นใน console `วิธี B ล้มเหลว ใช้วิธี A`) → jinovel เปลี่ยน bundle/algorithm แล้ว
- กลับไป reverse ใหม่ตามขั้นตอนใน `AGENTS.md` (หัวข้อ "ถ้าพังในอนาคต")
- `temporaryKey` เปลี่ยนทุก request อยู่แล้ว → ไม่ใช่ปัญหา (โค้ดอ่านสดจากแต่ละ response)
