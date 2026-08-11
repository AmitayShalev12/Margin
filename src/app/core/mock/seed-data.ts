import {
  Annotation,
  AnnotationKind,
  AnnotationStatus,
  Assignment,
  Course,
  CourseMaterial,
  CourseRule,
  DocumentBlock,
  LearningFeedbackLog,
  Student,
  Submission,
  SubmissionRound,
  SubmissionStatus,
  TeacherStyleExample,
} from '../models';

/**
 * Demonstration data for Phase 2, shaped as real model records — same field
 * names, same status values, same anchoring — so the screens are already
 * reading the structures Phase 3 will fill from Google Drive.
 *
 * Timestamps are seeded relative to the moment the app loads, so "אתמול"
 * stays "אתמול" rather than drifting into a date from months ago.
 */

const TEACHER_ID = '00000000-0000-4000-8000-000000000001';
const COURSE_ID = 'c0000000-0000-4000-8000-000000000001';
const ASSIGNMENT_ID = 'a5000000-0000-4000-8000-000000000001';

const DAY = 86_400_000;
const bootedAt = Date.now();

function daysAgo(days: number): string {
  return new Date(bootedAt - days * DAY).toISOString();
}

// ---------------------------------------------------------------------------
// Course, assignment, students
// ---------------------------------------------------------------------------

export const COURSE: Course = {
  id: COURSE_ID,
  teacher_id: TEACHER_ID,
  name: 'שיטות מחקר כמותיות במדעי החינוך',
  year: 'תשפ״ו',
  description: 'סמינריון מחקרי, כיתות יב׳.',
  drive_folder_id: null,
  archived: false,
  created_at: daysAgo(320),
  updated_at: daysAgo(30),
};

export const ASSIGNMENT: Assignment = {
  id: ASSIGNMENT_ID,
  course_id: COURSE_ID,
  title: 'סמינריון',
  brief: 'עבודת מחקר כמותית מלאה: מבוא וסקירת ספרות, שיטה, ממצאים ודיון.',
  due_at: daysAgo(-21),
  drive_folder_id: null,
  expected_min_words: 4000,
  archived: false,
  created_at: daysAgo(150),
  updated_at: daysAgo(150),
};

interface StudentSeed {
  id: string;
  full_name: string;
  class_name: string;
}

const STUDENT_SEEDS: StudentSeed[] = [
  { id: 's1', full_name: 'נועה ברקוביץ׳', class_name: 'יב׳1' },
  { id: 's2', full_name: 'שירה אלמוג', class_name: 'יב׳1' },
  { id: 's3', full_name: 'יעל דהן', class_name: 'יב׳2' },
  { id: 's4', full_name: 'תמר קסטן', class_name: 'יב׳1' },
  { id: 's5', full_name: 'מאיה לוין', class_name: 'יב׳2' },
  { id: 's6', full_name: 'אביגיל שרעבי', class_name: 'יב׳2' },
];

export const STUDENTS: Student[] = STUDENT_SEEDS.map((s) => ({
  id: s.id,
  teacher_id: TEACHER_ID,
  full_name: s.full_name,
  email: null,
  class_name: s.class_name,
  drive_account_email: null,
  notes: null,
  active: true,
  created_at: daysAgo(320),
  updated_at: daysAgo(320),
}));

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

interface SubmissionSeed {
  id: string;
  student_id: string;
  file: string;
  status: SubmissionStatus;
  round: number;
  updatedDaysAgo: number;
}

const SUBMISSION_SEEDS: SubmissionSeed[] = [
  {
    id: 'sub-noa',
    student_id: 's1',
    file: 'Noa_Berkovich_SEL_survey_v2.docx',
    status: 'resubmitted',
    round: 2,
    updatedDaysAgo: 1,
  },
  {
    id: 'sub-shira',
    student_id: 's2',
    file: 'shira-almog-SEL-regression.docx',
    status: 'new',
    round: 1,
    updatedDaysAgo: 2,
  },
  {
    id: 'sub-yael',
    student_id: 's3',
    file: 'yael_dahan_lit_review.docx',
    status: 'in_review',
    round: 1,
    updatedDaysAgo: 4,
  },
  {
    id: 'sub-tamar',
    student_id: 's4',
    file: 'Tamar_Kastan_methods.docx',
    status: 'notes_sent',
    round: 1,
    updatedDaysAgo: 5,
  },
  {
    id: 'sub-maya',
    student_id: 's5',
    file: 'maya-levin-findings-v3.docx',
    status: 'student_revised',
    round: 2,
    updatedDaysAgo: 6,
  },
  {
    id: 'sub-avigail',
    student_id: 's6',
    file: 'avigail_sharabi_seminar.docx',
    status: 'finalized',
    round: 3,
    updatedDaysAgo: 12,
  },
];

