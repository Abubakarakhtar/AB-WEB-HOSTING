// POST /api/deploy-files — deploy a multi-file static site.
import {
  Ctx,
  SiteMeta,
  json,
  slugify,
  sha256hex,
  randomKey,
  newDeployId,
  checkRateLimit,
  validateUploadFiles,
  siteUrl,
} from "../_shared";

export async function onRequestPost(context: Ctx): Promise<Response> {
  const { request, env } = context;
  try {
    const body = (await request.json().catch(() => null)) as {
      slug?: unknown;
      title?: unknown;
      sitePassword?: unknown;
      custom404?: unknown;
      launchDate?: unknown;
      construction?: unknown;
      watermark?: unknown;
      files?: unknown;
    } | null;
    if (!body) return json({ ok: false, error: "Invalid JSON body." }, 400);

    const slug = slugify(String(body.slug || ""));
    if (slug.length < 3) {
      return json({ ok: false, error: "Slug must be at least 3 characters." }, 400);
    }
    if (slug === "api") {
      return json({ ok: false, error: "This slug is reserved." }, 400);
    }

    const validated = validateUploadFiles(body.files);
    if (!validated.ok) return json({ ok: false, error: validated.error }, 400);

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

    for (const f of validated.files) {
      await env.SITES_R2.put(`${slug}/${f.path}`, f.bytes, {
        httpMetadata: { contentType: f.type },
      });
    }

    const meta: SiteMeta = {
      slug,
      title: String(body.title || slug),
      createdAt: new Date().toISOString(),
      updateKeyHash,
      construction: !!body.construction,
      watermark: !!body.watermark,
      files: validated.files.map((f) => ({ path: f.path, size: f.bytes.length, type: f.type })),
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
