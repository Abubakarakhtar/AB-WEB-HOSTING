// POST /api/check-slug — check whether a site slug is available.
import { Ctx, json, slugify } from "../_shared";

export async function onRequestPost(context: Ctx): Promise<Response> {
  try {
    const body = (await context.request.json().catch(() => null)) as { slug?: unknown } | null;
    const slug = slugify(String(body?.slug || ""));
    if (slug.length < 3) {
      return json({ ok: false, error: "Slug must be at least 3 characters." }, 400);
    }
    if (slug === "api") {
      return json({ ok: false, error: "This slug is reserved." }, 400);
    }
    const existing = await context.env.SITES_KV.get(`site:${slug}`);
    return json({ ok: true, available: !existing, slug });
  } catch {
    return json({ ok: false, error: "Invalid request." }, 400);
  }
}