export const SUBMISSIONS: Submission[] = SUBMISSION_SEEDS.map((s) => ({
  id: s.id,
  assignment_id: ASSIGNMENT_ID,
  student_id: s.student_id,
  status: s.status,
  current_round: s.round,
  title: null,
  drive_file_id: null,
  drive_file_name: s.file,
  drive_mime_type: 'application/vnd.google-apps.document',
  drive_web_view_link: null,
  drive_owner_email: null,
  drive_creator_email: null,
  drive_created_at: daysAgo(s.updatedDaysAgo + 14),
  drive_modified_at: daysAgo(s.updatedDaysAgo),
  drive_revision_count: null,
  drive_metadata_raw: null,
  last_synced_at: new Date(bootedAt - 4 * 60_000).toISOString(),
  word_count: 4200,
  created_at: daysAgo(s.updatedDaysAgo + 14),
  updated_at: daysAgo(s.updatedDaysAgo),
}));

// ---------------------------------------------------------------------------
// The document under review
//
// Stored the way a real submission is: plain text per block, plus the block
// structure. Nothing about the annotations is baked into the text.
// ---------------------------------------------------------------------------

interface BlockSeed {
  id: string;
  type: DocumentBlock['type'];
  level?: number;
  text: string;
}

const BLOCK_SEEDS: BlockSeed[] = [
  {
    id: 'b-title',
    type: 'heading',
    level: 1,
    text: 'למידה חברתית־רגשית וויסות עצמי בחטיבת הביניים: מחקר כמותי מתאמי',
  },
  { id: 'b-intro-h', type: 'heading', level: 2, text: 'מבוא וסקירת ספרות' },
  {
    id: 'b-intro',
    type: 'paragraph',
    text:
      'בעשור האחרון מחקרים רבים הוכיחו שתוכניות למידה חברתית־רגשית תורמות לוויסות עצמי ' +
      'בקרב מתבגרים, עם שיפור של כ־11% במדדי ויסות עצמי בהשוואה לקבוצות ביקורת. ' +
      'שאלת המחקר שלי היא האם קיים קשר בין מידת ההשתתפות בתוכנית SEL בית־ספרית לבין ' +
      'ויסות עצמי מדווח בקרב תלמידי כיתות ז׳–ט׳.',
  },
  { id: 'b-method-h', type: 'heading', level: 2, text: 'שיטת המחקר' },
  {
    id: 'b-method',
    type: 'paragraph',
    text:
      'במחקר השתתפו 214 תלמידים משתי חטיבות ביניים בעיר בינונית במרכז הארץ. ' +
      'המדגם נבחר באופן אקראי מתוך רשימות הכיתות. שאלון SEL בן 24 היגדים הועבר בשני ' +
      'מועדים, בהפרש של ארבעה חודשים, בסולם ליקרט בן חמש דרגות. מהימנות השאלון הייתה ' +
      'גבוהה. אין ספק כי העברה בשני מועדים מחזקת את יציבות המדידה.',
  },
  { id: 'b-findings-h', type: 'heading', level: 2, text: 'ממצאים ודיון' },
  {
    id: 'b-findings',
    type: 'paragraph',
    text:
      'ניתוח מתאם פירסון העלה כי הקשר בין המשתנים היה מובהק (r = .42, p < .01). ' +
      'ברגרסיה לינארית מרובה, הקשר נותר מובהק גם לאחר פיקוח על מגדר ורקע חברתי־כלכלי, ' +
      'והסביר כ־17% מהשונות בציוני הוויסות העצמי.',
  },
  {
    id: 'b-discussion',
    type: 'paragraph',
    text:
      'הממצאים עולים בקנה אחד עם הספרות, ועל פי מחקרים שנעשו בנושא בעשור האחרון מדובר ' +
      'בדפוס חוזר. ניתן להסיק כי התוכנית גורמת לשיפור ביכולת התלמידים לווסת את עצמם ' +
      'במצבי לחץ בכיתה.',
  },
];

