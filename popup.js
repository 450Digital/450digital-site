// Recon — account intelligence extension (450Digital)
// Update this file to refresh the matching engine without a code change

// Static fallback KB removed — all knowledge comes from the org's configured
// Products & Services, Stories, and Competitive Intel in the Recon dashboard.
export const DEFAULT_CAPABILITIES = [];
export const CUSTOMER_STORIES = [];
export const COMPETITIVE_INTEL = {};

const PROXY_URL = 'https://recon.jeffreymass.workers.dev';
const PROXY_SECRET = 'recon-2026-ydrk2XShah9l';
const SUPABASE_URL = 'https://rzstxdvchjtzkrhdtlje.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ6c3R4ZHZjaGp0emtyaGR0bGplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5NDI3MTEsImV4cCI6MjA5MTUxODcxMX0.ImPHUaTpb1dsvqrqzChq6KllyC9CXhncGiPxA09sraE';

async function getSession() {
  try {
    const stored = await chrome.storage.local.get(['recon_session']);
    return stored.recon_session || null;
  } catch { return null; }
}

async function saveSession(session) {
  await chrome.storage.local.set({ recon_session: session });
}

async function clearSession() {
  await chrome.storage.local.remove(['recon_session']);
}

async function signInWithEmailPassword(email, password) {
  const response = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPABASE_ANON_KEY },
    body: JSON.stringify({ email, password })
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error_description || data.error);
  await saveSession(data);
  return data;
}

async function getCurrentUser() {
  const session = await getSession();
  if (!session?.access_token) return null;
  const response = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { 'Authorization': 'Bearer ' + session.access_token, 'apikey': SUPABASE_ANON_KEY }
  });
  return response.ok ? response.json() : null;
}

async function getUserOrg() {
  const session = await getSession();
  if (!session?.access_token) return null;
  const response = await fetch(SUPABASE_URL + '/rest/v1/org_users?select=org_id,role,organizations(id,name,brand_name,brand_color,logo_url,company_description,solution_domain,value_drivers,target_personas)&limit=1', {
    headers: { 'Authorization': 'Bearer ' + session.access_token, 'apikey': SUPABASE_ANON_KEY }
  });
  const data = await response.json();
  return data?.[0] || null;
}

async function getProductLines(orgId) {
  const session = await getSession();
  if (!session?.access_token || !orgId) return [];
  const response = await fetch(SUPABASE_URL + '/rest/v1/product_lines?org_id=eq.' + orgId + '&active=eq.true&order=name', {
    headers: { 'Authorization': 'Bearer ' + session.access_token, 'apikey': SUPABASE_ANON_KEY }
  });
  return response.ok ? response.json() : [];
}

async function getOrgKnowledgeBase(orgId, productLineId) {
  const session = await getSession();
  if (!session?.access_token) return null;
  const headers = { 'Authorization': 'Bearer ' + session.access_token, 'apikey': SUPABASE_ANON_KEY };
  const plFilter = productLineId ? '&product_line_id=eq.' + productLineId : '';

  const [capsRes, storiesRes, compRes, icpRes] = await Promise.all([
    fetch(SUPABASE_URL + '/rest/v1/capabilities?org_id=eq.' + orgId + plFilter, { headers }),
    fetch(SUPABASE_URL + '/rest/v1/customer_stories?org_id=eq.' + orgId + plFilter, { headers }),
    fetch(SUPABASE_URL + '/rest/v1/competitive_intel?org_id=eq.' + orgId + plFilter, { headers }),
    fetch(SUPABASE_URL + '/rest/v1/icp_settings?org_id=eq.' + orgId + plFilter, { headers })
  ]);

  const [capabilities, stories, competitors, icpSettings] = await Promise.all([
    capsRes.ok ? capsRes.json() : [],
    storiesRes.ok ? storiesRes.json() : [],
    compRes.ok ? compRes.json() : [],
    icpRes.ok ? icpRes.json() : []
  ]);

  return { capabilities, stories, competitors, icpSettings };
}

// ─────────────────────────────────────────────────────────────────────────

const competitorList = Object.keys(COMPETITIVE_INTEL).join(', ');
const capabilityList = DEFAULT_CAPABILITIES.map(c => `- ${c.name}: ${c.description}`).join('\n');

// ── Secure proxy call ─────────────────────────────────────────────────────
async function callProxy(route, payload) {
  const session = await getSession();
  const headers = {
    'Content-Type': 'application/json',
    'X-Proxy-Secret': PROXY_SECRET
  };
  if (session?.access_token) headers['X-User-Token'] = session.access_token;

  const response = await fetch(PROXY_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ route, ...payload })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Proxy error ${response.status}`);
  }

  return response.json();
}

// ── Main research orchestrator ────────────────────────────────────────────
export async function researchAccount(companyName, onProgress, linkedinData) {
  onProgress('Searching SEC EDGAR for filings…');
  const secData = await fetchSECFilings(companyName);

  // Use dynamic KB if available, fall back to static
  const kb = state.kb;
  const caps = (kb?.capabilities?.length > 0) ? kb.capabilities : DEFAULT_CAPABILITIES;
  const competitors = (kb?.competitors?.length > 0) ? kb.competitors : Object.keys(COMPETITIVE_INTEL);
  const competitorNames = Array.isArray(competitors)
    ? competitors.map(c => c.competitor || c).join(', ')
    : competitorList;
  const dynamicCapList = caps.map(c => {
    let line = '- ' + (c.name || '') + (c.category ? ' (' + c.category + ')' : '') + ': ' + (c.description || '');
    if (c.problems_solved) line += ' | Solves: ' + c.problems_solved;
    if (c.differentiators) line += ' | Differentiators: ' + c.differentiators;
    if (Array.isArray(c.use_cases) && c.use_cases.length) line += ' | Use cases: ' + c.use_cases.join(', ');
    return line;
  }).join('\n');

  onProgress('Analyzing strategic priorities with AI…');
  const priorities = await callProxy('analyze', {
    companyName,
    secData,
    capabilityList: dynamicCapList || capabilityList,
    competitorList: competitorNames || competitorList,
    linkedinData: linkedinData || null,
    accountMode: state.accountMode || 'prospect',
    proofPoints: (kb?.stories || []).slice(0, 12).map(s => ({ company: s.company, industry: s.industry, outcome: s.outcome })),
    orgName: state.org?.name || null,
    productLineName: state.selectedProductLine?.name || null,
    companyProfile: state.org ? {
      description: state.org.company_description || null,
      solutionDomain: state.org.solution_domain || null,
      valueDrivers: state.org.value_drivers || null,
      targetPersonas: state.org.target_personas || null
    } : null
  });

  onProgress('Scoring capability fit…');
  const fitScores = scoreFitDynamic(priorities, caps, kb?.icpSettings || []);

  onProgress('Finding relevant customer stories…');
  const stories = findRelevantStoriesDynamic(priorities, kb?.stories || []);

  onProgress('Identifying competitive signals…');
  const competitive = detectCompetitiveDynamic(priorities, kb?.competitors || []);

  return { priorities, fitScores, stories, competitive };
}

// ── SEC EDGAR ─────────────────────────────────────────────────────────────
async function fetchSECFilings(companyName) {
  try {
    const searchUrl = `https://efts.sec.gov/LATEST/search-index?q=%22${encodeURIComponent(companyName)}%22&dateRange=custom&startdt=2023-01-01&forms=10-K`;
    const res = await fetch(searchUrl);
    if (!res.ok) return { snippets: [] };

    const data = await res.json();
    const hits = data.hits?.hits?.slice(0, 3) || [];
    const snippets = hits.map(h => {
      const src = h._source || {};
      return [
        src.period_of_report ? `Period: ${src.period_of_report}` : '',
        src.file_date ? `Filed: ${src.file_date}` : '',
        src.entity_name || ''
      ].filter(Boolean).join(' | ');
    });

    return { source: 'SEC EDGAR 10-K', snippets, filingCount: hits.length };
  } catch {
    return { snippets: [] };
  }
}

// ── Fit scoring (runs client-side — no API call needed) ───────────────────
export function scoreFit(analysisResult) {
  return [];
}

function scoreFitDynamic(analysisResult, capabilities, icpSettings) {
  if (!capabilities || capabilities.length === 0) return scoreFit(analysisResult);
  if (!analysisResult?.priorities) return [];

  const industry = (analysisResult.industry || '').toLowerCase();
  const overview = (analysisResult.companyOverview || '').toLowerCase();
  const empNum = parseInt((analysisResult.employeeCount || '0').replace(/[^0-9]/g, '')) || 0;

  // Determine ICP tier from dynamic settings
  let icpTier = 'unknown';
  if (icpSettings && icpSettings.length > 0) {
    const sorted = [...icpSettings].sort((a, b) => {
      const order = { primary: 0, secondary: 1, non: 2 };
      return (order[a.tier] || 99) - (order[b.tier] || 99);
    });
    for (const icp of sorted) {
      const industries = (icp.industries || []).map(i => i.toLowerCase());
      const minEmp = icp.min_employees || 0;
      const matchesIndustry = industries.length === 0 || industries.some(i => industry.includes(i) || overview.includes(i));
      const matchesSize = empNum >= minEmp;
      if (matchesIndustry && matchesSize) { icpTier = icp.tier; break; }
    }
  } else {
    // Fall back to static ICP logic
    const primaryIndustries = ['agriculture','healthcare','manufacturing','life sciences','hospitality','retail','financial services','business services'];
    const isPrimary = primaryIndustries.some(i => industry.includes(i) || overview.includes(i)) && empNum >= 5000;
    icpTier = isPrimary ? 'primary' : empNum >= 2500 ? 'secondary' : 'unknown';
  }

  const icpMultiplier = icpTier === 'primary' ? 1.3 : icpTier === 'secondary' ? 1.1 : icpTier === 'non' ? 0.5 : 1.0;

  const allKeywords = [
    ...analysisResult.priorities.flatMap(p => p.keywords || []),
    ...analysisResult.priorities.map(p => p.title.toLowerCase()),
    industry, overview
  ].map(k => k.toLowerCase());

  return capabilities.map(cap => {
    const capKeywords = (cap.keywords || []).map(k => k.toLowerCase());
    const matchCount = capKeywords.filter(kw => allKeywords.some(ak => ak.includes(kw) || kw.includes(ak))).length;
    const keywordScore = capKeywords.length > 0 ? Math.round((matchCount / capKeywords.length) * 45) : 0;
    const score = Math.min(98, Math.round((35 + keywordScore) * icpMultiplier));
    const matchedPriorities = analysisResult.priorities.filter(p => {
      const pText = ((p.title || '') + ' ' + (p.description || '') + ' ' + (p.keywords || []).join(' ')).toLowerCase();
      return capKeywords.some(ck => pText.includes(ck));
    });
    return {
      id: cap.id || cap.name,
      name: cap.name,
      description: cap.description || '',
      keywords: cap.keywords || [],
      useCases: cap.use_cases || [],
      score,
      matchedPriorities: matchedPriorities.map(p => p.title),
      relevant: score >= 50,
      icpTier
    };
  })
  .filter(s => s.relevant)
  .sort((a, b) => b.score - a.score)
  .slice(0, 6);
}

function findRelevantStoriesDynamic(analysisResult, stories) {
  if (!stories || stories.length === 0) return findRelevantStories(analysisResult);
  if (!analysisResult) return [];
  const allKeywords = [
    analysisResult.industry?.toLowerCase() || '',
    ...analysisResult.priorities?.flatMap(p => p.keywords || []) || []
  ];
  return stories.map(s => ({
    company: s.company,
    industry: s.industry,
    employees: s.employees,
    outcome: s.outcome,
    keywords: s.keywords || [],
    relevance: (s.keywords || []).filter(kw => allKeywords.some(ak => ak.includes(kw.toLowerCase()) || kw.toLowerCase().includes(ak))).length
  }))
  .filter(s => s.relevance > 0 || stories.length <= 3)
  .sort((a, b) => b.relevance - a.relevance)
  .slice(0, 3);
}

function detectCompetitiveDynamic(analysisResult, competitors) {
  if (!competitors || competitors.length === 0) return detectCompetitive(analysisResult);
  if (!analysisResult?.competitiveSignals) return [];
  return analysisResult.competitiveSignals.map(sig => {
    const match = competitors.find(c => (c.competitor || '').toLowerCase() === (sig.competitor || '').toLowerCase());
    return {
      ...sig,
      intel: match || null,
      displacementAngle: match?.displacement_angle || null
    };
  });
}

// ── Customer story matching (client-side) ─────────────────────────────────
export function findRelevantStories(analysisResult) {
  return [];
}

export function detectCompetitive(analysisResult) {
  return [];
}
// ── Discovery email generator ─────────────────────────────────────────────
export async function generateDiscoveryEmail(companyName, fitScores, analysisResult) {
  return callProxy('email', {
    companyName,
    topCapabilities: fitScores.slice(0, 3).map(f => f.name).join(', '),
    topPriority: analysisResult.priorities?.[0],
    competitive: analysisResult.competitiveSignals?.[0]
  });
}




