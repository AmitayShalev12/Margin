import { Route, Routes } from '@angular/router';

import { FEATURES } from './core/features';

const section = (path: string, load: Route['loadComponent']): Route => ({ path, loadComponent: load });

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'courses' },
  // Old addresses, from links and saved tabs. "current" is the course on screen.
  { path: 'home', redirectTo: 'courses' },
  { path: 'dashboard', redirectTo: 'students' },
  { path: 'submissions', redirectTo: 'courses/current/papers' },
  { path: 'grading-forms', redirectTo: 'courses/current/grading' },
  { path: 'style', redirectTo: 'courses/current/style' },
  {
    path: 'students',
    title: 'התלמידות שלי · Margin',
    loadComponent: () =>
      import('./features/students-overview/students-overview').then((m) => m.StudentsOverview),
  },
  {
    path: 'courses',
    pathMatch: 'full',
    title: 'קורסים · Margin',
    loadComponent: () =>
      import('./features/courses/courses-home/courses-home').then((m) => m.CoursesHome),
  },
  {
    path: 'courses/:courseId',
    title: 'קורס · Margin',
    loadComponent: () =>
      import('./features/courses/course-world/course-world').then((m) => m.CourseWorld),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'students' },
      section('students', () =>
        import('./features/courses/course-students/course-students').then((m) => m.CourseStudents),
      ),
      section('papers', () =>
        import('./features/submissions/submissions').then((m) => m.Submissions),
      ),
      section('rules', () =>
        import('./features/courses/course-rules').then((m) => m.CourseRules),
      ),
      section('process', () =>
        import('./features/courses/course-world/course-process').then((m) => m.CourseProcess),
      ),
      section('grading', () =>
        import('./features/grading-forms/grading-forms').then((m) => m.GradingForms),
      ),
      section('style', () =>
        import('./features/style-settings/style-settings').then((m) => m.StyleSettings),
      ),
      section('messages', () =>
        import('./features/courses/course-world/course-messages').then((m) => m.CourseMessages),
      ),
    ],
  },
  {
    path: 'settings',
    title: 'הגדרות · Margin',
    loadComponent: () => import('./features/settings/settings').then((m) => m.Settings),
  },
  {
    path: 'approve/:submissionId',
    title: 'אישור ושליחה · Margin',
    loadComponent: () => import('./features/approval/approval').then((m) => m.Approval),
  },
  {
    // The annotation screen. Reachable without an id while it is a stub.
    path: 'review/:submissionId',
    title: 'בדיקה · Margin',
    loadComponent: () => import('./features/review/review').then((m) => m.Review),
  },
  {
    path: 'review',
    title: 'בדיקה · Margin',
    loadComponent: () => import('./features/review/review').then((m) => m.Review),
  },
  {
    // Where the review screen's primary action lands, with the submission
    // already chosen. The bare path is the same screen reached from the nav.
    path: 'communication/:submissionId',
    title: FEATURES.mailing ? 'מייל לתלמידה · Margin' : 'ההערות במסמך · Margin',
    loadComponent: () =>
      import('./features/communication/communication').then((m) => m.Communication),
  },
  { path: 'communication', redirectTo: 'courses/current/messages' },
  { path: '**', redirectTo: 'courses' },
];