export const DOCUMENT_BLOCKS: DocumentBlock[] = BLOCK_SEEDS.map((b, index) => ({
  id: b.id,
  index,
  type: b.type,
  text: b.text,
  ...(b.level === undefined ? {} : { level: b.level }),
}));

// ---------------------------------------------------------------------------
// Annotations
//
// Seeded by quote rather than by offset: the offsets are located in the block
// text below, which is exactly what the AI pass in Phase 4 will have to do.
// ---------------------------------------------------------------------------

interface AnnotationSeed {
  id: string;
  block_id: string;
  kind: AnnotationKind;
  quote: string;
  body: string;
  ai_body: string;
  status: AnnotationStatus;
}

const ANNOTATION_SEEDS: AnnotationSeed[] = [
  {
    id: 'an-1',
    block_id: 'b-intro',
    kind: 'structure',
    quote: 'תוכניות למידה חברתית־רגשית תורמות לוויסות עצמי',
    body: 'זו כבר המסקנה, והיא מופיעה לפני שהצגת את שאלת המחקר. קודם השאלה, אחר כך ההשערה.',
    ai_body: 'זו כבר המסקנה, והיא מופיעה לפני שהצגת את שאלת המחקר. קודם השאלה, אחר כך ההשערה.',
    status: 'accepted',
  },
  {
    id: 'an-2',
    block_id: 'b-intro',
    kind: 'praise',
    quote: 'שאלת המחקר שלי היא האם',
    body: 'שאלת מחקר ממוקדת וניתנת לבדיקה. בדיוק כך צריך להיראות משפט כזה.',
    ai_body: 'שאלת מחקר ממוקדת וניתנת לבדיקה. בדיוק כך צריך להיראות משפט כזה.',
    status: 'accepted',
  },
  {
    id: 'an-3',
    block_id: 'b-intro',
    kind: 'language',
    quote: 'מחקרים רבים הוכיחו',
    body: '״הוכיחו״ חזק מדי למחקר מתאמי. עדיף ״מצאו קשר בין…״.',
    ai_body: 'יש להימנע משימוש בפועל ״הוכיחו״ בהקשר של מחקר מתאמי, שכן אין בכוחו לבסס טענה סיבתית.',
    status: 'edited',
  },
  {
    id: 'an-4',
    block_id: 'b-intro',
    kind: 'sources',
    quote: 'שיפור של כ־11% במדדי ויסות עצמי',
    body: 'הנתון הזה צריך הפניה עם שנה ועמוד. מאיזו מטה־אנליזה הוא לקוח?',
    ai_body: 'הנתון הזה צריך הפניה עם שנה ועמוד. מאיזו מטה־אנליזה הוא לקוח?',
    status: 'pending',
  },
  {
    id: 'an-5',
    block_id: 'b-method',
    kind: 'content',
    quote: 'המדגם נבחר באופן אקראי',
    body:
      'האם באמת אקראי, או נוחות? אם פנית לשתי חטיבות שהסכימו — זה מדגם נוחות, ' +
      'וזה בסדר גמור כל עוד את אומרת זאת.',
    ai_body:
      'האם באמת אקראי, או נוחות? אם פנית לשתי חטיבות שהסכימו — זה מדגם נוחות, ' +
      'וזה בסדר גמור כל עוד את אומרת זאת.',
    status: 'pending',
  },
  {
    id: 'an-6',
    block_id: 'b-method',
    kind: 'structure',
    quote: 'שאלון SEL בן 24 היגדים',
    body: 'תיאור הכלי מגיע לפני תיאור המשתתפים. הסדר המקובל הוא משתתפים, כלים, הליך.',
    ai_body: 'תיאור הכלי מגיע לפני תיאור המשתתפים. הסדר המקובל הוא משתתפים, כלים, הליך.',
    status: 'resolved',
  },
  {
    id: 'an-7',
    block_id: 'b-method',
    kind: 'language',
    quote: 'אין ספק כי',
    body: 'בכתיבה מחקרית עדיף בלי ״אין ספק״. הנתונים שלך חזקים מספיק.',
    ai_body: 'בכתיבה מחקרית עדיף בלי ״אין ספק״. הנתונים שלך חזקים מספיק.',
    status: 'pending',
  },
  {
    id: 'an-8',
    block_id: 'b-method',
    kind: 'content',
    quote: 'מהימנות השאלון הייתה גבוהה',
    body: 'צריך את המספר עצמו — אלפא של קרונבך לכל תת־סולם, לא רק הערכה מילולית.',
    ai_body: 'צריך את המספר עצמו — אלפא של קרונבך לכל תת־סולם, לא רק הערכה מילולית.',
    status: 'pending',
  },
  {
    id: 'an-9',
    block_id: 'b-findings',
    kind: 'praise',
    quote: 'הקשר נותר מובהק גם לאחר פיקוח על מגדר ורקע חברתי־כלכלי',
    body: 'זה הממצא החזק ביותר בעבודה, והצגת אותו בדיוק במקום הנכון.',
    ai_body: 'זה הממצא החזק ביותר בעבודה, והצגת אותו בדיוק במקום הנכון.',
    status: 'resolved',
  },
  {
    id: 'an-10',
    block_id: 'b-findings',
    kind: 'content',
    quote: 'הקשר בין המשתנים היה מובהק',
    body: 'מובהק זה לא הכול — כמה גדול האפקט? בלי גודל אפקט קשה לדעת אם זה משמעותי בכיתה.',
    ai_body: 'מובהק זה לא הכול — כמה גדול האפקט? בלי גודל אפקט קשה לדעת אם זה משמעותי בכיתה.',
    status: 'pending',
  },
  {
    id: 'an-11',
    block_id: 'b-discussion',
    kind: 'sources',
    quote: 'על פי מחקרים שנעשו בנושא',
    body: 'אילו מחקרים? שני שמות ושנה יעשו את העבודה.',
    ai_body: 'ההסתמכות על מחקרים אינה מלווה בהפניות ביבליוגרפיות ויש להשלימן בהתאם לכללי הציטוט.',
    status: 'edited',
  },
  {
    id: 'an-12',
    block_id: 'b-discussion',
    kind: 'structure',
    quote: 'ניתן להסיק כי התוכנית גורמת',
    body: 'מתאם אינו סיבתיות — במערך שלך אי אפשר לומר ״גורמת״. נסחי כקשר, והוסיפי מגבלה בפרק הדיון.',
    ai_body:
      'מתאם אינו סיבתיות — במערך שלך אי אפשר לומר ״גורמת״. נסחי כקשר, והוסיפי מגבלה בפרק הדיון.',
    status: 'resolved',
  },
];