// ── App State ──────────────────────────────────────────────────────────────
const state = {
  view: 'loading',
  user: null,
  org: null,
  productLines: [],
  selectedProductLine: null,
  kb: null,
  usage: null,
  linkedinData: null,
  // Prospect / Customer mode
  accountMode: 'prospect',     // 'prospect' | 'customer'
  ownedProductLines: [],       // product line IDs customer already owns
  // Cadence
  cadenceType: null,
  cadenceLoading: false,
  cadenceDraft: null,
  cadenceStep: 0,
  // Call script
  callScript: null,
  callScriptLoading: false,
  // Core
  company: '',
  loading: false,
  loadingMsg: '',
  error: null,
  result: null,
  activeTab: 'priorities',
  emailDraft: null,
  emailLoading: false,
  emailPromptOpen: false,
  emailRecipient: null,
  sources: {
    '10-K / Annual Report': true,
    'Press releases': true,
    'Social posts': true,
    'Earnings calls': false
  }
};

// ── Init ──────────────────────────────────────────────────────────────────
async function init() {
  const user = await getCurrentUser();
  if (!user) {
    state.view = 'login';
    render();
    return;
  }
  state.user = user;

  // Load org data
  const orgData = await getUserOrg();
  if (orgData) {
    state.org = orgData.organizations || null;

    // Load product lines
    const pls = await getProductLines(orgData.org_id);
    state.productLines = pls || [];

    // Check stored product line selection
    const stored = await new Promise(res => chrome.storage.local.get(['recon_product_line_id', 'recon_last_company', 'recon_auto_search', 'recon_linkedin_data'], res));
    if (stored.recon_linkedin_data) state.linkedinData = stored.recon_linkedin_data;

    if (state.productLines.length > 1 && !stored.recon_product_line_id) {
      // Multiple product lines — show selector
      state.view = 'select-product-line';
      render();
      return;
    }

    // Use stored or first product line
    const plId = stored.recon_product_line_id || (state.productLines[0]?.id || null);
    state.selectedProductLine = state.productLines.find(p => p.id === plId) || state.productLines[0] || null;

    // Load KB from Supabase
    if (orgData.org_id) {
      state.kb = await getOrgKnowledgeBase(orgData.org_id, plId);
    }

    // Load usage stats
    loadUsageStats();

    state.view = 'app';
    if (stored.recon_last_company) state.company = stored.recon_last_company;
    render();

    if (stored.recon_auto_search && stored.recon_last_company) {
      chrome.storage.local.set({ recon_auto_search: false });
      setTimeout(doResearch, 300);
    }
  } else {
    state.view = 'app';
    render();
  }
}

init();

// ── Usage stats ────────────────────────────────────────────────────────────
async function loadUsageStats() {
  try {
    const session = await getSession();
    if (!session?.access_token) return;
    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Proxy-Secret': PROXY_SECRET, 'X-User-Token': session.access_token },
      body: JSON.stringify({ route: 'usage-check' })
    });
    if (response.ok) {
      state.usage = await response.json();
      // Update usage display if visible
      const usageEl = document.getElementById('usage-indicator');
      if (usageEl && state.usage) {
        usageEl.textContent = state.usage.used + '/' + state.usage.limit + ' lookups';
        usageEl.style.color = state.usage.remaining <= 5 ? '#C0320F' : 'rgba(255,255,255,0.5)';
      }
    }
  } catch (e) { /* silent fail */ }
}

// ── Render ─────────────────────────────────────────────────────────────────
function render() {
  const root = document.getElementById('root');
  root.innerHTML = '';

  if (state.view === 'login') {
    root.appendChild(renderLogin());
    return;
  }

  if (state.view === 'loading') {
    const wrap = el('div', { class: 'loading-wrap' });
    wrap.appendChild(el('div', { class: 'spinner' }));
    root.appendChild(wrap);
    return;
  }

  if (state.view === 'select-product-line') {
    root.appendChild(renderProductLineSelector());
    return;
  }

  root.appendChild(renderHeader());

  const body = el('div', { class: 'body' });

  if (state.loading) {
    body.appendChild(renderLoading());
    root.appendChild(body);
    return;
  }

  body.appendChild(renderSearch());

  if (state.error) {
    body.appendChild(el('div', { class: 'error-msg' }, state.error));
  }

  if (state.result) {
    body.appendChild(renderOverview());
    body.appendChild(renderSourcePills());
    body.appendChild(renderNavTabs());
    body.appendChild(renderActiveSection());
  }

  root.appendChild(body);

  if (state.emailDraft || state.emailLoading || state.emailPromptOpen) {
    root.appendChild(renderEmailModal());
  }
}

// ── Header ─────────────────────────────────────────────────────────────────

function renderProductLineSelector() {
  const wrap = el('div', { style: 'padding:20px;' });

  const org = state.org;
  const brandColor = org?.brand_color || '#1B1F5E';

  // Logo + title
  const logoRow = el('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:20px;' });
  const logoMark = el('div', { style: 'width:32px;height:32px;border-radius:8px;background:' + brandColor + ';display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff;flex-shrink:0;overflow:hidden;' });
  if (org?.logo_url) {
    const img = el('img', { src: org.logo_url, style: 'width:100%;height:100%;object-fit:cover;' });
    logoMark.appendChild(img);
  } else {
    logoMark.textContent = (org?.name || 'S')[0].toUpperCase();
  }
  logoRow.appendChild(logoMark);
  const titleWrap = el('div');
  titleWrap.appendChild(el('div', { style: 'font-size:14px;font-weight:700;color:#1B1F5E;' }, (org?.brand_name || org?.name || 'Recon') + ' | Recon'));
  titleWrap.appendChild(el('div', { style: 'font-size:10px;color:#6B6E8F;' }, 'powered by 450digital'));
  logoRow.appendChild(titleWrap);
  wrap.appendChild(logoRow);

  wrap.appendChild(el('div', { style: 'font-size:13px;font-weight:600;color:#1B1F5E;margin-bottom:4px;' }, 'Select your product line'));
  wrap.appendChild(el('div', { style: 'font-size:12px;color:#6B6E8F;margin-bottom:14px;' }, 'Choose which product you are selling to focus your research'));

  state.productLines.forEach(pl => {
    const btn = el('div', { style: 'padding:12px 14px;border:1px solid #E0E0EC;border-radius:10px;cursor:pointer;margin-bottom:8px;background:#fff;transition:all 0.15s;' });
    const name = el('div', { style: 'font-size:13px;font-weight:600;color:#1B1F5E;' }, pl.name);
    const desc = el('div', { style: 'font-size:11px;color:#6B6E8F;margin-top:2px;' }, pl.description || pl.category || '');
    btn.appendChild(name);
    if (pl.description || pl.category) btn.appendChild(desc);
    btn.onmouseenter = () => { btn.style.background = '#F5F5F7'; btn.style.borderColor = brandColor; };
    btn.onmouseleave = () => { btn.style.background = '#fff'; btn.style.borderColor = '#E0E0EC'; };
    btn.onclick = async () => {
      state.selectedProductLine = pl;
      chrome.storage.local.set({ recon_product_line_id: pl.id });
      // Load KB for this product line
      const orgId = state.productLines.length > 0 ? (await getUserOrg())?.org_id : null;
      if (orgId) state.kb = await getOrgKnowledgeBase(orgId, pl.id);
      state.view = 'app';
      render();
    };
    wrap.appendChild(btn);
  });

  const switchBtn = el('div', { style: 'font-size:11px;color:#6B6E8F;text-align:center;margin-top:8px;cursor:pointer;' }, 'Change product line later from the header');
  wrap.appendChild(switchBtn);

  return wrap;
}

function renderLogin() {
  const wrap = el('div', { style: 'padding:20px;display:flex;flex-direction:column;gap:14px;' });

  const logoRow = el('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:4px;' });
  const logoImg = el('img', { src: 'icons/icon32.png', style: 'width:30px;height:30px;border-radius:6px;' });
  const logoText = el('div');
  logoText.appendChild(el('div', { style: 'font-size:15px;font-weight:700;color:#1B1F5E;' }, 'Recon'));
  logoText.appendChild(el('div', { style: 'font-size:10px;color:#6B6E8F;' }, 'by 450digital'));
  logoRow.appendChild(logoImg);
  logoRow.appendChild(logoText);
  wrap.appendChild(logoRow);

  wrap.appendChild(el('div', { style: 'font-size:13px;color:#6B6E8F;' }, 'Sign in to research accounts'));

  const emailInput = el('input', { type: 'email', placeholder: 'work@company.com', id: 'login-email',
    style: 'height:36px;padding:0 10px;border:1px solid #E0E0EC;border-radius:8px;font-size:13px;width:100%;' });
  wrap.appendChild(emailInput);

  const passInput = el('input', { type: 'password', placeholder: 'Password', id: 'login-password',
    style: 'height:36px;padding:0 10px;border:1px solid #E0E0EC;border-radius:8px;font-size:13px;width:100%;' });
  wrap.appendChild(passInput);

  const loginBtn = el('button', { class: 'btn btn-primary btn-full' }, 'Sign in');
  loginBtn.onclick = doLogin;
  wrap.appendChild(loginBtn);

  const errMsg = el('div', { id: 'login-error', style: 'font-size:11px;color:#C0320F;text-align:center;min-height:16px;' });
  wrap.appendChild(errMsg);

  const hint = el('div', { style: 'font-size:11px;color:#6B6E8F;text-align:center;' }, 'Need access? Contact jeff@450digital.com');
  wrap.appendChild(hint);

  return wrap;
}

function renderHeader() {
  const header = el('div', { class: 'header' });
  const top = el('div', { class: 'header-top' });

  const logoWrap = el('div', { class: 'header-logo' });
  const logoImg = el('img', { src: 'icons/icon32.png', style: 'width:28px;height:28px;border-radius:6px;' });
  logoWrap.appendChild(logoImg);

  const titleWrap = el('div', { class: 'header-title-wrap' });
  const titleLine = el('div', { class: 'header-title' }, 'Recon');
  const subLine = el('div', { class: 'header-sub' }, state.selectedProductLine ? state.selectedProductLine.name : 'by 450digital');
  titleWrap.appendChild(titleLine);
  titleWrap.appendChild(subLine);

  // Switch button
  const switchBtn = el('div', {
    style: 'font-size:10px;font-weight:600;color:rgba(255,255,255,0.7);cursor:pointer;padding:4px 8px;border:1px solid rgba(255,255,255,0.2);border-radius:5px;white-space:nowrap;margin-right:6px;'
  }, 'Switch ↕');
  switchBtn.onclick = () => toggleSwitchMenu(switchBtn);

  const signOutBtn = el('div', { class: 'header-signout' }, 'Sign out');
  signOutBtn.onclick = async () => {
    await clearSession();
    chrome.storage.local.remove(['recon_product_line_id']);
    state.view = 'login';
    state.result = null;
    state.company = '';
    state.org = null;
    state.kb = null;
    state.selectedProductLine = null;
    render();
  };

  top.appendChild(logoWrap);
  top.appendChild(titleWrap);
  top.appendChild(switchBtn);
  top.appendChild(signOutBtn);
  header.appendChild(top);
  return header;
}

