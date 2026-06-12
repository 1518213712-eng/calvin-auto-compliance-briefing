import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { saveAs } from 'file-saver';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

dayjs.extend(customParseFormat);

type Region = 'domestic' | 'overseas';
type SourceType = 'wechat' | 'web';
type ModelKey = 'grok' | 'chatgpt' | 'gemini';
type WizardStep = 'sources' | 'initial' | 'supplement' | 'review';
type SupplementMode = 'fill' | 'single';
type SupplementRegion = Region | 'both';
type SourceEntry = { id: string; region: Region; type: SourceType; name: string; url: string };
type NewsItem = {
  id: string;
  region: Region;
  date: string;
  title: string;
  summary: string;
  source_name: string;
  url: string;
  verified?: boolean;
};
type RenderItem = Omit<NewsItem, 'verified'> & { link_token: string; display_summary: string };
type DraftState = { month: string; items: NewsItem[]; step: WizardStep; reviewRegion: Region };
type ParseResult = { items: NewsItem[]; message: string };
type LooseRecord = Record<string, unknown>;

const BG_IMAGE_1 = 'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260609_195923_b0ba8ace-1d1d-4f2c-9a28-1ab84b330680.png&w=1280&q=85';
const BG_IMAGE_2 = 'https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260609_201152_bba90a12-bf12-459f-91f0-51f237dbaf3b.png&w=1280&q=85';
const SPOTLIGHT_R = 260;

const DEFAULT_SOURCES: SourceEntry[] = [
  { id: 'wechat-caam', region: 'domestic', type: 'wechat', name: '中国汽车工业协会', url: '' },
  { id: 'wechat-artiauto', region: 'domestic', type: 'wechat', name: 'ArtiAuto', url: '' },
  { id: 'wechat-jiangxin', region: 'domestic', type: 'wechat', name: '匠歆汽车', url: '' },
  { id: 'wechat-caict', region: 'domestic', type: 'wechat', name: '中国信通院CAICT', url: '' },
  { id: 'wechat-sh-v2x', region: 'domestic', type: 'wechat', name: '上海市车联网协会', url: '' },
  { id: 'wechat-miit', region: 'domestic', type: 'wechat', name: '工信微报', url: '' },
  { id: 'wechat-eai100', region: 'domestic', type: 'wechat', name: 'EAI 100', url: '' },
  { id: 'wechat-tansi', region: 'domestic', type: 'wechat', name: '谈思汽车', url: '' },
  { id: 'wechat-cpca', region: 'domestic', type: 'wechat', name: '乘联分会', url: '' },
  { id: 'wechat-security', region: 'domestic', type: 'wechat', name: '工业互联网和车联网安全中心', url: '' },
  { id: 'wechat-cicv', region: 'domestic', type: 'wechat', name: 'CICV创新中心', url: '' },
  { id: 'wechat-data-compliance', region: 'domestic', type: 'wechat', name: '智能网联汽车与数据合规', url: '' },
  { id: 'web-miit-auto', region: 'domestic', type: 'web', name: '工业和信息化部-汽车工业', url: 'https://www.miit.gov.cn/jgsj/zbys/qcgy/index.html' },
  { id: 'web-cnauto', region: 'domestic', type: 'web', name: '中国汽车报', url: 'http://www.cnautonews.com/yaowen/list_160_1.html' },
  { id: 'web-gov-policy', region: 'domestic', type: 'web', name: '国务院政策文件库', url: 'https://www.gov.cn/zhengce/zhengcewenjianku/' },
  { id: 'wechat-reuters', region: 'overseas', type: 'wechat', name: '路透财经早报', url: '' },
  { id: 'wechat-wpc', region: 'overseas', type: 'wechat', name: 'WPC数字化出海', url: '' },
  { id: 'web-iapp', region: 'overseas', type: 'web', name: 'IAPP 国际隐私专业协会', url: 'https://iapp.org/' },
  { id: 'web-edpb-dataguidance', region: 'overseas', type: 'web', name: 'EDPB / DataGuidance', url: 'https://www.dataguidance.com/' },
  { id: 'web-unece', region: 'overseas', type: 'web', name: '联合国世界车辆法规协调论坛 UNECE', url: 'https://unece.org/' },
];

