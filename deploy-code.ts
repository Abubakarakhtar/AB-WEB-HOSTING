// POST /api/deploy-code — deploy a single-HTML site.
import {
  Ctx,
  SiteMeta,
  json,
  slugify,
  sha256hex,
  randomKey,
  newDeployId,
  checkRateLimit,
  siteUrl,
} from "../_shared";

export async function onRequestPost(context: Ctx): Promise<Response> {
  const { request, env } = context;
  try {
    const body = (await request.json().catch(() => null)) as {
      slug?: unknown;
      title?: unknown;
      html?: unknown;
      sitePassword?: unknown;
      custom404?: unknown;
      launchDate?: unknown;
      construction?: unknown;
      watermark?: unknown;
    } | null;
    if (!body) return json({ ok: false, error: "Invalid JSON body." }, 400);

    const slug = slugify(String(body.slug || ""));
    if (slug.length < 3) {
      return json({ ok: false, error: "Slug must be at least 3 characters." }, 400);
    }
    if (slug === "api") {
      return json({ ok: false, error: "This slug is reserved." }, 400);
    }

    const html = String(body.html || "");
    if (!html) return json({ ok: false, error: "HTML content is required." }, 400);
    const bytes = new TextEncoder().encode(html);
    if (bytes.length > 2 * 1024 * 1024) {
      return json({ ok: false, error: "HTML exceeds the 2MB limit." }, 400);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (!(await checkRateLimit(env, ip))) {
      return json({ ok: false, error: "Rate limit exceeded. Max 10 deploys per hour." }, 429);
    }

    if (await env.SITES_KV.get(`site:${slug}`)) {
      return json({ ok: false, error: "This slug is already taken." }, 409);
    }

    const updateKey = randomKey();
    const updateKeyHash = await sha256hex(updateKey);
    const sitePassword = String(body.sitePassword || "");
    const sitePasswordHash = sitePassword ? await sha256hex(sitePassword) : undefined;

    await env.SITES_R2.put(`${slug}/index.html`, bytes, {
      httpMetadata: { contentType: "text/html; charset=utf-8" },
    });

    const meta: SiteMeta = {
      slug,
      title: String(body.title || slug),
      createdAt: new Date().toISOString(),
      updateKeyHash,
      construction: !!body.construction,
      watermark: !!body.watermark,
      files: [{ path: "index.html", size: bytes.length, type: "text/html" }],
    };
    if (sitePasswordHash) meta.sitePasswordHash = sitePasswordHash;
    if (body.custom404) meta.custom404 = String(body.custom404);
    if (body.launchDate) meta.launchDate = String(body.launchDate);
    await env.SITES_KV.put(`site:${slug}`, JSON.stringify(meta));

    const url = siteUrl(request, slug);
    return json({
      ok: true,
      url,
      updateKey, // plaintext — returned only once, at deploy time
      deployId: newDeployId(),
      site: { slug, url },
    });
  } catch {
    return json({ ok: false, error: "Deploy failed." }, 500);
  }
}