async function toggleSwitchMenu(anchor) {
  // Remove existing menu if open
  const existing = document.getElementById('switch-menu');
  if (existing) { existing.remove(); return; }

  const menu = el('div', {
    id: 'switch-menu',
    style: 'position:fixed;top:52px;right:8px;background:#fff;border:1px solid #E0E0EC;border-radius:10px;padding:12px;z-index:999;min-width:220px;box-shadow:0 8px 24px rgba(0,0,0,0.15);'
  });

  // Show loading state first
  menu.appendChild(el('div', { style: 'font-size:10px;font-weight:700;color:#6B6E8F;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;' }, 'Organization'));
  const loadingEl = el('div', { style: 'font-size:12px;color:#6B6E8F;padding:4px 0;' }, 'Loading…');
  menu.appendChild(loadingEl);
  document.getElementById('root').appendChild(menu);

  // Load orgs async THEN update menu
  const orgs = await loadUserOrgs();
  loadingEl.remove();
  if (!orgs || orgs.length === 0) {
    menu.appendChild(el('div', { style: 'font-size:12px;color:#6B6E8F;padding:4px 0;' }, 'No organizations found'));
  } else {
    orgs.forEach(orgRow => {
      const org = orgRow.organizations;
      const isCurrentOrg = state.org && state.org.id === org?.id;
      const orgBtn = el('div', {
        style: 'display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:7px;cursor:pointer;background:' + (isCurrentOrg ? '#EEF3FC' : 'transparent') + ';margin-bottom:2px;'
      });
      const dot = el('div', { style: 'width:8px;height:8px;border-radius:50%;background:' + (isCurrentOrg ? '#2B7DE9' : '#E0E0EC') + ';flex-shrink:0;' });
      const name = el('div', { style: 'font-size:12px;font-weight:' + (isCurrentOrg ? '600' : '400') + ';color:#0A0E24;' }, org?.name || orgRow.org_id);
      orgBtn.appendChild(dot);
      orgBtn.appendChild(name);
      if (isCurrentOrg) orgBtn.appendChild(el('div', { style: 'font-size:10px;color:#2B7DE9;margin-left:auto;' }, '✓'));
      orgBtn.onmouseenter = () => { if (!isCurrentOrg) orgBtn.style.background = '#F5F5F7'; };
      orgBtn.onmouseleave = () => { if (!isCurrentOrg) orgBtn.style.background = 'transparent'; };
      orgBtn.onclick = async () => {
        if (isCurrentOrg) return;
        menu.remove();
        await switchOrg(orgRow.org_id, org);
      };
      menu.appendChild(orgBtn);
    });
  }

  // Product line section
  if (state.productLines && state.productLines.length > 1) {
    menu.appendChild(el('div', { style: 'height:1px;background:#E0E0EC;margin:10px 0;' }));
    menu.appendChild(el('div', { style: 'font-size:10px;font-weight:700;color:#6B6E8F;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;' }, 'Product Line'));
    state.productLines.forEach(pl => {
      const isCurrent = state.selectedProductLine?.id === pl.id;
      const plBtn = el('div', {
        style: 'display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:7px;cursor:pointer;background:' + (isCurrent ? '#EEF3FC' : 'transparent') + ';margin-bottom:2px;'
      });
      const dot = el('div', { style: 'width:8px;height:8px;border-radius:50%;background:' + (isCurrent ? '#2B7DE9' : '#E0E0EC') + ';flex-shrink:0;' });
      const name = el('div', { style: 'font-size:12px;font-weight:' + (isCurrent ? '600' : '400') + ';color:#0A0E24;' }, pl.name);
      plBtn.appendChild(dot);
      plBtn.appendChild(name);
      if (pl.category) plBtn.appendChild(el('div', { style: 'font-size:10px;color:#6B6E8F;margin-left:auto;' }, pl.category));
      if (isCurrent) plBtn.appendChild(el('div', { style: 'font-size:10px;color:#2B7DE9;margin-left:auto;' }, '✓'));
      plBtn.onmouseenter = () => { if (!isCurrent) plBtn.style.background = '#F5F5F7'; };
      plBtn.onmouseleave = () => { if (!isCurrent) plBtn.style.background = 'transparent'; };
      plBtn.onclick = async () => {
        if (isCurrent) return;
        menu.remove();
        await switchProductLine(pl);
      };
      menu.appendChild(plBtn);
    });
  }

  // Usage indicator
  if (state.usage) {
    const usageIndicator = el('div', {
      id: 'usage-indicator',
      style: 'font-size:9px;color:' + (state.usage.remaining <= 5 ? '#FF5C35' : 'rgba(255,255,255,0.45)') + ';text-align:right;padding:2px 0 6px;'
    }, state.usage.used + '/' + state.usage.limit + ' lookups this month');
    header.appendChild(usageIndicator);
  }

  // Close on outside click — set AFTER menu is fully built
  setTimeout(() => {
    document.addEventListener('click', function closeMenu(e) {
      if (!menu.contains(e.target) && e.target !== anchor) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    });
  }, 200);
}

async function loadUserOrgs() {
  const session = await getSession();
  if (!session?.access_token) return [];
  try {
    // Step 1: get org memberships for current user
    const r1 = await fetch(
      SUPABASE_URL + '/rest/v1/org_users?select=org_id,role',
      { headers: { 'Authorization': 'Bearer ' + session.access_token, 'apikey': SUPABASE_ANON_KEY } }
    );
    if (!r1.ok) return [];
    const rows = await r1.json();
    if (!rows || rows.length === 0) return [];

    // Step 2: fetch org details for each org_id
    const orgIds = rows.map(r => r.org_id).join(',');
    const r2 = await fetch(
      SUPABASE_URL + '/rest/v1/organizations?id=in.(' + orgIds + ')&select=id,name,brand_name,brand_color,logo_url,company_description,solution_domain,value_drivers,target_personas',
      { headers: { 'Authorization': 'Bearer ' + session.access_token, 'apikey': SUPABASE_ANON_KEY } }
    );
    const orgsData = r2.ok ? await r2.json() : [];

    // Step 3: merge
    return rows.map(row => ({
      ...row,
      organizations: orgsData.find(o => o.id === row.org_id) || null
    }));
  } catch(e) {
    return [];
  }
}

async function switchOrg(orgId, orgData) {
  state.org = orgData;
  state.selectedProductLine = null;
  state.result = null;
  state.kb = null;

  // Load product lines for new org
  const pls = await getProductLines(orgId);
  state.productLines = pls || [];

  if (state.productLines.length > 1) {
    state.view = 'select-product-line';
    render();
    return;
  }

  // Auto-select first product line
  const pl = state.productLines[0] || null;
  state.selectedProductLine = pl;
  if (pl) {
    chrome.storage.local.set({ recon_product_line_id: pl.id });
    state.kb = await getOrgKnowledgeBase(orgId, pl.id);
  }

  state.view = 'app';
  render();
}

async function switchProductLine(pl) {
  state.selectedProductLine = pl;
  state.result = null;
  chrome.storage.local.set({ recon_product_line_id: pl.id });

  // Get current org id
  const orgData = await getUserOrg();
  if (orgData?.org_id) {
    state.kb = await getOrgKnowledgeBase(orgData.org_id, pl.id);
  }

  render();
}

// ── Search ─────────────────────────────────────────────────────────────────
function renderSearch() {
  const wrap = el('div');

  if (!state.result && !state.loading) {
    wrap.appendChild(el('div', { class: 'search-instruction' },
      'Select your product line above, then enter a prospect or company name to run Recon.'));
  }

  // Usage indicator
  if (state.usage) {
    const color = state.usage.remaining <= 5 ? '#C0320F' : '#6B6E8F';
    const usageText = state.usage.remaining <= 5 ? state.usage.remaining + ' lookups left' : state.usage.used + '/' + state.usage.limit;
    const usageRow = el('div', { style: 'display:flex;justify-content:flex-end;margin-bottom:2px;' });
    usageRow.appendChild(el('div', { style: 'font-size:10px;color:' + color + ';' }, usageText));
    wrap.appendChild(usageRow);
  }

  // Prospect / Customer toggle
  const modeRow = el('div', { style: 'display:flex;gap:6px;margin-bottom:8px;' });
  ['prospect', 'customer'].forEach(mode => {
    const btn = el('div', {
      style: 'flex:1;text-align:center;padding:5px 0;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;transition:all 0.15s;' +
        (state.accountMode === mode
          ? 'background:' + (mode === 'prospect' ? '#2B7DE9' : '#00C5A1') + ';color:#fff;'
          : 'background:#F5F6FA;color:#6B6E8F;border:1px solid #E0E4EC;')
    }, mode === 'prospect' ? '🎯 Prospect' : '🔄 Customer');
    btn.onclick = () => {
      state.accountMode = mode;
      state.ownedProductLines = [];
      render();
    };
    modeRow.appendChild(btn);
  });
  wrap.appendChild(modeRow);

  // Customer mode — owned product selector
  if (state.accountMode === 'customer' && state.productLines && state.productLines.length > 0) {
    const ownedWrap = el('div', { style: 'background:#F0FAF8;border:1px solid #00C5A1;border-radius:8px;padding:10px;margin-bottom:8px;' });
    ownedWrap.appendChild(el('div', { style: 'font-size:10px;font-weight:700;color:#007A62;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px;' }, 'Products they already own'));
    state.productLines.forEach(pl => {
      const isOwned = state.ownedProductLines.includes(pl.id);
      const row = el('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:4px;cursor:pointer;' });
      const cb = el('input', { type: 'checkbox', style: 'width:14px;height:14px;cursor:pointer;accent-color:#00C5A1;' });
      cb.checked = isOwned;
      cb.onchange = () => {
        if (cb.checked) { state.ownedProductLines.push(pl.id); }
        else { state.ownedProductLines = state.ownedProductLines.filter(id => id !== pl.id); }
      };
      row.appendChild(cb);
      row.appendChild(el('div', { style: 'font-size:12px;color:#0A0E24;' }, pl.name));
      ownedWrap.appendChild(row);
    });
    wrap.appendChild(ownedWrap);
  }

  // Search row
  const row = el('div', { class: 'search-row' });
  const input = el('input', {
    type: 'text', id: 'company-input',
    placeholder: state.accountMode === 'customer' ? 'Enter customer account name…' : 'Enter company name…',
    value: state.company
  });
  input.oninput = e => { state.company = e.target.value; };
  input.onkeydown = e => { if (e.key === 'Enter') doResearch(); };
  const btn = el('button', { class: 'btn btn-primary' },
    state.accountMode === 'customer' ? 'Find Opportunities ↗' : 'Research ↗');
  btn.onclick = doResearch;
  row.appendChild(input);
  row.appendChild(btn);
  wrap.appendChild(row);

  // LinkedIn indicator
  if (state.linkedinData && Object.keys(state.linkedinData).length > 1) {
    const liRow = el('div', { style: 'display:flex;align-items:center;gap:6px;margin-top:6px;' });
    liRow.appendChild(el('div', { style: 'font-size:10px;font-weight:600;background:#EBF3FD;color:#2B7DE9;padding:2px 8px;border-radius:10px;' }, '✓ LinkedIn data'));
    const clear = el('div', { style: 'font-size:10px;color:#6B6E8F;cursor:pointer;' }, 'clear');
    clear.onclick = () => { state.linkedinData = null; chrome.storage.local.remove(['recon_linkedin_data']); render(); };
    liRow.appendChild(clear);
    wrap.appendChild(liRow);
  }

  return wrap;
}

// ── Source pills ───────────────────────────────────────────────────────────
function renderSourcePills() {
  const wrap = el('div');
  wrap.appendChild(el('div', { class: 'label' }, 'Data sources'));
  const pills = el('div', { class: 'source-pills' });
  Object.entries(state.sources).forEach(([name, active]) => {
    const pill = el('div', { class: `source-pill${active ? ' active' : ''}` }, name);
    pill.onclick = () => { state.sources[name] = !state.sources[name]; render(); };
    pills.appendChild(pill);
  });
  wrap.appendChild(pills);
  return wrap;
}

// ── Overview banner ────────────────────────────────────────────────────────
function renderOverview() {
  const r = state.result;
  const banner = el('div', { class: 'overview-banner' });

  const nameRow = el('div', { style: 'display:flex;align-items:center;gap:8px;' });
  nameRow.appendChild(el('div', { class: 'overview-name' }, state.company));

  const exportBtn = el('button', { class: 'export-btn', title: 'Export a formatted account brief (.doc)' }, '⬇ Export Brief');
  exportBtn.onclick = exportBrief;
  nameRow.appendChild(exportBtn);

  // ICP tier badge
  const fitScores = r.fitScores || [];
  const icpTier = fitScores[0]?.icpTier;
  if (icpTier && icpTier !== 'unknown') {
    const badgeColors = {
      primary: 'background:#FF5C35;color:#fff;',
      secondary: 'background:#1B1F5E;color:#fff;',
      non: 'background:#888;color:#fff;'
    };
    const badgeLabels = { primary: 'Primary ICP', secondary: 'Secondary ICP', non: 'Non ICP' };
    const badge = el('div', {
      style: `font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;${badgeColors[icpTier] || ''}`
    }, badgeLabels[icpTier] || '');
    nameRow.appendChild(badge);
  }

  banner.appendChild(nameRow);
  const meta = [r.priorities?.industry, r.priorities?.geography, r.priorities?.employeeCount ? `~${r.priorities.employeeCount} employees` : null]
    .filter(Boolean).join(' · ');
  if (meta) banner.appendChild(el('div', { class: 'overview-meta' }, meta));
  if (r.priorities?.companyOverview) {
    banner.appendChild(el('div', { class: 'overview-desc' }, r.priorities.companyOverview));
  }
  const bizBits = [
    r.priorities?.revenueModel ? 'Revenue: ' + r.priorities.revenueModel : null,
    r.priorities?.growthStrategy ? 'Growth: ' + r.priorities.growthStrategy : null
  ].filter(Boolean);
  if (bizBits.length) banner.appendChild(el('div', { class: 'overview-biz' }, bizBits.join('  ·  ')));
  return banner;
}


// ── Initiatives matrix ──────────────────────────────────────────────────────
const FIT_STYLES = {
  Strong:      { fg: '#0E8A6B', bg: '#E1F6EF' },
  Moderate:    { fg: '#1663C7', bg: '#E8F0FC' },
  Exploratory: { fg: '#6B7480', bg: '#EEF0F3' }
};

