import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { EmailGenerator, standsBehind } from '../../core/communication/email-generator';
import { DataStore } from '../../core/data/data-store';
import { CommentPoster } from '../../core/drive/comment-poster';
import { GoogleDriveAuth } from '../../core/drive/google-auth';
import { UUID } from '../../core/models';
import { PageHeader } from '../../shared/ui/page-header/page-header';
import { BidiText } from '../../shared/ui/bidi-text/bidi-text';

/**
 * The message that goes back to the student.
 *
 * The end of the review, not a feature beside it: the review screen's one
 * primary action arrives here with the submission already chosen, the comments
 * she stood behind already gathered, and three drafts to pick between.
 *
 * Margin does not send it. It has no mail account, and giving it one would mean
 * her students receiving school mail from an address that isn't hers. The
 * message is handed to her own mail client with everything filled in, and it is
 * marked sent when she says it went — never because a button was pressed. The
 * previous version of this flow marked a review "sent" on a click and delivered
 * nothing, and a teacher had no way to tell the difference.
 */
/**
 * The message as her mail client wants it.
 *
 * Pulled out and exported so it can be asserted on directly: jsdom refuses to
 * navigate, and the encoding is the part that actually breaks — an unescaped
 * newline or ampersand truncates the body silently, which would send half a
 * review and look like a whole one.
 */
export function mailtoUrl(to: string, subject: string, body: string): string {
  return (
    `mailto:${encodeURIComponent(to.trim())}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`
  );
}

@Component({
  selector: 'app-communication',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [PageHeader, RouterLink, BidiText],
  templateUrl: './communication.html',
  styleUrl: './communication.scss',
})
export class Communication {
  private readonly data = inject(DataStore);
  protected readonly generator = inject(EmailGenerator);
  protected readonly poster = inject(CommentPoster);
  protected readonly auth = inject(GoogleDriveAuth);

  /** Set when the review screen sent her here; otherwise she picks. */
  readonly submissionId = input<string>('');

  private readonly picked = signal<UUID | null>(null);

  /** Null while she is not editing that field — the record is the source. */
  private readonly subjectDraft = signal<string | null>(null);
  private readonly bodyDraft = signal<string | null>(null);
  private readonly addressDraft = signal<string | null>(null);

  /** True once her mail client has been handed the message. */
  protected readonly handedOver = signal(false);
  protected readonly copied = signal(false);

  protected readonly submissions = computed(() =>
    this.data.submissions().map((s) => ({
      id: s.id,
      name: this.data.studentName(s.student_id),
      ready: standsBehind(this.data.annotations(), s.id, this.data.roundFor(s.id)?.id ?? null)
        .length,
      sent: this.data.studentEmail(s.id)?.status === 'sent',
    })),
  );

  protected readonly submission = computed(() => {
    const id = this.picked() ?? this.submissionId();
    return (
      this.data.submission(id) ??
      // Whichever has review work waiting to be sent, else simply the first.
      this.data.submission(this.submissions().find((s) => s.ready && !s.sent)?.id) ??
      this.data.submissions()[0]
    );
  });

  protected readonly student = computed(() =>
    this.data.studentName(this.submission()?.student_id ?? ''),
  );

  protected readonly firstName = computed(() => this.student().split(' ')[0]);

  protected readonly comments = computed(() => {
    const submission = this.submission();
    if (!submission) return [];
    return standsBehind(
      this.data.annotations(),
      submission.id,
      this.data.roundFor(submission.id)?.id ?? null,
    );
  });

  protected readonly email = computed(() => {
    const submission = this.submission();
    return submission ? (this.data.studentEmail(submission.id) ?? null) : null;
  });

  protected readonly isSent = computed(() => this.email()?.status === 'sent');

  /**
   * She decided this round needs no covering message.
   *
   * A state of its own, because "no message" and "not written yet" look
   * identical on an empty screen and mean opposite things — one is finished,
   * the other is waiting for her.
   */
  protected readonly isSkipped = computed(() => this.email()?.status === 'skipped');

  protected skip() {
    // The submission actually on screen, which is not the same as the routed
    // id once she has picked another from the list.
    const id = this.submission()?.id;
    if (id) this.data.skipStudentEmail(id);
  }

  protected unskip() {
    const id = this.submission()?.id;
    if (id) this.data.unskipStudentEmail(id);
  }

  protected readonly subject = computed(() => this.subjectDraft() ?? this.email()?.subject ?? '');
  protected readonly body = computed(() => this.bodyDraft() ?? this.email()?.body ?? '');

  /** The chips: which of the three she is looking at. */
  protected readonly variants = computed(() =>
    (this.email()?.variants ?? []).map((v) => ({
      key: v.key,
      label: v.label,
      active: v.key === this.email()?.selected_variant_key,
    })),
  );

  protected readonly address = computed(() => {
    const submission = this.submission();
    const stored = this.data.students().find((s) => s.id === submission?.student_id)?.email ?? '';
    return this.addressDraft() ?? stored;
  });