const MODELS: { key: ModelKey; name: string; url: string; hint: string }[] = [
  { key: 'grok', name: 'Grok', url: 'https://grok.com/', hint: '推荐 · 记得开启 Live Search 联网' },
  { key: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/', hint: '记得开启「搜索」联网' },
  { key: 'gemini', name: 'Gemini', url: 'https://gemini.google.com/app', hint: '记得开启联网检索' },
];

const SOURCE_STORAGE_KEY = 'car-news-monthly-workbench:structured-sources';
const DRAFT_STORAGE_KEY = 'car-news-monthly-workbench:wizard-draft';
const MODEL_STORAGE_KEY = 'car-news-monthly-workbench:preferred-model';
const STEPS: { key: WizardStep; label: string }[] = [
  { key: 'sources', label: '来源' },
  { key: 'initial', label: '第一轮' },
  { key: 'supplement', label: '补足' },
  { key: 'review', label: '审核导出' },
];
const DEFAULT_MONTH = dayjs().format('YYYY-MM');
const REGION_LABEL: Record<Region, string> = { domestic: '境内', overseas: '域外' };
const SOURCE_REGION_LABEL: Record<Region, string> = { domestic: '国内', overseas: '国外' };
const GLASS_PANEL = 'rounded-2xl border border-white/10 bg-white/[0.055] shadow-2xl shadow-black/30 backdrop-blur-sm';
const FIELD_CLASS = 'w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white outline-none transition-all placeholder:text-white/35 focus:border-accent/70 focus:bg-white/10 focus:ring-4 focus:ring-accent/10';
const SECONDARY_BUTTON = 'rounded-full border border-white/20 px-4 py-2 text-sm font-semibold text-white/90 transition-all hover:border-white/35 hover:bg-white/10 disabled:hover:bg-transparent';
const PRIMARY_BUTTON = 'rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-white transition-all hover:scale-[1.03] hover:bg-accent-hover hover:shadow-lg hover:shadow-accent/30 active:scale-95 disabled:hover:scale-100 disabled:hover:shadow-none';
const DANGER_BUTTON = 'rounded-full border border-red-400/25 px-4 py-2 text-sm font-semibold text-red-200 transition-all hover:bg-red-500/10';

function monthRange(month: string) {
  const start = dayjs(`${month}-01`, 'YYYY-MM-DD', true);
  return { start: start.format('YYYY-MM-DD'), end: start.endOf('month').format('YYYY-MM-DD') };
}
function issueTitle(month: string) {
  const { end } = monthRange(month);
  return `车企快讯（${month.replace('-', '.')}.01-${end.replace(/-/g, '.')}）`;
}
function randomId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function asRecord(value: unknown): LooseRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as LooseRecord : {};
}
function normalizeStoredItem(item: NewsItem): NewsItem {
  return { ...item, verified: item.verified ?? false };
}
function normalizeSourceEntry(value: unknown): SourceEntry | null {
  const record = asRecord(value);
  const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : randomId();
  const type = record.type === 'web' ? 'web' : 'wechat';
  const name = typeof record.name === 'string' ? record.name.trim() : '';
  const url = typeof record.url === 'string' ? record.url.trim() : '';
  if (!name) return null;
  const legacyOverseas = ['wechat-reuters', 'wechat-wpc', 'web-unece'].includes(id) || /Reuters|路透|WPC|UNECE|IAPP|EDPB|DataGuidance/i.test(name);
  const region = record.region === 'overseas' || legacyOverseas ? 'overseas' : 'domestic';
  return { id, region, type, name, url };
}
function cleanSources(sources: SourceEntry[]) {
  return sources.map(normalizeSourceEntry).filter((source): source is SourceEntry => Boolean(source));
}
function getInitialSources() {
  const MIGRATION_FLAG = 'car-news-monthly-workbench:sources-defaults-merged';
  try {
    const stored = localStorage.getItem(SOURCE_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const cleaned = cleanSources(parsed as SourceEntry[]);
        // 一次性把新版默认来源(如 EDPB / IAPP / UNECE)补进旧清单,之后尊重用户的增删。
        if (!localStorage.getItem(MIGRATION_FLAG)) {
          const existingIds = new Set(cleaned.map((source) => source.id));
          const merged = [...cleaned, ...DEFAULT_SOURCES.filter((source) => !existingIds.has(source.id))];
          localStorage.setItem(SOURCE_STORAGE_KEY, JSON.stringify(merged));
          localStorage.setItem(MIGRATION_FLAG, '1');
          return merged;
        }
        return cleaned;
      }
    }
  } catch {
    return DEFAULT_SOURCES;
  }
  return DEFAULT_SOURCES;
}
function getInitialDraft(): DraftState {
  try {
    const stored = localStorage.getItem(DRAFT_STORAGE_KEY);
    if (stored) {
      const draft = JSON.parse(stored) as DraftState;
      return {
        month: draft.month || DEFAULT_MONTH,
        items: Array.isArray(draft.items) ? draft.items.map(normalizeStoredItem) : [],
        step: draft.step || 'sources',
        reviewRegion: draft.reviewRegion || 'domestic',
      };
    }
  } catch {
    return { month: DEFAULT_MONTH, items: [], step: 'sources', reviewRegion: 'domestic' };
  }
  return { month: DEFAULT_MONTH, items: [], step: 'sources', reviewRegion: 'domestic' };
}
function getInitialModel(): ModelKey {
  try {
    const stored = localStorage.getItem(MODEL_STORAGE_KEY);
    if (stored === 'grok' || stored === 'chatgpt' || stored === 'gemini') return stored;
  } catch {
    return 'grok';
  }
  return 'grok';
}
function sourceNames(sources: SourceEntry[], region: Region, type: SourceType) {
  return cleanSources(sources).filter((source) => source.region === region && source.type === type);
}
function inferSourceName(url: string, sources: SourceEntry[]) {
  try {
    const hostname = new URL(normalizeUrlInput(url)).hostname.replace(/^www\./, '');
    const matched = cleanSources(sources).find((source) => source.url && source.url.includes(hostname));
    if (matched) return matched.name;
    const domainMap: Record<string, string> = {
      'miit.gov.cn': '工业和信息化部',
      'cnautonews.com': '中国汽车报',
      'unece.org': 'UNECE',
      'gov.cn': '国务院政策文件库',
      'dataguidance.com': 'DataGuidance',
      'iapp.org': 'IAPP',
      'cac.gov.cn': '国家互联网信息办公室',
      'caict.ac.cn': '中国信通院CAICT',
      'china-icv.cn': 'CICV创新中心',
      'edpb.europa.eu': '欧洲数据保护委员会',
      'nhtsa.gov': 'NHTSA',
      'cppa.ca.gov': '加州隐私保护局',
      'meti.go.jp': '日本经济产业省',
      'ico.org.uk': '英国信息专员办公室',
      'bsi.bund.de': '德国联邦信息安全局',
      'priv.gc.ca': '加拿大隐私专员办公室',
      'pipc.go.kr': '韩国个人信息保护委员会',
    };
    return domainMap[hostname] ?? hostname;
  } catch {
    return '待补充来源';
  }
}
function normalizeUrlInput(value: string) {
  let url = String(value).trim().replace(/^<|>$/g, '').replace(/[，。；;、\s]+$/g, '');
  const markdownMatch = url.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
  if (markdownMatch) {
    const label = markdownMatch[1].trim();
    const target = markdownMatch[2].trim();
    url = /^https?:\/\//i.test(label) ? label : target;
  }
  const embeddedUrl = url.match(/https?:\/\/[^\s\])）>，。；;]+/i);
  if (embeddedUrl && !/^https?:\/\//i.test(url)) url = embeddedUrl[0];
  if (/^www\./i.test(url)) url = `https://${url}`;
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    if ((hostname === 'google.com' || hostname === 'bing.com') && parsed.pathname === '/search') {
      const queryUrl = parsed.searchParams.get('q');
      if (queryUrl && /^https?:\/\//i.test(queryUrl)) return queryUrl;
    }
  } catch {
    return url;
  }
  return url;
}
function extractJsonInput(value: string) {
  let trimmed = value.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) trimmed = fenced[1].trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  const arrayStart = trimmed.indexOf('[');
  const arrayEnd = trimmed.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) return trimmed.slice(arrayStart, arrayEnd + 1);
  const itemsMatch = trimmed.match(/items\s*:\s*(\[[\s\S]*\])/i);
  if (itemsMatch) return `{"items":${itemsMatch[1]}}`;
  return trimmed;
}
function parseJsonLoose(value: string) {
  const extracted = extractJsonInput(value);
  const candidates = [
    extracted,
    extracted.replace(/,\s*([}\]])/g, '$1'),
    extracted.replace(/([{,]\s*)([A-Za-z_][\w-]*)\s*:/g, '$1"$2":').replace(/,\s*([}\]])/g, '$1'),
  ];
  let lastError: unknown;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('JSON 解析失败。');
}
function pickString(record: LooseRecord, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      if (text) return text;
    }
  }
  return '';
}
function pickItems(payload: unknown) {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  const keys = ['items', 'news', 'list', 'data', '新闻', '新闻列表', '条目'];
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}
function normalizeRegionInput(value: string): Region | null {
  const text = value.trim().toLowerCase();
  if (['domestic', '境内', '国内', '中国', '内地'].includes(text)) return 'domestic';
  if (['overseas', 'foreign', 'global', '境外', '域外', '海外', '国际', '国外'].includes(text)) return 'overseas';
  if (/境内|国内|中国/.test(value)) return 'domestic';
  if (/境外|域外|海外|国际|国外/.test(value)) return 'overseas';
  return null;
}
function normalizeDateInput(value: string, month: string) {
  const text = value.trim();
  const year = month.slice(0, 4);
  const candidates = [
    text,
    text.replace(/[/.]/g, '-'),
    text.replace(/年|月/g, '-').replace(/日/g, ''),
  ];
  const md = text.match(/^(\d{1,2})\s*[月/.-]\s*(\d{1,2})\s*日?$/);
  if (md) candidates.push(`${year}-${md[1].padStart(2, '0')}-${md[2].padStart(2, '0')}`);
  for (const candidate of candidates) {
    const parsed = dayjs(candidate, ['YYYY-MM-DD', 'YYYY-M-D'], true);
    if (parsed.isValid() && parsed.format('YYYY-MM') === month) return parsed.format('YYYY-MM-DD');
  }
  return '';
}
function parsePayloadMonth(payload: unknown) {
  const record = asRecord(payload);
  return pickString(record, ['issue_month', 'month', '月份', '期数月份', '发布月份']);
}
function coerceNewsItem(value: unknown, month: string, sources: SourceEntry[]): Omit<NewsItem, 'id'> | null {
  const record = asRecord(value);
  const region = normalizeRegionInput(pickString(record, ['region', '地域', '区域', '地区', '类型']));
  const date = normalizeDateInput(pickString(record, ['date', '日期', '发布时间', '发布日期', 'publish_date']), month);
  const title = pickString(record, ['title', '标题', '新闻标题', '题目']);
  const summary = pickString(record, ['summary', '摘要', '内容', '正文', '简述', '新闻摘要']);
  const url = normalizeUrlInput(pickString(record, ['url', 'link', '链接', '原文链接', '网址', 'source_url']));
  const sourceName = pickString(record, ['source_name', 'source', '来源', '来源名称', '发布机构', '媒体']);
  if (!region || !date || !title || !summary || !/^https?:\/\//i.test(url)) return null;
  return { region, date, title, summary, source_name: sourceName || inferSourceName(url, sources), url, verified: false };
}
function parseGeminiPayload(json: string, month: string, sources: SourceEntry[]): ParseResult {
  const raw = parseJsonLoose(json);
  const payloadMonth = parsePayloadMonth(raw);
  if (payloadMonth && payloadMonth !== month) throw new Error(`JSON 月份与当前选择不一致：${payloadMonth} ≠ ${month}`);
  const rawItems = pickItems(raw);
  const normalized = rawItems.map((item) => coerceNewsItem(item, month, sources)).filter((item): item is Omit<NewsItem, 'id'> => Boolean(item));
  if (!normalized.length) throw new Error('没有解析到可用条目。请确认至少包含地域、日期、标题、摘要和原文链接。');
  const skipped = rawItems.length - normalized.length;
  const markdownCleaned = rawItems.filter((item) => {
    const url = pickString(asRecord(item), ['url', 'link', '链接', '原文链接', '网址', 'source_url']);
    return /^\[.+\]\(.+\)$/.test(url) || /google\.com\/search|bing\.com\/search/i.test(url);
  }).length;
  const parts = [`已解析 ${normalized.length} 条`];
  if (markdownCleaned) parts.push(`自动清洗 ${markdownCleaned} 个链接`);
  if (skipped) parts.push(`跳过 ${skipped} 条不完整数据`);
  return { items: sortItemsByDate(normalized.map((item) => createItem(item))), message: `${parts.join('，')}。` };
}
function createItem(partial?: Partial<NewsItem>): NewsItem {
  return {
    id: randomId(),
    region: partial?.region ?? 'domestic',
    date: partial?.date ?? `${DEFAULT_MONTH}-01`,
    title: partial?.title ?? '',
    summary: partial?.summary ?? '',
    source_name: partial?.source_name ?? '',
    url: partial?.url ?? '',
    verified: partial?.verified ?? false,
  };
}
function sortItemsByDate(items: NewsItem[]) {
  return [...items].sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));
}
function countByRegion(items: NewsItem[], region: Region) {
  return items.filter((item) => item.region === region).length;
}
function isComplete(items: NewsItem[]) {
  return countByRegion(items, 'domestic') >= 10 && countByRegion(items, 'overseas') >= 10;
}
function sourcePromptBlock(sources: SourceEntry[], region: Region) {
  const regionLabel = SOURCE_REGION_LABEL[region];
  const wechat = sourceNames(sources, region, 'wechat');
  const web = sourceNames(sources, region, 'web');
  return [
    `${regionLabel}公众号参考来源:`,
    ...wechat.map((source) => `- ${source.name}`),
    '',
    `${regionLabel}网页参考来源:`,
    ...web.map((source) => `- ${source.name}:${source.url}`),
  ];
}
function buildPrompt(month: string, sources: SourceEntry[]) {
  const range = monthRange(month);
  return [
    `你是汽车数据合规研究员。本次检索 ${month} 自然月(${range.start} 至 ${range.end})的汽车数据合规新闻。`,
    '',
    '【本轮目标:境内 5 条、域外 5 条】',
    '- 本轮只输出 10 条:境内 5 条、域外 5 条。第二轮再补足到各 10 条。',
    '- 请多轮、换关键词反复检索,确保这 10 条都真实、链接能打开。',
    '',
    '【来源优先级】',
    '- 优先从下方「参考来源」检索。注意部分公众号内容公开网络可能搜不到,搜不到时不要卡住,用其它权威来源(官方网站、监管机构、主流媒体)补足,并在 source_name 后标注「(外部)」。',
    '- source_name:属参考来源用其名称,属外部来源标「(外部)」。',
    '',
    '【真实底线】',
    '- 不得编造任何标题、机构、处罚案例、会议、日期或链接。',
    '- 只输出你真实检索到、链接能打开的新闻。',
    '- url 必须是具体原文页的裸链接,不是首页/栏目/搜索/跳转链接,不得改写域名。',
    '- 某条链接与内容明显不符时,换掉它再找一条补上。',
    '',
    '【只输出 JSON,无解释、无 Markdown、无代码块】',
    '{ "issue_month": "YYYY-MM", "date_range": { "start": "YYYY-MM-01", "end": "YYYY-MM-DD" }, "items": [...] }',
    '',
    'items 每条字段:',
    '- region:只能是 domestic 或 overseas。',
    '- date:YYYY-MM-DD,必须在本月内。',
    '- title:8-16 个中文字符。',
    '- summary:150-250 字,以「X月X日,」开头。',
    '- source_name:发布机构/媒体名称,外部来源标「(外部)」。',
    '- url:具体原文裸链接。',
    '',
    '输出顺序:先输出 5 条 domestic,再输出 5 条 overseas;每个区域内部按日期从早到晚排序。',
    '',
    ...sourcePromptBlock(sources, 'domestic'),
    '',
    ...sourcePromptBlock(sources, 'overseas'),
  ].join('\n');
}
function buildSupplementPrompt(month: string, items: NewsItem[], sources: SourceEntry[], region: Region, count: number) {
  const range = monthRange(month);
  const regionLabel = REGION_LABEL[region];
  const existingList = sortItemsByDate(items).map((item) => `- ${item.region === 'domestic' ? '境内' : '域外'}｜${item.date}｜${item.title}｜${item.url}`);
  return [
    `你是汽车数据合规研究员。继续补足 ${month} 自然月(${range.start} 至 ${range.end})的汽车数据合规新闻。`,
    '',
    `【本次补足 ${regionLabel} ${count} 条】`,
    `- 只输出 ${regionLabel} 新增条目,补到该区域满 10 条;不要输出另一区域。`,
    '- 多轮换词检索,不要找到一两条就停;不得重复下方已有标题或链接。',
    '',
    `【来源优先级】优先从下方「${regionLabel}参考来源」检索;搜不到时用其它权威来源补足,并在 source_name 后标「(外部)」。`,
    '',
    '【真实底线】不得编造;只输出真实检索到、链接能打开的新闻;url 为具体原文裸链接(非首页/栏目/搜索/跳转),不得改写域名;链接与内容不符就换一条。',
    '',
    '【重复排除清单(勿与下列标题/链接重复)】',
    ...existingList,
    '',
    '【只输出 JSON,无解释、无 Markdown、无代码块】',
    '{ "issue_month": "YYYY-MM", "date_range": { "start": "YYYY-MM-01", "end": "YYYY-MM-DD" }, "items": [...] }',
    '',
    `items 每条字段:region(本次只能是 ${region})、date(本月内 YYYY-MM-DD)、title(8-16字)、summary(150-250字、以「X月X日,」开头)、source_name(外部来源标「(外部)」)、url(具体原文裸链接)。`,
    '',
    ...sourcePromptBlock(sources, region),
  ].join('\n');
}
function escapeXml(value: string) {
  return value.replace(/[<>&"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[ch] as string));
}
function escapeXmlAttr(value: string) { return escapeXml(value); }
function makeLinkToken(index: number) { return `__LINK_${index + 1}__`; }
function displaySummary(item: NewsItem) {
  const summary = item.summary.trim();
  if (/^\d{1,2}月\d{1,2}日，/.test(summary)) return summary;
  const date = dayjs(item.date, 'YYYY-MM-DD', true);
  if (!date.isValid()) return summary;
  return `${date.month() + 1}月${date.date()}日，${summary}`;
}
function prepareRenderItems(items: NewsItem[]) {
  let index = 0;
  const withToken = (item: NewsItem): RenderItem => {
    const { verified: _verified, ...templateItem } = item;
    return { ...templateItem, link_token: makeLinkToken(index++), display_summary: displaySummary(item) };
  };
  const domesticItems = sortItemsByDate(items.filter((item) => item.region === 'domestic')).map(withToken);
  const overseasItems = sortItemsByDate(items.filter((item) => item.region === 'overseas')).map(withToken);
  return { domesticItems, overseasItems, linkItems: [...domesticItems, ...overseasItems] };
}
function applyHyperlinks(documentXml: string, relsXml: string, items: RenderItem[]) {
  let outDocument = documentXml;
  let outRels = relsXml;
  const usedRelIds = [...relsXml.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1]));
  let nextRelId = usedRelIds.length ? Math.max(...usedRelIds) + 1 : 1;
  items.forEach((item) => {
    const relId = `rId${nextRelId++}`;
    const hyperlink = `</w:t></w:r><w:hyperlink r:id="${relId}" w:history="1"><w:r><w:rPr><w:rStyle w:val="af8"/><w:u w:val="single"/><w:color w:val="0563C1"/></w:rPr><w:t>${escapeXml(item.url)}</w:t></w:r></w:hyperlink><w:r><w:t>`;
    outDocument = outDocument.replaceAll(item.link_token, hyperlink);
    outRels = outRels.replace('</Relationships>', `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXmlAttr(item.url)}" TargetMode="External"/></Relationships>`);
  });
  return { documentXml: outDocument, relsXml: outRels };
}
async function renderTemplateDocx(month: string, items: NewsItem[]) {
  const templateUrl = `${import.meta.env.BASE_URL}templates/newsletter-template.docx`;
  const response = await fetch(templateUrl);
  if (!response.ok) throw new Error('无法读取 Word 模板。');
  const zip = new PizZip(await response.arrayBuffer());
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
  const prepared = prepareRenderItems(items);
  doc.render({ title: issueTitle(month), issue_month: month, date_range: monthRange(month), domestic_items: prepared.domesticItems, overseas_items: prepared.overseasItems });
  return { zip: doc.getZip(), linkItems: prepared.linkItems };
}
async function exportDocx(month: string, items: NewsItem[]) {
  const { zip: outZip, linkItems } = await renderTemplateDocx(month, items);
  const documentPath = 'word/document.xml';
  const relsPath = 'word/_rels/document.xml.rels';
  const currentDocumentXml = outZip.file(documentPath)?.asText() ?? '';
  const currentRelsXml = outZip.file(relsPath)?.asText() ?? '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
  const { documentXml, relsXml } = applyHyperlinks(currentDocumentXml, currentRelsXml, linkItems);
  outZip.file(documentPath, documentXml);
  outZip.file(relsPath, relsXml);
  const blob = outZip.generate({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  saveAs(blob, `${issueTitle(month)}.docx`);
}

export default function App() {
  const draft = useMemo(getInitialDraft, []);
  const [month, setMonth] = useState(draft.month);
  const [step, setStep] = useState<WizardStep>(draft.step);
  const [reviewRegion, setReviewRegion] = useState<Region>(draft.reviewRegion);
  const [sources, setSources] = useState<SourceEntry[]>(getInitialSources);
  const [items, setItems] = useState<NewsItem[]>(draft.items);
  const [initialJson, setInitialJson] = useState('');
  const [supplementJson, setSupplementJson] = useState('');
  const [supplementRegion, setSupplementRegion] = useState<SupplementRegion>('domestic');
  const [supplementMode, setSupplementMode] = useState<SupplementMode>('fill');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [view, setView] = useState<'home' | 'workbench'>('home');
  const [preferredModel, setPreferredModel] = useState<ModelKey>(getInitialModel);

  const domesticItems = sortItemsByDate(items.filter((item) => item.region === 'domestic'));
  const overseasItems = sortItemsByDate(items.filter((item) => item.region === 'overseas'));
  const activeReviewItems = reviewRegion === 'domestic' ? domesticItems : overseasItems;
  const domesticNeed = Math.max(0, 10 - domesticItems.length);
  const overseasNeed = Math.max(0, 10 - overseasItems.length);
  const selectedRegionNeed = supplementRegion === 'both' ? domesticNeed + overseasNeed : Math.max(0, 10 - countByRegion(items, supplementRegion));
  const supplementCount = supplementMode === 'single' ? Math.min(1, selectedRegionNeed) : selectedRegionNeed;
  const prompt = useMemo(() => buildPrompt(month, sources), [month, sources]);
  const domesticSupplementCount = supplementMode === 'single' ? Math.min(1, domesticNeed) : domesticNeed;
  const overseasSupplementCount = supplementMode === 'single' ? Math.min(1, overseasNeed) : overseasNeed;
  const domesticSupplementPrompt = useMemo(() => buildSupplementPrompt(month, items, sources, 'domestic', Math.max(1, domesticSupplementCount)), [month, items, sources, domesticSupplementCount]);
  const overseasSupplementPrompt = useMemo(() => buildSupplementPrompt(month, items, sources, 'overseas', Math.max(1, overseasSupplementCount)), [month, items, sources, overseasSupplementCount]);
  const editingItem = items.find((item) => item.id === editingId) ?? null;
  const fileName = `${issueTitle(month)}.docx`;

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ month, items, step, reviewRegion }));
    } catch {
      // Ignore storage failures in private browsing modes.
    }
  }, [month, items, step, reviewRegion]);

  useEffect(() => {
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, preferredModel);
    } catch {
      // Ignore storage failures in private browsing modes.
    }
  }, [preferredModel]);

  const updateItem = (id: string, patch: Partial<NewsItem>) => setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  const addItem = (region: Region) => {
    const item = createItem({ region, date: `${month}-01` });
    setItems((current) => sortItemsByDate([...current, item]));
    setReviewRegion(region);
    setEditingId(item.id);
  };
  const removeItem = (id: string) => {
    setItems((current) => current.filter((item) => item.id !== id));
    setEditingId((current) => (current === id ? null : current));
  };
  const parseJson = (json: string) => parseGeminiPayload(json, month, sources);
  const handleInitialParse = () => {
    try {
      const result = parseJson(initialJson);
      const normalized = result.items;
      setItems(normalized);
      setInitialJson('');
      const nextStep = isComplete(normalized) ? 'review' : 'supplement';
      setStep(nextStep);
      setSupplementRegion(countByRegion(normalized, 'domestic') < 10 && countByRegion(normalized, 'overseas') < 10 ? 'both' : countByRegion(normalized, 'domestic') < 10 ? 'domestic' : 'overseas');
      setNotice(`${result.message} 境内 ${countByRegion(normalized, 'domestic')} 条，域外 ${countByRegion(normalized, 'overseas')} 条。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'JSON 解析失败。');
    }
  };
  const handleSupplementAppend = () => {
    try {
      const result = parseJson(supplementJson);
      const incoming = result.items.filter((item) => supplementRegion === 'both' || item.region === supplementRegion);
      setItems((current) => {
        const seenUrls = new Set(current.map((item) => item.url.trim()).filter(Boolean));
        const seenTitles = new Set(current.map((item) => item.title.trim()).filter(Boolean));
        const merged = sortItemsByDate([...current, ...incoming.filter((item) => !seenUrls.has(item.url.trim()) && !seenTitles.has(item.title.trim()))]);
        if (isComplete(merged)) setStep('review');
        setNotice(`${result.message} 追加后境内 ${countByRegion(merged, 'domestic')} 条，域外 ${countByRegion(merged, 'overseas')} 条。`);
        return merged;
      });
      setSupplementJson('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'JSON 追加失败。');
    }
  };
  const handleExport = async () => {
    try {
      const unchecked = items.filter((item) => !item.verified).length;
      if (unchecked > 0) {
        const ok = window.confirm(`还有 ${unchecked} 条未勾选「已核验」。仍要导出吗?`);
        if (!ok) return;
      }
      await exportDocx(month, items);
      setNotice(`已导出 ${fileName}`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '导出失败。');
    }
  };
  const copyPrompt = async () => {
    await navigator.clipboard.writeText(prompt);
    setNotice('第一轮提示词已复制。');
  };
  const copySupplementPrompt = async (region: Region) => {
    const count = region === 'domestic' ? domesticSupplementCount : overseasSupplementCount;
    if (count <= 0) {
      setNotice(`${REGION_LABEL[region]}已达到 10 条参考目标，仍可手动新增或编辑。`);
      return;
    }
    await navigator.clipboard.writeText(region === 'domestic' ? domesticSupplementPrompt : overseasSupplementPrompt);
    setNotice(`补足提示词已复制：${REGION_LABEL[region]}最多 ${count} 条。`);
  };
  const updateSource = (id: string, patch: Partial<SourceEntry>) => setSources((current) => current.map((source) => (source.id === id ? { ...source, ...patch } : source)));
  const addSource = (region: Region, type: SourceType) => setSources((current) => [...current, { id: randomId(), region, type, name: '', url: '' }]);
  const deleteSource = (id: string) => setSources((current) => current.filter((source) => source.id !== id));
  const saveSources = () => {
    const cleaned = cleanSources(sources);
    setSources(cleaned);
    localStorage.setItem(SOURCE_STORAGE_KEY, JSON.stringify(cleaned));
    setNotice('来源清单已保存。');
  };
  const resetSources = () => {
    setSources(DEFAULT_SOURCES);
    localStorage.setItem(SOURCE_STORAGE_KEY, JSON.stringify(DEFAULT_SOURCES));
    setNotice('来源清单已恢复默认。');
  };
  const clearDraft = () => {
    setItems([]);
    setInitialJson('');
    setSupplementJson('');
    setEditingId(null);
    setStep('sources');
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    setNotice('本月草稿已清空。');
  };
  const openModel = (model: ModelKey) => {
    const target = MODELS.find((item) => item.key === model);
    if (!target) return;
    setPreferredModel(model);
    window.open(target.url, '_blank', 'noreferrer');
  };
  const modelProps = { preferredModel, onOpenModel: openModel };

  if (view === 'home') {
    return <HomePage domesticCount={domesticItems.length} overseasCount={overseasItems.length} onStart={() => { setStep('sources'); setView('workbench'); }} onContinue={() => setView('workbench')} />;
  }

  return (
    <div className="min-h-screen bg-[#050505] text-white tracking-[-0.02em]">
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_20%_0%,rgba(232,112,42,0.18),transparent_30%),radial-gradient(circle_at_85%_10%,rgba(255,255,255,0.08),transparent_28%),linear-gradient(180deg,#070707,#0f0f10_42%,#050505)]" />
      <header className="mx-auto flex max-w-[1440px] items-center justify-between gap-5 px-6 py-5">
        <BrandLockup />
        <div className="flex flex-wrap items-end justify-end gap-3">
          <label className="grid gap-1 text-xs font-semibold text-white/55">
            月份
            <input className={`${FIELD_CLASS} w-[180px]`} type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </label>
          <button type="button" className={SECONDARY_BUTTON} onClick={() => setView('home')}>首页</button>
          <button type="button" className={SECONDARY_BUTTON} onClick={clearDraft}>清空草稿</button>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-6 pb-10">
        <section className={`${GLASS_PANEL} mb-5 p-5`}>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-accent">Auto Compliance Briefing</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white">汽车数据合规月度快讯工作台</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/65">复制提示词、粘贴 JSON、真实优先核验链接并导出 Word。配额仅作参考，够了即可导出。</p>
            </div>
            <div className="max-w-xl text-right text-xs leading-6 text-white/55">
              <span>境内 {domesticItems.length}/10 参考</span>
              <span className="mx-2 text-white/25">·</span>
              <span>域外 {overseasItems.length}/10 参考</span>
              <span className="mx-2 text-white/25">·</span>
              <span>真实月末 {monthRange(month).end}</span>
              <span className="mx-2 text-white/25">·</span>
              <span>{fileName}</span>
            </div>
          </div>
        </section>
        <StepNav step={step} onStep={setStep} />
        {notice ? <div className="mb-5 rounded-2xl border border-accent/25 bg-accent/10 px-4 py-3 text-sm text-orange-100 shadow-xl shadow-black/20 backdrop-blur">{notice}</div> : null}
        {step === 'sources' ? <SourceStep sources={sources} onUpdate={updateSource} onAdd={addSource} onDelete={deleteSource} onSave={saveSources} onReset={resetSources} onNext={() => setStep('initial')} /> : null}
        {step === 'initial' ? <InitialStep value={initialJson} onChange={setInitialJson} onCopy={copyPrompt} onParse={handleInitialParse} onBack={() => setStep('sources')} {...modelProps} /> : null}
        {step === 'supplement' ? <SupplementStep value={supplementJson} onChange={setSupplementJson} region={supplementRegion} mode={supplementMode} need={selectedRegionNeed} count={supplementCount} domesticNeed={domesticNeed} overseasNeed={overseasNeed} domesticPromptCount={domesticSupplementCount} overseasPromptCount={overseasSupplementCount} domesticCount={domesticItems.length} overseasCount={overseasItems.length} onRegion={setSupplementRegion} onMode={setSupplementMode} onCopy={copySupplementPrompt} onAppend={handleSupplementAppend} onBack={() => setStep('initial')} onReview={() => setStep('review')} {...modelProps} /> : null}
        {step === 'review' ? <ReviewStep region={reviewRegion} items={activeReviewItems} domesticCount={domesticItems.length} overseasCount={overseasItems.length} onRegion={setReviewRegion} onEdit={setEditingId} onDelete={removeItem} onAdd={addItem} onUpdate={updateItem} onBack={() => setStep('supplement')} onExport={handleExport} {...modelProps} /> : null}
      </main>
      {editingItem ? <EditModal item={editingItem} onUpdate={updateItem} onClose={() => setEditingId(null)} onDelete={removeItem} /> : null}
    </div>
  );
}

function Pill({ children }: { children: ReactNode }) {
  return <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-white/70">{children}</span>;
}

function BrandLockup() {
  return (
    <div className="flex items-center gap-3">
      <LogoMark />
      <span className="font-serif-cjk text-2xl font-semibold tracking-[-0.03em] text-white">Calvin</span>
    </div>
  );
}

function LogoMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 256 256" aria-hidden="true" className="shrink-0">
      <path fill="#ffffff" d="M 256 256 L 128 256 L 0 128 L 128 128 Z M 256 128 L 128 128 L 0 0 L 128 0 Z" />
    </svg>
  );
}

function ModelLinks({ preferredModel, onOpenModel }: { preferredModel: ModelKey; onOpenModel: (model: ModelKey) => void }) {
  const selected = MODELS.find((model) => model.key === preferredModel) ?? MODELS[0];
  return (
    <div className="grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs font-semibold text-white/45">检索模型:</span>
        {MODELS.map((model) => (
          <button
            key={model.key}
            type="button"
            onClick={() => onOpenModel(model.key)}
            className={`rounded-full border px-4 py-2 text-sm font-semibold transition-all ${preferredModel === model.key ? 'border-accent/70 bg-accent/20 text-orange-100 shadow-lg shadow-accent/10' : 'border-white/15 bg-white/5 text-white/70 hover:border-white/30 hover:bg-white/10 hover:text-white'}`}
          >
            {model.name}
          </button>
        ))}
      </div>
      <p className="text-xs text-white/45">{selected.hint}</p>
    </div>
  );
}

function RevealLayer({ image, cursorX, cursorY }: { image: string; cursorX: number; cursorY: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [maskImage, setMaskImage] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const gradient = ctx.createRadialGradient(cursorX, cursorY, 0, cursorX, cursorY, SPOTLIGHT_R);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.4, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.6, 'rgba(255,255,255,0.75)');
    gradient.addColorStop(0.75, 'rgba(255,255,255,0.4)');
    gradient.addColorStop(0.88, 'rgba(255,255,255,0.12)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cursorX, cursorY, SPOTLIGHT_R, 0, Math.PI * 2);
    ctx.fill();
    setMaskImage(`url(${canvas.toDataURL()})`);
  }, [cursorX, cursorY]);

  return (
    <>
      <canvas ref={canvasRef} className="absolute inset-0 pointer-events-none" style={{ display: 'none' }} />
      <div
        className="pointer-events-none absolute inset-0 z-30 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${image})`, maskImage, WebkitMaskImage: maskImage, maskSize: '100% 100%', WebkitMaskSize: '100% 100%' }}
      />
    </>
  );
}