function renderMatrix(section) {
  const priorities = state.result?.priorities?.priorities || [];
  if (!priorities.length) {
    section.appendChild(el('div', { class: 'empty' }, 'No initiatives yet — run a research first.'));
    return;
  }

  const hasMapping = priorities.some(pr => pr.fitRating || pr.solutionProvides);
  if (!hasMapping) {
    section.appendChild(el('div', { class: 'matrix-hint' },
      'This research pre-dates initiative mapping. Re-run the search to populate fit ratings, solution mapping, and value drivers.'));
  }

  const table = el('table', { class: 'matrix-table' });
  const thead = el('thead');
  const hrow = el('tr');
  ['Initiative / Source', 'Fit', 'Why This Matters', 'Talking Points & Value Drivers', 'Product Fit', 'Safety Signals'].forEach(h =>
    hrow.appendChild(el('th', {}, h)));
  thead.appendChild(hrow);
  table.appendChild(thead);

  const tbody = el('tbody');
  priorities.forEach(pr => {
    const tr = el('tr');

    const tdInit = el('td', { class: 'matrix-init' });
    tdInit.appendChild(el('div', { class: 'matrix-init-title' }, pr.title || '—'));
    if (pr.description) tdInit.appendChild(el('div', { class: 'matrix-init-desc' }, pr.description));
    const srcBits = el('div', { class: 'matrix-src' });
    if (pr.sourceLabel || pr.source) srcBits.appendChild(el('span', { class: 'src-label' }, pr.sourceLabel || pr.source));
    if (pr.evidenceType) srcBits.appendChild(el('span', { class: 'ev-badge ev-' + pr.evidenceType }, pr.evidenceType === 'explicit' ? 'Explicit' : 'Inferred'));
    if (srcBits.childNodes.length) tdInit.appendChild(srcBits);
    tr.appendChild(tdInit);

    const tdFit = el('td');
    if (pr.fitRating) {
      const st = FIT_STYLES[pr.fitRating] || FIT_STYLES.Exploratory;
      tdFit.appendChild(el('span', { class: 'fit-pill', style: 'color:' + st.fg + ';background:' + st.bg + ';' }, pr.fitRating));
      if (pr.fitRationale) tdFit.appendChild(el('div', { class: 'matrix-cell-sub' }, pr.fitRationale));
    } else tdFit.textContent = '—';
    tr.appendChild(tdFit);

    tr.appendChild(el('td', { class: 'matrix-cell' }, pr.whyItMatters || '—'));

    const tdTalk = el('td');
    const talks = Array.isArray(pr.talkingPoints) && pr.talkingPoints.length ? pr.talkingPoints : (Array.isArray(pr.valueDrivers) ? pr.valueDrivers : []);
    if (talks.length) {
      talks.forEach(v => tdTalk.appendChild(el('div', { class: 'value-chip' }, v)));
    } else tdTalk.textContent = '—';
    tr.appendChild(tdTalk);

    const tdProd = el('td', { class: 'matrix-cell' });
    tdProd.textContent = pr.productFit || '—';
    if (pr.proofPoint) tdProd.appendChild(el('div', { class: 'matrix-cell-sub' }, 'Proof: ' + pr.proofPoint));
    tr.appendChild(tdProd);

    tr.appendChild(el('td', { class: 'matrix-cell matrix-osha' }, pr.oshaSignals || 'None found'));

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  section.appendChild(table);
}

// ── Export brief ────────────────────────────────────────────────────────────
function exportBrief() {
  const r = state.result || {};
  const pri = r.priorities?.priorities || [];
  const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const plName = state.selectedProductLine?.name || '';

  let h = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>Recon Brief</title>';
  h += '<style>body{font-family:Calibri,Arial,sans-serif;color:#1a1a2e;font-size:11pt;line-height:1.45}h1{font-size:20pt;color:#0D1235;margin-bottom:2pt}h2{font-size:13pt;color:#0D1235;border-bottom:1.5pt solid #1663C7;padding-bottom:3pt;margin-top:18pt}h3{font-size:11pt;color:#0D1235;margin-bottom:2pt}.meta{color:#59627F;font-size:10pt;margin-bottom:14pt}table{border-collapse:collapse;width:100%;font-size:10pt}th{background:#0D1235;color:#fff;text-align:left;padding:6pt;border:1pt solid #0D1235}td{border:1pt solid #C9D2E0;padding:6pt;vertical-align:top}.pill{font-weight:bold}.sub{color:#59627F;font-size:9pt}.chip{margin:0 0 2pt 0}p{margin:4pt 0}</style></head><body>';
  h += '<h1>Account Brief: ' + esc(state.company) + '</h1>';
  h += '<div class="meta">Generated by Recon · ' + esc(today) + (plName ? ' · Product line: ' + esc(plName) : '') + '</div>';

  if (r.priorities?.companyOverview) {
    h += '<h2>Company Overview</h2><p>' + esc(r.priorities.companyOverview) + '</p>';
    const meta = [r.priorities.industry, r.priorities.geography, r.priorities.employeeCount ? '~' + r.priorities.employeeCount + ' employees' : null].filter(Boolean).join(' · ');
    if (meta) h += '<p class="sub">' + esc(meta) + '</p>';
    if (r.priorities.revenueModel) h += '<p><b>Revenue model:</b> ' + esc(r.priorities.revenueModel) + '</p>';
    if (r.priorities.growthStrategy) h += '<p><b>Growth strategy:</b> ' + esc(r.priorities.growthStrategy) + '</p>';
  }

  if (pri.length) {
    h += '<h2>Strategic Initiatives &amp; Solution Fit</h2><table><tr><th style="width:20%">Initiative / Source</th><th style="width:11%">Fit</th><th style="width:18%">Why This Matters</th><th style="width:21%">Talking Points &amp; Value Drivers</th><th style="width:16%">Product Fit</th><th style="width:14%">Safety Signals</th></tr>';
    pri.forEach(prio => {
      const talks = Array.isArray(prio.talkingPoints) && prio.talkingPoints.length ? prio.talkingPoints : (prio.valueDrivers || []);
      const vd = talks.length ? talks.map(v => '<div class="chip">• ' + esc(v) + '</div>').join('') : '—';
      const fitColor = prio.fitRating === 'Strong' ? '#0E8A6B' : prio.fitRating === 'Moderate' ? '#1663C7' : '#6B7480';
      const src = [prio.sourceLabel || prio.source, prio.evidenceType === 'inferred' ? 'inferred' : (prio.evidenceType ? 'explicit' : null)].filter(Boolean).join(' · ');
      h += '<tr><td><b>' + esc(prio.title) + '</b><div class="sub">' + esc(prio.description || '') + '</div>' + (src ? '<div class="sub"><i>' + esc(src) + '</i></div>' : '') + '</td>'
        + '<td><span class="pill" style="color:' + fitColor + '">' + esc(prio.fitRating || '—') + '</span><div class="sub">' + esc(prio.fitRationale || '') + '</div></td>'
        + '<td>' + esc(prio.whyItMatters || '—') + '</td><td>' + vd + '</td>'
        + '<td>' + esc(prio.productFit || '—') + (prio.proofPoint ? '<div class="sub">Proof: ' + esc(prio.proofPoint) + '</div>' : '') + '</td>'
        + '<td>' + esc(prio.oshaSignals || 'None found') + '</td></tr>';
    });
    h += '</table>';
    if (r.priorities?.recommendedOutreachAngle) h += '<h2>Recommended Outreach Angle</h2><p>' + esc(r.priorities.recommendedOutreachAngle) + '</p>';
    const contacts = r.priorities?.suggestedContacts || [];
    if (contacts.length) {
      h += '<h2>Suggested Contacts</h2>';
      contacts.forEach(c => { h += '<p>• <b>' + esc([c.name, c.title].filter(Boolean).join(', ')) + '</b>' + (c.rationale ? ' — ' + esc(c.rationale) : '') + '</p>'; });
    }
  }

  const intents = r.priorities?.intentSignals || [];
  if (intents.length) {
    h += '<h2>Intent Signals</h2>';
    intents.forEach(s => { h += '<p>• <b>' + esc(s.signal) + '</b> <span class="sub">(' + esc(s.strength || '') + ')</span></p>'; });
  }

  const comp = (r.priorities?.competitiveSignals || []).concat(r.competitive || []);
  if (comp.length) {
    h += '<h2>Competitive Landscape</h2>';
    comp.forEach(c => { h += '<p>• <b>' + esc(c.competitor || '') + '</b>: ' + esc(c.signal || c.note || '') + (c.detail ? ' — ' + esc(c.detail) : '') + '</p>'; });
  }

  const fits = r.fitScores || [];
  if (fits.length) {
    h += '<h2>Capability Fit Scores</h2>';
    fits.forEach(f => { h += '<p>• ' + esc(f.name || f.capability || '') + ': <b>' + esc(f.score) + '</b></p>'; });
  }

  const stories = r.stories || [];
  if (stories.length) {
    h += '<h2>Relevant Customer Stories</h2>';
    stories.forEach(s => { h += '<h3>' + esc(s.customer || s.title || '') + '</h3><p>' + esc(s.summary || s.story || '') + '</p>'; });
  }

  if (Array.isArray(state.cadenceDraft) && state.cadenceDraft.length) {
    h += '<h2>Outreach Cadence</h2>';
    state.cadenceDraft.forEach((st, i) => {
      h += '<h3>Email ' + (i + 1) + (st.subject ? ': ' + esc(st.subject) : '') + '</h3><p>' + esc(st.body || '').replace(/\n/g, '<br>') + '</p>';
    });
  }

  if (state.callScript) {
    h += '<h2>Call Script</h2><p>' + esc(typeof state.callScript === 'string' ? state.callScript : JSON.stringify(state.callScript)).replace(/\n/g, '<br>') + '</p>';
  }

  h += '<p class="sub" style="margin-top:20pt">Recon by 450Digital · recon.450digital.com</p></body></html>';

  const blob = new Blob(['\ufeff' + h], { type: 'application/msword' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'Recon Brief - ' + (state.company || 'Account').replace(/[^\w\s-]/g, '') + '.doc';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}


// ── Shareable brief + internal email ────────────────────────────────────────
function buildBriefText() {
  const r = state.result || {};
  const pr = r.priorities || {};
  const items = pr.priorities || [];
  const seller = state.org?.name || 'Our company';
  const L = [];
  L.push('ACCOUNT BRIEF: ' + (state.company || '').toUpperCase());
  L.push('');
  L.push('EXECUTIVE SUMMARY');
  L.push([pr.companyOverview, pr.geography ? 'Geography: ' + pr.geography : null,
          pr.revenueModel ? 'Revenue model: ' + pr.revenueModel : null,
          pr.growthStrategy ? 'Growth strategy: ' + pr.growthStrategy : null].filter(Boolean).join(' '));
  L.push('');
  if (items.length) {
    L.push('KEY PRIORITIES');
    items.forEach(i => {
      L.push('• ' + i.title + (i.sourceLabel ? ' [' + i.sourceLabel + (i.evidenceType === 'inferred' ? ', inferred' : '') + ']' : ''));
      if (i.whyItMatters) L.push('  Why it matters: ' + i.whyItMatters);
    });
    L.push('');
    L.push(seller.toUpperCase() + ' RELEVANCE');
    items.forEach(i => {
      if (i.productFit || i.solutionProvides) {
        L.push('• ' + i.title + ' → ' + (i.productFit || '') + (i.solutionProvides ? ': ' + i.solutionProvides : ''));
        if (i.proofPoint) L.push('  Proof point: ' + i.proofPoint);
      }
    });
    L.push('');
  }
  if (pr.recommendedOutreachAngle) {
    L.push('RECOMMENDED OUTREACH ANGLE');
    L.push(pr.recommendedOutreachAngle);
    L.push('');
  }
  const contacts = pr.suggestedContacts || [];
  if (contacts.length) {
    L.push('SUGGESTED CONTACTS');
    contacts.forEach(c => L.push('• ' + [c.name, c.title].filter(Boolean).join(', ') + (c.rationale ? ' — ' + c.rationale : '')));
  }
  return L.join('\n');
}

function buildInternalEmailText() {
  const r = state.result || {};
  const pr = r.priorities || {};
  const items = pr.priorities || [];
  const strongest = items.find(i => i.fitRating === 'Strong') || items[0];
  const L = [];
  L.push('Subject: Recon findings — ' + (state.company || ''));
  L.push('');
  L.push('Ran a Recon on ' + (state.company || '') + '. Key findings:');
  items.slice(0, 3).forEach(i => L.push('• ' + i.title + (i.whyItMatters ? ' — ' + i.whyItMatters : '')));
  if (strongest) {
    L.push('');
    L.push('Strongest angle: ' + strongest.title + (strongest.productFit ? ' → ' + strongest.productFit : '') + (strongest.fitRating ? ' (' + strongest.fitRating + ' fit)' : ''));
  }
  if (pr.recommendedOutreachAngle) { L.push(''); L.push('Suggested approach: ' + pr.recommendedOutreachAngle); }
  L.push('');
  L.push('Next steps: review the full brief, confirm target contact, and kick off a day-1 LinkedIn + email + call sequence.');
  return L.join('\n');
}

function copyBtn(getText, label) {
  const b = el('button', { class: 'copy-btn' }, label || 'Copy');
  b.onclick = () => {
    navigator.clipboard.writeText(getText());
    b.textContent = '✓ Copied'; setTimeout(() => { b.textContent = label || 'Copy'; }, 1500);
  };
  return b;
}

function renderBrief(section) {
  if (!state.result?.priorities) {
    section.appendChild(el('div', { class: 'empty' }, 'Run a research first.'));
    return;
  }
  const head = el('div', { class: 'brief-head' });
  head.appendChild(el('div', { class: 'brief-title' }, 'Shareable one-pager'));
  head.appendChild(copyBtn(buildBriefText, 'Copy brief'));
  section.appendChild(head);
  section.appendChild(el('pre', { class: 'brief-pre' }, buildBriefText()));

  const head2 = el('div', { class: 'brief-head', style: 'margin-top:16px;' });
  head2.appendChild(el('div', { class: 'brief-title' }, 'Internal email to requester'));
  head2.appendChild(copyBtn(buildInternalEmailText, 'Copy email'));
  section.appendChild(head2);
  section.appendChild(el('pre', { class: 'brief-pre' }, buildInternalEmailText()));
}

// ── Nav tabs ───────────────────────────────────────────────────────────────
function renderNavTabs() {
  const isCustomer = state.accountMode === 'customer';
  const tabs = isCustomer ? [
    { id: 'matrix', label: 'Initiatives' },
    { id: 'brief', label: 'Brief' },
    { id: 'intelligence', label: 'Intelligence' },
    { id: 'signals', label: '⚡ Signals' },
    { id: 'stories', label: 'Stories' },
    { id: 'cadence', label: '✦ Outreach' }
  ] : [
    { id: 'matrix', label: 'Initiatives' },
    { id: 'brief', label: 'Brief' },
    { id: 'intelligence', label: 'Intelligence' },
    { id: 'intent', label: 'Intent & Competitive' },
    { id: 'stories', label: 'Stories' },
    { id: 'cadence', label: '✦ Outreach' }
  ];
  const row = el('div', { class: 'nav-tabs' });
  tabs.forEach(t => {
    const tab = el('div', { class: 'nav-tab' + (state.activeTab === t.id ? ' active' : '') }, t.label);
    tab.onclick = () => { state.activeTab = t.id; render(); };
    row.appendChild(tab);
  });
  return row;
}

// ── Active section ─────────────────────────────────────────────────────────
function renderActiveSection() {
  const section = el('div', { class: 'section visible' });
  switch (state.activeTab) {
    case 'matrix':       renderMatrix(section);     break;
    case 'brief':        renderBrief(section);      break;
    case 'intelligence': state.accountMode === 'customer' ? renderIntelligenceCustomer(section) : renderIntelligence(section); break;
    case 'intent':       renderIntent(section);     break;
    case 'signals':      renderSignals(section);    break;
    case 'stories':      renderStories(section);    break;
    case 'cadence':      renderCadence(section);    break;
  }
  return section;
}

// ── Intelligence tab (combined priorities + fit) ───────────────────────────
function renderIntelligence(section) {
  const priorities = state.result?.priorities?.priorities || [];
  const fitScores = state.result?.fitScores || [];

  if (!priorities.length && !fitScores.length) {
    section.appendChild(el('div', { class: 'empty' }, 'No results yet.'));
    return;
  }

  // ── Strategic priorities ──────────────────────────────────────────────
  if (priorities.length) {
    section.appendChild(el('div', {
      style: 'font-size:10px;font-weight:700;color:var(--fu-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;'
    }, 'Strategic priorities'));

    priorities.forEach(p => {
      const card = el('div', { style: 'border:1px solid var(--fu-border);border-radius:8px;padding:10px 12px;margin-bottom:8px;background:#fff;border-left:3px solid var(--fu-orange);' });
      card.appendChild(el('div', { style: 'font-size:12px;font-weight:600;color:var(--fu-text);margin-bottom:3px;' }, p.title));
      if (p.description) card.appendChild(el('div', { style: 'font-size:11px;color:var(--fu-muted);line-height:1.4;margin-bottom:4px;' }, p.description));
      card.appendChild(el('div', { style: 'font-size:10px;color:var(--fu-muted);' }, 'Source: ' + p.source));
      section.appendChild(card);
    });
  }

  // ── Divider ───────────────────────────────────────────────────────────
  if (priorities.length && fitScores.length) {
    section.appendChild(el('div', { style: 'height:1px;background:var(--fu-border);margin:14px 0;' }));
  }

  // ── Capability fit ────────────────────────────────────────────────────
  if (fitScores.length) {
    // ICP badge
    const icpTier = fitScores[0]?.icpTier;
    const headerRow = el('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;' });
    headerRow.appendChild(el('div', { style: 'font-size:10px;font-weight:700;color:var(--fu-muted);text-transform:uppercase;letter-spacing:0.08em;' }, 'Capability fit'));
    if (icpTier && icpTier !== 'unknown') {
      const tierColors = { primary: '#FF5C35', secondary: '#2B7DE9', non: '#888' };
      const tierLabels = { primary: 'Primary ICP', secondary: 'Secondary ICP', non: 'Non-ICP' };
      const badge = el('div', { style: 'font-size:10px;font-weight:600;padding:2px 8px;border-radius:10px;background:' + tierColors[icpTier] + '22;color:' + tierColors[icpTier] + ';' }, tierLabels[icpTier]);
      headerRow.appendChild(badge);
    }
    section.appendChild(headerRow);

    fitScores.forEach(f => {
      const row = el('div', { style: 'margin-bottom:10px;' });
      // Name + score
      const top = el('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;' });
      const nameWrap = el('div', { style: 'flex:1;' });
      nameWrap.appendChild(el('div', { style: 'font-size:12px;font-weight:600;color:var(--fu-text);' }, f.name));
      if (f.useCases?.[0]) nameWrap.appendChild(el('div', { style: 'font-size:10px;color:var(--fu-muted);margin-top:1px;' }, f.useCases[0]));
      top.appendChild(nameWrap);
      top.appendChild(el('div', { style: 'font-size:13px;font-weight:700;color:' + (f.score >= 75 ? '#007A62' : f.score >= 55 ? '#2B7DE9' : 'var(--fu-muted)') + ';margin-left:8px;' }, f.score + '%'));
      row.appendChild(top);

      // Score bar
      const barBg = el('div', { style: 'height:4px;background:var(--fu-border);border-radius:2px;overflow:hidden;margin-bottom:4px;' });
      const barFill = el('div', { style: 'height:100%;width:' + f.score + '%;background:' + (f.score >= 75 ? '#00C5A1' : '#2B7DE9') + ';border-radius:2px;transition:width 0.6s;' });
      barBg.appendChild(barFill);
      row.appendChild(barBg);

      // Matched priorities as pills
      if (f.matchedPriorities?.length) {
        const pillRow = el('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;' });
        f.matchedPriorities.slice(0, 3).forEach(p => {
          pillRow.appendChild(el('span', { style: 'font-size:10px;background:#EBF3FD;color:#2B7DE9;padding:1px 7px;border-radius:8px;' }, p.length > 28 ? p.slice(0, 28) + '…' : p));
        });
        row.appendChild(pillRow);
      }

      section.appendChild(row);
    });

    // Generate email button
    const emailBtn = el('button', { class: 'btn btn-primary btn-full', style: 'margin-top:6px;' }, 'Generate discovery email ↗');
    emailBtn.onclick = doGenerateEmail;
    section.appendChild(emailBtn);
  }
}

// ── Intelligence tab — customer/expansion mode ─────────────────────────────
function renderIntelligenceCustomer(section) {
  const priorities = state.result?.priorities?.priorities || [];
  const fitScores = state.result?.fitScores || [];
  const expansionSignals = state.result?.priorities?.expansionSignals || [];
  const unowned = fitScores.filter(f => !state.ownedProductLines.includes(f.id));
  const owned = fitScores.filter(f => state.ownedProductLines.includes(f.id));

  // ── Top expansion signals ─────────────────────────────────────────────
  if (expansionSignals.length) {
    section.appendChild(el('div', { style: 'font-size:10px;font-weight:700;color:#C0320F;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;' }, '⚡ Expansion signals'));
    expansionSignals.slice(0, 2).forEach(s => {
      const card = el('div', { style: 'border:1px solid #FFD0C8;border-radius:8px;padding:8px 12px;margin-bottom:6px;background:#FFF8F7;border-left:3px solid #C0320F;' });
      card.appendChild(el('div', { style: 'font-size:11px;font-weight:600;color:#C0320F;' }, s.signal));
      if (s.opportunity) card.appendChild(el('div', { style: 'font-size:11px;color:#007A62;margin-top:2px;' }, '↳ ' + s.opportunity));
      section.appendChild(card);
    });
    section.appendChild(el('div', { style: 'height:1px;background:var(--fu-border);margin:12px 0;' }));
  }

  // ── Strategic priorities ──────────────────────────────────────────────
  if (priorities.length) {
    section.appendChild(el('div', { style: 'font-size:10px;font-weight:700;color:var(--fu-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;' }, 'Strategic priorities'));
    priorities.slice(0, 3).forEach(p => {
      const card = el('div', { style: 'border:1px solid var(--fu-border);border-radius:8px;padding:9px 12px;margin-bottom:6px;background:#fff;border-left:3px solid #00C5A1;' });
      card.appendChild(el('div', { style: 'font-size:12px;font-weight:600;color:var(--fu-text);margin-bottom:2px;' }, p.title));
      if (p.description) card.appendChild(el('div', { style: 'font-size:11px;color:var(--fu-muted);line-height:1.4;' }, p.description));
      section.appendChild(card);
    });
    section.appendChild(el('div', { style: 'height:1px;background:var(--fu-border);margin:12px 0;' }));
  }

  // ── Expansion opportunities ───────────────────────────────────────────
  if (unowned.length) {
    section.appendChild(el('div', { style: 'font-size:10px;font-weight:700;color:var(--fu-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;' }, 'Expansion opportunities'));
    unowned.sort((a, b) => b.score - a.score).forEach(f => {
      const row = el('div', { style: 'margin-bottom:10px;' });
      const top = el('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:3px;' });
      const nameWrap = el('div', { style: 'flex:1;' });
      nameWrap.appendChild(el('div', { style: 'font-size:12px;font-weight:600;color:var(--fu-text);' }, f.name));
      if (f.score >= 75) nameWrap.appendChild(el('div', { style: 'font-size:10px;color:#007A62;font-weight:600;' }, '↑ Strong opportunity'));
      top.appendChild(nameWrap);
      top.appendChild(el('div', { style: 'font-size:13px;font-weight:700;color:' + (f.score >= 75 ? '#007A62' : '#2B7DE9') + ';margin-left:8px;' }, f.score + '%'));
      row.appendChild(top);
      const barBg = el('div', { style: 'height:4px;background:var(--fu-border);border-radius:2px;overflow:hidden;margin-bottom:4px;' });
      barBg.appendChild(el('div', { style: 'height:100%;width:' + f.score + '%;background:' + (f.score >= 75 ? '#00C5A1' : '#2B7DE9') + ';border-radius:2px;transition:width 0.6s;' }));
      row.appendChild(barBg);
      if (f.matchedPriorities?.length) {
        const pillRow = el('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;' });
        f.matchedPriorities.slice(0, 3).forEach(p => {
          pillRow.appendChild(el('span', { style: 'font-size:10px;background:#E0FAF5;color:#007A62;padding:1px 7px;border-radius:8px;' }, p.length > 28 ? p.slice(0, 28) + '…' : p));
        });
        row.appendChild(pillRow);
      }
      section.appendChild(row);
    });
  }

  // ── Already owns (collapsed) ──────────────────────────────────────────
  if (owned.length) {
    section.appendChild(el('div', { style: 'height:1px;background:var(--fu-border);margin:12px 0;' }));
    section.appendChild(el('div', { style: 'font-size:10px;font-weight:700;color:var(--fu-muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;opacity:0.6;' }, 'Already owns'));
    owned.forEach(f => {
      const row = el('div', { style: 'display:flex;align-items:center;justify-content:space-between;padding:4px 0;opacity:0.5;' });
      row.appendChild(el('div', { style: 'font-size:12px;color:var(--fu-text);' }, f.name));
      row.appendChild(el('div', { style: 'font-size:12px;color:var(--fu-muted);' }, f.score + '%'));
      section.appendChild(row);
    });
  }

  // Email button
  const emailBtn = el('button', { class: 'btn btn-primary btn-full', style: 'margin-top:10px;' }, 'Generate expansion email ↗');
  emailBtn.onclick = doGenerateEmail;
  section.appendChild(emailBtn);
}

