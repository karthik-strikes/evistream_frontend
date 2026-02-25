export const typography = {
  heading: {
    h1: 'text-5xl font-bold leading-tight',
    h2: 'text-3xl font-bold',
    h3: 'text-2xl font-bold',
    h4: 'text-xl font-semibold',
    h5: 'text-lg font-semibold',
    h6: 'text-base font-semibold',
  },

  page: {
    title: 'text-2xl font-bold',
    section: 'text-lg font-semibold',
    cardTitle: 'text-base font-semibold',
    subsection: 'text-sm font-medium',
  },

  body: {
    large: 'text-lg font-normal',
    base: 'text-base font-normal',
    small: 'text-sm font-normal',
    tiny: 'text-xs font-normal',
  },

  label: {
    default: 'text-sm font-medium',
    large: 'text-base font-medium',
    small: 'text-xs font-medium',
  },

  sectionHeader: {
    default: 'text-xs font-semibold uppercase tracking-wider',
    large: 'text-sm font-semibold uppercase tracking-wider',
  },

  button: {
    primary: 'text-sm font-semibold',
    secondary: 'text-sm font-medium',
    small: 'text-xs font-semibold',
    large: 'text-base font-semibold',
  },

  badge: {
    default: 'text-xs font-medium',
    large: 'text-sm font-medium',
  },

  cardTitle: {
    default: 'text-lg font-semibold',
    large: 'text-xl font-semibold',
    small: 'text-base font-semibold',
  },

  emptyState: {
    title: 'text-lg font-semibold',
    description: 'text-sm font-normal text-muted',
  },

  dropzone: {
    title: 'text-lg font-medium tracking-tight',
    subtitle: 'text-xs font-normal uppercase tracking-wide',
  },

  link: {
    default: 'text-sm font-medium',
    large: 'text-base font-medium',
    small: 'text-xs font-medium',
  },

  code: {
    default: 'text-xs font-normal font-mono',
    inline: 'text-sm font-normal font-mono',
  },

  meta: {
    default: 'text-xs font-normal text-gray-400',
    large: 'text-sm font-normal text-gray-500',
  },

  message: {
    error: 'text-sm font-medium text-red-600',
    warning: 'text-sm font-medium text-yellow-600',
    success: 'text-sm font-medium text-green-600',
    info: 'text-sm font-medium text-blue-600',
  },

  nav: {
    item: 'text-sm font-normal',
    itemActive: 'text-sm font-medium',
    section: 'text-xs font-semibold uppercase tracking-wider text-gray-500',
  },

  stat: {
    large: 'text-4xl font-bold tracking-tight leading-none',
    default: 'text-2xl font-bold tracking-tight leading-none',
    small: 'text-lg font-semibold tracking-tight leading-none',
    label: 'text-xs font-semibold uppercase tracking-wider text-gray-500',
  },

  cardSubtitle: {
    default: 'text-sm font-normal text-gray-500',
    small: 'text-xs font-normal text-gray-400',
  },
} as const;

export const tracking = {
  tighter: 'tracking-tighter',
  tight: 'tracking-tight',
  normal: 'tracking-normal',
  wide: 'tracking-wide',
  wider: 'tracking-wider',
} as const;

export const leading = {
  none: 'leading-none',
  tight: 'leading-tight',
  snug: 'leading-snug',
  normal: 'leading-normal',
  relaxed: 'leading-relaxed',
} as const;

export const getTypography = (style: string, additionalClasses?: string) => {
  return additionalClasses ? `${style} ${additionalClasses}` : style;
};

export const typographyPatterns = {
  formField: {
    label: typography.label.default,
    error: typography.message.error,
    helper: typography.meta.default,
  },

  card: {
    title: typography.cardTitle.default,
    description: typography.body.small,
    meta: typography.meta.default,
  },

  listItem: {
    title: typography.body.small + ' font-medium',
    subtitle: typography.meta.default,
  },

  dialog: {
    title: typography.heading.h4,
    description: typography.body.small,
  },

  sidebar: {
    section: typography.nav.section,
    item: typography.nav.item,
    itemActive: typography.nav.itemActive,
  },

  status: {
    label: typography.badge.default,
    description: typography.body.small,
  },
} as const;

export type TypographyCategory = keyof typeof typography;
export type TypographyVariant<T extends TypographyCategory> = keyof typeof typography[T];
