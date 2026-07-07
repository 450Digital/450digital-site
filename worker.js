// Recon Cloudflare Worker — usage enforcement + all routes
const SUPABASE_URL = 'https://rzstxdvchjtzkrhdtlje.supabase.co';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return corsResponse(null, 204);
    if (request.method !== 'POST') return errorResponse('Method not allowed', 405);

    const proxySecret = request.headers.get('X-Proxy-Secret');
    if (!proxySecret || proxySecret !== env.PROXY_SECRET) return errorResponse('Forbidden', 403);

    let body;
    try { body = await request.json(); }
    catch (e) { return errorResponse('Invalid JSON body', 400); }

    try {
      if (body.route === 'analyze')       return await handleAnalyze(body, env, request);
      if (body.route === 'company-profile') return await handleCompanyProfile(body, env);
      if (body.route === 'email')         return await handleEmail(body, env);
      if (body.route === 'direct-claude') return await handleDirectClaude(body, env, request);
      if (body.route === 'invite')        return await handleInvite(body, env);
      if (body.route === 'usage-check')   return await handleUsageCheck(body, env, request);
      return errorResponse('Unknown route', 400);
    } catch (err) {
      return errorResponse('Internal error: ' + err.message, 500);
    }
  }
};

// ── Usage check ────────────────────────────────────────────────────────────
async function handleUsageCheck(body, env, request) {
  const userToken = request.headers.get('X-User-Token');
  if (!userToken || !env.SUPABASE_SERVICE_KEY) return errorResponse('Unauthorized', 401);

  const svcKey = env.SUPABASE_SERVICE_KEY;

  // Get user ID
  const userRes = await fetch(SUPABASE_URL + '/auth/v1/user', {
    headers: { 'Authorization': 'Bearer ' + userToken, 'apikey': svcKey }
  });
  const userData = await userRes.json();
  const userId = userData?.id;
  if (!userId) return errorResponse('Invalid token', 401);

  // Get org + limits
  const orgRes = await fetch(
    SUPABASE_URL + '/rest/v1/org_users?user_id=eq.' + userId + '&select=org_id,organizations(monthly_lookup_limit,monthly_cadence_limit,plan)',
    { headers: { 'Authorization': 'Bearer ' + svcKey, 'apikey': svcKey } }
  );
  const orgData = await orgRes.json();
  const orgRow = orgData?.[0];
  if (!orgRow) return corsResponse({ allowed: false, reason: 'No organization found' }, 200);

  const orgId = orgRow.org_id;
  const limits = orgRow.organizations || {};
  const lookupLimit = limits.monthly_lookup_limit || 50;

  // Count this month's lookups for this user
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const countRes = await fetch(
    SUPABASE_URL + '/rest/v1/usage_logs?user_id=eq.' + userId +
    '&org_id=eq.' + orgId +
    '&usage_type=eq.lookup' +
    '&created_at=gte.' + startOfMonth.toISOString() +
    '&select=id',
    { headers: { 'Authorization': 'Bearer ' + svcKey, 'apikey': svcKey, 'Prefer': 'count=exact', 'Range': '0-0' } }
  );

  const countHeader = countRes.headers.get('content-range') || '0/0';
  const used = parseInt(countHeader.split('/')[1]) || 0;
  const remaining = Math.max(0, lookupLimit - used);
  const allowed = remaining > 0 || lookupLimit >= 999999;

  return corsResponse({
    allowed,
    used,
    limit: lookupLimit,
    remaining,
    orgId,
    plan: limits.plan || 'starter',
    reason: allowed ? null : 'Monthly lookup limit reached (' + lookupLimit + '/month on ' + (limits.plan || 'starter') + ' plan)'
  }, 200);
}


// ── Company profile (AI setup) ─────────────────────────────────────────────
async function handleCompanyProfile(body, env) {
  const { companyName, website } = body;
  if (!companyName && !website) return errorResponse('companyName or website required', 400);
  const prompt = 'Research the company ' + (companyName || '') + (website ? ' (website: ' + website + ')' : '')
    + ' using web search. This company SELLS B2B products/services and is configuring a sales-intelligence tool.\n'
    + 'From their website and public materials, determine:\n'
    + '- description: 1-2 sentences on what they sell and to whom\n'
    + '- solutionDomain: the business areas a sales rep should look for in TARGET companies (the problems this company solves)\n'
    + '- valueDrivers: 3-6 short phrases naming the business value they deliver\n'
    + '- targetPersonas: 3-6 buyer titles/roles they typically sell to\n'
    + '- suggestedCompetitors: up to 6 competitor names\n'
    + 'Base everything on evidence from their actual materials; do not invent.\n'
    + 'Return ONLY JSON: {"description":"...","solutionDomain":"...","valueDrivers":["..."],"targetPersonas":["..."],"suggestedCompetitors":["..."]}';
  return corsResponse(await callClaude(prompt, 900, env, 3), 200);
}

