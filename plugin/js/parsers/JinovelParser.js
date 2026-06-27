"use strict";

// ===== AES-256-ECB decrypt (pure JS) =====
// ถอดรหัสเนื้อหาที่ Jinovel เข้ารหัสไว้ (ตรวจสอบแล้วตรงกับ FIPS-197 C.3 และ node crypto)
const JinovelAes = (() => {
    const mul = (a, b) => {
        let r = 0;
        for (let i = 0; i < 8; i++) {
            if (b & 1) r ^= a;
            const hi = a & 0x80;
            a = (a << 1) & 0xff;
            if (hi) a ^= 0x1b;
            b >>= 1;
        }
        return r;
    };
    const E = new Array(256), L = new Array(256);
    { let p = 1; for (let i = 0; i < 255; i++) { E[i] = p; L[p] = i; p = mul(p, 3); } }
    const inv = (a) => (a === 0) ? 0 : E[(255 - L[a]) % 255];
    const SB = new Array(256), ISB = new Array(256);
    for (let a = 0; a < 256; a++) {
        let s = inv(a), x = s, acc = s;
        for (let i = 0; i < 4; i++) { x = ((x << 1) | (x >>> 7)) & 0xff; acc ^= x; }
        SB[a] = acc ^ 0x63;
    }
    for (let a = 0; a < 256; a++) ISB[SB[a]] = a;
    const RCON = [0x00,0x01,0x02,0x04,0x08,0x10,0x20,0x40,0x80,0x1b,0x36,0x6c,0xd8,0xab,0x4d];
    function keyExpansion(key) {
        const Nk = 8, Nr = 14, w = new Array(4 * (Nr + 1));
        for (let i = 0; i < Nk; i++) w[i] = [key[4*i], key[4*i+1], key[4*i+2], key[4*i+3]];
        for (let i = Nk; i < 4 * (Nr + 1); i++) {
            let t = w[i-1].slice();
            if (i % Nk === 0) { t = [t[1], t[2], t[3], t[0]].map(x => SB[x]); t[0] ^= RCON[i / Nk]; }
            else if (Nk > 6 && i % Nk === 4) { t = t.map(x => SB[x]); }
            w[i] = [w[i-Nk][0]^t[0], w[i-Nk][1]^t[1], w[i-Nk][2]^t[2], w[i-Nk][3]^t[3]];
        }
        return w;
    }
    function addRoundKey(st, w, rnd) {
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) st[r + 4*c] ^= w[4*rnd + c][r];
    }
    function invSubBytes(st) { for (let i = 0; i < 16; i++) st[i] = ISB[st[i]]; }
    function invShiftRows(st) {
        const s = st.slice();
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) st[r + 4*c] = s[r + 4*((c - r + 4) % 4)];
    }
    function invMixColumns(st) {
        for (let c = 0; c < 4; c++) {
            const a0 = st[4*c], a1 = st[4*c+1], a2 = st[4*c+2], a3 = st[4*c+3];
            st[4*c]   = mul(a0,0x0e)^mul(a1,0x0b)^mul(a2,0x0d)^mul(a3,0x09);
            st[4*c+1] = mul(a0,0x09)^mul(a1,0x0e)^mul(a2,0x0b)^mul(a3,0x0d);
            st[4*c+2] = mul(a0,0x0d)^mul(a1,0x09)^mul(a2,0x0e)^mul(a3,0x0b);
            st[4*c+3] = mul(a0,0x0b)^mul(a1,0x0d)^mul(a2,0x09)^mul(a3,0x0e);
        }
    }
    function decryptBlock(block, w) {
        const Nr = 14, st = block.slice();
        addRoundKey(st, w, Nr);
        for (let rnd = Nr - 1; rnd >= 1; rnd--) {
            invShiftRows(st); invSubBytes(st); addRoundKey(st, w, rnd); invMixColumns(st);
        }
        invShiftRows(st); invSubBytes(st); addRoundKey(st, w, 0);
        return st;
    }
    // ถอดรหัส AES-256-ECB ทั้ง buffer (ยังไม่ตัด padding ออก)
    function decryptECB(key, cipher) {
        const w = keyExpansion(key), out = [];
        for (let i = 0; i < cipher.length; i += 16) {
            const d = decryptBlock(cipher.slice(i, i + 16), w);
            for (let j = 0; j < 16; j++) out.push(d[j]);
        }
        return Uint8Array.from(out);
    }
    return { decryptECB };
})();

