"use strict";

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
        return "Jinovel"; // ถ้าหาไม่เจอจริงๆ ให้ใส่ชื่อเว็บไว้
    }

    // [แก้ปัญหาที่ 3 และ 4] ดึงหน้าปก และแก้บั๊กค้าง 1/2 (Cloudflare Block)
    findCoverImageUrl(dom) {
        let metaImg = dom.querySelector('meta[property="og:image"]');
        if (metaImg) {
            let url = metaImg.getAttribute("content");
            // รูปต้นฉบับจะซ่อนอยู่หลัง /https:// ให้เราตัดเอาเฉพาะลิงก์ S3 ของจริงมาใช้
            let parts = url.split("/https://");
            if (parts.length > 1) {
                return "https://" + parts[1]; // ลิงก์ตรง ไม่ผ่าน Cloudflare โหลดฉลุยแน่นอน!
            }
            return url;
        }
        return super.findCoverImageUrl(dom);
    }

    // สารบัญแบบ API (ใช้ของเดิมที่เวิร์คอยู่แล้ว)
    async getChapterUrls(dom) {
        let chapterUrls = [];
        let match = dom.baseURI.match(/\/novel\/([a-z0-9\-]+)/);
        if (!match) return chapterUrls;
        
        let novelId = match[1];
        let page = 1;
        let hasMore = true;
        
        while (hasMore) {
            let apiUrl = `https://api.jinovel.com/v1/l/books/${novelId}/chapters?page=${page}`;
            try {
                let response = await fetch(apiUrl);
                if (!response.ok) break;
                
                let json = await response.json();
                let items = json.data?.items || json.data?.chapters || json.data || json;
                
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
            if (page > 150) break;
        }
        return chapterUrls;
    }

    // Jinovel เป็น Nuxt SPA ที่เข้ารหัสเนื้อหาไว้ fetch() ธรรมดาได้แค่เปลือกเปล่า
    // วิธี A: เปิดหน้าใน tab จริง ให้ Nuxt render + ถอดรหัสเอง แล้วดึง DOM ที่ render แล้ว
    // (ตามรูปแบบ Sbxh1Parser.fetchContentInPageContext)
    async fetchChapter(url) {
        let tabId = JinovelParser.extractTabIdFromQueryParameter();
        if (tabId != null && !util.isFirefox()) {
            return await this.fetchChapterInTab(tabId, url);
        }
        // fallback: ถ้าไม่มี tabId (เช่น Firefox) ใช้ fetch ธรรมดา (จะไม่ได้เนื้อหา)
        return (await HttpClient.wrapFetch(url)).responseXML;
    }

    async fetchChapterInTab(tabId, url) {
        let t0 = Date.now();
        let step = (label) => console.log("[Jinovel] +" + (Date.now() - t0) + "ms  " + label);
        step("fetchChapterInTab START  url=" + url);

        step("→ chrome.tabs.update");
        await chrome.tabs.update(tabId, { url: url });
        step("← tabs.update returned");

        // เป้าหมาย pathname ของตอนนี้ เพื่อยืนยันว่า tab ไปถึงหน้าใหม่แล้ว (กันอ่านของเก่า)
        let expectedPath = new URL(url).pathname;

        // Poll เนื้อหาตรงๆ จาก popup (ไม่พึ่ง onUpdated ซึ่งไม่น่าเชื่อถือใน SPA)
        // แต่ละรอบเป็น executeScript แบบ sync อ่าน DOM ปัจจุบัน รวมรอโหลด+render ไว้ในจุดเดียว
        step("→ poll content");
        let pollStart = Date.now();
        let data = null;
        let MAX_POLLS = 100;   // 100 x 300ms = 30 วินาที
        for (let i = 0; i < MAX_POLLS; ++i) {
            let result;
            try {
                let rs = await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    args: [expectedPath],
                    func: (expectedPath) => {
                        let cleanLen = (el) => el.textContent.replace(/\s/g, "").length;
                        let onTarget = location.pathname === expectedPath;
                        // content div จริงมี class "text-grey-800 bg-yellow-300" (ปุ่มปรับขนาดตัวอักษร
                        // ก็มี bg-yellow-300 แต่ไม่มี text-grey-800 จึงต้องใช้ทั้งคู่เพื่อจำเพาะ)
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
                        // diagnostic
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
                    + " selector=" + data.selector + " textLen=" + data.textLen
                    + " source=" + data.source);
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
        // ห่อเนื้อหาใน div.jinovel-content เพื่อให้ findContent หาเจอแน่นอน
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

    static extractTabIdFromQueryParameter() {
        let tabId = new URLSearchParams(window.location.search).get("id");
        return util.isNullOrEmpty(tabId) ? null : parseInt(tabId, 10);
    }

    extractTitle(dom) {
        let titleElement = dom.querySelector('h1');
        return titleElement ? titleElement.textContent.trim() : "Jinovel Story";
    }

    findChapterTitle(dom) {
        let h1 = dom.querySelector('h1');
        return h1 ? h1.textContent.trim() : "Chapter";
    }

    // เนื้อหาที่ render แล้ว (สร้างโดย fetchChapterInTab ห่อไว้ใน div.jinovel-content)
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
        // แก้ฟอนต์ CSPraJad anti-scrape: remap codepoint สงวน -> Thai มาตรฐาน แล้วถอด span
        JinovelParser.fixCspPrajad(content);
        // ทำความสะอาด: เอา <p> เปล่าออก
        content.querySelectorAll("p:empty").forEach(p => p.remove());
        return content;
    }

    // เว็บใช้ฟอนต์ CSPraJad1/2 เก็บพยัญชนะไทยใน codepoint สงวน (U+0E5C–0E7F) ของ Thai block
    // ที่ฟอนต์ Thai ปกติไม่มี glyph → แสดงเป็นสี่เหลี่ยม (tofu) ใน EPUB reader
    // ตารางนี้แมปกลับเป็น Thai มาตรฐาน (ได้จากการ parse glyph outline ของฟอนต์จริง)
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
            // เลือกตารางตามฟอนต์ (class บอกว่า 1 หรือ 2)
            let map = /csprajad2/i.test(cls)
                ? JinovelParser.CSPRAJAD2_MAP
                : JinovelParser.CSPRAJAD1_MAP;
            // remap codepoint สงวนเป็น Thai มาตรฐาน
            let text = span.textContent.replace(/[\u0e5c-\u0e7f]/g, (ch) => map[ch] || ch);
            span.replaceWith(document.createTextNode(text));
        });
    }
}

parserFactory.register("jinovel.com", function() { return new JinovelParser(); });