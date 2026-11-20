export type Category = 'colors' | 'spacing' | 'fontSizes' | 'fontWeights' | 'radii' | 'shadows' | 'sizes' | 'textStyles';

export type Token = {
  name: string;
  /** プレビューで当てる CSS の値（var(--space-4)、calc(var(--spacing) * 4) など） */
  css?: string;
  /** textStyles のように、複数のプロパティをまとめて当てるトークン。CSS プロパティ → 値 */
  style?: Record<string, string>;
  /** 一覧を分けて見せるときの見出し */
  group?: string;
  description: string;
  /** トークンではなく、パネルで直接入れた値。name に CSS の値がそのまま入る */
  raw?: boolean;
};

export type Tokens = Record<Category, Token[]>;

/** 要素がいま使っているトークンの推定結果 */
export type Detection =
  | { how: 'class'; name: string; value?: string }
  | { how: 'value'; candidates: string[]; value: string }
  | { how: 'zero' | 'none'; value: string };

export type ElementInfo = {
  route: string;
  tag: string;
  components: string[];
  text: string;
  /** トークンに関係する class だけ */
  tokenClasses: string[];
  marks: string[];
  /** ソースマップから戻した作成場所。self は要素を作った場所、usage はその部品を使っている場所 */
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

/** トークンではない並びの設定。値は CSS の値そのまま */
export type LayoutKey = 'display' | 'flexDirection' | 'justifyContent' | 'alignItems' | 'flexWrap';

export type Change = {
  info: ElementInfo;
  baseline: Record<PropKey, Detection>;
  props: Partial<Record<PropKey, string>>;
  layout?: Partial<Record<LayoutKey, string>>;
  /** 並びの設定の変更前の値 */
  layoutBase?: Partial<Record<LayoutKey, string>>;
  /** 兄弟の中での並べ替え。直前に来る兄弟の説明（先頭なら空文字） */
  move?: string;
  /** 並べ替えたあとの親の子の並び（元の位置の番号）。当て直し用 */
  order?: number[];
  /** 別の親へ移したときの、移し先の説明 */
  into?: string;
  /** 移し先の親と、直後に来る要素の位置（当て直し用） */
  intoLoc?: { parent: string; before: string | null };
  /** 見た目だけずらした量（px） */
  nudge?: { x: number; y: number };
  /** 削除を試している */
  removed?: boolean;
  /** Storybook のストーリーから差し込んだ要素。into・move・intoLoc に置き場所が入る */
  insert?: {
    id: string;
    title: string;
    name: string;
    importPath: string;
    html: string;
    args?: Record<string, string | number | boolean>;
    argTypes?: Record<string, { kind: 'select' | 'boolean' | 'text' | 'number'; options?: string[] }>;
  };
  /** 文字の書き換え */
  text?: { from: string; to: string };
  /** 保存と当て直し用。body からの位置 */
  locator?: string;
};

export type Selected = {
  el: Element;
  info: ElementInfo;
  baseline: Record<PropKey, Detection>;
};

/** 変更の件数（トークン・並び・並べ替えを1つずつ数える） */
export const countOf = (c: Change) =>
  Object.keys(c.props).length + Object.keys(c.layout ?? {}).length + (c.move !== undefined || c.insert ? 1 : 0) + (c.nudge ? 1 : 0) + (c.removed ? 1 : 0) + (c.text ? 1 : 0);
