/**
 * Table names, in one place, so a rename in the schema is a one-line change
 * here rather than a string hunt across services.
 */
export const TABLES = {
  courses: 'courses',
  courseRules: 'course_rules',
  courseMaterials: 'course_materials',
  courseStudents: 'course_students',
  students: 'students',
  assignments: 'assignments',
  submissions: 'submissions',
  submissionRounds: 'submission_rounds',
  annotations: 'annotations',
  gradingFormCategories: 'grading_form_categories',
  gradingFormEntries: 'grading_form_entries',
  studentGradingForms: 'student_grading_forms',
  teacherStyleExamples: 'teacher_style_examples',
  learningFeedbackLogs: 'learning_feedback_logs',
  studentEmails: 'student_emails',
  reliabilityChecks: 'reliability_checks',
} as const;

export type TableName = (typeof TABLES)[keyof typeof TABLES];