// ── Analyze ────────────────────────────────────────────────────────────────
async function handleAnalyze(body, env, request) {
  const { companyName, secData, competitorList, orgId, capabilityList, linkedinData, accountMode, proofPoints, orgName, productLineName, companyProfile } = body;
  if (!companyName) return errorResponse('companyName required', 400);

  const userToken = request.headers.get('X-User-Token');

  // Check usage limit first
  if (userToken && env.SUPABASE_SERVICE_KEY) {
    const check = await handleUsageCheck({ route: 'usage-check' }, env, request);
    const checkData = await check.clone().json();
    if (!checkData.allowed) {
      return errorResponse(checkData.reason || 'Monthly limit reached', 429);
    }
  }

  const secText = (secData?.snippets?.length)
    ? secData.snippets.join('\n')
    : 'No SEC data available.';

  const linkedinText = linkedinData
    ? '\n\nLinkedIn signals:\n' + JSON.stringify(linkedinData)
    : '';

  const capText = capabilityList
    ? '\n\nOUR PRODUCTS & SERVICES (the catalog to compare the researched company against):\n' + capabilityList
    : '';

  const proofText = (Array.isArray(proofPoints) && proofPoints.length)
    ? '\n\nCUSTOMER PROOF POINTS (the ONLY customer examples you may reference):\n'
      + proofPoints.map(function(s) { return '- ' + (s.company || '') + ' (' + (s.industry || '') + '): ' + (s.outcome || ''); }).join('\n')
    : '';

  const seller = orgName || 'our company';
  const pl = productLineName ? ' (' + productLineName + ' product line)' : '';
  const cp = companyProfile || {};
  const profileText = [
    cp.description ? 'ABOUT ' + seller.toUpperCase() + ': ' + cp.description : null,
    cp.solutionDomain ? 'RESEARCH LENS — prioritize target-company initiatives related to: ' + cp.solutionDomain : null,
    cp.valueDrivers ? 'VALUE DRIVERS — align talking points and value drivers to: ' + cp.valueDrivers : null,
    cp.targetPersonas ? 'TARGET PERSONAS — prefer suggested contacts matching: ' + cp.targetPersonas : null
  ].filter(Boolean).join('\n');

  const prompt = 'You are an expert B2B sales researcher helping go-to-market, sales, and customer success teams at '
    + seller + pl + ' analyze a target company\'s signals and translate them into actionable, evidence-led insights.\n\n'
    + 'TARGET COMPANY: "' + companyName + '"\n\n'
    + (profileText ? profileText + '\n\n' : '')
    + 'RESEARCH SCOPE — use web search to gather:\n'
    + '- Public companies: 10-K, 10-Q, annual reports, earnings call transcripts\n'
    + '- Private companies: press releases, leadership interviews, investor decks, blogs\n'
    + '- Additional signals: recent news, LinkedIn/social posts, executive commentary, hiring trends, review sites like G2 Crowd\n'
    + '- OSHA or EU-OSHA violations, citations, or safety news involving this company\n\n'
    + 'RECENCY: strongly prioritize the last 6-12 months. Prefer the most recent filings, statements, and executive commentary. Only include older sources when still clearly relevant, and reflect their age in your phrasing.\n\n'
    + 'SEC DATA PROVIDED:\n' + secText
    + linkedinText
    + capText
    + proofText + '\n\n'
    + 'Competitors to watch: ' + (competitorList || 'none listed') + '\n\n'
    + 'TASK: Extract UP TO THREE credible strategic initiatives, risks, or business priorities. Fewer than three is correct when evidence is thin — never stretch relevance. Avoid speculation: only include connections clearly supported by evidence. Clearly distinguish explicit company statements from inferred implications. For each item, map it to what it implies for the buyer, then connect to how ' + seller + ' can help using ONLY the products/services catalog above. Reference customer proof points ONLY from the provided list, and only when genuinely aligned. When public information supports it, suggest specific individuals (or roles/titles) for outreach.\n\n'
    + 'Return ONLY JSON, no prose outside the JSON:\n'
    + '{"companyOverview":"2-3 sentence clean summary","geography":"HQ + main regions","revenueModel":"how they generate revenue","growthStrategy":"their stated strategy for growth","employeeCount":"...","industry":"...",'
    + '"priorities":[{"title":"...","description":"...","sourceLabel":"e.g. 10-K, Earnings call, Press release, CEO LinkedIn post, OSHA citation record, News report","evidenceType":"explicit|inferred","keywords":["..."],'
    + '"fitRating":"Strong|Moderate|Exploratory","fitRationale":"one sentence","whyItMatters":"why this could matter to them, tied to evidence",'
    + '"talkingPoints":["2-4 short talking points, each tied to a value driver"],"valueDrivers":["2-4 short value lever phrases"],'
    + '"productFit":"the specific product(s)/service(s) from our catalog that apply","solutionProvides":"1-2 sentences on what our solution concretely provides",'
    + '"proofPoint":"matching customer proof point from the provided list, or null","oshaSignals":"any OSHA/EU-OSHA violation or safety signal found, with source, or null"}],'
    + '"competitiveSignals":[{"competitor":"...","signal":"...","detail":"..."}],'
    + '"intentSignals":[{"signal":"...","strength":"high/medium/low"}],'
    + '"suggestedContacts":[{"name":"real name if publicly supported, else null","title":"role/title","rationale":"why them"}],'
    + '"recommendedOutreachAngle":"1-2 sentences: the strongest evidence-led angle for outreach"}';

  const result = await callClaude(prompt, 3600, env, 5);

  if (userToken && orgId && env.SUPABASE_SERVICE_KEY) {
    await logUsage(companyName, orgId, userToken, env, 'lookup');
  }

  return corsResponse(result, 200);
}