function renderPriorities(section) {
  const priorities = state.result.priorities?.priorities || [];
  if (!priorities.length) { section.appendChild(el('div', { class: 'empty' }, 'No priorities found.')); return; }
  priorities.forEach(p => {
    const card = el('div', { class: 'priority-card' });
    card.appendChild(el('div', { class: 'priority-card-title' }, p.title));
    if (p.description) card.appendChild(el('div', { class: 'priority-card-desc' }, p.description));
    card.appendChild(el('div', { class: 'priority-card-src' }, `Source: ${p.source}`));
    section.appendChild(card);
  });
}

function renderIntent(section) {
  const intentSignals = state.result.priorities?.intentSignals || [];
  const competitive = state.result.competitive || [];
  if (!intentSignals.length && !competitive.length) {
    section.appendChild(el('div', { class: 'empty' }, 'No intent signals detected.')); return;
  }
  intentSignals.forEach(s => {
    const row = el('div', { class: 'signal-row' });
    const color = s.strength === 'high' ? '#FF5C35' : s.strength === 'medium' ? '#F0A500' : '#00C5A1';
    row.appendChild(el('div', { class: 'signal-dot', style: `background:${color}` }));
    const body = el('div', { class: 'signal-body' });
    body.appendChild(el('div', { class: 'signal-label' }, s.signal));
    row.appendChild(body);
    const badgeClass = s.strength === 'high' ? 'badge-high' : s.strength === 'medium' ? 'badge-med' : 'badge-low';
    const badgeText = s.strength === 'high' ? 'High intent' : s.strength === 'medium' ? 'Medium' : 'Low';
    row.appendChild(el('div', { class: `signal-badge ${badgeClass}` }, badgeText));
    section.appendChild(row);
  });
  competitive.forEach(c => {
    const row = el('div', { class: 'signal-row' });
    row.appendChild(el('div', { class: 'signal-dot', style: 'background:#FF5C35' }));
    const body = el('div', { class: 'signal-body' });
    body.appendChild(el('div', { class: 'signal-label' }, `${c.competitor} — ${c.signal}`));
    if (c.detail) body.appendChild(el('div', { class: 'signal-detail' }, typeof c.detail === 'string' ? c.detail : JSON.stringify(c.detail)));
    if (c.displacementAngle) body.appendChild(el('div', { class: 'signal-detail', style: 'color:#1B1F5E;margin-top:4px;font-weight:500;' }, `↳ ${c.displacementAngle}`));
    row.appendChild(body);
    row.appendChild(el('div', { class: 'signal-badge badge-displacement' }, 'Competitive'));
    section.appendChild(row);
  });
}

