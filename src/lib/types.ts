export type Category = 'colors' | 'spacing' | 'fontSizes' | 'fontWeights' | 'radii' | 'shadows' | 'sizes' | 'textStyles';

export type Token = {
  name: string;
  /** CSS value applied in preview (var(--space-4), calc(var(--spacing) * 4) etc.) */
  css?: string;
  /** Token that applies several properties at once, like textStyles. CSS property → value */
  style?: Record<string, string>;
  /** The CSS variable behind the token. When the page defines it, previews use var() so values match the page exactly */
  variable?: string;
  /** Heading used when the list is shown in groups */
  group?: string;
  description: string;
  /** A value typed directly in the panel rather than a token. name holds the raw CSS value */
  raw?: boolean;
};

export type Tokens = Record<Category, Token[]>;

/** Inferred tokens the element currently uses */
export type Detection =
  | { how: 'class'; name: string; value?: string }
  | { how: 'value'; candidates: string[]; value: string }
  | { how: 'zero' | 'none'; value: string };

export type ElementInfo = {
  route: string;
  tag: string;
  components: string[];
  text: string;
  /** Only token-related classes */
  tokenClasses: string[];
  marks: string[];
  /** Creation site recovered via source maps. self is where the element was created, usage is where its component is used */
  source?: { self: string | null; usage: string | null };
};

export type PropKey =
  | 'color'
  | 'backgroundColor'
  | 'borderColor'
  | 'textStyle'
  | 'fontSize'
  | 'fontWeight'
  | 'paddingTop'
  | 'paddingRight'
  | 'paddingBottom'
  | 'paddingLeft'
  | 'gap'
  | 'marginTop'
  | 'marginBottom'
  | 'marginLeft'
  | 'marginRight'
  | 'width'
  | 'height'
  | 'borderRadius'
  | 'boxShadow';

/** Non-token layout settings. Values are raw CSS values */
export type LayoutKey = 'display' | 'flexDirection' | 'justifyContent' | 'alignItems' | 'flexWrap';

export type Change = {
  info: ElementInfo;
  baseline: Record<PropKey, Detection>;
  props: Partial<Record<PropKey, string>>;
  layout?: Partial<Record<LayoutKey, string>>;
  /** Original values of the layout settings */
  layoutBase?: Partial<Record<LayoutKey, string>>;
  /** Reordering among siblings. Description of the sibling that comes right before (empty string if first) */
  move?: string;
  /** Parent's child order after reordering (original indexes), for reapplying */
  order?: number[];
  /** Description of the target when moved to another parent */
  into?: string;
  /** Target parent and position of the element right after it (for reapplying) */
  intoLoc?: { parent: string; before: string | null };
  /** Visual-only offset (px) */
  nudge?: { x: number; y: number };
  /** Trying out deletion */
  removed?: boolean;
  /** Element inserted from a Storybook story. into, move and intoLoc hold its placement */
  insert?: {
    id: string;
    title: string;
    name: string;
    importPath: string;
    html: string;
    args?: Record<string, string | number | boolean>;
    argTypes?: Record<string, { kind: 'select' | 'boolean' | 'text' | 'number'; options?: string[] }>;
  };
  /** Text edit */
  text?: { from: string; to: string };
  /** Free-form note for the coding agent, in the user's own words */
  note?: string;
  /** When the comment is about several elements (marquee selection), short names of them. The note sits on their common parent */
  noteScope?: string[];
  /** For saving and reapplying. Position from body */
  locator?: string;
};

export type Selected = {
  el: Element;
  info: ElementInfo;
  baseline: Record<PropKey, Detection>;
};

/** Change count (tokens, layout and reordering each count as one) */
export const countOf = (c: Change) =>
  Object.keys(c.props).length + Object.keys(c.layout ?? {}).length + (c.move !== undefined || c.insert ? 1 : 0) + (c.nudge ? 1 : 0) + (c.removed ? 1 : 0) + (c.text ? 1 : 0) + (c.note ? 1 : 0);