const NOA_ROUND_ID = 'round-noa-2';

export const NOA_ROUND: SubmissionRound = {
  id: NOA_ROUND_ID,
  submission_id: 'sub-noa',
  round_number: 2,
  document_text: DOCUMENT_BLOCKS.map((b) => b.text).join('\n\n'),
  document_blocks: DOCUMENT_BLOCKS,
  drive_revision_id: null,
  received_at: daysAgo(1),
  notes_sent_at: null,
  ai_summary: null,
  ai_summary_confirmed_at: null,
  created_at: daysAgo(1),
  updated_at: daysAgo(1),
};

/**
 * Every submission gets a round so the review screen is reachable from any
 * row. They share one demo document; only Noa's carries annotations, which is
 * what an unopened submission looks like anyway.
 */
export const ROUNDS: SubmissionRound[] = SUBMISSION_SEEDS.map((s) =>
  s.id === 'sub-noa'
    ? NOA_ROUND
    : {
        ...NOA_ROUND,
        id: `round-${s.id}`,
        submission_id: s.id,
        round_number: s.round,
        received_at: daysAgo(s.updatedDaysAgo),
        created_at: daysAgo(s.updatedDaysAgo),
        updated_at: daysAgo(s.updatedDaysAgo),
      },
);

/**
 * Turns a seed into a real `Annotation`, locating the quote in its block to
 * produce the character offsets the anchor needs.
 */
function toAnnotation(seed: AnnotationSeed, sortOrder: number): Annotation {
  const block = DOCUMENT_BLOCKS.find((b) => b.id === seed.block_id);
  if (!block) throw new Error(`Unknown block ${seed.block_id} for annotation ${seed.id}`);

  const start = block.text.indexOf(seed.quote);
  if (start === -1) {
    throw new Error(`Quote for ${seed.id} is not present in block ${seed.block_id}`);
  }

  const edited = seed.status === 'edited';

  return {
    id: seed.id,
    submission_id: 'sub-noa',
    round_id: NOA_ROUND_ID,
    anchor: {
      block_id: block.id,
      block_index: block.index,
      start,
      end: start + seed.quote.length,
      quote: seed.quote,
    },
    kind: seed.kind,
    body: seed.body,
    ai_body: seed.ai_body,
    origin: 'ai',
    edited_by_teacher: edited,
    status: seed.status,
    confidence: null,
    grading_category_id: null,
    resolved_in_round: seed.status === 'resolved' ? 2 : null,
    sort_order: sortOrder,
    created_at: daysAgo(1),
    updated_at: daysAgo(1),
  };
}