function renderFit(section) {
  const fitScores = state.result.fitScores || [];
  if (!fitScores.length) { section.appendChild(el('div', { class: 'empty' }, 'No fit data available.')); return; }
  const table = el('table', { class: 'fit-table' });
  const thead = el('thead');
  const hrow = el('tr');
  ['Capability', 'Matched initiatives', 'Fit'].forEach(h => hrow.appendChild(el('th', {}, h)));
  thead.appendChild(hrow);
  table.appendChild(thead);
  const tbody = el('tbody');
  fitScores.forEach(f => {
    const tr = el('tr');
    const tdName = el('td');
    tdName.appendChild(el('div', { class: 'cap-name' }, f.name));
    tdName.appendChild(el('div', { class: 'cap-match' }, f.useCases[0] || ''));
    tr.appendChild(tdName);
    const tdPills = el('td');
    (f.matchedPriorities || []).slice(0, 2).forEach(p => {
      tdPills.appendChild(el('span', { class: 'cap-pill' }, p.length > 22 ? p.slice(0, 22) + '…' : p));
    });
    tr.appendChild(tdPills);
    const tdScore = el('td');
    const barWrap = el('div', { class: 'score-bar-wrap' });
    const barBg = el('div', { class: 'score-bar-bg' });
    barBg.appendChild(el('div', { class: 'score-bar-fill', style: `width:${f.score}%` }));
    barWrap.appendChild(barBg);
    barWrap.appendChild(el('div', { class: 'score-num' }, String(f.score)));
    tdScore.appendChild(barWrap);
    tr.appendChild(tdScore);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  section.appendChild(table);
  const emailBtn = el('button', { class: 'btn btn-primary btn-full', style: 'margin-top:10px;' }, 'Generate discovery email ↗');
  emailBtn.onclick = doGenerateEmail;
  section.appendChild(emailBtn);
}

function renderStories(section) {
  const stories = state.result.stories || [];
  if (!stories.length) { section.appendChild(el('div', { class: 'empty' }, 'No matching customer stories found.')); return; }
  stories.forEach(s => {
    const card = el('div', { class: 'story-card' });
    card.appendChild(el('div', { class: 'story-company' }, s.company));
    card.appendChild(el('div', { class: 'story-industry' }, `${s.industry} · ${s.employees} employees`));
    card.appendChild(el('div', { class: 'story-outcome' }, s.outcome));
    section.appendChild(card);
  });
}

// ── Expansion signals (customer mode) ─────────────────────────────────────
function renderSignals(section) {
  const signals = state.result?.priorities?.expansionSignals || [];
  const intentSignals = state.result?.priorities?.intentSignals || [];

  if (!signals.length && !intentSignals.length) {
    section.appendChild(el('div', { class: 'empty' }, 'No expansion signals detected. Try researching on LinkedIn first.'));
    return;
  }

  if (signals.length > 0) {
    section.appendChild(el('div', { style: 'font-size:10px;font-weight:700;color:#6B6E8F;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;' }, 'Expansion signals'));
    signals.forEach(s => {
      const card = el('div', { style: 'border:1px solid #E0E4EC;border-radius:8px;padding:10px 12px;margin-bottom:8px;background:#fff;border-left:3px solid ' + (s.urgency === 'high' ? '#C0320F' : s.urgency === 'medium' ? '#F0A500' : '#2B7DE9') + ';' });
      const titleRow = el('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;' });
      titleRow.appendChild(el('div', { style: 'font-size:12px;font-weight:600;color:#0A0E24;' }, s.signal));
      const urgencyColor = s.urgency === 'high' ? '#C0320F' : s.urgency === 'medium' ? '#F0A500' : '#2B7DE9';
      titleRow.appendChild(el('div', { style: 'font-size:10px;font-weight:600;color:' + urgencyColor + ';' }, (s.urgency || 'low').toUpperCase()));
      card.appendChild(titleRow);
      if (s.detail) card.appendChild(el('div', { style: 'font-size:11px;color:#6B6E8F;line-height:1.4;' }, typeof s.detail === 'string' ? s.detail : JSON.stringify(s.detail)));
      if (s.opportunity) card.appendChild(el('div', { style: 'font-size:11px;color:#007A62;margin-top:4px;font-weight:500;' }, '↳ ' + s.opportunity));
      section.appendChild(card);
    });
  }

  if (intentSignals.length > 0) {
    section.appendChild(el('div', { style: 'font-size:10px;font-weight:700;color:#6B6E8F;text-transform:uppercase;letter-spacing:0.06em;margin:12px 0 8px;' }, 'Intent signals'));
    intentSignals.forEach(s => {
      const row = el('div', { class: 'signal-row' });
      const color = s.strength === 'high' ? '#C0320F' : s.strength === 'medium' ? '#F0A500' : '#2B7DE9';
      row.appendChild(el('div', { class: 'signal-dot', style: 'background:' + color }));
      const body = el('div', { class: 'signal-body' });
      body.appendChild(el('div', { class: 'signal-label' }, s.signal));
      row.appendChild(body);
      const badgeClass = s.strength === 'high' ? 'badge-high' : s.strength === 'medium' ? 'badge-med' : 'badge-low';
      row.appendChild(el('div', { class: 'signal-badge ' + badgeClass }, s.strength));
      section.appendChild(row);
    });
  }
}

// ── Expansion fit (customer mode) ─────────────────────────────────────────
function renderExpansionFit(section) {
  const fitScores = state.result?.fitScores || [];
  const unowned = fitScores.filter(f => !state.ownedProductLines.includes(f.id));
  const owned = fitScores.filter(f => state.ownedProductLines.includes(f.id));

  if (!fitScores.length) { section.appendChild(el('div', { class: 'empty' }, 'No fit data available.')); return; }

  // Header
  section.appendChild(el('div', { style: 'font-size:11px;color:#6B6E8F;margin-bottom:12px;' },
    state.ownedProductLines.length > 0
      ? 'Scoring ' + unowned.length + ' unowned products as expansion opportunities'
      : 'Showing full platform fit — check owned products above to see expansion opportunities'
  ));

  const renderFitRow = (f, isExpansion) => {
    const row = el('div', { style: 'padding:10px 12px;border:1px solid ' + (isExpansion && f.score >= 75 ? '#00C5A1' : '#E0E4EC') + ';border-radius:8px;margin-bottom:8px;background:' + (isExpansion && f.score >= 75 ? '#F0FAF8' : '#fff') + ';' });
    const top = el('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;' });
    const nameWrap = el('div');
    nameWrap.appendChild(el('div', { style: 'font-size:12px;font-weight:600;color:#0A0E24;' }, f.name));
    if (isExpansion && f.score >= 75) {
      nameWrap.appendChild(el('div', { style: 'font-size:10px;color:#007A62;font-weight:600;margin-top:1px;' }, '↑ Expansion opportunity'));
    }
    top.appendChild(nameWrap);
    const scoreEl = el('div', { style: 'font-size:14px;font-weight:600;color:' + (f.score >= 75 ? '#007A62' : f.score >= 55 ? '#2B7DE9' : '#6B6E8F') + ';' }, f.score + '%');
    top.appendChild(scoreEl);
    row.appendChild(top);
    const barBg = el('div', { style: 'height:4px;background:#F0F0F4;border-radius:2px;overflow:hidden;' });
    const barFill = el('div', { style: 'height:100%;width:' + f.score + '%;background:' + (f.score >= 75 ? '#00C5A1' : '#2B7DE9') + ';border-radius:2px;transition:width 0.6s ease;' });
    barBg.appendChild(barFill);
    row.appendChild(barBg);
    if (f.matchedPriorities?.length) {
      const pillRow = el('div', { style: 'display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;' });
      f.matchedPriorities.slice(0, 2).forEach(p => {
        pillRow.appendChild(el('span', { class: 'cap-pill' }, p.length > 24 ? p.slice(0, 24) + '…' : p));
      });
      row.appendChild(pillRow);
    }
    return row;
  };

  // Unowned (expansion opportunities) first
  const toShow = state.ownedProductLines.length > 0 ? unowned : fitScores;
  toShow.sort((a, b) => b.score - a.score).forEach(f => section.appendChild(renderFitRow(f, true)));

  // Owned products (dimmed)
  if (owned.length > 0) {
    section.appendChild(el('div', { style: 'font-size:10px;font-weight:700;color:#6B6E8F;text-transform:uppercase;letter-spacing:0.06em;margin:12px 0 8px;' }, 'Already owns'));
    owned.forEach(f => {
      const row = renderFitRow(f, false);
      row.style.opacity = '0.5';
      section.appendChild(row);
    });
  }

  const emailBtn = el('button', { class: 'btn btn-primary btn-full', style: 'margin-top:10px;' }, 'Generate expansion email ↗');
  emailBtn.onclick = doGenerateEmail;
  section.appendChild(emailBtn);
}

// ── Loading ────────────────────────────────────────────────────────────────
function renderLoading() {
  const wrap = el('div', { class: 'loading-wrap' });
  wrap.appendChild(el('img', { src: 'icons/icon48.png', style: 'width:44px;height:44px;border-radius:10px;' }));
  wrap.appendChild(el('div', { class: 'spinner' }));
  wrap.appendChild(el('div', { class: 'loading-msg', id: 'loading-msg' }, state.loadingMsg || 'Researching account…'));
  return wrap;
}