  protected readonly subtitle = computed(() => {
    if (!this.submission()) return 'אין עדיין עבודות.';
    if (this.isSent()) return `המייל ל${this.firstName()} סומן כנשלח.`;
    const ready = this.comments().length;
    if (!ready) {
      return `עוד לא אישרת אף הערה בעבודה של ${this.firstName()}, ואין על מה לכתוב.`;
    }
    return `${ready === 1 ? 'הערה אחת' : `${ready} הערות`} שאישרת — שלוש אפשרויות ניסוח, ואת בוחרת ועורכת.`;
  });

  /** What she is being told the button will do, in as many words. */
  protected readonly canSend = computed(() => !!this.body().trim() && !!this.address().trim());

  // -- the comments on the document -----------------------------------------

  /** Whether this submission came from Drive at all. */
  protected readonly hasDocument = computed(() => !!this.submission()?.drive_file_id);

  /** Comments a send would carry, i.e. approved and not yet on the document. */
  protected readonly toPost = computed(() => {
    const submission = this.submission();
    return submission ? this.poster.waiting(submission.id).length : 0;
  });

  /**
   * Comments from *this round* that are on the document.
   *
   * The round, matching `toPost` and the email's own list. Counting the whole
   * submission put an older round's posted comments into the same sentence as
   * this round's outstanding ones — so the panel read "19 are on the document"
   * directly above "12 the email was written from", two true numbers that
   * cannot both be about the same thing.
   */
  protected readonly postedCount = computed(() => {
    const submission = this.submission();
    const roundId = submission ? this.data.roundFor(submission.id)?.id : null;
    if (!roundId) return 0;

    return this.data
      .annotations()
      .filter(
        (a) =>
          a.round_id === roundId &&
          (a.status === 'accepted' || a.status === 'edited') &&
          !!a.posted_comment_id,
      ).length;
  });

  /**
   * The line above the button. It says how many, and — after a send that
   * couldn't place everything — it does not round up.
   */
  protected readonly postLabel = computed(() => {
    const waiting = this.toPost();
    const done = this.postedCount();

    if (!waiting && done) {
      return done === 1 ? 'ההערה שאישרת נמצאת במסמך.' : `${done} ההערות שאישרת נמצאות במסמך.`;
    }
    if (!waiting) return 'אין הערות מאושרות להוסיף למסמך.';
    if (done) {
      return waiting === 1
        ? `הערה אחת חדשה להוסיף למסמך (${done} כבר שם).`
        : `${waiting} הערות חדשות להוסיף למסמך (${done} כבר שם).`;
    }
    return waiting === 1 ? 'הערה אחת להוסיף למסמך.' : `${waiting} הערות להוסיף למסמך.`;
  });

  /**
   * What actually reached the student, said after she marks the email sent.
   *
   * Two deliveries, not one: the message, and the comments on the document.
   * Confirming the message flips the submission to "notes sent" on its own, so
   * without this the screen reports a review as delivered while every comment
   * is still sitting here — which is the same fiction the review screen's send
   * button used to tell, one step further along.
   */
  protected readonly deliveryNote = computed(() => {
    if (!this.hasDocument()) return null;

    const waiting = this.toPost();
    const done = this.postedCount();

    if (waiting) {
      return waiting === 1
        ? 'הערה אחת עדיין לא נוספה למסמך שלה.'
        : `${waiting} הערות עדיין לא נוספו למסמך שלה.`;
    }
    if (done) {
      return done === 1 ? 'ההערה נמצאת גם במסמך שלה.' : `${done} ההערות נמצאות גם במסמך שלה.`;
    }
    return null;
  });

  /** True when something she approved never reached the document. */
  protected readonly deliveryIncomplete = computed(() => this.hasDocument() && this.toPost() > 0);

