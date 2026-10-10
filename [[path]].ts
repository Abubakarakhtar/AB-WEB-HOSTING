// GET [[path]] — serves deployed sites: /{slug}[/{file...}]
// First path segment is the site slug; the rest is the file path (default index.html).
import { Ctx, SiteMeta, sha256hex, contentTypeFor, parseCookies, escapeHtml } from "./_shared";

const WATERMARK_BADGE =
  `<div id="ab-badge" style="position:fixed;bottom:12px;right:12px;z-index:99999;` +
  `background:rgba(10,10,16,.85);color:#fff;font:12px/1.5 system-ui,-apple-system,sans-serif;` +
  `padding:6px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.16);backdrop-filter:blur(6px)">` +
  `Hosted by <b>AB</b></div>`;

function plain(text: string, status: number): Response {
  return new Response(text, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function passwordPage(): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Protected Site</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0b10;color:#e8e8ef;font-family:system-ui,-apple-system,sans-serif;padding:20px}
.card{background:#14141c;border:1px solid #26263a;border-radius:16px;padding:40px 32px;max-width:380px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.lock{font-size:48px;margin-bottom:12px}
h1{font-size:20px;margin-bottom:8px}
p{color:#9a9ab0;font-size:14px;margin-bottom:20px}
input{width:100%;padding:12px 14px;border-radius:10px;border:1px solid #33334d;background:#0e0e15;color:#fff;font-size:15px;margin-bottom:12px;outline:none}
input:focus{border-color:#7c5cff}
button{width:100%;padding:12px;border:none;border-radius:10px;background:linear-gradient(135deg,#7c5cff,#4a9eff);color:#fff;font-size:15px;font-weight:600;cursor:pointer}
button:hover{opacity:.92}
</style>
</head>
<body>
<div class="card">
<div class="lock">🔒</div>
<h1>Protected Site</h1>
<p>Enter the password to view this site.</p>
<form method="get" action="">
<input type="password" name="pass" placeholder="Password" required autocomplete="off">
<button type="submit">Unlock</button>
</form>
</div>
</body>
</html>`;
  return new Response(html, {
    status: 401,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function constructionPage(meta: SiteMeta): Response {
  const launchMs = meta.launchDate ? Date.parse(meta.launchDate) : NaN;
  const hasLaunch = Number.isFinite(launchMs) && launchMs > 0;
  const title = escapeHtml(meta.title || meta.slug);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Under Construction</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{min-height:100vh;display:flex;align-items:center;justify-content:center;background:radial-gradient(1200px 600px at 50% -10%,#2a1e5c 0%,#0b0b10 60%);color:#e8e8ef;font-family:system-ui,-apple-system,sans-serif;padding:20px;text-align:center}
.wrap{max-width:520px}
.emoji{font-size:64px;margin-bottom:16px;animation:float 3s ease-in-out infinite}
@keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
h1{font-size:32px;margin-bottom:10px;background:linear-gradient(135deg,#a78bfa,#60a5fa);-webkit-background-clip:text;background-clip:text;color:transparent}
p{color:#9a9ab0;font-size:15px;margin-bottom:24px}
.countdown{display:flex;gap:12px;justify-content:center}
.box{background:#14141c;border:1px solid #26263a;border-radius:14px;padding:16px 0;width:88px}
.box span{font-size:28px;font-weight:700;display:block}
.box label{font-size:11px;color:#9a9ab0;text-transform:uppercase;letter-spacing:1px}
</style>
</head>
<body>
<div class="wrap">
<div class="emoji">🚧</div>
<h1>Under Construction</h1>
<p>${title} is getting ready. Check back soon!</p>
${
  hasLaunch
    ? `<div class="countdown">
<div class="box"><span id="cd-d">0</span><label>Days</label></div>
<div class="box"><span id="cd-h">0</span><label>Hours</label></div>
<div class="box"><span id="cd-m">0</span><label>Mins</label></div>
<div class="box"><span id="cd-s">0</span><label>Secs</label></div>
</div>
<script>
var target=${JSON.stringify(launchMs)};
function tick(){
  var diff=Math.max(0,target-Date.now());
  var s=Math.floor(diff/1000);
  document.getElementById('cd-d').textContent=Math.floor(s/86400);
  document.getElementById('cd-h').textContent=Math.floor(s%86400/3600);
  document.getElementById('cd-m').textContent=Math.floor(s%3600/60);
  document.getElementById('cd-s').textContent=s%60;
}
setInterval(tick,1000);tick();
</script>`
    : ""
}
</div>
</body>
</html>`;
  return new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function onRequestGet(context: Ctx): Promise<Response> {
  const { request, env, params } = context;
  const rawSegs = params.path;
  const segs: string[] = Array.isArray(rawSegs) ? rawSegs : rawSegs ? [rawSegs] : [];
  const slug = (segs[0] || "").toLowerCase();

  // Empty slug ("/"): serve the static landing page via ASSETS.
  // Functions run before static assets in Pages, so we must delegate.
  if (!slug) return env.ASSETS.fetch(request);

  const rawMeta = await env.SITES_KV.get(`site:${slug}`);
  if (!rawMeta) return plain("Site not found", 404);
  const meta = JSON.parse(rawMeta) as SiteMeta;

  // --- Password gate ---
  if (meta.sitePasswordHash) {
    const url = new URL(request.url);
    const cookieName = `sitepass_${slug}`;
    const cookies = parseCookies(request.headers.get("cookie") || "");
    let authed = cookies[cookieName] === meta.sitePasswordHash;
    if (!authed) {
      const pass = url.searchParams.get("pass");
      if (pass && (await sha256hex(pass)) === meta.sitePasswordHash) {
        url.searchParams.delete("pass");
        const headers = new Headers();
        headers.set("location", url.toString());
        headers.append(
          "set-cookie",
          `${cookieName}=${meta.sitePasswordHash}; Path=/${slug}; Max-Age=2592000; SameSite=Lax`
        );
        return new Response(null, { status: 302, headers });
      }
      return passwordPage();
    }
  }

  // --- Construction mode ---
  if (meta.construction) return constructionPage(meta);

  // --- Resolve file path ---
  let filePath = segs.slice(1).join("/");
  if (!filePath) filePath = "index.html";
  filePath = filePath.replace(/^\/+/, "");
  const pathSegs = filePath.split("/");
  if (filePath.includes("..") || pathSegs.some((s) => s.startsWith(".")) || filePath.length > 200) {
    return plain("Not found", 404);
  }

  let obj = await env.SITES_R2.get(`${slug}/${filePath}`);
  if (!obj) {
    // Directory-ish path: try {path}/index.html
    obj = await env.SITES_R2.get(`${slug}/${filePath}/index.html`);
  }
  if (!obj) {
    if (meta.custom404) return plain(meta.custom404, 404);
    return plain("Not found", 404);
  }

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  const ctype = contentTypeFor(filePath);
  headers.set("content-type", ctype);

  // --- Watermark injection for HTML ---
  if (meta.watermark && ctype.startsWith("text/html")) {
    const text = await obj.text();
    const injected = /<\/body>/i.test(text)
      ? text.replace(/<\/body>/i, WATERMARK_BADGE + "</body>")
      : text + WATERMARK_BADGE;
    headers.delete("content-length");
    headers.delete("etag");
    return new Response(injected, { headers });
  }

  return new Response(obj.body, { headers });
}