export const ANNOTATIONS: Annotation[] = ANNOTATION_SEEDS.map(toAnnotation);

// ---------------------------------------------------------------------------
// Course knowledge base
// ---------------------------------------------------------------------------

let ruleOrder = 0;
function rule(
  id: string,
  origin: CourseRule['origin'],
  kind: CourseRule['kind'],
  body: string,
  active = true,
): CourseRule {
  return {
    id,
    course_id: COURSE_ID,
    kind,
    title: body,
    body,
    origin,
    source_url: null,
    active,
    sort_order: ruleOrder++,
    created_at: daysAgo(200),
    updated_at: daysAgo(40),
  };
}

export const COURSE_RULES: CourseRule[] = [
  rule('r1', 'teacher', 'structure', 'שאלת המחקר וההשערה מנוסחות בסוף המבוא, כל אחת במשפט אחד.'),
  rule('r2', 'teacher', 'content', 'כל ממצא מדווח עם ערך המבחן, רמת מובהקות וגודל אפקט.'),
  rule('r3', 'teacher', 'content', 'מתאם אינו סיבתיות — לא לכתוב ״גורם ל…״ במערך מתאמי.'),
  rule('r4', 'teacher', 'language', 'להימנע מניסוחים מוחלטים: ״הוכיחו״, ״אין ספק״.'),
  rule('r5', 'web', 'formatting', 'כללי דיווח סטטיסטי לפי APA 7'),
  rule('r6', 'web', 'structure', 'מבנה מקובל לדוח מחקר כמותי', false),
];

/**
 * Rules the teacher never wrote down but that were inferred from how often
 * she says the same thing. Phase 4 derives this count from
 * `LearningFeedbackLog`; here it is part of the seed.
 */
export const LEARNED_RULE_NOTES: Record<string, string> = {
  r3: 'נלמד מ־7 הערות שכתבת',
};

function material(
  id: string,
  kind: CourseMaterial['kind'],
  title: string,
  notes: string | null,
  active = true,
): CourseMaterial {
  return {
    id,
    course_id: COURSE_ID,
    kind,
    title,
    notes,
    content: null,
    drive_file_id: kind === 'syllabus' ? 'drive-syllabus' : null,
    external_url: null,
    active,
    created_at: daysAgo(200),
    updated_at: daysAgo(60),
  };
}

export const COURSE_MATERIALS: CourseMaterial[] = [
  material('m1', 'syllabus', 'סילבוס — שיטות מחקר כמותיות במדעי החינוך, תשפ״ו', 'נקרא מהדרייב'),
  material(
    'm2',
    'model_assignment',
    'סמינריון של רוני מ., תשפ״ד — מסוגלות עצמית ואקלים כיתה',
    null,
  ),
  material(
    'm3',
    'model_assignment',
    'סמינריון של דנה ל., תשפ״ה — SEL והישגים לימודיים',
    'שימושית בעיקר להדגמת פרק השיטה',
  ),
  material('m4', 'example_correction', '״מובהק זה לא הכול — כמה גדול האפקט?״', 'ממצאים'),
  material('m5', 'example_correction', '״מדגם נוחות זה בסדר גמור. פשוט תכתבי שזה מה שזה.״', 'שיטה'),
];

// ---------------------------------------------------------------------------
// Style learning
// ---------------------------------------------------------------------------

export const STYLE_EXAMPLES: TeacherStyleExample[] = [
  ['past_feedback', 'קודם השאלה, אחר כך ההשערה. תמיד בסדר הזה.'],
  ['past_feedback', 'מדגם נוחות זה בסדר גמור. פשוט תכתבי שזה מה שזה.'],
  ['past_email', 'קראתי בעיון, ויש כאן בסיס טוב מאוד. כמה דברים לחדד לפני ההגשה הסופית.'],
  ['past_grading_form', 'שליטה יפה בכלים הסטטיסטיים, פחות בניסוח המסקנות.'],
  ['manual', 'מובהק זה לא הכול — כמה גדול האפקט בפועל בכיתה?'],
  ['manual', 'אני מעדיפה שאלה על פני קביעה. תני לה להגיע לזה בעצמה.'],
].map(([source, text], i) => ({
  id: `sx${i + 1}`,
  teacher_id: TEACHER_ID,
  course_id: COURSE_ID,
  source: source as TeacherStyleExample['source'],
  student_text: null,
  teacher_text: text as string,
  tags: [],
  active: true,
  created_at: daysAgo(90 - i * 8),
  updated_at: daysAgo(90 - i * 8),
}));

