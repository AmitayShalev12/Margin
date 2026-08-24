import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  {
    path: 'dashboard',
    title: 'מה ממתין לי · Margin',
    loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
  },
  {
    path: 'submissions',
    title: 'עבודות · Margin',
    loadComponent: () => import('./features/submissions/submissions').then((m) => m.Submissions),
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
    path: 'courses',
    title: 'קורסים · Margin',
    loadComponent: () => import('./features/courses/courses').then((m) => m.Courses),
  },
  {
    path: 'grading-forms',
    title: 'טפסי הערכה · Margin',
    loadComponent: () =>
      import('./features/grading-forms/grading-forms').then((m) => m.GradingForms),
  },
  {
    // Where the review screen's primary action lands, with the submission
    // already chosen. The bare path is the same screen reached from the nav.
    path: 'communication/:submissionId',
    title: 'מייל לתלמידה · Margin',
    loadComponent: () =>
      import('./features/communication/communication').then((m) => m.Communication),
  },
  {
    path: 'communication',
    title: 'מיילים לתלמידות · Margin',
    loadComponent: () =>
      import('./features/communication/communication').then((m) => m.Communication),
  },
  {
    path: 'style',
    title: 'הסגנון שלי · Margin',
    loadComponent: () =>
      import('./features/style-settings/style-settings').then((m) => m.StyleSettings),
  },
  { path: '**', redirectTo: 'dashboard' },
];
