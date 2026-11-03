import { Injectable, signal } from '@angular/core';

/**
 * The app's quick actions — "add a student", "add a course" — reachable from
 * wherever she is.
 *
 * The dialogs themselves live once, in the app shell. Every entry point (a
 * page header, a card on the home screen, the sidebar, the assistant) only
 * asks for one to open. The alternative — each screen with its own copy of
 * the form — is how this app ended up with five different text fields.
 */
@Injectable({ providedIn: 'root' })
export class QuickActions {
  readonly addStudentOpen = signal(false);
  readonly addCourseOpen = signal(false);

  openAddStudent() {
    this.addCourseOpen.set(false);
    this.addStudentOpen.set(true);
  }

  openAddCourse() {
    this.addStudentOpen.set(false);
    this.addCourseOpen.set(true);
  }

  close() {
    this.addStudentOpen.set(false);
    this.addCourseOpen.set(false);
  }
}