  /** The outcome panel after a send: posted, already there, and what wasn't. */
  protected readonly postOutcome = computed(() => {
    const report = this.poster.report();
    if (!report) return null;

    const posted =
      report.posted === 0
        ? 'לא נוספה אף הערה חדשה'
        : report.posted === 1
          ? 'נוספה הערה אחת למסמך'
          : `נוספו ${report.posted} הערות למסמך`;

    return {
      posted,
      /**
       * Where the comments landed, said plainly.
       *
       * The difference is the whole value of the feature to the student: an
       * anchored comment sits beside the sentence it is about, an unanchored
       * one is a list in a side panel she has to match up herself. Both are
       * successful sends, so this is stated rather than warned about — but not
       * left for her to work out from the document.
       */
      markers:
        report.markers === 0
          ? null
          : report.markers === 1
            ? 'סימון אחד נוסף לטקסט, ומספרו מופיע בהערה.'
            : `${report.markers} סימונים נוספו לטקסט, ומספריהם מופיעים בהערות.`,
      unmarked:
        report.unmarked === 0
          ? null
          : `${report.unmarked} הערות נשלחו בלי סימון, כי לא מצאתי את המשפט שהן מצטטות.`,
      placement: report.anchored
        ? 'ההערות מוצמדות למשפטים עצמם במסמך.'
        : // Observed on a real document, not inferred: Google Docs has no
          // file-level comment, so a comment it cannot anchor is shown under
          // the heading "התוכן המקורי נמחק". The text is intact and the
          // student can read every word — but the label says something false
          // about her writing, and she has to be warned before it goes out.
          'ההערות נוספו לפאנל ההערות, אבל גוגל דוקס מציגה כל אחת מהן עם הכותרת ״התוכן המקורי נמחק״ — כאילו נמחק משהו מהעבודה. שום דבר לא נמחק, אבל התלמידה תראה את המשפט הזה.',
      failed: report.failed,
      unplaced: report.unplaced,
      // Named rather than counted: she has to find these by hand, and a
      // number alone would not tell her which.
      unplacedLine:
        report.unplaced.length === 1
          ? 'הערה אחת לא נוספה — הטקסט שהיא מצטטת כבר לא מופיע במסמך כמו שהיה:'
          : `${report.unplaced.length} הערות לא נוספו — הטקסט שהן מצטטות כבר לא מופיע במסמך כמו שהיה:`,
    };
  });

  // -- actions --------------------------------------------------------------

  protected select(id: UUID) {
    this.picked.set(id);
    this.subjectDraft.set(null);
    this.bodyDraft.set(null);
    this.addressDraft.set(null);
    this.handedOver.set(false);
    this.copied.set(false);
    // Another student's outcome must not stay on screen under this one's name.
    this.poster.dismiss();
  }

  /** Adds her comments to the student's document. */
  protected async postComments() {
    const submission = this.submission();
    if (submission) await this.poster.post(submission.id);
  }

  /** True once anything has been marked, so removal has a reason to appear. */
  protected readonly hasMarkers = computed(() => {
    const submission = this.submission();
    const roundId = submission ? this.data.roundFor(submission.id)?.id : null;
    if (!roundId) return false;
    return this.data.annotations().some((a) => a.round_id === roundId && a.marker_number !== null);
  });

  /**
   * Takes the numbers back out of the document.
   *
   * Offered plainly rather than buried: Margin put characters into a student's
   * paper, and the teacher has to be able to undo that without asking anyone.
   */
  protected async clearMarkers() {
    const submission = this.submission();
    if (submission) await this.poster.removeMarkers(submission.id);
  }

  /** Sends her back to Google to grant the commenting permission. */
  protected async reconnect() {
    await this.auth.connect();
  }

  protected async draft() {
    const submission = this.submission();
    if (!submission) return;
    await this.generator.generate(submission.id);
    this.subjectDraft.set(null);
    this.bodyDraft.set(null);
  }

  protected choose(key: string) {
    const email = this.email();
    if (!email) return;
    this.data.chooseEmailVariant(email.id, key);
    // Her edits belonged to the option she just left.
    this.subjectDraft.set(null);
    this.bodyDraft.set(null);
  }

  protected editSubject(value: string) {
    this.subjectDraft.set(value);
  }

  protected editBody(value: string) {
    this.bodyDraft.set(value);
  }

  /** Committed on blur: the rewrite is saved, and recorded as hers. */
  protected commit() {
    const email = this.email();
    if (!email) return;
    this.data.editStudentEmail(email.id, { subject: this.subject(), body: this.body() });
    this.subjectDraft.set(null);
    this.bodyDraft.set(null);
  }

  protected editAddress(value: string) {
    this.addressDraft.set(value);
  }

  protected commitAddress() {
    const submission = this.submission();
    if (!submission) return;
    this.data.setStudentEmailAddress(submission.student_id, this.address());
    this.addressDraft.set(null);
  }

  /**
   * Hands the message to her mail client.
   *
   * `mailto:` rather than a mail API on purpose — it sends from her own
   * account, needs no new Google scope, and puts the message in front of her
   * one more time before it goes. Long bodies get truncated by some clients,
   * which is exactly why "העתקה" sits beside it and is never hidden.
   */
  protected openMail() {
    this.commit();
    const email = this.email();
    if (!email) return;

    window.location.href = mailtoUrl(this.address(), this.subject(), this.body());
    this.handedOver.set(true);
  }

  protected async copy() {
    this.commit();
    try {
      await navigator.clipboard.writeText(`${this.subject()}\n\n${this.body()}`);
      this.copied.set(true);
    } catch {
      // No clipboard permission. The text is on screen and selectable, which
      // is the fallback — saying nothing is better than a false confirmation.
      this.copied.set(false);
    }
  }

  /** She says it went out. Only now is anything marked sent. */
  protected confirmSent() {
    const email = this.email();
    if (email) this.data.markStudentEmailSent(email.id);
  }
}