function HomePage({ domesticCount, overseasCount, onStart, onContinue }: { domesticCount: number; overseasCount: number; onStart: () => void; onContinue: () => void }) {
  const mouse = useRef({ x: -999, y: -999 });
  const smooth = useRef({ x: -999, y: -999 });
  const rafRef = useRef<number | null>(null);
  const [cursorPos, setCursorPos] = useState({ x: -999, y: -999 });

  useEffect(() => {
    const handleMove = (event: MouseEvent) => {
      mouse.current = { x: event.clientX, y: event.clientY };
    };
    const tick = () => {
      smooth.current.x += (mouse.current.x - smooth.current.x) * 0.1;
      smooth.current.y += (mouse.current.y - smooth.current.y) * 0.1;
      setCursorPos({ x: smooth.current.x, y: smooth.current.y });
      rafRef.current = requestAnimationFrame(tick);
    };
    window.addEventListener('mousemove', handleMove);
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return (
    <div className="min-h-screen bg-white tracking-[-0.02em]">
      <nav className="fixed left-0 right-0 top-0 z-[100] flex items-center justify-between p-4 sm:p-5">
        <BrandLockup />
        <button type="button" onClick={onContinue} className="hidden rounded-full bg-white px-6 py-2.5 text-sm font-semibold text-gray-900 hover:bg-gray-100 md:block">进入工作台</button>
        <button type="button" onClick={onContinue} className="rounded-full border border-white/30 bg-white/15 px-4 py-2 text-sm font-semibold text-white backdrop-blur md:hidden">进入工作台</button>
      </nav>
      <section className="relative w-full overflow-hidden bg-black" style={{ height: '100dvh' }}>
        <div className="hero-zoom absolute inset-0 z-10 bg-cover bg-center bg-no-repeat" style={{ backgroundImage: `url(${BG_IMAGE_1})` }} />
        <RevealLayer image={BG_IMAGE_2} cursorX={cursorPos.x} cursorY={cursorPos.y} />
        <div className="pointer-events-none absolute left-0 right-0 top-[14%] z-50 flex flex-col items-center px-5 text-center">
          <h1 className="leading-[0.95] text-white">
            <span className="hero-anim hero-reveal font-serif-cjk block text-5xl font-semibold sm:text-7xl md:text-8xl" style={{ letterSpacing: '0.02em', animationDelay: '0.25s' }}>合规万象</span>
            <span className="hero-anim hero-reveal font-serif-cjk mt-1 block text-5xl font-semibold sm:text-7xl md:text-8xl" style={{ letterSpacing: '0.015em', animationDelay: '0.42s' }}>凝成月度一报</span>
          </h1>
        </div>
        <div className="hero-anim hero-fade absolute bottom-14 left-10 z-50 hidden max-w-[260px] sm:block md:left-14" style={{ animationDelay: '0.7s' }}>
          <p className="text-sm leading-relaxed text-white/80">每月汇聚境内与域外的汽车数据合规动态,从监管法规到处罚案例,逐条沉淀为可核验的情报。</p>
        </div>
        <div className="hero-anim hero-fade absolute bottom-10 left-5 right-5 z-50 flex max-w-full flex-col items-start gap-4 sm:bottom-24 sm:left-auto sm:right-10 sm:max-w-[260px] sm:gap-5 md:right-14" style={{ animationDelay: '0.85s' }}>
          <p className="text-xs leading-relaxed text-white/80 sm:text-sm">从参考来源检索,到境内、域外各 10 条快讯补足,再到 Word 母版导出,把月度合规简报流程收进一个工作台。</p>
          <button type="button" className="rounded-full bg-[#e8702a] px-7 py-3 text-sm font-medium text-white transition-all hover:scale-[1.03] hover:bg-[#d2611f] hover:shadow-lg hover:shadow-[#e8702a]/30 active:scale-95" onClick={onStart}>开始生成</button>
          <div className="text-xs leading-5 text-white/65">
            <span>当前草稿 境内 {domesticCount}/10 · 域外 {overseasCount}/10</span>
            <button type="button" onClick={onContinue} className="ml-3 font-semibold text-white underline decoration-white/30 underline-offset-4 hover:decoration-white">继续草稿</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function StepNav({ step, onStep }: { step: WizardStep; onStep: (step: WizardStep) => void }) {
  const activeIndex = STEPS.findIndex((item) => item.key === step);
  return (
    <nav className="mb-6 rounded-2xl border border-white/10 bg-white/[0.035] px-5 py-4">
      <div className="grid grid-cols-4 items-start">
      {STEPS.map((item, index) => (
        <div key={item.key} className="relative flex flex-col items-center">
          {index < STEPS.length - 1 ? <div className={`absolute left-1/2 top-4 h-px w-full ${index < activeIndex ? 'bg-accent/70' : 'bg-white/12'}`} /> : null}
          <button
            type="button"
            className={`relative z-10 grid h-8 w-8 place-items-center rounded-full border text-sm font-semibold transition-all ${item.key === step ? 'border-accent bg-accent text-white shadow-lg shadow-accent/25' : index < activeIndex ? 'border-accent/60 bg-accent/25 text-orange-100' : 'border-white/15 bg-[#111] text-white/45 hover:border-white/30 hover:text-white/75'}`}
            onClick={() => onStep(item.key)}
            aria-label={item.label}
          >
            {index < activeIndex ? '✓' : index + 1}
          </button>
          <button
            type="button"
            className={`relative z-10 mt-2 text-sm font-semibold transition-colors ${item.key === step ? 'text-white' : index < activeIndex ? 'text-orange-100/80' : 'text-white/42 hover:text-white/70'}`}
            onClick={() => onStep(item.key)}
          >
            {item.label}
          </button>
        </div>
      ))}
      </div>
    </nav>
  );
}

function SectionHead({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <h2 className="text-2xl font-semibold tracking-[-0.04em] text-white">{title}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-white/65">{children}</p>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

function SourceStep({ sources, onUpdate, onAdd, onDelete, onSave, onReset, onNext }: { sources: SourceEntry[]; onUpdate: (id: string, patch: Partial<SourceEntry>) => void; onAdd: (region: Region, type: SourceType) => void; onDelete: (id: string) => void; onSave: () => void; onReset: () => void; onNext: () => void }) {
  const count = (region: Region, type: SourceType) => sources.filter((source) => source.region === region && source.type === type).length;
  return (
    <section className={`${GLASS_PANEL} p-6`}>
      <SectionHead title="确认来源" actions={<><button type="button" onClick={onReset} className={SECONDARY_BUTTON}>恢复默认</button><button type="button" onClick={onSave} className={SECONDARY_BUTTON}>保存来源</button><button type="button" onClick={onNext} className={PRIMARY_BUTTON}>下一步</button></>}>
        来源按国内 / 国外与公众号 / 网页分组。旧草稿来源会自动补国内外字段,保存后提示词立即使用新清单。
      </SectionHead>
      <div className="mb-5 grid gap-2 text-sm text-white/65 sm:grid-cols-2 lg:grid-cols-4">
        <Pill>国内公众号 {count('domestic', 'wechat')}</Pill>
        <Pill>国内网页 {count('domestic', 'web')}</Pill>
        <Pill>国外公众号 {count('overseas', 'wechat')}</Pill>
        <Pill>国外网页 {count('overseas', 'web')}</Pill>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        {(['domestic', 'overseas'] as Region[]).map((region) => (
          <div key={region} className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <h3 className="mb-4 text-lg font-semibold text-white">{region === 'domestic' ? '🇨🇳 国内' : '🌍 国外'}</h3>
            <div className="grid gap-4 lg:grid-cols-2">
              {(['wechat', 'web'] as SourceType[]).map((type) => (
                <SourceColumn key={`${region}-${type}`} region={region} type={type} sources={sources.filter((source) => source.region === region && source.type === type)} onUpdate={onUpdate} onAdd={onAdd} onDelete={onDelete} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SourceColumn({ region, type, sources, onUpdate, onAdd, onDelete }: { region: Region; type: SourceType; sources: SourceEntry[]; onUpdate: (id: string, patch: Partial<SourceEntry>) => void; onAdd: (region: Region, type: SourceType) => void; onDelete: (id: string) => void }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-white/85">{type === 'wechat' ? '公众号' : '网页'}</h4>
        <button type="button" onClick={() => onAdd(region, type)} className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-white/70 hover:bg-white/10">增加</button>
      </div>
      <div className="grid gap-2">
        {sources.map((source) => (
          <div key={source.id} className={`grid gap-2 ${type === 'web' ? 'xl:grid-cols-[0.8fr_1.2fr_auto]' : 'xl:grid-cols-[1fr_auto]'}`}>
            <input className={FIELD_CLASS} value={source.name} onChange={(event) => onUpdate(source.id, { name: event.target.value })} placeholder={type === 'wechat' ? '公众号名称' : '网页名称'} />
            {type === 'web' ? <input className={FIELD_CLASS} value={source.url} onChange={(event) => onUpdate(source.id, { url: event.target.value })} placeholder="https://..." /> : null}
            <button type="button" className={DANGER_BUTTON} onClick={() => onDelete(source.id)}>删除</button>
          </div>
        ))}
        {sources.length === 0 ? <div className="rounded-xl border border-dashed border-white/15 px-4 py-6 text-center text-sm text-white/40">暂无来源</div> : null}
      </div>
    </div>
  );
}

function InitialStep({ value, onChange, onCopy, onParse, onBack, preferredModel, onOpenModel }: { value: string; onChange: (value: string) => void; onCopy: () => void; onParse: () => void; onBack: () => void; preferredModel: ModelKey; onOpenModel: (model: ModelKey) => void }) {
  return (
    <section className={`${GLASS_PANEL} p-6`}>
      <SectionHead title="第一轮生成" actions={<><button type="button" onClick={onBack} className={SECONDARY_BUTTON}>上一步</button><button type="button" className={PRIMARY_BUTTON} onClick={onCopy}>复制第一轮提示词</button></>}>
        复制提示词给模型。第一轮境内、域外各 5 条,第二轮再补足。
      </SectionHead>
      <div className="mb-5"><ModelLinks preferredModel={preferredModel} onOpenModel={onOpenModel} /></div>
      <div className="grid max-w-5xl gap-4">
        <label className="grid gap-2 text-sm font-semibold text-white/60">
          粘贴模型返回的第一轮 JSON
          <textarea className={`${FIELD_CLASS} min-h-[320px] font-mono text-xs leading-6`} value={value} onChange={(event) => onChange(event.target.value)} placeholder="在此粘贴第一轮 JSON" />
        </label>
        <button type="button" className={`${PRIMARY_BUTTON} w-fit`} onClick={onParse}>解析第一轮结果</button>
      </div>
    </section>
  );
}

function SupplementStep({ value, onChange, region, mode, need, count, domesticNeed, overseasNeed, domesticPromptCount, overseasPromptCount, domesticCount, overseasCount, onRegion, onMode, onCopy, onAppend, onBack, onReview, preferredModel, onOpenModel }: { value: string; onChange: (value: string) => void; region: SupplementRegion; mode: SupplementMode; need: number; count: number; domesticNeed: number; overseasNeed: number; domesticPromptCount: number; overseasPromptCount: number; domesticCount: number; overseasCount: number; onRegion: (region: SupplementRegion) => void; onMode: (mode: SupplementMode) => void; onCopy: (region: Region) => void; onAppend: () => void; onBack: () => void; onReview: () => void; preferredModel: ModelKey; onOpenModel: (model: ModelKey) => void }) {
  const regionLabel = region === 'both' ? '境内和域外' : REGION_LABEL[region];
  return (
    <section className={`${GLASS_PANEL} p-6`}>
      <SectionHead title="补足缺口" actions={<><button type="button" onClick={onBack} className={SECONDARY_BUTTON}>上一步</button><button type="button" onClick={onReview} className={SECONDARY_BUTTON}>进入审核</button></>}>
        选择区域和补足方式。选择“境内+域外”时分别复制对应区域提示词;少于 10 条也可进入审核。
      </SectionHead>
      <div className="mb-5 grid gap-3 md:grid-cols-2">
        <ProgressCard label={`境内 ${domesticCount}/10 参考`} count={domesticCount} />
        <ProgressCard label={`域外 ${overseasCount}/10 参考`} count={overseasCount} />
      </div>
      <div className="mb-5 grid gap-4 lg:grid-cols-[1fr_1fr_260px]">
        <label className="grid gap-2 text-sm font-semibold text-white/60">补足区域<select className={FIELD_CLASS} value={region} onChange={(event) => onRegion(event.target.value as SupplementRegion)}><option value="both">境内 + 域外</option><option value="domestic">境内</option><option value="overseas">域外</option></select></label>
        <label className="grid gap-2 text-sm font-semibold text-white/60">补足方式<select className={FIELD_CLASS} value={mode} onChange={(event) => onMode(event.target.value as SupplementMode)}><option value="fill">最多补到 10 条</option><option value="single">最多补 1 条</option></select></label>
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <span className="text-xs font-semibold text-white/45">{regionLabel}参考缺口</span>
          <strong className="mt-1 block text-3xl font-semibold text-white">{need} 条</strong>
          <small className="mt-1 block text-white/45">{region === 'both' ? `本次最多境内 ${domesticPromptCount} 条,域外 ${overseasPromptCount} 条` : `本次提示词最多要求补 ${count} 条`}</small>
        </div>
      </div>
      <div className="mb-5"><ModelLinks preferredModel={preferredModel} onOpenModel={onOpenModel} /></div>
      <div className="mb-4 flex flex-wrap gap-2">
        {region === 'both' ? <><button type="button" className={PRIMARY_BUTTON} onClick={() => onCopy('domestic')} disabled={domesticNeed <= 0}>复制境内补足提示词</button><button type="button" className={PRIMARY_BUTTON} onClick={() => onCopy('overseas')} disabled={overseasNeed <= 0}>复制域外补足提示词</button></> : <button type="button" className={PRIMARY_BUTTON} onClick={() => onCopy(region)}>复制补足提示词</button>}
      </div>
      <div className="grid max-w-5xl gap-4">
        <label className="grid gap-2 text-sm font-semibold text-white/60">
          粘贴模型返回的补足 JSON
          <textarea className={`${FIELD_CLASS} min-h-[280px] font-mono text-xs leading-6`} value={value} onChange={(event) => onChange(event.target.value)} placeholder={region === 'both' ? '可先粘贴境内补足 JSON 追加,再粘贴域外补足 JSON 追加' : '在此粘贴补足 JSON'} />
        </label>
        <button type="button" className={`${PRIMARY_BUTTON} w-fit`} onClick={onAppend}>解析并追加</button>
      </div>
    </section>
  );
}

function ProgressCard({ label, count }: { label: string; count: number }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-4">
      <strong className="text-sm font-semibold text-white/80">{label}</strong>
      <span className="mt-3 block h-2 rounded-full bg-white/10"><span className="block h-2 rounded-full bg-accent" style={{ width: `${Math.min(100, count * 10)}%` }} /></span>
    </div>
  );
}

function ReviewStep({ region, items, domesticCount, overseasCount, onRegion, onEdit, onDelete, onAdd, onUpdate, onBack, onExport, preferredModel, onOpenModel }: { region: Region; items: NewsItem[]; domesticCount: number; overseasCount: number; onRegion: (region: Region) => void; onEdit: (id: string) => void; onDelete: (id: string) => void; onAdd: (region: Region) => void; onUpdate: (id: string, patch: Partial<NewsItem>) => void; onBack: () => void; onExport: () => void; preferredModel: ModelKey; onOpenModel: (model: ModelKey) => void }) {
  return (
    <section className={`${GLASS_PANEL} p-6`}>
      <SectionHead title="审核与导出" actions={<><button type="button" onClick={onBack} className={SECONDARY_BUTTON}>返回补足</button><button type="button" className={PRIMARY_BUTTON} onClick={onExport}>导出 Word</button></>}>
        如链接无法打开,或不是原文页,请手动检索后替换为准确链接。
      </SectionHead>
      <div className="mb-5"><ModelLinks preferredModel={preferredModel} onOpenModel={onOpenModel} /></div>
      <div className="mb-6 flex flex-col gap-4 border-b border-white/10 pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex gap-8">
          <button type="button" className={`border-b-2 pb-3 text-sm font-semibold transition-colors ${region === 'domestic' ? 'border-accent text-white' : 'border-transparent text-white/45 hover:text-white/75'}`} onClick={() => onRegion('domestic')}>境内动态 <span className="ml-1 text-white/45">{domesticCount}/10</span></button>
          <button type="button" className={`border-b-2 pb-3 text-sm font-semibold transition-colors ${region === 'overseas' ? 'border-accent text-white' : 'border-transparent text-white/45 hover:text-white/75'}`} onClick={() => onRegion('overseas')}>域外动态 <span className="ml-1 text-white/45">{overseasCount}/10</span></button>
        </div>
        <button type="button" className={SECONDARY_BUTTON} onClick={() => onAdd(region)}>新增条目</button>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {items.length === 0 ? <div className="rounded-2xl border border-dashed border-white/15 bg-white/5 p-8 text-center text-white/40">暂无条目</div> : items.map((item, index) => {
          const cardClass = item.verified ? 'border-emerald-400/35 bg-emerald-500/10' : 'border-white/10 bg-white/[0.045]';
          return (
            <article className={`rounded-2xl border p-5 transition-all ${cardClass}`} key={item.id}>
              <div className="flex items-start gap-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-sm font-semibold text-white/70">{index + 1}</span>
                <strong className="text-lg font-semibold tracking-[-0.03em] text-white">{item.title || '未命名条目'}</strong>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-white/45"><span>{item.date}</span><span>{item.source_name || '待补充来源'}</span></div>
              <p className="mt-3 line-clamp-3 min-h-[4.5em] text-sm leading-6 text-white/68">{item.summary || '暂无摘要'}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <a className={SECONDARY_BUTTON} href={item.url || '#'} target="_blank" rel="noreferrer">打开原文</a>
                <label className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white/75"><input className="h-4 w-4 accent-[#e8702a]" type="checkbox" checked={!!item.verified} onChange={(event) => onUpdate(item.id, { verified: event.target.checked })} /> 已核验</label>
                <button type="button" className={SECONDARY_BUTTON} onClick={() => onEdit(item.id)}>编辑</button>
                <button type="button" className={DANGER_BUTTON} onClick={() => onDelete(item.id)}>删除</button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function EditModal({ item, onUpdate, onClose, onDelete }: { item: NewsItem; onUpdate: (id: string, patch: Partial<NewsItem>) => void; onClose: () => void; onDelete: (id: string) => void }) {
  return (
    <div className="fixed inset-0 z-[200] grid place-items-center bg-black/70 p-6 backdrop-blur">
      <div className="max-h-[calc(100vh-48px)] w-full max-w-3xl overflow-auto rounded-3xl border border-white/10 bg-[#111] p-6 shadow-2xl shadow-black">
        <SectionHead title="编辑条目" actions={<button type="button" onClick={onClose} className={SECONDARY_BUTTON}>关闭</button>}>
          核验链接后,可以在这里替换标题、摘要或原文链接。
        </SectionHead>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm font-semibold text-white/60">发布日期<input className={FIELD_CLASS} value={item.date} onChange={(event) => onUpdate(item.id, { date: event.target.value })} /></label>
          <label className="grid gap-2 text-sm font-semibold text-white/60">地域<select className={FIELD_CLASS} value={item.region} onChange={(event) => onUpdate(item.id, { region: event.target.value as Region })}><option value="domestic">境内</option><option value="overseas">域外</option></select></label>
          <label className="grid gap-2 text-sm font-semibold text-white/60 md:col-span-2">新闻标题<input className={FIELD_CLASS} value={item.title} onChange={(event) => onUpdate(item.id, { title: event.target.value })} /></label>
          <label className="grid gap-2 text-sm font-semibold text-white/60 md:col-span-2">正文摘要<textarea className={FIELD_CLASS} rows={5} value={item.summary} onChange={(event) => onUpdate(item.id, { summary: event.target.value })} /></label>
          <label className="grid gap-2 text-sm font-semibold text-white/60 md:col-span-2">来源名称<input className={FIELD_CLASS} value={item.source_name} onChange={(event) => onUpdate(item.id, { source_name: event.target.value })} /></label>
          <label className="grid gap-2 text-sm font-semibold text-white/60 md:col-span-2">原文链接<input className={FIELD_CLASS} value={item.url} onChange={(event) => onUpdate(item.id, { url: event.target.value })} placeholder="https://..." /></label>
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <a className={SECONDARY_BUTTON} href={item.url || '#'} target="_blank" rel="noreferrer">打开原文</a>
          <button type="button" className={DANGER_BUTTON} onClick={() => { onDelete(item.id); onClose(); }}>删除条目</button>
          <button type="button" className={PRIMARY_BUTTON} onClick={onClose}>完成</button>
        </div>
      </div>
    </div>
  );
}