// ── Email modal ────────────────────────────────────────────────────────────
function renderEmailModal() {
  const overlay = el('div', { class: 'email-modal' });
  const card = el('div', { class: 'email-card' });
  card.appendChild(el('div', { class: 'label', style: 'margin-bottom:8px;' }, 'Discovery email'));
  if (state.emailPromptOpen && !state.emailLoading && !state.emailDraft) {
    card.appendChild(el('div', { style: 'font-size:12px;color:#59627F;margin-bottom:10px;' },
      'Who is this email for? A title and company help tailor it to their seniority and priorities.'));
    const tIn = el('input', { id: 'email-recip-title', placeholder: 'Recipient title, e.g. VP Internal Comms', class: 'modal-input' });
    const cIn = el('input', { id: 'email-recip-company', placeholder: 'Company (defaults to ' + (state.company || 'researched company') + ')', class: 'modal-input' });
    const toneSel = el('select', { id: 'email-tone', class: 'modal-input' });
    ['Challenger', 'Executive'].forEach(t => toneSel.appendChild(el('option', { value: t }, t + ' tone')));
    card.appendChild(tIn); card.appendChild(cIn); card.appendChild(toneSel);
    const actions = el('div', { class: 'email-actions' });
    const goBtn = el('button', { class: 'btn btn-primary' }, 'Generate');
    goBtn.onclick = () => {
      state.emailRecipient = {
        title: document.getElementById('email-recip-title').value.trim() || null,
        company: document.getElementById('email-recip-company').value.trim() || null,
        tone: document.getElementById('email-tone').value
      };
      generateEmailNow();
    };
    const cancelBtn = el('button', { class: 'btn btn-ghost' }, 'Cancel');
    cancelBtn.onclick = () => { state.emailPromptOpen = false; render(); };
    actions.appendChild(goBtn); actions.appendChild(cancelBtn);
    card.appendChild(actions);
  } else if (state.emailLoading) {
    card.appendChild(el('div', { class: 'spinner', style: 'margin:24px auto;' }));
    card.appendChild(el('div', { class: 'loading-msg' }, 'Writing your email…'));
  } else if (state.emailDraft) {
    card.appendChild(el('div', { class: 'email-subject' }, `Subject: ${state.emailDraft.subject}`));
    card.appendChild(el('div', { class: 'email-body' }, state.emailDraft.body));
    const actions = el('div', { class: 'email-actions' });
    const copyBtn = el('button', { class: 'btn btn-primary' }, 'Copy');
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(`Subject: ${state.emailDraft.subject}\n\n${state.emailDraft.body}`)
        .then(() => { copyBtn.textContent = '✓ Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000); });
    };
    const closeBtn = el('button', { class: 'btn btn-ghost' }, 'Close');
    closeBtn.onclick = () => { state.emailDraft = null; state.emailRecipient = null; render(); };
    actions.appendChild(copyBtn);
    actions.appendChild(closeBtn);
    card.appendChild(actions);
  }
  overlay.appendChild(card);
  return overlay;
}

// ── Cadence tab ────────────────────────────────────────────────────────────
function renderCadence(section) {
  // If we have a draft, show the cadence viewer
  if (state.cadenceDraft) {
    renderCadenceDraft(section);
    return;
  }

  // If loading
  if (state.cadenceLoading) {
    const wrap = el('div', { style: 'text-align:center;padding:24px;' });
    wrap.appendChild(el('div', { class: 'spinner', style: 'margin:0 auto 12px;' }));
    wrap.appendChild(el('div', { class: 'loading-msg' }, 'Claude is writing your cadence…'));
    section.appendChild(wrap);
    return;
  }

  // Selector UI
  const r = state.result;
  const topPriority = r.priorities?.priorities?.[0];
  const topFit = r.fitScores?.[0];
  const topCompetitor = r.competitive?.[0];

  // Context summary
  const ctx = el('div', { style: 'background:#F0EEFF;border-radius:8px;padding:12px;margin-bottom:14px;' });
  ctx.appendChild(el('div', { style: 'font-size:10px;font-weight:600;color:#3C3489;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px;' }, 'Outreach context'));
  if (topPriority) ctx.appendChild(el('div', { style: 'font-size:11px;color:#1B1F5E;margin-bottom:3px;' }, `✦ Priority: ${topPriority.title}`));
  if (topFit) ctx.appendChild(el('div', { style: 'font-size:11px;color:#1B1F5E;margin-bottom:3px;' }, `✦ Capability fit: ${topFit.name} (${topFit.score}%)`));
  if (topCompetitor) ctx.appendChild(el('div', { style: 'font-size:11px;color:#FF5C35;' }, `✦ Competitive: ${topCompetitor.competitor} — ${topCompetitor.signal}`));
  section.appendChild(ctx);

  // Guidance input
  const guidanceLabel = el('div', { style: 'font-size:11px;font-weight:600;color:#6B6E8F;margin-bottom:4px;' }, 'Optional guidance');
  const guidanceInput = el('textarea', {
    id: 'cadence-guidance',
    style: 'width:100%;height:56px;padding:8px;border:1px solid #E0E0EC;border-radius:8px;font-size:11px;font-family:inherit;resize:none;margin-bottom:12px;'
  });
  guidanceInput.placeholder = 'e.g. Focus on HR transformation, tone should be consultative…';
  section.appendChild(guidanceLabel);
  section.appendChild(guidanceInput);

  // Cadence type selector
  const typeLabel = el('div', { style: 'font-size:11px;font-weight:600;color:#6B6E8F;margin-bottom:8px;' }, 'Choose outreach type');
  section.appendChild(typeLabel);

  const isCustomer = state.accountMode === 'customer';
  const options = isCustomer ? [
    { type: 'call-script', label: 'Call script', desc: 'Challenger-style talk track with insight hooks', icon: '📞' },
    { type: 'single', label: 'Expansion email', desc: 'Customer-framed expansion outreach', icon: '✉️' },
    { type: '3-step', label: '3-step expansion cadence', desc: 'Expansion → Proof → Next step', icon: '📋' },
  ] : [
    { type: 'call-script', label: 'Call script', desc: 'Challenger-style talk track with insight hooks', icon: '📞' },
    { type: 'single', label: 'Single email', desc: 'One personalized outreach email', icon: '✉️' },
    { type: '3-step', label: '3-step cadence', desc: 'Cold → Follow-up → Break-up', icon: '📋' },
    { type: '5-step', label: '5-step cadence', desc: 'Full multi-touch sequence', icon: '🎯' }
  ];

  options.forEach(opt => {
    const btn = el('div', {
      style: 'display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid #E0E0EC;border-radius:8px;cursor:pointer;margin-bottom:6px;background:#fff;transition:all 0.15s;'
    });
    btn.appendChild(el('div', { style: 'font-size:18px;' }, opt.icon));
    const info = el('div', { style: 'flex:1;' });
    info.appendChild(el('div', { style: 'font-size:12px;font-weight:600;color:#0A0E24;' }, opt.label));
    info.appendChild(el('div', { style: 'font-size:11px;color:#6B6E8F;' }, opt.desc));
    btn.appendChild(info);
    btn.appendChild(el('div', { style: 'font-size:14px;color:#6B6E8F;' }, '→'));
    btn.onmouseenter = () => btn.style.background = '#F5F5F7';
    btn.onmouseleave = () => btn.style.background = '#fff';
    btn.onclick = () => opt.type === 'call-script' ? doGenerateCallScript() : doGenerateCadence(opt.type);
    section.appendChild(btn);
  });

  // Show call script if loading or ready
  if (state.callScriptLoading) {
    const wrap = el('div', { style: 'text-align:center;padding:16px;' });
    wrap.appendChild(el('div', { class: 'spinner', style: 'margin:0 auto 8px;' }));
    wrap.appendChild(el('div', { style: 'font-size:12px;color:#6B6E8F;' }, 'Building your call script…'));
    section.appendChild(wrap);
  }

  if (state.callScript) {
    renderCallScript(section);
  }
}

function renderCadenceDraft(section) {
  const emails = state.cadenceDraft;
  const total = emails.length;

  // Step indicator
  const stepRow = el('div', { style: 'display:flex;gap:4px;margin-bottom:12px;align-items:center;' });
  emails.forEach((_, i) => {
    const dot = el('div', {
      style: `width:28px;height:4px;border-radius:2px;cursor:pointer;background:${i === state.cadenceStep ? '#FF5C35' : '#E0E0EC'};transition:background 0.2s;`
    });
    dot.onclick = () => { state.cadenceStep = i; render(); };
    stepRow.appendChild(dot);
  });
  const stepLabel = el('div', { style: 'font-size:11px;color:#6B6E8F;margin-left:8px;' }, `Email ${state.cadenceStep + 1} of ${total}`);
  stepRow.appendChild(stepLabel);
  section.appendChild(stepRow);

  // Current email
  const email = emails[state.cadenceStep];
  const stepNames = {
    0: total === 1 ? 'Outreach email' : 'Step 1 — Cold outreach',
    1: 'Step 2 — Follow-up',
    2: total === 3 ? 'Step 3 — Break-up' : 'Step 3 — Customer story',
    3: 'Step 4 — Competitive angle',
    4: 'Step 5 — Break-up'
  };

  const nameEl = el('div', { style: 'font-size:10px;font-weight:700;color:#FF5C35;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;' }, stepNames[state.cadenceStep] || `Step ${state.cadenceStep + 1}`);
  section.appendChild(nameEl);

  const subjectEl = el('div', { style: 'font-size:11px;font-weight:600;color:#6B6E8F;margin-bottom:2px;' }, 'Subject:');
  const subjectVal = el('div', { style: 'font-size:12px;font-weight:600;color:#1B1F5E;margin-bottom:10px;padding:6px 8px;background:#F5F5F7;border-radius:6px;' }, email.subject);
  section.appendChild(subjectEl);
  section.appendChild(subjectVal);

  const bodyEl = el('div', { style: 'font-size:12px;color:#333;line-height:1.6;white-space:pre-wrap;max-height:180px;overflow-y:auto;padding:8px;background:#F5F5F7;border-radius:6px;margin-bottom:10px;' }, email.body);
  section.appendChild(bodyEl);

  // Actions row
  const actions = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;' });

  const copyBtn = el('button', { class: 'btn btn-primary', style: 'flex:1;' }, 'Copy email');
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(`Subject: ${email.subject}

${email.body}`)
      .then(() => { copyBtn.textContent = '✓ Copied!'; setTimeout(() => { copyBtn.textContent = 'Copy email'; }, 2000); });
  };
  actions.appendChild(copyBtn);

  if (total > 1) {
    const downloadBtn = el('button', { class: 'btn btn-ghost' }, 'Download all');
    downloadBtn.onclick = () => downloadCadence(emails);
    actions.appendChild(downloadBtn);
  }

  const resetBtn = el('button', { class: 'btn btn-ghost' }, 'New cadence');
  resetBtn.onclick = () => { state.cadenceDraft = null; state.cadenceStep = 0; render(); };
  actions.appendChild(resetBtn);

  section.appendChild(actions);

  // Nav arrows
  if (total > 1) {
    const nav = el('div', { style: 'display:flex;justify-content:space-between;margin-top:10px;' });
    const prevBtn = el('button', { class: 'btn btn-ghost', style: `visibility:${state.cadenceStep > 0 ? 'visible' : 'hidden'};` }, '← Previous');
    prevBtn.onclick = () => { state.cadenceStep--; render(); };
    const nextBtn = el('button', { class: 'btn btn-ghost', style: `visibility:${state.cadenceStep < total - 1 ? 'visible' : 'hidden'};` }, 'Next →');
    nextBtn.onclick = () => { state.cadenceStep++; render(); };
    nav.appendChild(prevBtn);
    nav.appendChild(nextBtn);
    section.appendChild(nav);
  }
}

function downloadCadence(emails) {
  const divider = '==================================================';
  const subDivider = '------------------------------';
  const stepNames = ['Cold outreach', 'Follow-up', 'Customer story', 'Competitive angle', 'Break-up'];
  let lines = [];
  lines.push('RECON OUTREACH CADENCE - ' + state.company.toUpperCase());
  lines.push('Generated: ' + new Date().toLocaleDateString());
  lines.push(divider);
  lines.push('');
  emails.forEach(function(e, i) {
    lines.push('STEP ' + (i + 1) + ': ' + (stepNames[i] || 'Email ' + (i+1)));
    lines.push(subDivider);
    lines.push('Subject: ' + e.subject);
    lines.push('');
    lines.push(e.body);
    lines.push('');
    lines.push(divider);
    lines.push('');
  });
  const text = lines.join('\n');
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'Recon_Cadence_' + state.company.replace(/[^a-z0-9]/gi, '_') + '_' + new Date().toISOString().split('T')[0] + '.txt';
  a.click();
  URL.revokeObjectURL(url);
}

// ── Call script ────────────────────────────────────────────────────────────
function renderCallScript(section) {
  const cs = state.callScript;
  if (!cs) return;

  const card = el('div', { style: 'border:2px solid #2B7DE9;border-radius:10px;padding:14px;margin-top:10px;background:#F8FAFF;' });

  const headerRow = el('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;' });
  headerRow.appendChild(el('div', { style: 'font-size:12px;font-weight:700;color:#2B7DE9;text-transform:uppercase;letter-spacing:0.06em;' }, '📞 Call Script — ' + (state.accountMode === 'customer' ? 'Expansion' : 'Challenger')));
  const copyBtn = el('button', { class: 'btn btn-ghost', style: 'font-size:11px;padding:3px 10px;' }, 'Copy all');
  copyBtn.onclick = () => {
    const text = formatCallScriptText(cs);
    navigator.clipboard.writeText(text).then(() => { copyBtn.textContent = '✓ Copied'; setTimeout(() => { copyBtn.textContent = 'Copy all'; }, 2000); });
  };
  headerRow.appendChild(copyBtn);
  card.appendChild(headerRow);

  const sections = [
    { key: 'insightHook', label: '🎯 Insight hook (Teach)', color: '#2B7DE9' },
    { key: 'tailorToThem', label: '🏢 Tailor to them', color: '#0A0E24' },
    { key: 'tensionPoint', label: '⚡ Tension point', color: '#C0320F' },
    { key: 'discoveryQuestions', label: '💬 Discovery questions', color: '#007A62' },
    { key: 'storyToTell', label: '📖 Story to tell', color: '#6B6E8F' },
    { key: 'opener', label: '👋 Opener', color: '#2B7DE9' },
    { key: 'objectionHandlers', label: '🛡 Objection handlers', color: '#F0A500' },
    { key: 'close', label: '✅ Close', color: '#007A62' }
  ];

  sections.forEach(s => {
    if (!cs[s.key]) return;
    const block = el('div', { style: 'margin-bottom:10px;' });
    block.appendChild(el('div', { style: 'font-size:10px;font-weight:700;color:' + s.color + ';text-transform:uppercase;letter-spacing:0.06em;margin-bottom:4px;' }, s.label));

    if (Array.isArray(cs[s.key])) {
      cs[s.key].forEach((item, i) => {
        const row = el('div', { style: 'font-size:12px;color:#0A0E24;line-height:1.5;padding:4px 0 4px 12px;border-left:2px solid #E0E4EC;margin-bottom:4px;' });
        row.textContent = (typeof item === 'object' ? (item.question || item.objection || item.response || JSON.stringify(item)) : item);
        block.appendChild(row);
      });
    } else {
      const text = el('div', { style: 'font-size:12px;color:#0A0E24;line-height:1.5;padding:6px 10px;background:#fff;border-radius:6px;border:1px solid #E0E4EC;' });
      text.textContent = typeof cs[s.key] === 'string' ? cs[s.key] : JSON.stringify(cs[s.key]);
      block.appendChild(text);
    }
    card.appendChild(block);
  });

  const resetBtn = el('button', { class: 'btn btn-ghost btn-full', style: 'margin-top:8px;font-size:11px;' }, 'Generate new script');
  resetBtn.onclick = () => { state.callScript = null; render(); };
  card.appendChild(resetBtn);

  section.appendChild(card);
}

