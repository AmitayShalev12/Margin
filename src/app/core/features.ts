import { InjectionToken } from '@angular/core';

/**
 * Features that exist in the code but can be switched off in the interface.
 *
 * One place, so turning something back on is a one-word change and not an
 * archaeology project.
 */
export interface FeatureFlags {
  /**
   * Writing the covering email to a student.
   *
   * Off after a usability review: the sidebar entry, the review screen's
   * "write the email" button and the email half of the communication screen
   * all go. Nothing is deleted — `EmailGenerator`, the `student-email` Edge
   * Function, the `student_emails` table and the compose screen are intact,
   * and setting this to `true` restores every entry point.
   *
   * What does NOT go with it: posting her approved comments into the
   * student's Google Doc. That lived on the same screen and used to appear
   * only once an email had been drafted. It is not mailing, so with mailing
   * off the screen shows it directly, as "ההערות במסמך".
   */
  mailing: boolean;
}

export const FEATURES: FeatureFlags = {
  mailing: true,
};

/**
 * The flags, injectable — so the specs for a switched-off feature can switch
 * it back on and keep guarding code that is kept precisely so it can return.
 */
export const FEATURE_FLAGS = new InjectionToken<FeatureFlags>('FEATURE_FLAGS', {
  providedIn: 'root',
  factory: () => FEATURES,
});
