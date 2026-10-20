// POST /api/update-code — replace the HTML of an existing site (verified by updateKey).
import {
  Ctx,
  SiteMeta,
  json,
  slugify,
  newDeployId,
  verifyUpdateKey,
  siteUrl,
} from "../_shared";

export async function onRequestPost(context: Ctx): Promise<Response> {
  const { request, env } = context;
  try {
    const body = (await request.json().catch(() => null)) as {
      slug?: unknown;
      updateKey?: unknown;
      html?: unknown;
    } | null;
    if (!body) return json({ ok: false, error: "Invalid JSON body." }, 400);

    const slug = slugify(String(body.slug || ""));
    const updateKey = String(body.updateKey || "");
    const html = String(body.html || "");
    if (!html) return json({ ok: false, error: "HTML content is required." }, 400);
    const bytes = new TextEncoder().encode(html);
    if (bytes.length > 2 * 1024 * 1024) {
      return json({ ok: false, error: "HTML exceeds the 2MB limit." }, 400);
    }

    const raw = await env.SITES_KV.get(`site:${slug}`);
    if (!raw) return json({ ok: false, error: "Site not found." }, 404);
    const meta = JSON.parse(raw) as SiteMeta;

    if (!(await verifyUpdateKey(updateKey, meta.updateKeyHash))) {
      return json({ ok: false, error: "Invalid update key." }, 401);
    }

    await env.SITES_R2.put(`${slug}/index.html`, bytes, {
      httpMetadata: { contentType: "text/html; charset=utf-8" },
    });

    // Keep password and settings untouched; refresh file list.
    meta.files = [{ path: "index.html", size: bytes.length, type: "text/html" }];
    meta.updatedAt = new Date().toISOString();
    await env.SITES_KV.put(`site:${slug}`, JSON.stringify(meta));

    const url = siteUrl(request, slug);
    return json({ ok: true, url, deployId: newDeployId(), site: { slug, url } });
  } catch {
    return json({ ok: false, error: "Update failed." }, 500);
  }
}