function formatCallScriptText(cs) {
  const lines = ['RECON CALL SCRIPT — ' + state.company.toUpperCase(), ''];
  const sections = [
    { key: 'insightHook', label: 'INSIGHT HOOK (TEACH)' },
    { key: 'tailorToThem', label: 'TAILOR TO THEM' },
    { key: 'tensionPoint', label: 'TENSION POINT' },
    { key: 'opener', label: 'OPENER' },
    { key: 'discoveryQuestions', label: 'DISCOVERY QUESTIONS' },
    { key: 'storyToTell', label: 'STORY TO TELL' },
    { key: 'objectionHandlers', label: 'OBJECTION HANDLERS' },
    { key: 'close', label: 'CLOSE' }
  ];
  sections.forEach(s => {
    if (!cs[s.key]) return;
    lines.push('── ' + s.label + ' ──');
    if (Array.isArray(cs[s.key])) {
      cs[s.key].forEach((item, i) => {
        lines.push((i + 1) + '. ' + (typeof item === 'object' ? JSON.stringify(item) : item));
      });
    } else {
      lines.push(typeof cs[s.key] === 'string' ? cs[s.key] : JSON.stringify(cs[s.key]));
    }
    lines.push('');
  });
  return lines.join('\n');
}

async function doGenerateCallScript() {
  const r = state.result;
  if (!r) return;

  state.callScriptLoading = true;
  state.callScript = null;
  render();

  const isCustomer = state.accountMode === 'customer';
  const topPriority = r.priorities?.priorities?.[0];
  const topPriorities = (r.priorities?.priorities || []).slice(0, 3);
  const topFit = r.fitScores?.[0];
  const topCompetitor = r.competitive?.[0];
  const topStory = r.stories?.[0];
  const expansionSignals = r.priorities?.expansionSignals || [];
  const ownedNames = state.productLines.filter(p => state.ownedProductLines.includes(p.id)).map(p => p.name).join(', ');
  const targetNames = r.fitScores?.filter(f => !state.ownedProductLines.includes(f.id)).slice(0, 3).map(f => f.name).join(', ');

  const context = [
    'Company: ' + state.company,
    'Industry: ' + (r.priorities?.industry || 'unknown'),
    'Employees: ' + (r.priorities?.employeeCount || 'unknown'),
    'Mode: ' + (isCustomer ? 'EXISTING CUSTOMER - expansion/upsell' : 'PROSPECT - new logo'),
    isCustomer && ownedNames ? 'Products they already own: ' + ownedNames : '',
    isCustomer && targetNames ? 'Expansion targets: ' + targetNames : '',
    'Top priorities: ' + topPriorities.map(p => p.title + ' — ' + p.description).join(' | '),
    topFit ? 'Best capability fit: ' + topFit.name + ' (' + topFit.score + '%) — ' + topFit.description : '',
    topCompetitor ? 'Competitive signal: ' + topCompetitor.competitor + ' (' + topCompetitor.signal + ')' : '',
    topStory ? 'Best customer story: ' + topStory.company + ' (' + topStory.industry + ') — ' + topStory.outcome : '',
    expansionSignals.length ? 'Expansion signals: ' + expansionSignals.map(s => s.signal).join(', ') : ''
  ].filter(Boolean).join('\n');

  const prompt = 'You are an expert B2B sales coach specializing in Challenger selling. '
    + 'Create a call script for a sales rep using the Challenger Sale methodology: Teach → Tailor → Take Control.\n\n'
    + 'ACCOUNT CONTEXT:\n' + context + '\n\n'
    + (isCustomer
      ? 'This is an EXPANSION call to an existing customer. Frame everything around upsell opportunities and business value they are leaving on the table.\n'
      : 'This is a PROSPECT call. Frame everything around insights they may not know, creating constructive tension.\n')
    + 'Return ONLY JSON with no markdown:\n'
    + '{"insightHook":"A reframing insight about their industry/situation they would not expect you to know (2-3 sentences, reference specific research findings)",'
    + '"tailorToThem":"How this insight specifically applies to their company situation (2-3 sentences using their specific details)",'
    + '"tensionPoint":"The constructive tension — what are they risking by not acting? Reference competitor or urgency signal if present (1-2 sentences)",'
    + '"opener":"Word-for-word opening 30 seconds of the call (natural, peer-to-peer tone)",'
    + '"discoveryQuestions":["question 1","question 2","question 3"] — insight-led questions not need-based,'
    + '"storyToTell":"The customer story to reference and why it resonates for this account (2-3 sentences)",'
    + '"objectionHandlers":[{"objection":"common objection","response":"challenger response"}],'
    + '"close":"Suggested close — specific and direct"}';

  try {
    const session = await getSession();
    const headers = { 'Content-Type': 'application/json', 'X-Proxy-Secret': PROXY_SECRET };
    if (session?.access_token) headers['X-User-Token'] = session.access_token;

    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ route: 'direct-claude', prompt, maxTokens: 2000 })
    });

    if (!response.ok) throw new Error('Proxy error ' + response.status);
    state.callScript = await response.json();
    state.callScriptLoading = false;
    render();
  } catch (e) {
    state.callScriptLoading = false;
    state.error = 'Call script failed: ' + e.message;
    render();
  }
}

// ── Actions ────────────────────────────────────────────────────────────────

async function doLogin() {
  const email = document.getElementById('login-email')?.value?.trim();
  const password = document.getElementById('login-password')?.value;
  const errEl = document.getElementById('login-error');

  if (!email || !password) {
    if (errEl) errEl.textContent = 'Please enter your email and password';
    return;
  }

  try {
    if (errEl) errEl.textContent = 'Signing in…';
    await signInWithEmailPassword(email, password);
    state.view = 'loading';
    render();
    await init();
  } catch (e) {
    if (errEl) errEl.textContent = e.message || 'Sign in failed';
  }
}

async function doResearch() {
  const company = document.querySelector('#company-input')?.value?.trim() || state.company;
  if (!state.selectedProductLine) {
    state.error = 'Select a product line first, then enter the prospect or company name.';
    render(); return;
  }
  if (!company) {
    state.error = 'Enter a prospect or company name to run the analysis.';
    render(); return;
  }

  // Check usage limit
  if (state.usage && !state.usage.allowed) {
    state.error = state.usage.reason || 'Monthly lookup limit reached. Please contact your admin.';
    render();
    return;
  }

  state.company = company;
  state.loading = true;
  state.loadingMsg = 'Starting research…';
  state.error = null;
  state.result = null;
  state.activeTab = 'matrix';
  chrome.storage.local.set({ recon_last_company: company });
  render();

  try {
    const result = await researchAccount(company, (msg) => {
      state.loadingMsg = msg;
      const msgEl = document.querySelector('#loading-msg');
      if (msgEl) msgEl.textContent = msg;
    }, state.linkedinData);
    state.result = result;
    state.loading = false;
    // Refresh usage after lookup
    loadUsageStats();
    render();
  } catch (e) {
    state.loading = false;
    if (e.message.includes('429') || e.message.includes('limit')) {
      state.error = 'Monthly lookup limit reached. Please contact your admin to upgrade your plan.';
    } else {
      state.error = 'Research failed: ' + e.message;
    }
    render();
  }
}

async function doGenerateCadence(type) {
  const r = state.result;
  if (!r) return;

  const guidance = document.getElementById('cadence-guidance')?.value?.trim() || '';
  const topPriority = r.priorities?.priorities?.[0];
  const topFit = r.fitScores?.[0];
  const topCompetitor = r.competitive?.[0];
  const topStory = r.stories?.[0];

  const context = [
    `Company: ${state.company}`,
    `Industry: ${r.priorities?.industry || 'unknown'}`,
    `Employees: ${r.priorities?.employeeCount || 'unknown'}`,
    topPriority ? `Top strategic priority: ${topPriority.title} — ${topPriority.description}` : '',
    topFit ? `Best capability fit: ${topFit.name} (${topFit.score}% match) — ${topFit.description}` : '',
    topCompetitor ? `Competitive signal: ${topCompetitor.competitor} (${topCompetitor.signal}) — ${topCompetitor.displacementAngle || ''}` : '',
    topStory ? `Relevant customer story: ${topStory.company} (${topStory.industry}) — ${topStory.outcome}` : '',
    guidance ? `Guidance: ${guidance}` : ''
  ].filter(Boolean).join('\n');

  const stepCount = type === 'single' ? 1 : type === '3-step' ? 3 : 5;
  const stepDescriptions = {
    1: ['A personalized cold outreach email that opens with their strategic priority and connects it to a specific capability. Include a soft CTA for a 15-minute call.'],
    3: [
      'Cold outreach — Open with their strategic priority insight. Connect to one capability. Soft CTA for 15-min call.',
      'Follow-up (3 days later) — Different angle. Reference a relevant customer story. Ask if the timing is right.',
      'Break-up (5 days later) — Acknowledge they may not be the right contact. Offer to connect with someone else or revisit later. Light competitive urgency if applicable.'
    ],
    5: [
      'Cold outreach — Open with their #1 strategic priority. Connect to your strongest capability fit. Soft CTA for 15-min call.',
      'Follow-up day 3 — Lead with a capability proof point or metric. Different angle from email 1.',
      'Follow-up day 5 — Share the most relevant customer story. Make it feel peer-to-peer.',
      'Follow-up day 8 — Use the competitive signal if present. Create mild urgency. Ask if they are evaluating solutions.',
      'Break-up day 12 — Acknowledge timing may be off. Leave the door open. One final value statement.'
    ]
  };

  const steps = stepDescriptions[stepCount];

  state.cadenceLoading = true;
  state.cadenceDraft = null;
  state.cadenceStep = 0;
  render();

  try {
    const stepBriefs = steps.map(function(s, i) { return 'Email ' + (i+1) + ': ' + s; }).join('\n');
    const prompt = 'You are a sharp SDR coach. Write a ' + stepCount + '-touch outreach cadence for a sales rep.'
      + ' ACCOUNT CONTEXT: ' + context
      + ' RULES: Vary channel, angle, and CTA across touches. Day 1 should combine a LinkedIn touch, an intro email, and a phone call.'
      + ' Each email under 100 words, subject lines under 5 words. Lead with relevance to the prospect and push the problem statement to the top.'
      + ' Never open with "I" or talk about our product in the intro. No "I hope you\'re doing well", no filler like "quick", no marketing-speak, no inauthentic stories, do not bold company names.'
      + ' Conversational tonality (e.g. "not sure if you\'re seeing this"). Connect observed triggers to why now, why change, why a conversation.'
      + ' Use Challenger value/outcome framing. When referencing customer examples, prefer industry-specific ones from the context only.'
      + ' Keep each step plainly structured (channel, subject, body) so it pastes cleanly into Clari Groove.'
      + ' Return ONLY a JSON array with no markdown: [{"channel":"email|linkedin|call","subject":"...","body":"..."}]'
      + ' One object per touch in sequence order.'
      + ' TOUCH BRIEFS: ' + stepBriefs;

    const session = await getSession();
    const headers = { 'Content-Type': 'application/json', 'X-Proxy-Secret': PROXY_SECRET };
    if (session?.access_token) headers['X-User-Token'] = session.access_token;

    const response = await fetch(PROXY_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ route: 'direct-claude', prompt, maxTokens: 2000, usageType: 'cadence' })
    });

    if (!response.ok) throw new Error('Proxy error ' + response.status);
    const data = await response.json();

    if (!Array.isArray(data) || data.length === 0) throw new Error('No emails returned');

    state.cadenceDraft = data;
    state.cadenceLoading = false;
    render();
  } catch(e) {
    state.cadenceLoading = false;
    state.error = 'Cadence generation failed: ' + e.message;
    render();
  }
}

async function doGenerateEmail() {
  // Spec: prompt for the recipient (title + company) before generating
  if (!state.emailRecipient) {
    state.emailPromptOpen = true;
    state.emailDraft = null;
    render();
    return;
  }
  await generateEmailNow();
}

async function generateEmailNow() {
  state.emailPromptOpen = false;
  state.emailLoading = true;
  state.emailDraft = null;
  render();
  try {
    const isCustomer = state.accountMode === 'customer';
    const ownedNames = state.productLines.filter(p => state.ownedProductLines.includes(p.id)).map(p => p.name).join(', ');
    const expansionTargets = state.result.fitScores?.filter(f => !state.ownedProductLines.includes(f.id)).slice(0, 3).map(f => f.name).join(', ');
    const expansionSignals = state.result.priorities?.expansionSignals || [];

    const draft = await callProxy('email', {
      companyName: state.company,
      topCapabilities: expansionTargets || state.result.fitScores?.slice(0, 3).map(f => f.name).join(', '),
      topPriority: state.result.priorities?.priorities?.[0],
      competitive: state.result.competitive?.[0],
      accountMode: state.accountMode,
      ownedProducts: ownedNames || null,
      expansionSignal: expansionSignals[0] || null,
      recipientTitle: state.emailRecipient?.title || null,
      recipientCompany: state.emailRecipient?.company || state.company,
      tone: state.emailRecipient?.tone || 'Challenger'
    });
    state.emailDraft = draft;
    state.emailLoading = false;
    render();
  } catch (e) {
    state.emailLoading = false;
    state.error = 'Email generation failed: ' + e.message;
    render();
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function el(tag, attrs = {}, text = null) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === 'class') node.className = v;
    else node.setAttribute(k, v);
  });
  if (text !== null) node.textContent = text;
  return node;
}

render();