// ── Direct Claude (cadences, AI populate, discovery) ──────────────────────
async function handleDirectClaude(body, env, request) {
  const { prompt, maxTokens, usageType } = body;
  if (!prompt) return errorResponse('prompt required', 400);

  const userToken = request.headers.get('X-User-Token');

  // Check cadence limits if applicable
  if (usageType === 'cadence' && userToken && env.SUPABASE_SERVICE_KEY) {
    const svcKey = env.SUPABASE_SERVICE_KEY;
    const userRes = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { 'Authorization': 'Bearer ' + userToken, 'apikey': svcKey }
    });
    const userData = await userRes.json();
    const userId = userData?.id;

    if (userId) {
      const orgRes = await fetch(
        SUPABASE_URL + '/rest/v1/org_users?user_id=eq.' + userId + '&select=org_id,organizations(monthly_cadence_limit,plan)',
        { headers: { 'Authorization': 'Bearer ' + svcKey, 'apikey': svcKey } }
      );
      const orgData = await orgRes.json();
      const limits = orgData?.[0]?.organizations || {};
      const cadenceLimit = limits.monthly_cadence_limit || 0;

      if (cadenceLimit === 0) {
        return errorResponse('Cadence generation not available on your current plan. Upgrade to Growth or higher.', 403);
      }

      const startOfMonth = new Date();
      startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0);
      const countRes = await fetch(
        SUPABASE_URL + '/rest/v1/usage_logs?user_id=eq.' + userId +
        '&usage_type=eq.cadence&created_at=gte.' + startOfMonth.toISOString() + '&select=id',
        { headers: { 'Authorization': 'Bearer ' + svcKey, 'apikey': svcKey, 'Prefer': 'count=exact', 'Range': '0-0' } }
      );
      const countHeader = countRes.headers.get('content-range') || '0/0';
      const used = parseInt(countHeader.split('/')[1]) || 0;
      if (used >= cadenceLimit) {
        return errorResponse('Monthly cadence limit reached (' + cadenceLimit + '/month on ' + (limits.plan || 'starter') + ' plan)', 429);
      }

      // Log cadence usage
      const orgId = orgData?.[0]?.org_id;
      if (orgId) await logUsage('cadence', orgId, userToken, env, 'cadence');
    }
  }

  return corsResponse(await callClaude(prompt, maxTokens || 2000, env), 200);
}

// ── Email ──────────────────────────────────────────────────────────────────
async function handleEmail(body, env) {
  const { companyName, topCapabilities, topPriority, competitive, recipientTitle, recipientCompany, tone } = body;
  if (!companyName) return errorResponse('companyName required', 400);
  const audience = (recipientTitle || 'a senior decision-maker') + ' at ' + (recipientCompany || companyName);
  const prompt = 'Write a personalized outbound email from a sales rep to ' + audience + '.\n'
    + 'Tone: ' + (tone || 'Challenger') + ' — sharp, credible, peer-to-peer. Use Challenger value/outcome framing.\n'
    + 'Evidence to build on (do not add unsupported claims):\n'
    + 'Priority: ' + (topPriority ? topPriority.title + ' - ' + (topPriority.whyItMatters || topPriority.description || '') : 'none') + '\n'
    + 'Competitive: ' + (competitive ? competitive.competitor + ' (' + competitive.signal + ')' : 'none') + '\n'
    + 'Relevant capabilities: ' + (topCapabilities || '') + '\n\n'
    + 'HARD RULES:\n'
    + '- Under 100 words. Subject line under 5 words.\n'
    + '- Lead with relevance to the prospect; push the problem statement to the top.\n'
    + '- Never open with "I" or talk about us/our product in the intro.\n'
    + '- No "I hope you\'re doing well", no marketing-speak, no filler words like "quick", no inauthentic stories.\n'
    + '- Do not bold any company name.\n'
    + '- Conversational tonality, e.g. "not sure if you\'re seeing this".\n'
    + '- Connect the observed trigger to why now, why change, why a conversation is relevant.\n'
    + 'Return ONLY JSON: {"subject":"...","body":"..."}';
  return corsResponse(await callClaude(prompt, 500, env), 200);
}