class JinovelParser extends Parser {
    constructor() {
        super();
    }

    // [แก้ปัญหาที่ 2] บังคับให้เป็นภาษาไทย
    extractLanguage(dom) {
        return "th";
    }

    // [แก้ปัญหาที่ 1] ดึงชื่อผู้แต่ง
    extractAuthor(dom) {
        let author = dom.querySelector('.text-yellow-600');
        if (author) {
            return author.textContent.trim();
        }
        return "Jinovel";
    }

    // [แก้ปัญหาที่ 3 และ 4] ดึงหน้าปก และแก้บั๊กค้าง (Cloudflare)
    findCoverImageUrl(dom) {
        let metaImg = dom.querySelector('meta[property="og:image"]');
        if (metaImg) {
            let url = metaImg.getAttribute("content");
            let parts = url.split("/https://");
            if (parts.length > 1) {
                return "https://" + parts[1];
            }
            return url;
        }
        return super.findCoverImageUrl(dom);
    }

    // สารบัญแบบ API
    async getChapterUrls(dom) {
        let chapterUrls = [];
        let match = dom.baseURI.match(/\/novel\/([a-f0-9-]+)/i);
        if (!match) return chapterUrls;

        let novelId = match[1];
        let page = 1;
        let hasMore = true;

        while (hasMore) {
            let apiUrl = `https://api.jinovel.com/v1/l/books/${novelId}/chapters?page=${page}`;
            try {
                let json = (await HttpClient.fetchJson(apiUrl)).json;
                let data = json.data || json;
                let items = Array.isArray(data) ? data : (data.items || data.chapters || []);

                if (Array.isArray(items) && items.length > 0) {
                    for (let chapter of items) {
                        if (chapter.id) {
                            let title = chapter.name || chapter.title || ("ตอนที่ " + chapter.id);
                            chapterUrls.push({
                                sourceUrl: `https://www.jinovel.com/novel/chapter/${chapter.id}`,
                                title: title.trim()
                            });
                        }
                    }
                    page++;
                } else {
                    hasMore = false;
                }
            } catch (err) {
                console.error("Jinovel API Fetch Error:", err);
                break;
            }
            if (page > 200) break;
        }
        return chapterUrls;
    }

    // วิธี B (หลัก): ดึงผ่าน API + ถอดรหัส AES เอง — เร็วกว่า + ไม่ต้องเปิด tab + batch ได้
    // วิธี A (fallback): render ใน tab จริง (กรณี API ไม่ได้ เช่น ติดเหรียญ/เข้าระบบ)
    async fetchChapter(url) {
        let tabId = JinovelParser.extractTabIdFromQueryParameter();
        let m = url.match(/\/novel\/chapter\/([a-f0-9-]+)/i);
        if (m) {
            try {
                return await this.fetchChapterViaApi(m[1], tabId);
            } catch (e) {
                console.warn("[Jinovel] วิธี B (API) ล้มเหลว ใช้วิธี A (render-in-tab):", e.message);
            }
        }
        if (tabId != null && !util.isFirefox()) {
            return await this.fetchChapterInTab(tabId, url);
        }
        return (await HttpClient.wrapFetch(url)).responseXML;
    }

