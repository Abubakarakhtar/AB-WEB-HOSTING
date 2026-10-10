// POST /api/update-files — replace all files of an existing site (verified by updateKey).
import {
  Ctx,
  SiteMeta,
  json,
  slugify,
  newDeployId,
  verifyUpdateKey,
  validateUploadFiles,
  deleteR2Prefix,
  siteUrl,
} from "../_shared";

export async function onRequestPost(context: Ctx): Promise<Response> {
  const { request, env } = context;
  try {
    const body = (await request.json().catch(() => null)) as {
      slug?: unknown;
      updateKey?: unknown;
      files?: unknown;
    } | null;
    if (!body) return json({ ok: false, error: "Invalid JSON body." }, 400);

    const slug = slugify(String(body.slug || ""));
    const updateKey = String(body.updateKey || "");

    const raw = await env.SITES_KV.get(`site:${slug}`);
    if (!raw) return json({ ok: false, error: "Site not found." }, 404);
    const meta = JSON.parse(raw) as SiteMeta;

    if (!(await verifyUpdateKey(updateKey, meta.updateKeyHash))) {
      return json({ ok: false, error: "Invalid update key." }, 401);
    }

    const validated = validateUploadFiles(body.files);
    if (!validated.ok) return json({ ok: false, error: validated.error }, 400);

    // Remove old files first so deleted files don't linger.
    await deleteR2Prefix(env, `${slug}/`);

    for (const f of validated.files) {
      await env.SITES_R2.put(`${slug}/${f.path}`, f.bytes, {
        httpMetadata: { contentType: f.type },
      });
    }

    // Keep password and settings untouched; refresh file list.
    meta.files = validated.files.map((f) => ({ path: f.path, size: f.bytes.length, type: f.type }));
    meta.updatedAt = new Date().toISOString();
    await env.SITES_KV.put(`site:${slug}`, JSON.stringify(meta));

    const url = siteUrl(request, slug);
    return json({ ok: true, url, deployId: newDeployId(), site: { slug, url } });
  } catch {
    return json({ ok: false, error: "Update failed." }, 500);
  }
}