// ── Invite ─────────────────────────────────────────────────────────────────
async function handleInvite(body, env) {
  const { email, orgId, role } = body;
  if (!email || !orgId) return errorResponse('email and orgId required', 400);
  if (!env.SUPABASE_SERVICE_KEY) return errorResponse('SUPABASE_SERVICE_KEY not set', 500);

  const svcKey = env.SUPABASE_SERVICE_KEY;
  const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + svcKey, 'apikey': svcKey };

  await fetch(SUPABASE_URL + '/rest/v1/user_invites', {
    method: 'POST',
    headers: { ...headers, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ email, org_id: orgId, role: role || 'member', accepted: false })
  });

  const createRes = await fetch(SUPABASE_URL + '/auth/v1/admin/users', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, email_confirm: false, send_email: true, redirect_to: 'https://recon.450digital.com/dashboard.html' })
  });

  const createData = await createRes.json();

  if (!createRes.ok) {
    const linkRes = await fetch(SUPABASE_URL + '/auth/v1/admin/generate_link', {
      method: 'POST', headers,
      body: JSON.stringify({ type: 'magiclink', email, redirect_to: 'https://recon.450digital.com/dashboard.html' })
    });
    if (!linkRes.ok) {
      const linkErr = await linkRes.text();
      return errorResponse('Failed to send magic link: ' + linkErr, 500);
    }
    const linkData = await linkRes.json();
    const userId = linkData?.user?.id;
    if (userId) {
      await fetch(SUPABASE_URL + '/rest/v1/org_users', {
        method: 'POST', headers: { ...headers, 'Prefer': 'return=minimal' },
        body: JSON.stringify({ user_id: userId, org_id: orgId, role: role || 'member' })
      });
    }
    return corsResponse({ success: true, message: 'Magic link sent to ' + email }, 200);
  }

  const userId = createData?.id;
  if (userId) {
    await fetch(SUPABASE_URL + '/rest/v1/org_users', {
      method: 'POST', headers: { ...headers, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ user_id: userId, org_id: orgId, role: role || 'member' })
    });
  }
  return corsResponse({ success: true, message: 'Invite sent to ' + email }, 200);
}

// ── Usage logging ──────────────────────────────────────────────────────────
async function logUsage(companyName, orgId, userToken, env, usageType) {
  try {
    const svcKey = env.SUPABASE_SERVICE_KEY;
    const userRes = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { 'Authorization': 'Bearer ' + userToken, 'apikey': svcKey }
    });
    const { id: userId } = await userRes.json();
    if (!userId) return;
    await fetch(SUPABASE_URL + '/rest/v1/usage_logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + svcKey, 'apikey': svcKey, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ company_name: companyName, org_id: orgId, user_id: userId, usage_type: usageType || 'lookup' })
    });
  } catch (e) { console.error('Usage log failed:', e); }
}

// ── Claude API ─────────────────────────────────────────────────────────────
function extractJSON(text) {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) {
    const aStart = cleaned.indexOf('[');
    const aEnd = cleaned.lastIndexOf(']');
    if (aStart !== -1 && aEnd !== -1) return JSON.parse(cleaned.slice(aStart, aEnd + 1));
    throw new Error('No JSON found in model response');
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function callClaude(prompt, maxTokens, env, webSearches) {
  const body = { model: 'claude-sonnet-4-20250514', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] };
  if (webSearches) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: webSearches }];
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(body)
  });
  if (!response.ok) { const err = await response.json(); throw new Error(err.error?.message || 'Claude API error'); }
  const data = await response.json();
  const text = data.content.filter(b => b.type === 'text').map(b => b.text || '').join('');
  return extractJSON(text);
}

// ── CORS ───────────────────────────────────────────────────────────────────
function corsResponse(data, status) {
  return new Response(data !== null ? JSON.stringify(data) : null, {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Secret, X-User-Token' }
  });
}

function errorResponse(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
