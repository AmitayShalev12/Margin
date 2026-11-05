import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { AnnotationGenerator } from '../ai/annotation-generator';
import { DataStore } from '../data/data-store';
import { GoogleDriveAuth } from '../drive/google-auth';
import { LocalRepository } from '../data/local-repository';
import { Repository } from '../data/repository';
import { SupabaseService } from '../supabase/supabase';
import { Assistant } from './assistant';

/**
 * The conversation: ask, answer, act, report.
 *
 * The function call is faked at `fetch`, so everything from the request body
 * to the outcome on screen is the real code. Two promises are checked as well
 * as the happy path: what leaves the browser carries no email address, and an
 * action that cannot be undone waits for her.
 */

class FakeSupabase {
  isConfigured = true;
  teacherId = 'teacher-1';
  functionsUrl = 'https://project.supabase.co/functions/v1';
  client = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) },
  };
}

let sent: { url: string; body: { messages: { role: string; text: string }[]; context: unknown } }[];
let reply: { status: number; json: unknown };

function setup() {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      { provide: SupabaseService, useValue: new FakeSupabase() },
      { provide: Repository, useClass: LocalRepository },
      {
        provide: Router,
        useValue: { url: '/home', navigateByUrl: async () => true, navigate: async () => true },
      },
      { provide: AnnotationGenerator, useValue: { generate: async () => null, state: () => ({}) } },
      {
        provide: GoogleDriveAuth,
        useValue: { connection: () => 'connected', refreshStatus: async () => 'connected' },
      },
    ],
  });
  const store = TestBed.inject(DataStore);
  const course = store.createCourse('שיטות מחקר', 'תשפ״ז')!;
  return { store, course, assistant: TestBed.inject(Assistant) };
}

beforeEach(() => {
  localStorage.clear();
  sent = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.json,
      text: async () => JSON.stringify(reply.json),
    } as unknown as Response;
  });
});

afterEach(() => vi.unstubAllGlobals());

describe('asking the assistant', () => {
  it('sends her message with the conversation, and runs what comes back', async () => {
    const { store, course, assistant } = setup();
    reply = {
      status: 200,
      json: {
        reply: 'מוסיפה את נועה לקורס',
        actions: [
          { name: 'add_student', args: { full_name: 'נועה כהן', course_ids: [course.id] } },
        ],
      },
    };

    await assistant.send('תוסיפי את נועה כהן לשיטות מחקר');

    expect(sent[0].url).toContain('/assistant');
    expect(sent[0].body.messages.at(-1)).toEqual({
      role: 'user',
      text: 'תוסיפי את נועה כהן לשיטות מחקר',
    });

    const answer = assistant.messages().at(-1)!;
    expect(answer.text).toBe('מוסיפה את נועה לקורס');
    expect(answer.steps[0].outcome.status).toBe('done');
    expect(store.students().map((s) => s.full_name)).toEqual(['נועה כהן']);
  });

  /** Names and ids go to the model; addresses never do. */
  it('sends names and ids, and no email address', async () => {
    const { store, assistant } = setup();
    store.addStudent('נועה כהן', 'noa.private@gmail.com');
    reply = { status: 200, json: { reply: 'יש לך תלמידה אחת', actions: [] } };

    await assistant.send('מי ברשימה?');

    const body = JSON.stringify(sent[0].body);
    expect(body).toContain('נועה כהן');
    expect(body).not.toContain('noa.private@gmail.com');
    expect(body).not.toContain('@');
  });

  it('answers a question with no actions', async () => {
    const { assistant } = setup();
    reply = { status: 200, json: { reply: 'אין כרגע הערות שממתינות לך', actions: [] } };

    await assistant.send('מה מחכה לי?');

    expect(assistant.messages().at(-1)!.steps).toEqual([]);
    expect(assistant.busy()).toBe(false);
  });
});

