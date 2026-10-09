const http = require('http');
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
function req(p, m, b, t) { return new Promise((res, rej) => { const d = b ? JSON.stringify(b) : null; const r = http.request({ host: 'localhost', port: 4000, path: p, method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) } }, resp => { let x = ''; resp.on('data', c => x += c); resp.on('end', () => res({ s: resp.statusCode, b: x })); }); r.on('error', rej); if (d) r.write(d); r.end(); }); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const out = [];
  try {
    const L = await req('/api/auth/login', 'POST', { email: 'admin@qms.io', password: 'Admin123!' });
    const token = JSON.parse(L.b).token;
    const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const p = await b.newPage();
    p.on('pageerror', e => out.push('PAGEERR: ' + e.message));
    await p.goto('http://localhost:4000/', { waitUntil: 'networkidle2' });
    await p.evaluate(t => localStorage.setItem('qms_token', t), token);
    await p.reload({ waitUntil: 'networkidle2' });
    await p.waitForSelector('.app-shell');
    // 1. tab title on /risks
    await p.goto('http://localhost:4000/risks', { waitUntil: 'networkidle2' }); await sleep(600);
    out.push('title /risks = ' + await p.title());
    // 2. 404 page
    await p.goto('http://localhost:4000/nope-not-real', { waitUntil: 'networkidle2' }); await sleep(600);
    const nf = await p.evaluate(() => document.body.innerText.includes('404') && document.body.innerText.includes('Back to dashboard'));
    out.push('404 page shows 404 + back button: ' + nf);
    // click back to dashboard
    await p.evaluate(() => { const x = Array.from(document.querySelectorAll('button')).find(y => /back to dashboard/i.test(y.textContent)); if (x) x.click(); });
    await sleep(900);
    out.push('after 404 back-click url: ' + p.url());
    // 3. "/" shortcut focuses search
    await p.goto('http://localhost:4000/policies', { waitUntil: 'networkidle2' }); await sleep(500);
    await p.keyboard.press('/');
    await sleep(300);
    const focused = await p.evaluate(() => { const a = document.activeElement; return a && a.placeholder ? a.placeholder.slice(0, 20) : 'NOT-FOCUSED'; });
    out.push('slash focuses search input: ' + focused);
    // 4. back-to-top appears after scroll
    await p.evaluate(() => window.scrollTo(0, 2000));
    await sleep(600);
    const bt = await p.evaluate(() => !!document.querySelector('.back-top'));
    out.push('back-top visible after scroll: ' + bt);
    if (bt) { await p.evaluate(() => document.querySelector('.back-top').click()); await sleep(900); out.push('scrollY after back-top click: ' + await p.evaluate(() => Math.round(window.scrollY))); }
    // 5. print CSS present
    const printCss = await p.evaluate(() => Array.from(document.styleSheets).some(s => { try { return Array.from(s.cssRules).some(r => r.type === 7); } catch { return false; } }));
    out.push('print stylesheet block present: ' + printCss);
    // 6. dark toggle smoke: click moon, check data-theme
    await p.evaluate(() => { const b2 = document.querySelector('.topbar .icon-btn[title*="dark mode" i], .topbar .icon-btn[title*="mode" i]'); if (b2) b2.click(); });
    await sleep(400);
    out.push('data-theme after toggle: ' + await p.evaluate(() => document.documentElement.dataset.theme));
    await b.close();
  } catch (e) { out.push('HARNESS FAIL: ' + e.message); }
  console.log(out.join('\n'));
})();