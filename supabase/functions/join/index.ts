/**
 * The public sign-up form behind a join link.
 *
 * No account: the token in the link is the whole authority, and it reaches one
 * course of one teacher, only while the link is open and under its cap. The
 * browser never writes a row and never sees another student or the teacher.
 *
 * POST /join { action: 'info', token }            → { course }
 * POST /join { action: 'submit', token, fields }  → { ok: true, updated: boolean }
 *
 * Deploy with `verify_jwt = false`.
 */
import { Env, corsHeaders, db, json, readEnv } from '../_shared/google.ts';
import { JoinLinkRow, RosterRow, checkJoin, linkIsOpen, matchExisting } from '../_shared/join.ts';

interface LinkRow extends JoinLinkRow {
  id: string;
  teacher_id: string;
  course_id: string;
}

const TOKEN = /^[A-Za-z0-9_-]{20,80}$/;

async function findLink(env: Env, token: string): Promise<LinkRow | null> {
  const rows = await db<LinkRow[]>(
    env,
    `join_links?token=eq.${encodeURIComponent(token)}&select=id,teacher_id,course_id,expires_at,closed_at,submissions,max_submissions`,
  );
  return rows[0] ?? null;
}

Deno.serve(async (request: Request) => {
  let env: Env;
  try {
    env = readEnv();
  } catch (error) {
    console.error('join: environment incomplete', error);
    return json({ error: 'server_misconfigured' }, 500, {});
  }

  const headers = corsHeaders(request.headers.get('Origin'), env.allowedOrigins);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, headers);

  let body: { action?: unknown; token?: unknown; fields?: unknown };
  try {
    const text = await request.text();
    if (text.length > 8_000) return json({ error: 'too_large' }, 413, headers);
    body = JSON.parse(text);
  } catch {
    return json({ error: 'bad_request' }, 400, headers);
  }

  const token = typeof body.token === 'string' ? body.token : '';
  if (!TOKEN.test(token)) return json({ error: 'not_found' }, 404, headers);

  try {
    const link = await findLink(env, token);
    if (!link) return json({ error: 'not_found' }, 404, headers);
    if (!linkIsOpen(link)) return json({ error: 'closed' }, 410, headers);

    const courses = await db<{ name: string }[]>(
      env,
      `courses?id=eq.${link.course_id}&select=name`,
    );
    const course = courses[0]?.name;
    if (!course) return json({ error: 'not_found' }, 404, headers);

    if (body.action === 'info') return json({ course }, 200, headers);
    if (body.action !== 'submit') return json({ error: 'bad_request' }, 400, headers);

    const check = checkJoin(body.fields);
    if (!check.ok) return json({ error: 'invalid', fields: check.errors }, 422, headers);
    const { values, folderId } = check;

    // Claim a place under the cap first, so two at once cannot both slip past it.
    const claimed = await db<{ id: string }[]>(
      env,
      `join_links?id=eq.${link.id}&submissions=eq.${link.submissions}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ submissions: link.submissions + 1 }),
        prefer: 'return=representation',
      },
    );
    if (!claimed.length) return json({ error: 'busy' }, 409, headers);

    const roster = await db<RosterRow[]>(
      env,
      `students?teacher_id=eq.${link.teacher_id}&select=id,full_name,email,id_number`,
    );
    const existing = matchExisting(values, roster);
    const now = new Date().toISOString();
    const details = {
      full_name: values.full_name,
      email: values.email,
      mobile: values.mobile || null,
      phone: values.phone || null,
      id_number: values.id_number || null,
      address: values.address || null,
      drive_folder_id: folderId,
      roster_details: {
        status: null,
        pedagogic_year: values.pedagogic_year || null,
        track: values.track || null,
        department: values.department || null,
      },
      updated_at: now,
    };

    let studentId: string;
    if (existing) {
      studentId = existing;
      await db(env, `students?id=eq.${existing}&teacher_id=eq.${link.teacher_id}`, {
        method: 'PATCH',
        body: JSON.stringify(details),
      });
    } else {
      studentId = crypto.randomUUID();
      await db(env, 'students', {
        method: 'POST',
        body: JSON.stringify({
          id: studentId,
          teacher_id: link.teacher_id,
          active: true,
          created_at: now,
          ...details,
        }),
      });
    }

    await db(env, 'course_students?on_conflict=course_id,student_id', {
      method: 'POST',
      body: JSON.stringify({ course_id: link.course_id, student_id: studentId }),
      prefer: 'resolution=ignore-duplicates',
    });

    return json({ ok: true, updated: !!existing }, 200, headers);
  } catch (error) {
    console.error('join: failed', error);
    return json({ error: 'failed' }, 500, headers);
  }
});