interface FeedbackSeed {
  ai: string;
  final: string;
  note: string;
  daysAgo: number;
}

const FEEDBACK_SEEDS: FeedbackSeed[] = [
  {
    ai: 'יש לדווח על מדדי המהימנות של הכלי בהתאם לכללי הדיווח המקובלים.',
    final: 'מה האלפא של קרונבך לכל תת־סולם? מספר אחד לכל אחד יספיק.',
    note: 'קיצרת, הפכת לשאלה',
    daysAgo: 2,
  },
  {
    ai: 'הניתוח הסטטיסטי אינו מלא ויש להשלימו.',
    final: 'מובהק זה לא הכול — כמה גדול האפקט בפועל בכיתה?',
    note: 'ריככת, הוספת הנחיה קונקרטית',
    daysAgo: 3,
  },
  {
    ai: 'ההסתמכות על מחקרים אינה מלווה בהפניות ביבליוגרפיות ויש להשלימן בהתאם לכללי הציטוט.',
    final: 'אילו מחקרים? שני שמות ושנה יעשו את העבודה.',
    note: 'קיצרת מאוד, הפכת לשאלה',
    daysAgo: 5,
  },
  {
    ai: 'יש להימנע משימוש בפועל ״הוכיחו״ בהקשר של מחקר מתאמי, שכן אין בכוחו לבסס טענה סיבתית.',
    final: '״הוכיחו״ חזק מדי למחקר מתאמי. עדיף ״מצאו קשר בין…״.',
    note: 'קיצרת, הצעת ניסוח חלופי',
    daysAgo: 7,
  },
  {
    ai: 'המבנה של פרק השיטה חורג מהסדר המקובל בספרות המתודולוגית.',
    final: 'הסדר המקובל הוא משתתפים, כלים, הליך.',
    note: 'קיצרת, ויתרת על ההסבר',
    daysAgo: 9,
  },
  {
    ai: 'ראוי לציין לחיוב את אופן הצגת הממצא.',
    final: 'זה הממצא החזק ביותר בעבודה, והצגת אותו בדיוק במקום הנכון.',
    note: 'חיממת, הסברת למה',
    daysAgo: 12,
  },
  {
    ai: 'המדגם מתואר כאקראי אך תיאור ההליך אינו תומך בכך.',
    final: 'האם באמת אקראי, או נוחות?',
    note: 'קיצרת מאוד, הפכת לשאלה',
    daysAgo: 15,
  },
  {
    ai: 'יש להוסיף התייחסות למגבלות המחקר בפרק הדיון.',
    final: 'שווה להוסיף מגבלה אחת בדיון — שזה מתאמי, ולא יותר מזה.',
    note: 'ריככת, הגבלת את ההיקף',
    daysAgo: 18,
  },
];

export const FEEDBACK_LOGS: LearningFeedbackLog[] = FEEDBACK_SEEDS.map((f, i) => ({
  id: `lf${i + 1}`,
  teacher_id: TEACHER_ID,
  course_id: COURSE_ID,
  target_type: 'annotation',
  target_id: `an-${i + 1}`,
  action: 'edited',
  ai_text: f.ai,
  final_text: f.final,
  change_note: f.note,
  context_excerpt: null,
  created_at: daysAgo(f.daysAgo),
}));

/**
 * What the system noticed about how she writes. Phase 4 derives these from
 * the feedback log; for now they are stated, so the screen can show the shape
 * of the answer.
 */
export const STYLE_TRAITS: { text: string; kind: AnnotationKind }[] = [
  { text: 'את פותחת בשאלה, לא בתיקון.', kind: 'language' },
  { text: 'את מקצרת: משפט אחד להערה, לכל היותר שניים.', kind: 'structure' },
  { text: 'את מבקשת את המספר עצמו במקום לקבוע שהדיווח חסר.', kind: 'sources' },
  { text: 'על כל שלוש הערות תיקון את משאירה אחת של חיזוק.', kind: 'praise' },
];