describe('an action that cannot be undone', () => {
  function proposeDelete(studentId: string) {
    reply = {
      status: 200,
      json: {
        reply: 'למחוק את נועה?',
        actions: [{ name: 'delete_student', args: { student_id: studentId } }],
      },
    };
  }

  it('waits for her, and deletes nothing until she confirms', async () => {
    const { store, assistant } = setup();
    const noa = store.addStudent('נועה כהן')!;
    proposeDelete(noa.id);

    await assistant.send('תמחקי את נועה');

    const answer = assistant.messages().at(-1)!;
    expect(answer.steps[0].outcome.status).toBe('confirm');
    expect(store.students()).toHaveLength(1);

    await assistant.confirm(answer.id, answer.steps[0].id);

    expect(assistant.messages().at(-1)!.steps[0].outcome.status).toBe('done');
    expect(store.students()).toEqual([]);
  });

  it('does nothing when she declines', async () => {
    const { store, assistant } = setup();
    const noa = store.addStudent('נועה כהן')!;
    proposeDelete(noa.id);

    await assistant.send('תמחקי את נועה');
    const answer = assistant.messages().at(-1)!;
    assistant.decline(answer.id, answer.steps[0].id);

    expect(assistant.messages().at(-1)!.steps[0].outcome.status).toBe('cancelled');
    expect(store.students()).toHaveLength(1);
  });
});

describe('when there is no answer', () => {
  it('says why, in the words the rest of the app uses', async () => {
    const { assistant } = setup();
    reply = { status: 429, json: { error: 'credits_exhausted', key_source: 'teacher' } };

    await assistant.send('שלום');

    const answer = assistant.messages().at(-1)!;
    expect(answer.failed).toBe(true);
    expect(answer.text).toContain('קרדיטים');
    expect(assistant.busy()).toBe(false);
  });

  it('says the function is not on the server yet, when it is not', async () => {
    const { assistant } = setup();
    reply = { status: 404, json: { message: 'Requested function was not found' } };

    await assistant.send('שלום');

    expect(assistant.messages().at(-1)!.text).toContain('לא הועלתה לשרת');
  });

  /** A failed turn is not sent back to the model as if it had said it. */
  it('leaves a failed answer out of the next request', async () => {
    const { assistant } = setup();
    reply = { status: 429, json: { error: 'credits_exhausted' } };
    await assistant.send('ראשונה');

    reply = { status: 200, json: { reply: 'בסדר', actions: [] } };
    await assistant.send('שנייה');

    expect(sent[1].body.messages.map((m) => m.role)).toEqual(['user', 'user']);
  });

  describe('attached files', () => {
    const SECRET = 'התוכן הסודי של העבודה';
    const file = () => new File([SECRET], 'עבודה של נועה.txt');

    /** Her students' work stays in the browser. The model gets the name only. */
    it('sends the name of a file and never what is in it', async () => {
      const { assistant } = setup();
      reply = { status: 200, json: { reply: 'בסדר', actions: [] } };

      await assistant.send('תוסיפי לחומרים', [file()]);

      const body = JSON.stringify(sent[0].body);
      expect(body).toContain('עבודה של נועה.txt');
      expect(body).not.toContain(SECRET);
    });

    it('remembers a file for the rest of the conversation', async () => {
      const { assistant } = setup();
      reply = { status: 200, json: { reply: 'בסדר', actions: [] } };
      await assistant.send('הנה קובץ', [file()]);

      reply = {
        status: 200,
        json: {
          reply: 'מוסיפה',
          actions: [{ name: 'add_material_from_file', args: { file_name: 'עבודה של נועה.txt' } }],
        },
      };
      await assistant.send('תוסיפי אותו לחומרים');

      expect(assistant.messages().at(-1)!.steps[0].outcome.status).toBe('done');
      expect(
        (sent[1].body.context as { attached_files: string[] }).attached_files,
      ).toEqual(['עבודה של נועה.txt']);
    });

    it('forgets the files when she starts a new conversation', async () => {
      const { assistant } = setup();
      reply = { status: 200, json: { reply: 'בסדר', actions: [] } };
      await assistant.send('הנה קובץ', [file()]);

      assistant.clear();

      expect(assistant.attachedNames()).toEqual([]);
    });

    it('can send a file with no words', async () => {
      const { assistant } = setup();
      reply = { status: 200, json: { reply: 'מה לעשות איתו?', actions: [] } };

      await assistant.send('   ', [file()]);

      expect(sent).toHaveLength(1);
      expect(assistant.messages()[0].files).toEqual(['עבודה של נועה.txt']);
    });
  });
});
