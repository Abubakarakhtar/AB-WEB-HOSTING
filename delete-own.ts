// POST /api/delete-own — delete a site and all its files (verified by updateKey).
import { Ctx, SiteMeta, json, slugify, verifyUpdateKey, deleteR2Prefix } from "../_shared";

export async function onRequestPost(context: Ctx): Promise<Response> {
  const { request, env } = context;
  try {
    const body = (await request.json().catch(() => null)) as {
      slug?: unknown;
      updateKey?: unknown;
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

    await deleteR2Prefix(env, `${slug}/`);
    await env.SITES_KV.delete(`site:${slug}`);

    return json({ ok: true, message: "Site deleted." });
  } catch {
    return json({ ok: false, error: "Delete failed." }, 500);
  }
}
