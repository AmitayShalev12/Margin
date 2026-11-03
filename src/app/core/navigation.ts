import { IconName } from '../shared/ui/icon/icon';
import { FeatureFlags } from './features';

/** A quick action an entry carries with it ("הוספת תלמידה" on My Students). */
export type QuickActionId = 'add-student' | 'add-course';

export interface NavItem {
  path: string;
  /** Short label — what fits in a bottom tab. */
  label: string;
  /** Longer label for the sidebar, where there is room. */
  longLabel: string;
  icon: IconName;
  /**
   * Primary items get a slot in the mobile tab bar; the rest live behind
   * "עוד". Four is the most that stays comfortable at 375px.
   */
  primary: boolean;
  quickAction?: { id: QuickActionId; label: string };
}

/**
 * A titled, collapsible group in the sidebar.
 *
 * The sidebar used to be one undifferentiated list of six links. A usability
 * review found it hard to navigate, so the entries are grouped by what she is
 * doing — her students and their work, the course itself, her settings — and
 * each group folds away on its own.
 */
export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export function navGroups(flags: FeatureFlags): NavGroup[] {
  return [
    {
      id: 'overview',
      label: 'סקירה',
      items: [{ path: '/home', label: 'בית', longLabel: 'בית', icon: 'home', primary: true }],
    },
    {
      id: 'work',
      label: 'תלמידות ועבודות',
      items: [
        {
          path: '/students',
          label: 'תלמידות',
          longLabel: 'התלמידות שלי',
          icon: 'users',
          primary: true,
          quickAction: { id: 'add-student', label: 'הוספת תלמידה' },
        },
        {
          path: '/submissions',
          label: 'עבודות',
          longLabel: 'עבודות שהוגשו',
          icon: 'docs',
          primary: true,
        },
        // Switched off in core/features.ts; kept so the flag restores it.
        ...(flags.mailing
          ? [
              {
                path: '/communication',
                label: 'מיילים',
                longLabel: 'מיילים לתלמידות',
                icon: 'mail' as const,
                primary: false,
              },
            ]
          : []),
      ],
    },
    {
      id: 'course',
      label: 'הקורס',
      items: [
        {
          path: '/courses',
          label: 'קורסים',
          longLabel: 'קורסים וחומרי רקע',
          icon: 'book',
          primary: true,
          quickAction: { id: 'add-course', label: 'הוספת קורס' },
        },
        {
          path: '/grading-forms',
          label: 'טפסים',
          longLabel: 'טפסי הערכה',
          icon: 'clipboard',
          primary: false,
        },
      ],
    },
    {
      id: 'settings',
      label: 'הגדרות',
      items: [
        { path: '/style', label: 'הסגנון', longLabel: 'הסגנון שלי', icon: 'quill', primary: false },
      ],
    },
  ];
}

export function navItems(groups: readonly NavGroup[]): NavItem[] {
  return groups.flatMap((g) => g.items);
}