    // === วิธี B: API + decrypt (hybrid: รองรับตอนฟรี + ตอนเสียเงิน) ===
    // API: GET /v1/l/chapters/{id}/content -> {data:{content(base64), temporaryKey}}
    //   - ตอนฟรี (anonymous): key = temporaryKey
    //   - ตอนเสียเงิน (login): เซิร์ฟเวอร์เข้ารหัสด้วย userId + ต้องส่ง Authorization: Bearer
    //     accessToken/userId อ่านจาก cookie "jinovel" (vuex-persistedstate auth module)
    // key = sha256(keyStr) hex ตัดเอา 32 ตัวหลัง -> ASCII 32 bytes = AES-256 key
    // AES-ECB ถอด base64(content) -> HTML ไทยสะอาด (ข้าม encContent ที่สร้าง tofu)
    async fetchChapterViaApi(chapterId, tabId) {
        let t0 = Date.now();
        let step = (label) => console.log("[Jinovel] +" + (Date.now() - t0) + "ms  " + label);
        step("API method (วิธี B)  chapterId=" + chapterId);

        // อ่าน auth จาก localStorage ของ tab jinovel (ก่อน) หรือ cookie (รอง) — ถ้า login อยู่
        let auth = await JinovelParser.getAuth(tabId);
        step("auth: " + (auth ? "logged-in  userId=" + auth.userId : "anonymous (ตอนฟรีเท่านั้น)"));

        let apiUrl = "https://api.jinovel.com/v1/l/chapters/" + chapterId + "/content";
        let fetchOpts = { credentials: "include" };
        if (auth) {
            fetchOpts.headers = { Authorization: "Bearer " + auth.accessToken };
        }
        let json = (await HttpClient.fetchJson(apiUrl, fetchOpts)).json;
        let data = json?.data || json || {};
        let content = data.content;
        let temporaryKey = data.temporaryKey;
        step("API raw: success=" + json?.success + "  keys=[" + Object.keys(data).join(",") + "]"
            + "  content=" + (content ? content.length + "B" : "null")
            + "  temporaryKey=" + (temporaryKey ? "yes" : "no"));
        if (!content) {
            throw Error("ไม่ได้รับเนื้อหา (ต้อง login/เป็นเจ้าของตอน?) → ลองวิธี A");
        }

        // ลอง key: userId ก่อน (ตอนเสียเงิน) แล้วถึง temporaryKey (ตอนฟรี)
        let html = null;
        let usedKey = null;
        if (auth?.userId) {
            try {
                html = await JinovelParser.decryptContent(content, auth.userId);
                usedKey = "userId";
            } catch (e) { html = null; }
        }
        if (!JinovelParser.htmlLooksValid(html) && temporaryKey) {
            html = await JinovelParser.decryptContent(content, temporaryKey);
            usedKey = "temporaryKey";
        }
        let valid = JinovelParser.htmlLooksValid(html);
        step("decrypt usedKey=" + usedKey + "  valid(<p>)=" + valid
            + "  html=" + (html ? html.length : 0) + " chars"
            + "  preview=" + JSON.stringify(html ? html.slice(0, 80) : ""));
        if (!valid) {
            throw Error("ถอดรหัสไม่สำเร็จ → ลองวิธี A");
        }

        // ชื่อตอน (ลองดึง metadata, ถ้า fail ก็ช่างมัน)
        let title = "Chapter";
        try {
            let meta = (await HttpClient.fetchJson("https://api.jinovel.com/v1/l/chapters/" + chapterId)).json;
            title = meta?.data?.name || meta?.data?.title || title;
        } catch (e) { /* ignore */ }

        let dom = new DOMParser().parseFromString(
            "<html><head></head><body></body></html>", "text/html");
        let h1 = dom.createElement("h1");
        h1.textContent = title;
        dom.body.appendChild(h1);
        let wrap = dom.createElement("div");
        wrap.className = "jinovel-content";
        wrap.innerHTML = html;
        dom.body.appendChild(wrap);
        step("API method END  total=" + (Date.now() - t0) + "ms");
        return dom;
    }

