/*
 Session Manager
 - Save/Load session (cookies + localStorage)
 - Restore automatically on startup
*/
const fs = require('fs');
const path = require('path');

class Session {
  constructor({ sessionPath, fileName }) {
    this.dir = sessionPath;
    this.file = path.join(sessionPath, fileName);
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
  }

  async restore(page) {
    try {
      if (!fs.existsSync(this.file)) return;
      const raw = fs.readFileSync(this.file, 'utf8');
      const data = JSON.parse(raw);
      if (data.cookies && Array.isArray(data.cookies)) {
        await page.setCookie(...data.cookies);
      }
      if (data.localStorage) {
        await page.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded' });
        await page.evaluate((ls) => {
          try {
            Object.entries(ls).forEach(([k, v]) => localStorage.setItem(k, v));
          } catch (_) {}
        }, data.localStorage);
      }
    } catch (e) {
      // ignore corrupt session
    }
  }

  async save(page) {
    try {
      const cookies = await page.cookies();
      const localStorage = await page.evaluate(() => {
        const out = {};
        try {
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            out[key] = localStorage.getItem(key);
          }
        } catch (_) {}
        return out;
      });
      const data = { cookies, localStorage };
      fs.writeFileSync(this.file, JSON.stringify(data, null, 2));
    } catch (e) {
      // ignore
    }
  }
}

module.exports = Session;
