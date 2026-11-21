/** 品种 / 藏品 / 账号等数据模型（与后端、Web、小程序字段保持一致） */

export interface CoinImage {
  url: string;
  f: string;
  k: string;
  label: string;
}

export interface PmPiece {
  seq: number;
  name: string;
  metal: string;
  weightG: number;
  purity: string;
  face: number;
  maxMintage: number;
  mintageUnit: string;
  shape: string;
  sizeText: string;
  quality: string;
  reverseText: string;
}

export interface PmInfo {
  metal: string;
  purity: string;
  weightG: number;
  weightText: string | null;
  spec: string | null;
  shape: string;
  quality: string;
  issueMethod: string;
  issueDate: string;
  isSet: boolean;
  setPieces: number;
  setWeightG: number;
  setFaceTotal: number;
  salesChannel: string;
  dealer: string;
  certificate: string;
  packaging: string;
  mintageNote: string;
  pieces: PmPiece[];
}

/** 原始品种（rawfile catalog.json 的一条） */
export interface RawCoin {
  id: number;
  no: number;
  category: string;
  hasPrice: boolean;
  year: number;
  name: string;
  series: string;
  seriesKeys: string[];
  face: number;
  mintage: number | null;
  material: string;
  dia: string | number;
  diaText: string;
  diaLabel: string;
  thickness?: string;
  weight?: string;
  caster?: string;
  edge?: string;
  obverse?: string;
  reverse?: string;
  specFrom?: string;
  limit?: number;
  kind: string;
  est?: number;
  set?: string;
  pieces?: number;
  setSize?: number;
  img?: boolean;
  imgs?: CoinImage[];
  desc?: string;
  descMd?: string;
  descTitle?: string;
  descSrc?: string;
  pm?: PmInfo;
}

/** 展示用品种：在 RawCoin 上补一套件数、面额、图片地址等派生字段 */
export interface Coin extends RawCoin {
  faceUnit: number;
  estUnit: number;
  setSizeCalc: number;
  setSizeBase: number;
  setFace: number;
  setFaceBase: number;
  setEst: number;
  group: string;
  short: string;
  seriesName: string;
  imgUrl: string;
  thumbUrl: string;
  smallUrl: string;
  faceText: string;
  mintageText: string;
  diaFullText: string;
}

export interface SetMeta {
  name: string;
  size: number;
}

export interface SeriesMeta {
  key: string;
  name: string;
  desc: string;
  img: string;
  sort: number;
}

export interface SeriesItem {
  code: string;
  name: string;
  desc: string;
  img: string;
  sort: number;
  count: number;
}

/** 发行计划 */
export interface PlanDesign {
  obverse?: string;
  reverse?: string;
}

export interface PlanItem {
  key: string;
  name: string;
  short?: string;
  kind?: string;
  face?: number;
  material?: string;
  dia?: string;
  mintage?: number;
  date?: string;
  status?: string;
  extra?: boolean;
  note?: string;
  reserve?: string;
  verify?: string;
  exchange?: string;
  limit?: number;
  proxy?: number;
  banks?: string;
  schedule?: PlanScheduleRow[];
  design?: PlanDesign;
  sourceText?: string;
  sourceUrl?: string;
  coinNo?: number;
}

export interface PlanScheduleRow {
  k: string;
  v: string;
}

export interface PlanYear {
  year: number;
  publishedAt?: string;
  publishedBy?: string;
  sourceUrl?: string;
  sourceText?: string;
  items: PlanItem[];
}

export interface PlanPmItem {
  key: string;
  name: string;
  code: string;
  pieces: number;
  release?: string;
  announce?: string;
}

export interface PlanPmYear {
  year: number;
  items: PlanPmItem[];
}

export interface PlanDoc {
  years: PlanYear[];
}

export interface PlanPmDoc {
  years: PlanPmYear[];
}

export interface PlansResponse {
  ok: boolean;
  plan: PlanDoc;
  planPm: PlanPmDoc;
}

/** 账号 */
export interface User {
  name: string;
  nickname?: string;
  avatar?: string;
  /** 华为账号头像外链（会失效，仅作展示兜底） */
  hwAvatar?: string;
  /** 是否绑定了微信 / 华为账号 */
  wx?: boolean;
  hw?: boolean;
  role?: string;
  createdAt?: string;
  nameChanged?: boolean;
  hasPassword?: boolean;
  isTest?: boolean;
}

/** 藏品（账本条目），字段与小程序 store.persist 一致 */
export interface Holding {
  id: string;
  name: string;
  category: string;
  thumb: string;
  unit: string;
  rolls: number;
  cost: number;
  market: number;
  group: string;
  serials: string[];
  form: string;
  images: string[];
}

export interface Stats {
  face: number;
  cost: number;
  market: number;
  profit: number;
  rolls: number;
  kinds: number;
  pmKinds: number;
  pmRolls: number;
}

export interface StateResponse {
  user: User | null;
  isAdmin: boolean;
  holdings: Holding[];
  prices: Record<string, number>;
  userCount: number;
  rev: number;
}

/** 贵金属目录（服务端全量库，分页） */
export interface PmRow {
  code: string;
  thumb: string;
  name: string;
  year: number;
  projectName: string;
  metaText: string;
  faceText: string;
  fineness: string;
  metalClass: string;
  metalChar: string;
}

export interface PmFacets {
  years: number[];
  faces: number[];
  materials: string[];
}

export interface PmListResponse {
  ok: boolean;
  items: PmItemRaw[];
  page: number;
  pages: number;
  total: number;
  facets?: PmFacets;
}

export interface PmItemRaw {
  code: string;
  name: string;
  year: number;
  projectName: string;
  material: string;
  weightG: number;
  quality: string;
  face: number;
  fineness: string;
  thumb?: string;
  thumbBack?: string;
}

/** 广场晒单 */
export interface ShareTag {
  name: string;
}

export interface ShareItem {
  id: number | string;
  uid?: string;
  author: string;
  avatar?: string;
  holdingName: string;
  serials: string[];
  tags: Array<ShareTag | string>;
  images: string[];
  likes?: number;
  liked?: boolean;
  comments?: number;
  createdAt: string;
  caption?: string;
  form?: string;
}

export interface SharesResponse {
  ok: boolean;
  items: ShareItem[];
  total?: number;
}

/** 系列（贵金属发行项目） */
export interface PmSeriesItem {
  code: string;
  name: string;
  count: number;
  yearFrom: string;
  yearTo: string;
  materials: string[];
  thumb: string;
}

export interface PmSeriesResponse {
  ok: boolean;
  items: PmSeriesItem[];
}
