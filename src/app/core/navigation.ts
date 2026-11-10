import { IconName } from '../shared/ui/icon/icon';

export interface NavItem {
  path: string;
  /** Short label, for the phone's bottom bar. */
  label: string;
  /** Longer label for the sidebar. */
  longLabel: string;
  icon: IconName;
}

const STUDENTS: NavItem = {
  path: '/students',
  label: 'תלמידות',
  longLabel: 'התלמידות שלי',
  icon: 'users',
};


/** A phone has no tab strip, so its bottom bar also has to reach the courses. */
export const MOBILE_NAV: readonly NavItem[] = [
  { path: '/courses', label: 'קורסים', longLabel: 'קורסים', icon: 'book' },
  STUDENTS,
];
