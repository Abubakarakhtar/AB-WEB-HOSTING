# AB HOST — Cloudflare Hosting Steps
_Follow these on your phone browser. ~15 minutes total._

## What you're hosting
**AB HOST** — a static site hosting platform (like the AB FreeHost concept, rebuilt with your branding):
- Paste HTML → get a live URL
- Upload a project folder → get a live URL
- Update Key for editing/deleting sites later
- Passcode protection, construction mode, QR codes, share buttons

## What Cloudflare needs
1. **Pages project** (the site + Functions backend)
2. **KV namespace** `SITES_KV` (site metadata)
3. **R2 bucket** `SITES_R2` (hosted file contents)

---

## Step 1 — Create KV namespace (2 min)
1. Open **dash.cloudflare.com** → left menu → **Workers & Pages** → **KV**
2. Tap **Create a namespace**
3. Name: `SITES_KV` → **Add**

## Step 2 — Create R2 bucket (2 min)
1. Left menu → **R2** → **Create bucket**
2. Name: `SITES_R2` → **Create bucket**
3. (If R2 asks to enable — it's pay-as-you-go, free tier is generous)

## Step 3 — Create Pages project (5 min)
1. Left menu → **Workers & Pages** → **Create** → **Pages** → **Upload assets**
2. Project name: `ab-host` (your URL will be `ab-host.pages.dev`)
3. Upload the `ab-host.zip` file (attached) — or drag the unzipped folder
4. **Deploy site**

## Step 4 — Bind KV + R2 to the project (3 min)
1. Open the `ab-host` project → **Settings** → **Functions**
2. **KV namespace bindings** → **Add binding**
   - Variable name: `SITES_KV`
   - KV namespace: select `SITES_KV`
3. **R2 bucket bindings** → **Add binding**
   - Variable name: `SITES_R2`
   - R2 bucket: select `SITES_R2`
4. **Save** — this triggers a redeploy automatically

## Step 5 — Test it (2 min)
1. Open `https://ab-host.pages.dev`
2. Paste any HTML → pick a slug like `test123` → **Deploy Code**
3. You should get a live URL: `https://ab-host.pages.dev/test123`
4. Open it — your site is live ✅
5. **Save the Update Key** shown — you need it to edit/delete later

## Step 6 — Custom domain (optional)
1. Project → **Custom domains** → **Set up a custom domain**
2. Enter your domain (e.g. `host.elevatexbyzaid.com`)
3. Cloudflare adds DNS automatically → wait ~2 min → live

---

## How it works (for reference)
| Part | Where |
|---|---|
| Frontend | `index.html` (premium dark UI) |
| API | `functions/api/*.ts` (6 endpoints) |
| Site server | `functions/[[path]].ts` (serves `/{slug}` sites) |
| Metadata | KV `site:{slug}` |
| Files | R2 `{slug}/{path}` |

**Endpoints:**
- `POST /api/check-slug` — slug availability
- `POST /api/deploy-code` — deploy single HTML
- `POST /api/deploy-files` — deploy folder (base64)
- `POST /api/update-code` — update with key
- `POST /api/update-files` — update with key
- `POST /api/delete-own` — delete with key

**Safety built in:** risky extensions blocked (.exe/.php/.apk…), update keys hashed, 10 deploys/hour/IP rate limit, path traversal blocked.

## Troubleshooting
- **"Site not found" on a deployed slug** → check KV/R2 bindings are added (Step 4), then redeploy
- **Upload fails** → file over 20MB, or more than 100 files, or missing index.html
- **Functions not running** → make sure the zip included the `functions/` folder at root