    // อ่าน accessToken + userId เพื่อ decrypt ตอนเสียเงิน
    // ลำดับ: (1) localStorage "jinovel" ของ tab jinovel (vuex-persistedstate เก็บที่นี่) -> (2) cookie "jinovel"
    static async getAuth(tabId) {
        let raw = null;
        let source = null;
        // (1) localStorage ของ tab jinovel
        if (tabId != null && !util.isFirefox()) {
            try {
                let rs = await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    func: () => { try { return localStorage.getItem("jinovel"); } catch (e) { return null; } }
                });
                let v = rs?.[0]?.result;
                if (v) { raw = v; source = "localStorage(tab)"; }
            } catch (e) { /* ignore */ }
        }
        // (2) cookie
        if (!raw && chrome?.cookies?.get) {
            try {
                let c = await chrome.cookies.get({ url: "https://www.jinovel.com", name: "jinovel" });
                if (c?.value) { raw = c.value; source = "cookie"; }
            } catch (e) { /* ignore */ }
        }
        if (!raw) {
            console.log("[Jinovel] auth: ไม่พบข้อมูล auth (ไม่เจอ localStorage และ cookie 'jinovel')");
            return null;
        }
        let obj = null;
        for (let v of [raw, decodeURIComponent(raw)]) {
            try { obj = JSON.parse(v); if (obj) break; } catch (e) { /* try next */ }
        }
        if (!obj) {
            console.log("[Jinovel] auth: พบข้อมูล (" + source + ") แต่ parse JSON ไม่ได้");
            return null;
        }
        let auth = obj?.auth || obj?.state?.auth || {};
        let profile = auth.profile || {};
        let userId = profile.id || profile._id
            || profile.core?.id || profile.library?.id
            || profile.core?._id || profile.library?._id;
        let accessToken = auth.accessToken || auth.token;
        // log โครงสร้างเพื่อวินิจฉัย ถ้า field ไม่ตรงจะได้เห็น
        console.log("[Jinovel] auth source=" + source
            + "  topKeys=[" + Object.keys(obj).join(",") + "]"
            + "  authKeys=[" + Object.keys(auth).join(",") + "]"
            + "  profileKeys=[" + Object.keys(profile).join(",") + "]"
            + "  userId=" + (userId ? "found" : "MISSING")
            + "  accessToken=" + (accessToken ? "found" : "MISSING"));
        if (accessToken && userId) {
            return { accessToken, userId };
        }
        return null;
    }

    static htmlLooksValid(html) {
        return typeof html === "string" && html.length > 20 && /<p[\s>]/i.test(html);
    }

    static async decryptContent(contentBase64, temporaryKey) {
        let hashHex = await JinovelParser.sha256Hex(temporaryKey);
        let keyHex = hashHex.slice(32); // 32 ตัวหลังของ hex sha256
        let keyBytes = new TextEncoder().encode(keyHex); // 32 bytes ASCII
        let ctBytes = JinovelParser.base64ToBytes(contentBase64);
        let ptBytes = JinovelAes.decryptECB(keyBytes, ctBytes);
        let text = new TextDecoder("utf-8").decode(ptBytes);
        // ตัด control char 0x01-0x10 (PKCS7 padding ที่ aes-js ทิ้งไว้) + trim
        text = text.replace(/[\u0001-\u0010]/g, "");
        return text.trim();
    }

    static async sha256Hex(msg) {
        const data = new TextEncoder().encode(msg);
        const buf = await crypto.subtle.digest("SHA-256", data);
        return Array.from(new Uint8Array(buf))
            .map(b => b.toString(16).padStart(2, "0")).join("");
    }

    static base64ToBytes(b64) {
        let bin = atob(b64.trim());
        let bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    }

    // === วิธี A (fallback): render ใน tab จริง ===
    static extractTabIdFromQueryParameter() {
        let tabId = new URLSearchParams(window.location.search).get("id");
        return util.isNullOrEmpty(tabId) ? null : parseInt(tabId, 10);
    }

    async fetchChapterInTab(tabId, url) {
        let t0 = Date.now();
        let step = (label) => console.log("[Jinovel] +" + (Date.now() - t0) + "ms  " + label);
        step("fetchChapterInTab (fallback) START  url=" + url);

        step("→ chrome.tabs.update");
        await chrome.tabs.update(tabId, { url: url });
        step("← tabs.update returned");

        let expectedPath = new URL(url).pathname;

        step("→ poll content");
        let pollStart = Date.now();
        let data = null;
        let MAX_POLLS = 100;
        for (let i = 0; i < MAX_POLLS; ++i) {
            let result;
            try {
                let rs = await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    args: [expectedPath],
                    func: (expectedPath) => {
                        let cleanLen = (el) => el.textContent.replace(/\s/g, "").length;
                        let onTarget = location.pathname === expectedPath;
                        let contentDiv = document.querySelector("div.text-grey-800.bg-yellow-300");
                        if (onTarget && contentDiv && cleanLen(contentDiv) > 200) {
                            let crumbs = document.querySelectorAll(".breadcrumb li a");
                            let title = crumbs.length
                                ? crumbs[crumbs.length - 1].textContent.trim()
                                : (document.title || "");
                            return {
                                ok: true, html: contentDiv.outerHTML, title: title,
                                selector: "div.text-grey-800.bg-yellow-300",
                                textLen: cleanLen(contentDiv), onTarget: onTarget,
                            };
                        }
                        let body = document.body?.innerText || "";
                        if (onTarget && (body.includes("เข้าสู่ระบบ") || body.includes("ล็อกอิน"))) {
                            return { ok: false, error: "login-required", onTarget: onTarget };
                        }
                        return {
                            ok: false, onTarget: onTarget,
                            path: location.pathname, bodyLen: body.length,
                            readyState: document.readyState,
                            bg300: document.querySelectorAll("div.bg-yellow-300").length,
                        };
                    },
                });
                result = rs?.[0]?.result;
            } catch (e) {
                result = { ok: false, error: "exec:" + e.message };
            }

            if (result?.ok) {
                data = result;
                step("← content found at poll #" + (i + 1) + " (" + (Date.now() - pollStart) + "ms)"
                    + "  textLen=" + data.textLen);
                break;
            }
            if (i === 0 || (i + 1) % 5 === 0) {
                step("  poll #" + (i + 1) + ": " + JSON.stringify(result));
            }
            if (result?.error === "login-required") {
                throw Error("Jinovel: ต้องเข้าสู่ระบบก่อน");
            }
            await util.sleep(300);
        }

        if (!data || !data.ok) {
            step("✗ no content after " + MAX_POLLS + " polls (" + (Date.now() - pollStart) + "ms)");
            throw Error("Jinovel: ไม่เจอเนื้อหาหลังรอ " + Math.round((Date.now() - pollStart) / 1000) + "s");
        }

        step("→ ประกอบ DOM");
        let dom = new DOMParser().parseFromString(
            "<html><head></head><body></body></html>", "text/html");
        let h1 = dom.createElement("h1");
        h1.textContent = data.title || "Chapter";
        dom.body.appendChild(h1);
        let wrap = dom.createElement("div");
        wrap.className = "jinovel-content";
        wrap.innerHTML = data.html;
        dom.body.appendChild(wrap);
        step("fetchChapterInTab END  total=" + (Date.now() - t0) + "ms");
        return dom;
    }

    extractTitle(dom) {
        let titleElement = dom.querySelector('h1');
        return titleElement ? titleElement.textContent.trim() : "Jinovel Story";
    }

    findChapterTitle(dom) {
        let h1 = dom.querySelector('h1');
        return h1 ? h1.textContent.trim() : "Chapter";
    }

    // เนื้อหาที่ได้จากทั้งสองวิธีห่อไว้ใน div.jinovel-content
    // วิธี B: ได้ HTML ไทยสะอาดอยู่แล้ว วิธี A: มี span csprajad ต้อง remap
    findContent(dom) {
        let content = dom.querySelector(".jinovel-content")
            || dom.querySelector("div.text-grey-800.bg-yellow-300")
            || dom.querySelector("div.bg-yellow-300")
            || dom.querySelector(".view-content")
            || dom.querySelector(".content");
        if (!content) {
            let err = dom.createElement("div");
            err.innerHTML = "<p>Jinovel: ไม่พบเนื้อหา (อาจเป็นตอนที่ต้องเข้าสู่ระบบ/ติดเหรียญ)</p>";
            return err;
        }
        // แก้ฟอนต์ CSPraJad (กรณีวิธี A) — วิธี B ไม่มี span นี้จึงเป็น no-op
        JinovelParser.fixCspPrajad(content);
        content.querySelectorAll("p:empty").forEach(p => p.remove());
        return content;
    }

    // เว็บใช้ฟอนต์ CSPraJad1/2 เก็บพยัญชนะไทยใน codepoint สงวน (U+0E5C–U+0E7F)
    static CSPRAJAD1_MAP = {
        "\u0e5c": "\u0e12", "\u0e5d": "\u0e16", "\u0e5e": "\u0e19", "\u0e5f": "\u0e13",
        "\u0e60": "\u0e02", "\u0e61": "\u0e17", "\u0e62": "\u0e1a", "\u0e63": "\u0e21",
        "\u0e64": "\u0e0b", "\u0e65": "\u0e20", "\u0e66": "\u0e06", "\u0e67": "\u0e25",
        "\u0e68": "\u0e14", "\u0e69": "\u0e1e", "\u0e6a": "\u0e2d", "\u0e6b": "\u0e07",
        "\u0e6c": "\u0e09", "\u0e6d": "\u0e27", "\u0e6e": "\u0e2b", "\u0e6f": "\u0e08",
        "\u0e70": "\u0e0a", "\u0e71": "\u0e2a", "\u0e72": "\u0e28", "\u0e73": "\u0e04",
        "\u0e74": "\u0e18", "\u0e75": "\u0e1c", "\u0e76": "\u0e22", "\u0e77": "\u0e01",
        "\u0e78": "\u0e11", "\u0e79": "\u0e23", "\u0e7a": "\u0e29", "\u0e7b": "\u0e15",
    };
    static CSPRAJAD2_MAP = {
        "\u0e60": "\u0e01", "\u0e61": "\u0e18", "\u0e62": "\u0e0b", "\u0e63": "\u0e25",
        "\u0e64": "\u0e1a", "\u0e65": "\u0e27", "\u0e66": "\u0e04", "\u0e67": "\u0e12",
        "\u0e68": "\u0e1e", "\u0e69": "\u0e29", "\u0e6a": "\u0e14", "\u0e6b": "\u0e06",
        "\u0e6c": "\u0e21", "\u0e6d": "\u0e16", "\u0e6e": "\u0e2b", "\u0e6f": "\u0e09",
        "\u0e70": "\u0e0a", "\u0e71": "\u0e23", "\u0e72": "\u0e19", "\u0e73": "\u0e02",
        "\u0e74": "\u0e11", "\u0e75": "\u0e2d", "\u0e76": "\u0e1c", "\u0e77": "\u0e28",
        "\u0e78": "\u0e13", "\u0e79": "\u0e07", "\u0e7a": "\u0e20", "\u0e7b": "\u0e15",
        "\u0e7c": "\u0e2a", "\u0e7d": "\u0e08", "\u0e7e": "\u0e22", "\u0e7f": "\u0e17",
    };

    static fixCspPrajad(root) {
        root.querySelectorAll("span").forEach((span) => {
            let cls = span.getAttribute("class") || "";
            if (!/font-csprajad/i.test(cls)) {
                return;
            }
            let map = /csprajad2/i.test(cls)
                ? JinovelParser.CSPRAJAD2_MAP
                : JinovelParser.CSPRAJAD1_MAP;
            let text = span.textContent.replace(/[\u0e5c-\u0e7f]/g, (ch) => map[ch] || ch);
            span.replaceWith(document.createTextNode(text));
        });
    }
}

parserFactory.register("jinovel.com", function() { return new JinovelParser(); });
