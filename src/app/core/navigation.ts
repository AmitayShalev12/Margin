import { IconName } from '../shared/ui/icon/icon';

export interface NavItem {
  path: string;
  /** Short label — what fits in a bottom tab. */
  label: string;
  /** Longer label for the desktop rail, where there is room. */
  longLabel: string;
  icon: IconName;
  /**
   * Primary items get a slot in the mobile tab bar; the rest live behind
   * "עוד". Four is the most that stays comfortable at 375px.
   */
  primary: boolean;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { path: '/dashboard', label: 'היום', longLabel: 'מה ממתין לי', icon: 'home', primary: true },
  {
    path: '/submissions',
    label: 'עבודות',
    longLabel: 'עבודות שהוגשו',
    icon: 'docs',
    primary: true,
  },
  {
    path: '/courses',
    label: 'קורסים',
    longLabel: 'קורסים וחומרי רקע',
    icon: 'book',
    primary: true,
  },
  {
    path: '/grading-forms',
    label: 'טפסים',
    longLabel: 'טפסי הערכה',
    icon: 'clipboard',
    primary: true,
  },
  {
    path: '/communication',
    label: 'מיילים',
    longLabel: 'מיילים לתלמידות',
    icon: 'mail',
    primary: false,
  },
  { path: '/style', label: 'הסגנון', longLabel: 'הסגנון שלי', icon: 'quill', primary: false },
];

export const PRIMARY_NAV = NAV_ITEMS.filter((i) => i.primary);
export const SECONDARY_NAV = NAV_ITEMS.filter((i) => !i.primary);
