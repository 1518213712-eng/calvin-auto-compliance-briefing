import { useEffect, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';
import { z } from 'zod';
import { saveAs } from 'file-saver';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

dayjs.extend(customParseFormat);

type Region = 'domestic' | 'overseas';
type SourceType = 'wechat' | 'web';
type WizardStep = 'sources' | 'initial' | 'supplement' | 'review';
type SupplementMode = 'fill' | 'single';
type SupplementRegion = Region | 'both';
type SourceEntry = { id: string; type: SourceType; name: string; url: string };
type NewsItem = { id: string; region: Region; date: string; title: string; summary: string; source_name: string; url: string };
type RenderItem = NewsItem & { link_token: string; display_summary: string };
type ParsedItem = Omit<NewsItem, 'id' | 'source_name'> & { source_name?: string };
type ParsedPayload = { issue_month: string; date_range: { start: string; end: string }; items: ParsedItem[] };
type DraftState = { month: string; items: NewsItem[]; step: WizardStep; reviewRegion: Region };

const DEFAULT_SOURCES: SourceEntry[] = [
  { id: 'wechat-caam', type: 'wechat', name: '中国汽车工业协会', url: '' },
  { id: 'wechat-artiauto', type: 'wechat', name: 'ArtiAuto', url: '' },
  { id: 'wechat-jiangxin', type: 'wechat', name: '匠歆汽车', url: '' },
  { id: 'wechat-caict', type: 'wechat', name: '中国信通院CAICT', url: '' },
  { id: 'wechat-sh-v2x', type: 'wechat', name: '上海市车联网协会', url: '' },
  { id: 'wechat-miit', type: 'wechat', name: '工信微报', url: '' },
  { id: 'wechat-eai100', type: 'wechat', name: 'EAI 100', url: '' },
  { id: 'wechat-tansi', type: 'wechat', name: '谈思汽车', url: '' },
  { id: 'wechat-reuters', type: 'wechat', name: '路透财经早报', url: '' },
  { id: 'wechat-cpca', type: 'wechat', name: '乘联分会', url: '' },
  { id: 'wechat-security', type: 'wechat', name: '工业互联网和车联网安全中心', url: '' },
  { id: 'wechat-cicv', type: 'wechat', name: 'CICV创新中心', url: '' },
  { id: 'wechat-data-compliance', type: 'wechat', name: '智能网联汽车与数据合规', url: '' },
  { id: 'wechat-wpc', type: 'wechat', name: 'WPC数字化出海', url: '' },
  { id: 'web-miit-auto', type: 'web', name: '工业与信息化部-汽车工业', url: 'https://www.miit.gov.cn/jgsj/zbys/qcgy/index.html' },
  { id: 'web-cnauto', type: 'web', name: '中国汽车报', url: 'http://www.cnautonews.com/yaowen/list_160_1.html' },
  { id: 'web-unece', type: 'web', name: '联合国世界车辆法规协调论坛/UNECE', url: 'https://unece.org/' },
  { id: 'web-gov-policy', type: 'web', name: '国务院政策文件库', url: 'https://www.gov.cn/zhengce/zhengcewenjianku/' },
];
const SOURCE_STORAGE_KEY = 'car-news-monthly-workbench:structured-sources';
const DRAFT_STORAGE_KEY = 'car-news-monthly-workbench:wizard-draft';
const assetUrl = (path: string) => `${import.meta.env.BASE_URL}${path}`;
const STEPS: { key: WizardStep; label: string }[] = [
  { key: 'sources', label: '来源' },
  { key: 'initial', label: '第一轮' },
  { key: 'supplement', label: '补足' },
  { key: 'review', label: '审核导出' },
];

const ITEM_SCHEMA = z.object({
  region: z.enum(['domestic', 'overseas']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().min(1),
  summary: z.string().min(1),
  source_name: z.string().optional(),
  url: z.string().url(),
});
const PAYLOAD_SCHEMA = z.object({
  issue_month: z.string().regex(/^\d{4}-\d{2}$/),
  date_range: z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  items: z.array(ITEM_SCHEMA),
});
const DEFAULT_MONTH = dayjs().format('YYYY-MM');

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
function cleanSources(sources: SourceEntry[]) {
  return sources.map((source) => ({ ...source, name: source.name.trim(), url: source.url.trim() })).filter((source) => source.name);
}
function getInitialSources() {
  try {
    const stored = localStorage.getItem(SOURCE_STORAGE_KEY);
    if (stored) return cleanSources(JSON.parse(stored) as SourceEntry[]);
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
        items: Array.isArray(draft.items) ? draft.items : [],
        step: draft.step || 'sources',
        reviewRegion: draft.reviewRegion || 'domestic',
      };
    }
  } catch {
    return { month: DEFAULT_MONTH, items: [], step: 'sources', reviewRegion: 'domestic' };
  }
  return { month: DEFAULT_MONTH, items: [], step: 'sources', reviewRegion: 'domestic' };
}
function sourceNames(sources: SourceEntry[], type: SourceType) {
  return cleanSources(sources).filter((source) => source.type === type);
}
function inferSourceName(url: string, sources: SourceEntry[]) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    const matched = cleanSources(sources).find((source) => source.url && source.url.includes(hostname));
    if (matched) return matched.name;
    const domainMap: Record<string, string> = {
      'miit.gov.cn': '工业和信息化部',
      'cnautonews.com': '中国汽车报',
      'unece.org': 'UNECE',
      'gov.cn': '国务院政策文件库',
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
function normalizeParsedItem(item: ParsedItem, sources: SourceEntry[]): Omit<NewsItem, 'id'> {
  return { ...item, source_name: item.source_name?.trim() || inferSourceName(item.url, sources) };
}
function createItem(partial?: Partial<NewsItem>): NewsItem {
  return { id: randomId(), region: partial?.region ?? 'domestic', date: partial?.date ?? `${DEFAULT_MONTH}-01`, title: partial?.title ?? '', summary: partial?.summary ?? '', source_name: partial?.source_name ?? '', url: partial?.url ?? '' };
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
function sourcePromptBlock(sources: SourceEntry[]) {
  const wechat = sourceNames(sources, 'wechat');
  const web = sourceNames(sources, 'web');
  return [
    '公众号参考来源：',
    ...wechat.map((source) => `- ${source.name}`),
    '',
    '网页参考来源：',
    ...web.map((source) => `- ${source.name}：${source.url}`),
  ];
}
function buildPrompt(month: string, sources: SourceEntry[]) {
  const range = monthRange(month);
  return [
    `你是汽车数据合规研究员。请检索 ${month} 自然月（${range.start} 至 ${range.end}）的汽车数据合规新闻。`,
    '',
    '请严格只输出 JSON，不要解释文字、不要 Markdown、不要代码块。',
    '',
    '核心目标：',
    '- 第一轮只输出 10 条：境内 5 条、域外 5 条。',
    '- 第一轮必须优先、尽量全部来自“公众号参考来源”和“网页参考来源”。',
    '- 如果参考来源内已有足够内容，不要使用外部来源。',
    '- 只有参考来源经过充分检索仍不足时，才允许极少量外部权威来源；每个区域最多 1 条外部来源。',
    '- 链接精准和事实可核验优先于数量；不得编造新闻、法规名称、处罚案例、会议活动、发布日期或链接。',
    '',
    '请思考久一点再输出：',
    '- 先围绕参考来源进行多轮检索，不要找到 2-3 条就停止。',
    '- 对每条候选新闻做内部核验：url 能打开、不是首页/栏目页/列表页、页面能直接支持 title 和 summary 的核心事实。',
    '- 如果链接打不开、跳转到首页、需要猜测事实、或只是栏目入口，请丢弃该条并继续检索。',
    '- 输出前再次检查：每条 url 都必须是具体原文页、公告页、文件页、会议动态页或报告下载页。',
    '',
    'JSON 结构：',
    '{ "issue_month": "YYYY-MM", "date_range": { "start": "YYYY-MM-01", "end": "YYYY-MM-DD" }, "items": [...] }',
    '',
    'items 每条只输出以下字段：',
    '- region：只能是 domestic 或 overseas。',
    '- date：必须在所选月份内，格式 YYYY-MM-DD。',
    '- title：建议 8-16 个中文字符。',
    '- summary：150-250 字，必须以日期开头，例如 “4月16日，……”。',
    '- source_name：发布机构或媒体名称。',
    '- url：具体原文链接。',
    '',
    '输出顺序：先输出 5 条 domestic，再输出 5 条 overseas；每个区域内部按日期从早到晚排序。',
    '',
    ...sourcePromptBlock(sources),
  ].join('\n');
}
function buildSupplementPrompt(month: string, items: NewsItem[], sources: SourceEntry[], region: Region, count: number) {
  const range = monthRange(month);
  const regionLabel = region === 'domestic' ? '境内' : '域外';
  const existingList = sortItemsByDate(items).map((item) => `- ${item.region === 'domestic' ? '境内' : '域外'}｜${item.date}｜${item.title}｜${item.url}`);
  return [
    `你是汽车数据合规研究员。请继续补足 ${month} 自然月（${range.start} 至 ${range.end}）的汽车数据合规新闻。`,
    '',
    '请严格只输出 JSON，不要解释文字、不要 Markdown、不要代码块。',
    '',
    `本次只补 ${regionLabel} ${count} 条。不要输出另一区域条目。`,
    '- 只输出新增条目，不要重复已有标题或链接。',
    '- 补足条目仍然必须优先来自参考来源；最终结果应尽量全部来自参考来源。',
    '- 只有参考来源内确实无法补足时，才允许极少量外部权威来源。',
    '- 真实性和链接精准优先：不得编造新闻、法规名称、处罚案例、会议活动、发布日期或链接。',
    '',
    '请思考久一点再输出：',
    '- 先基于参考来源继续深挖，不要直接转向外部搜索。',
    '- 对每条候选新闻逐条核验：url 能打开、不是首页/栏目页/列表页、页面能直接支持 title 和 summary 的核心事实。',
    '- 如果链接打不开、跳转到首页、需要猜测事实、或只是栏目入口，请丢弃该条并继续检索。',
    '',
    '重复排除清单：',
    ...existingList,
    '',
    'JSON 结构：',
    '{ "issue_month": "YYYY-MM", "date_range": { "start": "YYYY-MM-01", "end": "YYYY-MM-DD" }, "items": [...] }',
    '',
    'items 每条只输出以下字段：',
    `- region：本次只能是 ${region}。`,
    '- date：必须在所选月份内，格式 YYYY-MM-DD。',
    '- title：建议 8-16 个中文字符。',
    '- summary：150-250 字，必须以日期开头，例如 “4月16日，……”。',
    '- source_name：发布机构或媒体名称。',
    '- url：具体原文链接。',
    '',
    ...sourcePromptBlock(sources),
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
  const withToken = (item: NewsItem): RenderItem => ({ ...item, link_token: makeLinkToken(index++), display_summary: displaySummary(item) });
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
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [items, setItems] = useState<NewsItem[]>(draft.items);
  const [initialJson, setInitialJson] = useState('');
  const [supplementJson, setSupplementJson] = useState('');
  const [supplementRegion, setSupplementRegion] = useState<SupplementRegion>('domestic');
  const [supplementMode, setSupplementMode] = useState<SupplementMode>('fill');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [view, setView] = useState<'home' | 'workbench'>('home');

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
  const supplementPrompt = supplementRegion === 'overseas' ? overseasSupplementPrompt : domesticSupplementPrompt;
  const editingItem = items.find((item) => item.id === editingId) ?? null;
  const fileName = `${issueTitle(month)}.docx`;

  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ month, items, step, reviewRegion }));
    } catch {
      // Ignore storage failures in private browsing modes.
    }
  }, [month, items, step, reviewRegion]);

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
  const parseJson = (json: string) => {
    const parsed = PAYLOAD_SCHEMA.parse(JSON.parse(json)) as ParsedPayload;
    if (parsed.issue_month !== month) throw new Error(`JSON 月份与当前选择不一致：${parsed.issue_month} ≠ ${month}`);
    return sortItemsByDate(parsed.items.map((item) => createItem(normalizeParsedItem(item, sources))));
  };
  const handleInitialParse = () => {
    try {
      const normalized = parseJson(initialJson);
      setItems(normalized);
      setInitialJson('');
      const nextStep = isComplete(normalized) ? 'review' : 'supplement';
      setStep(nextStep);
      setSupplementRegion(countByRegion(normalized, 'domestic') < 10 && countByRegion(normalized, 'overseas') < 10 ? 'both' : countByRegion(normalized, 'domestic') < 10 ? 'domestic' : 'overseas');
      setNotice(`第一轮解析成功：境内 ${countByRegion(normalized, 'domestic')} 条，域外 ${countByRegion(normalized, 'overseas')} 条。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'JSON 解析失败。');
    }
  };
  const handleSupplementAppend = () => {
    try {
      const incoming = parseJson(supplementJson).filter((item) => supplementRegion === 'both' || item.region === supplementRegion);
      setItems((current) => {
        const seenUrls = new Set(current.map((item) => item.url.trim()).filter(Boolean));
        const seenTitles = new Set(current.map((item) => item.title.trim()).filter(Boolean));
        const merged = sortItemsByDate([...current, ...incoming.filter((item) => !seenUrls.has(item.url.trim()) && !seenTitles.has(item.title.trim()))]);
        if (isComplete(merged)) setStep('review');
        setNotice(`追加成功：境内 ${countByRegion(merged, 'domestic')} 条，域外 ${countByRegion(merged, 'overseas')} 条。`);
        return merged;
      });
      setSupplementJson('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'JSON 追加失败。');
    }
  };
  const handleExport = async () => {
    try {
      if (!isComplete(items)) setNotice(`当前境内 ${domesticItems.length}/10、域外 ${overseasItems.length}/10，仍会继续导出。`);
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
      setNotice(`${region === 'domestic' ? '境内' : '域外'}已经达到 10 条。`);
      return;
    }
    await navigator.clipboard.writeText(region === 'domestic' ? domesticSupplementPrompt : overseasSupplementPrompt);
    setNotice(`补足提示词已复制：${region === 'domestic' ? '境内' : '域外'} ${count} 条。`);
  };
  const updateSource = (id: string, patch: Partial<SourceEntry>) => setSources((current) => current.map((source) => (source.id === id ? { ...source, ...patch } : source)));
  const addSource = (type: SourceType) => setSources((current) => [...current, { id: randomId(), type, name: '', url: '' }]);
  const deleteSource = (id: string) => setSources((current) => current.filter((source) => source.id !== id));
  const saveSources = () => {
    const cleaned = cleanSources(sources);
    setSources(cleaned);
    localStorage.setItem(SOURCE_STORAGE_KEY, JSON.stringify(cleaned));
    setSourcesOpen(false);
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

  if (view === 'home') return <HomePage domesticCount={domesticItems.length} overseasCount={overseasItems.length} onStart={() => { setStep('sources'); setView('workbench'); }} onContinue={() => setView('workbench')} />;

  return <div className="app-shell workbench-shell"><img className="workbench-bg" src={assetUrl('assets/image.png')} aria-hidden="true" /><header className="wizard-hero"><BrandLockup /><div><div className="eyebrow">Auto Compliance Briefing</div><h1>按步骤生成月度快讯</h1><p>复制提示词、粘贴 JSON、补足缺口、核验链接并导出 Word。</p></div><div className="topbar__actions"><label className="field field--inline"><span>月份</span><input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><button type="button" className="button-ghost" onClick={() => setView('home')}>首页</button><button type="button" className="button-ghost" onClick={clearDraft}>清空草稿</button></div></header><StepNav step={step} onStep={setStep} /><div className="notice-bar"><span>境内 {domesticItems.length}/10</span><span>域外 {overseasItems.length}/10</span><span>真实月末：{monthRange(month).end}</span><span>导出文件名：{fileName}</span></div>{notice ? <div className="toast">{notice}</div> : null}<main className="wizard-panel">{step === 'sources' ? <SourceStep sources={sources} sourcesOpen={sourcesOpen} onToggle={() => setSourcesOpen((open) => !open)} onUpdate={updateSource} onAdd={addSource} onDelete={deleteSource} onSave={saveSources} onReset={resetSources} onNext={() => setStep('initial')} /> : null}{step === 'initial' ? <InitialStep value={initialJson} onChange={setInitialJson} onCopy={copyPrompt} onParse={handleInitialParse} onBack={() => setStep('sources')} /> : null}{step === 'supplement' ? <SupplementStep value={supplementJson} onChange={setSupplementJson} region={supplementRegion} mode={supplementMode} need={selectedRegionNeed} count={supplementCount} domesticNeed={domesticNeed} overseasNeed={overseasNeed} domesticPromptCount={domesticSupplementCount} overseasPromptCount={overseasSupplementCount} domesticCount={domesticItems.length} overseasCount={overseasItems.length} onRegion={setSupplementRegion} onMode={setSupplementMode} onCopy={copySupplementPrompt} onAppend={handleSupplementAppend} onBack={() => setStep('initial')} onReview={() => setStep('review')} /> : null}{step === 'review' ? <ReviewStep region={reviewRegion} items={activeReviewItems} domesticCount={domesticItems.length} overseasCount={overseasItems.length} onRegion={setReviewRegion} onEdit={setEditingId} onDelete={removeItem} onAdd={addItem} onBack={() => setStep(isComplete(items) ? 'supplement' : 'supplement')} onExport={handleExport} /> : null}</main>{editingItem ? <EditModal item={editingItem} onUpdate={updateItem} onClose={() => setEditingId(null)} onDelete={removeItem} /> : null}</div>;
}

function BrandLockup() {
  return <div className="brand-lockup"><div className="brand-mark" aria-hidden="true"><img src={assetUrl('assets/logo.png')} alt="" /></div><div><strong>Calvin</strong><span>Auto Compliance Briefing</span></div></div>;
}

function HomePage({ domesticCount, overseasCount, onStart, onContinue }: { domesticCount: number; overseasCount: number; onStart: () => void; onContinue: () => void }) {
  return <div className="landing-shell"><div className="landing-bg"><img src={assetUrl('assets/image_2.png')} alt="" /></div><nav className="landing-nav"><BrandLockup /><div className="landing-pill"><a href="#features">功能</a><a href="#process">流程</a><button type="button" onClick={onContinue}>进入工作台</button></div></nav><main className="landing-main"><section className="landing-copy" id="features"><div className="landing-kicker">Calvin Auto Compliance Briefing</div><h1>汽车数据合规快讯，一键成稿</h1><p>从参考来源检索，到 10+10 条快讯补足，再到 Word 母版导出，把月度合规简报流程收进一个清爽工作台。</p><div className="landing-actions"><button type="button" className="button-primary" onClick={onStart}>开始生成</button><button type="button" onClick={onContinue}>继续草稿</button></div><div className="landing-status"><span>当前草稿</span><strong>境内 {domesticCount}/10 · 域外 {overseasCount}/10</strong></div></section><section className="process-panel" id="process"><div><span>01</span><strong>配置来源</strong><p>公众号与网页分开维护，提示词优先引用你的参考源。</p></div><div><span>02</span><strong>复制提示词</strong><p>隐藏冗长文本，只保留复制和打开 Gemini 的动作。</p></div><div><span>03</span><strong>补足 10+10</strong><p>按境内或域外分批补足，自动排除重复标题与链接。</p></div><div><span>04</span><strong>审核导出</strong><p>卡片式核验原文链接，最终套用 Word 母版导出。</p></div></section></main></div>;
}

function StepNav({ step, onStep }: { step: WizardStep; onStep: (step: WizardStep) => void }) {
  const activeIndex = STEPS.findIndex((item) => item.key === step);
  return <nav className="stepper">{STEPS.map((item, index) => <button type="button" key={item.key} className={`stepper__item ${item.key === step ? 'stepper__item--active' : ''} ${index < activeIndex ? 'stepper__item--done' : ''}`} onClick={() => onStep(item.key)}><span>{index + 1}</span>{item.label}</button>)}</nav>;
}

function SourceStep({ sources, sourcesOpen, onToggle, onUpdate, onAdd, onDelete, onSave, onReset, onNext }: { sources: SourceEntry[]; sourcesOpen: boolean; onToggle: () => void; onUpdate: (id: string, patch: Partial<SourceEntry>) => void; onAdd: (type: SourceType) => void; onDelete: (id: string) => void; onSave: () => void; onReset: () => void; onNext: () => void }) {
  const wechatSources = sources.filter((source) => source.type === 'wechat');
  const webSources = sources.filter((source) => source.type === 'web');
  return <section className="flow-card"><div className="flow-card__head"><div><h2>确认来源</h2><p>默认使用已保存来源。需要调整时展开编辑，保存后提示词会立即采用新清单。</p></div><button type="button" onClick={onNext} className="button-primary">下一步</button></div><div className="source-summary"><span>公众号 {wechatSources.length} 个</span><span>网页 {webSources.length} 个</span><button type="button" onClick={onToggle}>{sourcesOpen ? '收起来源' : '编辑来源'}</button></div>{sourcesOpen ? <div className="source-editor source-editor--wide"><div className="source-editor__toolbar"><button type="button" onClick={() => onAdd('wechat')}>增加公众号</button><button type="button" onClick={() => onAdd('web')}>增加网页</button><button type="button" onClick={onSave}>保存来源</button><button type="button" onClick={onReset}>恢复默认</button></div><div className="source-columns"><div><h3>公众号</h3>{wechatSources.map((source) => <div className="source-row source-row--wechat" key={source.id}><input value={source.name} onChange={(event) => onUpdate(source.id, { name: event.target.value })} placeholder="公众号名称" /><button type="button" className="button-danger" onClick={() => onDelete(source.id)}>删除</button></div>)}</div><div><h3>网页</h3>{webSources.map((source) => <div className="source-row source-row--web" key={source.id}><input value={source.name} onChange={(event) => onUpdate(source.id, { name: event.target.value })} placeholder="网页名称" /><input value={source.url} onChange={(event) => onUpdate(source.id, { url: event.target.value })} placeholder="https://..." /><button type="button" className="button-danger" onClick={() => onDelete(source.id)}>删除</button></div>)}</div></div></div> : null}</section>;
}

function InitialStep({ value, onChange, onCopy, onParse, onBack }: { value: string; onChange: (value: string) => void; onCopy: () => void; onParse: () => void; onBack: () => void }) {
  return <section className="flow-card"><div className="flow-card__head"><div><h2>第一轮生成</h2><p>复制提示词给 Gemini。第一轮只要境内 5 条、域外 5 条，优先保证来源和链接质量。</p></div><div className="flow-actions"><button type="button" onClick={onBack}>上一步</button><a className="button-link" href="https://gemini.google.com/" target="_blank" rel="noreferrer">打开 Gemini</a><button type="button" className="button-primary" onClick={onCopy}>复制第一轮提示词</button></div></div><div className="single-task"><label className="field"><span>粘贴 Gemini 返回的第一轮 JSON</span><textarea rows={14} value={value} onChange={(event) => onChange(event.target.value)} placeholder="在此粘贴第一轮 JSON" /></label><button type="button" className="button-primary" onClick={onParse}>解析第一轮结果</button></div></section>;
}

function SupplementStep({ value, onChange, region, mode, need, count, domesticNeed, overseasNeed, domesticPromptCount, overseasPromptCount, domesticCount, overseasCount, onRegion, onMode, onCopy, onAppend, onBack, onReview }: { value: string; onChange: (value: string) => void; region: SupplementRegion; mode: SupplementMode; need: number; count: number; domesticNeed: number; overseasNeed: number; domesticPromptCount: number; overseasPromptCount: number; domesticCount: number; overseasCount: number; onRegion: (region: SupplementRegion) => void; onMode: (mode: SupplementMode) => void; onCopy: (region: Region) => void; onAppend: () => void; onBack: () => void; onReview: () => void }) {
  const regionLabel = region === 'both' ? '境内和域外' : region === 'domestic' ? '境内' : '域外';
  return <section className="flow-card"><div className="flow-card__head"><div><h2>补足缺口</h2><p>选择区域和补足方式。选择“境内+域外”时，会分别复制对应区域的提示词，避免 Gemini 混合输出跑偏。</p></div><div className="flow-actions"><button type="button" onClick={onBack}>上一步</button><button type="button" onClick={onReview}>进入审核</button></div></div><div className="progress-pair"><div><strong>境内 {domesticCount}/10</strong><span style={{ width: `${Math.min(100, domesticCount * 10)}%` }} /></div><div><strong>域外 {overseasCount}/10</strong><span style={{ width: `${Math.min(100, overseasCount * 10)}%` }} /></div></div><div className="supplement-controls"><label className="field"><span>补足区域</span><select value={region} onChange={(event) => onRegion(event.target.value as SupplementRegion)}><option value="both">境内 + 域外</option><option value="domestic">境内</option><option value="overseas">域外</option></select></label><label className="field"><span>补足方式</span><select value={mode} onChange={(event) => onMode(event.target.value as SupplementMode)}><option value="fill">一次性补到 10 条</option><option value="single">只补 1 条</option></select></label><div className="need-card"><span>{regionLabel}还差</span><strong>{need} 条</strong><small>{region === 'both' ? `境内补 ${domesticPromptCount} 条，域外补 ${overseasPromptCount} 条` : `本次提示词将要求补 ${count} 条`}</small></div></div><div className="single-task"><div className="flow-actions"><a className="button-link" href="https://gemini.google.com/" target="_blank" rel="noreferrer">打开 Gemini</a>{region === 'both' ? <><button type="button" className="button-primary" onClick={() => onCopy('domestic')} disabled={domesticNeed <= 0}>复制境内补足提示词</button><button type="button" className="button-primary" onClick={() => onCopy('overseas')} disabled={overseasNeed <= 0}>复制域外补足提示词</button></> : <button type="button" className="button-primary" onClick={() => onCopy(region)}>复制补足提示词</button>}</div><label className="field"><span>粘贴 Gemini 返回的补足 JSON</span><textarea rows={12} value={value} onChange={(event) => onChange(event.target.value)} placeholder={region === 'both' ? '可先粘贴境内补足 JSON 追加，再粘贴域外补足 JSON 追加' : '在此粘贴补足 JSON'} /></label><button type="button" className="button-primary" onClick={onAppend}>解析并追加</button></div></section>;
}

function ReviewStep({ region, items, domesticCount, overseasCount, onRegion, onEdit, onDelete, onAdd, onBack, onExport }: { region: Region; items: NewsItem[]; domesticCount: number; overseasCount: number; onRegion: (region: Region) => void; onEdit: (id: string) => void; onDelete: (id: string) => void; onAdd: (region: Region) => void; onBack: () => void; onExport: () => void }) {
  return <section className="flow-card"><div className="flow-card__head"><div><h2>审核与导出</h2><p>如链接无法打开或不是原文页，请手动检索后替换为准确链接。</p></div><div className="flow-actions"><button type="button" onClick={onBack}>返回补足</button><button type="button" className="button-primary" onClick={onExport}>导出 Word</button></div></div><div className="review-tabs"><button type="button" className={region === 'domestic' ? 'tab-active' : ''} onClick={() => onRegion('domestic')}>境内动态 {domesticCount}/10</button><button type="button" className={region === 'overseas' ? 'tab-active' : ''} onClick={() => onRegion('overseas')}>域外动态 {overseasCount}/10</button><button type="button" onClick={() => onAdd(region)}>新增条目</button></div><div className="review-grid">{items.length === 0 ? <div className="empty-state">暂无条目</div> : items.map((item, index) => <article className="review-card" key={item.id}><div className="review-card__top"><span>{index + 1}</span><strong>{item.title || '未命名条目'}</strong></div><div className="review-card__meta"><span>{item.date}</span><span>{item.source_name || '待补充来源'}</span></div><p>{item.summary || '暂无摘要'}</p><div className="card-actions"><a className="button-link button-link--small" href={item.url || '#'} target="_blank" rel="noreferrer">打开原文</a><button type="button" onClick={() => onEdit(item.id)}>编辑</button><button type="button" className="button-danger" onClick={() => onDelete(item.id)}>删除</button></div></article>)}</div></section>;
}

function EditModal({ item, onUpdate, onClose, onDelete }: { item: NewsItem; onUpdate: (id: string, patch: Partial<NewsItem>) => void; onClose: () => void; onDelete: (id: string) => void }) {
  return <div className="modal-backdrop"><div className="modal"><div className="flow-card__head"><div><h2>编辑条目</h2><p>核验链接后，可以在这里替换标题、摘要或原文链接。</p></div><button type="button" onClick={onClose}>关闭</button></div><div className="grid grid--two"><label className="field"><span>发布日期</span><input value={item.date} onChange={(event) => onUpdate(item.id, { date: event.target.value })} /></label><label className="field"><span>地域</span><select value={item.region} onChange={(event) => onUpdate(item.id, { region: event.target.value as Region })}><option value="domestic">境内</option><option value="overseas">域外</option></select></label><label className="field field--full"><span>新闻标题</span><input value={item.title} onChange={(event) => onUpdate(item.id, { title: event.target.value })} /></label><label className="field field--full"><span>正文摘要</span><textarea rows={5} value={item.summary} onChange={(event) => onUpdate(item.id, { summary: event.target.value })} /></label><label className="field field--full"><span>来源名称</span><input value={item.source_name} onChange={(event) => onUpdate(item.id, { source_name: event.target.value })} /></label><label className="field field--full"><span>原文链接</span><input value={item.url} onChange={(event) => onUpdate(item.id, { url: event.target.value })} placeholder="https://..." /></label></div><div className="modal-actions"><a className="button-link" href={item.url || '#'} target="_blank" rel="noreferrer">打开原文</a><button type="button" className="button-danger" onClick={() => { onDelete(item.id); onClose(); }}>删除条目</button><button type="button" className="button-primary" onClick={onClose}>完成</button></div></div></div>;
}
