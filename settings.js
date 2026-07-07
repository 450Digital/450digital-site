// Recon Settings — Clean top-to-bottom flow

const PROXY_URL = 'https://recon.jeffreymass.workers.dev';
const PROXY_SECRET = 'recon-2026-ydrk2XShah9l';

let currentOrgId = null;
let currentProductLineId = null;
let currentProductLineName = '';
let currentTab = 'capabilities';
let discoveredProducts = [];
let aiSuggestions = null;
let currentAIPopulatePlId = null;
let currentAIPopulatePlName = '';

// ── INIT ──────────────────────────────────────────────────────────────────
async function initSettings() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return; }
  await loadOrgs();
}

async function loadOrgs() {
  const { data: orgs } = await supabaseClient.from('organizations').select('*').order('name');
  const select = document.getElementById('org-select');
  if (!orgs || orgs.length === 0) {
    select.innerHTML = '<option value="">No organizations yet — add one in Customers</option>';
    return;
  }
  select.innerHTML = '<option value="">Select organization...</option>' +
    orgs.map(o => `<option value="${o.id}">${o.name}</option>`).join('');
}

async function onOrgChange() {
  const orgId = document.getElementById('org-select').value;
  if (!orgId) {
    document.getElementById('product-lines-section').style.display = 'none';
    return;
  }
  currentOrgId = orgId;
  currentProductLineId = null;

  // Hide downstream panels
  hideAIDiscovery();
  hideAIPopulate();
  hidePreview();
  document.getElementById('kb-section').style.display = 'none';
  document.getElementById('product-lines-section').style.display = 'block';
  document.getElementById('company-profile-section').style.display = 'block';

  await loadCompanyProfile();
  await loadProductLines();
}

// ── COMPANY PROFILE ───────────────────────────────────────────────────────
async function loadCompanyProfile() {
  const { data } = await supabaseClient.from('organizations')
    .select('company_website,company_description,solution_domain,value_drivers,target_personas')
    .eq('id', currentOrgId).single();
  if (!data) return;
  document.getElementById('cp-website').value = data.company_website || '';
  document.getElementById('cp-desc').value = data.company_description || '';
  document.getElementById('cp-domain').value = data.solution_domain || '';
  document.getElementById('cp-drivers').value = data.value_drivers || '';
  document.getElementById('cp-personas').value = data.target_personas || '';
}

async function saveCompanyProfile() {
  const msg = document.getElementById('cp-msg');
  const payload = {
    company_website: document.getElementById('cp-website').value.trim(),
    company_description: document.getElementById('cp-desc').value.trim(),
    solution_domain: document.getElementById('cp-domain').value.trim(),
    value_drivers: document.getElementById('cp-drivers').value.trim(),
    target_personas: document.getElementById('cp-personas').value.trim(),
    updated_at: new Date().toISOString()
  };
  const { error } = await supabaseClient.from('organizations').update(payload).eq('id', currentOrgId);
  if (error) { msg.textContent = 'Error: ' + error.message; msg.style.color = '#C0320F'; }
  else { msg.textContent = '✓ Saved'; msg.style.color = '#0E8A6B'; setTimeout(() => { msg.textContent = ''; }, 2500); }
}

async function aiSetupProfile() {
  const msg = document.getElementById('cp-msg');
  const website = document.getElementById('cp-website').value.trim();
  const orgName = document.getElementById('org-select').selectedOptions[0]?.textContent || '';
  if (!website && !orgName) { msg.textContent = 'Enter your company website first'; msg.style.color = '#C0320F'; return; }
  msg.textContent = '✦ Researching your company…'; msg.style.color = 'var(--muted)';
  try {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Proxy-Secret': PROXY_SECRET },
      body: JSON.stringify({ route: 'company-profile', companyName: orgName, website })
    });
    if (!res.ok) throw new Error('Proxy error ' + res.status);
    const prof = await res.json();
    if (prof.description) document.getElementById('cp-desc').value = prof.description;
    if (prof.solutionDomain) document.getElementById('cp-domain').value = prof.solutionDomain;
    if (Array.isArray(prof.valueDrivers)) document.getElementById('cp-drivers').value = prof.valueDrivers.join(', ');
    if (Array.isArray(prof.targetPersonas)) document.getElementById('cp-personas').value = prof.targetPersonas.join(', ');
    msg.textContent = '✓ Review the suggestions, then Save profile'; msg.style.color = '#0E8A6B';
  } catch (e) {
    msg.textContent = 'AI setup failed: ' + e.message; msg.style.color = '#C0320F';
  }
}

// ── PRODUCT LINES ─────────────────────────────────────────────────────────
async function loadProductLines() {
  const { data: pls } = await supabaseClient.from('product_lines')
    .select('*').eq('org_id', currentOrgId).order('name');

  const list = document.getElementById('product-lines-list');
  if (!pls || pls.length === 0) {
    list.className = 'empty-state';
    list.innerHTML = 'No product lines yet — use ✦ Discover with AI or add manually';
    return;
  }

  list.className = '';
  list.innerHTML = `<table class="table">
    <thead><tr><th>Name</th><th>Category</th><th>Description</th><th>Actions</th></tr></thead>
    <tbody>${pls.map(p => `
      <tr>
        <td><strong>${p.name}</strong></td>
        <td style="font-size:12px;color:var(--muted);">${p.category || '—'}</td>
        <td style="font-size:12px;color:var(--muted);max-width:200px;">${p.description || '—'}</td>
        <td>
          <div class="pl-row-actions">
            <button class="btn-sm primary" onclick="openAIPopulate('${p.id}', '${p.name.replace(/'/g, "\\'")}', '${(p.website||'').replace(/'/g, "\\'")}')">✦ AI</button>
            <button class="btn-sm" onclick="openKBSection('${p.id}', '${p.name.replace(/'/g, "\\'")}')">Manage</button>
            <button class="btn-sm" onclick="editProductLine('${p.id}')">Edit</button>
            <button class="btn-sm danger" onclick="deleteProductLine('${p.id}')">Delete</button>
          </div>
        </td>
      </tr>`).join('')}
    </tbody></table>`;
}

function showAddProductLineForm() {
  document.getElementById('pl-id').value = '';
  document.getElementById('pl-name').value = '';
  document.getElementById('pl-category').value = '';
  document.getElementById('pl-website').value = '';
  document.getElementById('pl-desc').value = '';
  document.getElementById('pl-form').style.display = 'block';
}

function hideProductLineForm() {
  document.getElementById('pl-form').style.display = 'none';
}

async function editProductLine(id) {
  const { data } = await supabaseClient.from('product_lines').select('*').eq('id', id).single();
  if (!data) return;
  document.getElementById('pl-id').value = data.id;
  document.getElementById('pl-name').value = data.name || '';
  document.getElementById('pl-category').value = data.category || '';
  document.getElementById('pl-website').value = data.website || '';
  document.getElementById('pl-desc').value = data.description || '';
  document.getElementById('pl-form').style.display = 'block';
  document.getElementById('pl-form').scrollIntoView({ behavior: 'smooth' });
}

async function saveProductLine() {
  if (!currentOrgId) return;
  const id = document.getElementById('pl-id').value;
  const msg = document.getElementById('pl-msg');
  const payload = {
    org_id: currentOrgId,
    name: document.getElementById('pl-name').value.trim(),
    category: document.getElementById('pl-category').value.trim(),
    website: document.getElementById('pl-website').value.trim(),
    description: document.getElementById('pl-desc').value.trim(),
    updated_at: new Date().toISOString()
  };
  if (!payload.name) { msg.textContent = 'Name required'; msg.style.color = '#C0320F'; return; }
  const { error } = id
    ? await supabaseClient.from('product_lines').update(payload).eq('id', id)
    : await supabaseClient.from('product_lines').insert([payload]);
  if (error) { msg.textContent = 'Error: ' + error.message; msg.style.color = '#C0320F'; }
  else { hideProductLineForm(); await loadProductLines(); }
}

async function deleteProductLine(id) {
  if (!confirm('Delete this product line and all its knowledge base data?')) return;
  await supabaseClient.from('product_lines').delete().eq('id', id);
  await loadProductLines();
  document.getElementById('kb-section').style.display = 'none';
}

// ── AI DISCOVERY ──────────────────────────────────────────────────────────
function startAIDiscovery() {
  hideAIPopulate();
  hidePreview();
  const orgSelect = document.getElementById('org-select');
  const orgName = orgSelect.options[orgSelect.selectedIndex]?.text || '';
  document.getElementById('discovery-company').value = orgName !== 'Select organization...' ? orgName : '';
  document.getElementById('discovery-status').textContent = '';
  document.getElementById('discovery-results').style.display = 'none';
  document.getElementById('ai-discovery-panel').classList.add('visible');
  document.getElementById('ai-discovery-panel').scrollIntoView({ behavior: 'smooth' });
}

function hideAIDiscovery() {
  document.getElementById('ai-discovery-panel').classList.remove('visible');
}

async function runDiscovery() {
  const company = document.getElementById('discovery-company').value.trim();
  const status = document.getElementById('discovery-status');
  if (!company) { status.textContent = 'Please enter a company name'; status.style.color = '#C0320F'; return; }

  status.innerHTML = '<div class="ai-spinner"><div class="spinner"></div>Discovering product lines for ' + company + '…</div>';

  const prompt = 'Research the company "' + company + '" and identify all their major product lines and solution categories that enterprise sales teams would sell. Return ONLY a JSON array with no markdown: [{"name":"...","description":"one sentence","category":"CRM/ERP/HCM/etc","website":"url if known"}]. Include all major product lines. For large companies include 10-20 products. Be specific and accurate.';

  try {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Proxy-Secret': PROXY_SECRET },
      body: JSON.stringify({ route: 'direct-claude', prompt, maxTokens: 2000 })
    });
    if (!res.ok) throw new Error('Proxy error ' + res.status);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) throw new Error('No products found');

    discoveredProducts = data;
    status.textContent = 'Found ' + data.length + ' product lines for ' + company;
    status.style.color = '#007A62';

    document.getElementById('discovery-list').innerHTML = data.map((p, i) => `
      <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;background:var(--white);">
        <input type="checkbox" id="disc-${i}" value="${i}" checked style="margin-top:3px;width:15px;height:15px;flex-shrink:0;" />
        <label for="disc-${i}" style="cursor:pointer;flex:1;">
          <div style="font-weight:600;font-size:13px;">${p.name} <span style="font-weight:400;font-size:11px;color:var(--muted);">${p.category || ''}</span></div>
          <div style="font-size:12px;color:var(--muted);margin-top:2px;">${p.description || ''}</div>
        </label>
      </div>`).join('');
    document.getElementById('discovery-results').style.display = 'block';
  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    status.style.color = '#C0320F';
  }
}

async function createDiscoveredLines() {
  if (!currentOrgId) return;
  const checked = document.querySelectorAll('#discovery-list input[type="checkbox"]:checked');
  if (checked.length === 0) { alert('Select at least one product line'); return; }
  const selected = Array.from(checked).map(cb => discoveredProducts[parseInt(cb.value)]);
  const { error } = await supabaseClient.from('product_lines').insert(
    selected.map(p => ({ org_id: currentOrgId, name: p.name, description: p.description, website: p.website || null, category: p.category || null }))
  );
  if (error) { alert('Error: ' + error.message); return; }
  hideAIDiscovery();
  await loadProductLines();
}

// ── AI POPULATE ───────────────────────────────────────────────────────────
function openAIPopulate(plId, plName, website) {
  currentAIPopulatePlId = plId;
  currentAIPopulatePlName = plName;

  hideAIDiscovery();
  hidePreview();
  document.getElementById('kb-section').style.display = 'none';

  document.getElementById('ai-populate-pl-name').textContent = plName;
  document.getElementById('ai-guidance').value = '';
  document.getElementById('guidance-box').classList.remove('visible');
  document.getElementById('guidance-toggle-btn').textContent = '+ Add guidance';
  document.getElementById('ai-populate-status').textContent = '';
  document.getElementById('ai-populate-panel').classList.add('visible');
  document.getElementById('ai-populate-panel').scrollIntoView({ behavior: 'smooth' });
}

function hideAIPopulate() {
  document.getElementById('ai-populate-panel').classList.remove('visible');
}

function toggleGuidance() {
  const box = document.getElementById('guidance-box');
  const btn = document.getElementById('guidance-toggle-btn');
  const isVisible = box.classList.contains('visible');
  box.classList.toggle('visible');
  btn.textContent = isVisible ? '+ Add guidance' : '− Hide guidance';
}

async function runAIPopulate() {
  const guidance = document.getElementById('ai-guidance').value.trim();
  const status = document.getElementById('ai-populate-status');

  const { data: pl } = await supabaseClient.from('product_lines')
    .select('*, organizations(name)').eq('id', currentAIPopulatePlId).single();
  const company = pl?.organizations?.name || '';

  status.innerHTML = '<div class="ai-spinner"><div class="spinner"></div>Claude is researching ' + company + ' — ' + currentAIPopulatePlName + '…</div>';

  const prompt = 'You are a B2B sales intelligence expert. Research the following product and return structured data for a sales team.\n'
    + 'Company: ' + company + '\nProduct line: ' + currentAIPopulatePlName + '\n'
    + (pl?.website ? 'Website: ' + pl.website + '\n' : '')
    + (guidance ? 'Guidance: ' + guidance + '\n' : '')
    + 'Return ONLY a JSON object with no markdown: {"capabilities":[{"name":"...","description":"...","keywords":["..."],"use_cases":["..."]}],"customer_stories":[{"company":"...","industry":"...","employees":"...","outcome":"...","keywords":["..."]}],"competitive_intel":[{"competitor":"...","status":"active/sunsetting/legacy","displacement_angle":"...","keywords":["..."]}],"icp_settings":[{"tier":"primary/secondary/non","min_employees":0,"industries":["..."],"geographies":["..."]}]}'
    + ' Include 5-8 capabilities, 3-5 customer stories, 3-5 competitors, 2-3 ICP tiers. Be specific and actionable.';

  try {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Proxy-Secret': PROXY_SECRET },
      body: JSON.stringify({ route: 'direct-claude', prompt, maxTokens: 2000 })
    });
    if (!res.ok) throw new Error('Proxy error ' + res.status);
    const data = await res.json();

    aiSuggestions = {
      plId: currentAIPopulatePlId,
      capabilities: (data.capabilities || []).map((c, i) => ({ ...c, _id: 'cap_' + i, _include: true })),
      customer_stories: (data.customer_stories || []).map((s, i) => ({ ...s, _id: 'st_' + i, _include: true })),
      competitive_intel: (data.competitive_intel || []).map((c, i) => ({ ...c, _id: 'comp_' + i, _include: true })),
      icp_settings: (data.icp_settings || []).map((s, i) => ({ ...s, _id: 'icp_' + i, _include: true }))
    };

    status.textContent = 'Done! Review and edit suggestions below before saving.';
    status.style.color = '#007A62';

    // Hide populate panel, show preview directly below
    hideAIPopulate();
    renderPreview(company, currentAIPopulatePlName);

  } catch (e) {
    status.textContent = 'Error: ' + e.message;
    status.style.color = '#C0320F';
  }
}

// ── PREVIEW EDITOR ────────────────────────────────────────────────────────
function renderPreview(company, plName) {
  const panel = document.getElementById('preview-panel');
  const content = document.getElementById('preview-content');

  const counts = [
    aiSuggestions.capabilities.length + ' capabilities',
    aiSuggestions.customer_stories.length + ' stories',
    aiSuggestions.competitive_intel.length + ' competitors',
    aiSuggestions.icp_settings.length + ' ICP tiers'
  ].join(' · ');

  let html = `<div style="font-size:12px;color:var(--muted);margin-bottom:16px;">
    <strong>${company} — ${plName}</strong> &nbsp;·&nbsp; ${counts}
  </div>`;

  html += renderPreviewSection('capabilities', 'Capabilities', aiSuggestions.capabilities, [
    { key: 'name', label: 'Name', type: 'input' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'keywords', label: 'Keywords (comma separated)', type: 'input', isArray: true },
    { key: 'use_cases', label: 'Use cases (comma separated)', type: 'input', isArray: true }
  ]);

  html += renderPreviewSection('customer_stories', 'Customer Stories', aiSuggestions.customer_stories, [
    { key: 'company', label: 'Company', type: 'input' },
    { key: 'industry', label: 'Industry', type: 'input' },
    { key: 'employees', label: 'Employees', type: 'input' },
    { key: 'outcome', label: 'Outcome', type: 'textarea' },
    { key: 'keywords', label: 'Keywords (comma separated)', type: 'input', isArray: true }
  ]);

  html += renderPreviewSection('competitive_intel', 'Competitive Intel', aiSuggestions.competitive_intel, [
    { key: 'competitor', label: 'Competitor', type: 'input' },
    { key: 'status', label: 'Status', type: 'select', options: ['active', 'sunsetting', 'legacy'] },
    { key: 'displacement_angle', label: 'Displacement angle', type: 'textarea' },
    { key: 'keywords', label: 'Keywords (comma separated)', type: 'input', isArray: true }
  ]);

  html += renderPreviewSection('icp_settings', 'ICP Settings', aiSuggestions.icp_settings, [
    { key: 'tier', label: 'Tier', type: 'select', options: ['primary', 'secondary', 'non'] },
    { key: 'min_employees', label: 'Min employees', type: 'input' },
    { key: 'industries', label: 'Industries (comma separated)', type: 'input', isArray: true },
    { key: 'geographies', label: 'Geographies (comma separated)', type: 'input', isArray: true }
  ]);

  content.innerHTML = html;
  panel.classList.add('visible');
  panel.scrollIntoView({ behavior: 'smooth' });
}

function renderPreviewSection(type, title, items, fields) {
  return `<div class="preview-section">
    <div class="preview-section-label">
      <span>${title} (${items.length})</span>
      <button class="btn-sm primary" onclick="addPreviewItem('${type}')">+ Add</button>
    </div>
    <div id="prev-${type}">
      ${items.map((item, idx) => renderPreviewItem(type, item, idx, fields)).join('')}
    </div>
  </div>`;
}

function renderPreviewItem(type, item, idx, fields) {
  const fieldDefs = getFieldDefs(type);
  return `<div class="preview-item ${item._include ? '' : 'excluded'}" id="pi-${type}-${idx}">
    <div class="preview-item-header">
      <input type="checkbox" ${item._include ? 'checked' : ''} onchange="togglePI('${type}',${idx},this.checked)" />
      <div class="preview-item-title">${getItemTitle(type, item)}</div>
      <button class="btn-sm danger" onclick="removePI('${type}',${idx})">Remove</button>
    </div>
    ${fieldDefs.map(f => `
      <div class="preview-field">
        <label>${f.label}</label>
        ${f.type === 'textarea'
          ? `<textarea oninput="updatePI('${type}',${idx},'${f.key}',this.value,${!!f.isArray})">${f.isArray ? (item[f.key]||[]).join(', ') : (item[f.key]||'')}</textarea>`
          : f.type === 'select'
          ? `<select onchange="updatePI('${type}',${idx},'${f.key}',this.value,false)">${f.options.map(o=>`<option value="${o}"${item[f.key]===o?' selected':''}>${o}</option>`).join('')}</select>`
          : `<input type="text" value="${f.isArray?(item[f.key]||[]).join(', '):(item[f.key]||'')}" oninput="updatePI('${type}',${idx},'${f.key}',this.value,${!!f.isArray})" />`
        }
      </div>`).join('')}
  </div>`;
}

function getFieldDefs(type) {
  const defs = {
    capabilities: [
      { key: 'name', label: 'Name', type: 'input' },
      { key: 'category', label: 'Type', type: 'select', options: ['product', 'service'] },
      { key: 'description', label: 'Description', type: 'textarea' },
      { key: 'problems_solved', label: 'Problems it solves', type: 'textarea' },
      { key: 'differentiators', label: 'Key differentiators', type: 'textarea' },
      { key: 'keywords', label: 'Keywords (comma separated)', type: 'input', isArray: true },
      { key: 'use_cases', label: 'Use cases (comma separated)', type: 'input', isArray: true }
    ],
    customer_stories: [
      { key: 'company', label: 'Company', type: 'input' },
      { key: 'industry', label: 'Industry', type: 'input' },
      { key: 'employees', label: 'Employees', type: 'input' },
      { key: 'outcome', label: 'Outcome', type: 'textarea' },
      { key: 'keywords', label: 'Keywords (comma separated)', type: 'input', isArray: true }
    ],
    competitive_intel: [
      { key: 'competitor', label: 'Competitor', type: 'input' },
      { key: 'status', label: 'Status', type: 'select', options: ['active', 'sunsetting', 'legacy'] },
      { key: 'displacement_angle', label: 'Displacement angle', type: 'textarea' },
      { key: 'keywords', label: 'Keywords (comma separated)', type: 'input', isArray: true }
    ],
    icp_settings: [
      { key: 'tier', label: 'Tier', type: 'select', options: ['primary', 'secondary', 'non'] },
      { key: 'min_employees', label: 'Min employees', type: 'input' },
      { key: 'industries', label: 'Industries (comma separated)', type: 'input', isArray: true },
      { key: 'geographies', label: 'Geographies (comma separated)', type: 'input', isArray: true }
    ]
  };
  return defs[type] || [];
}

function getItemTitle(type, item) {
  if (type === 'capabilities') return item.name || 'New capability';
  if (type === 'customer_stories') return item.company || 'New story';
  if (type === 'competitive_intel') return item.competitor || 'New competitor';
  if (type === 'icp_settings') return (item.tier || 'primary') + ' ICP';
  return 'Item';
}

function updatePI(type, idx, key, value, isArray) {
  aiSuggestions[type][idx][key] = isArray ? value.split(',').map(v => v.trim()).filter(Boolean) : value;
  const titleEl = document.querySelector('#pi-' + type + '-' + idx + ' .preview-item-title');
  if (titleEl) titleEl.textContent = getItemTitle(type, aiSuggestions[type][idx]);
}

function togglePI(type, idx, checked) {
  aiSuggestions[type][idx]._include = checked;
  const el = document.getElementById('pi-' + type + '-' + idx);
  if (el) el.className = 'preview-item' + (checked ? '' : ' excluded');
}

function removePI(type, idx) {
  aiSuggestions[type].splice(idx, 1);
  // Re-render just that section
  const titles = { capabilities: 'Capabilities', customer_stories: 'Customer Stories', competitive_intel: 'Competitive Intel', icp_settings: 'ICP Settings' };
  const container = document.getElementById('prev-' + type);
  if (container) {
    container.innerHTML = aiSuggestions[type].map((item, i) => renderPreviewItem(type, item, i, getFieldDefs(type))).join('');
    const label = container.previousElementSibling;
    if (label) label.querySelector('span').textContent = titles[type] + ' (' + aiSuggestions[type].length + ')';
  }
}

function addPreviewItem(type) {
  const defaults = {
    capabilities: { name: '', description: '', keywords: [], use_cases: [], _include: true },
    customer_stories: { company: '', industry: '', employees: '', outcome: '', keywords: [], _include: true },
    competitive_intel: { competitor: '', status: 'active', displacement_angle: '', keywords: [], _include: true },
    icp_settings: { tier: 'primary', min_employees: 0, industries: [], geographies: [], _include: true }
  };
  const item = { ...defaults[type], _id: type + '_' + Date.now() };
  aiSuggestions[type].push(item);
  const idx = aiSuggestions[type].length - 1;
  const container = document.getElementById('prev-' + type);
  if (container) {
    const div = document.createElement('div');
    div.innerHTML = renderPreviewItem(type, item, idx, getFieldDefs(type));
    container.appendChild(div.firstElementChild);
  }
}

function hidePreview() {
  document.getElementById('preview-panel').classList.remove('visible');
  aiSuggestions = null;
}

async function saveSelectedSuggestions() {
  if (!aiSuggestions) return;
  const plId = aiSuggestions.plId || currentProductLineId;
  if (!plId) return;

  const btn = event.target;
  btn.textContent = 'Saving…';
  btn.disabled = true;

  try {
    const clean = (arr) => arr.filter(i => i._include).map(({ _id, _include, ...rest }) => ({
      ...rest,
      org_id: currentOrgId,
      product_line_id: plId
    }));

    const ops = [];
    if (aiSuggestions.capabilities.some(i => i._include)) ops.push(supabaseClient.from('capabilities').insert(clean(aiSuggestions.capabilities)));
    if (aiSuggestions.customer_stories.some(i => i._include)) ops.push(supabaseClient.from('customer_stories').insert(clean(aiSuggestions.customer_stories)));
    if (aiSuggestions.competitive_intel.some(i => i._include)) ops.push(supabaseClient.from('competitive_intel').insert(clean(aiSuggestions.competitive_intel)));
    if (aiSuggestions.icp_settings.some(i => i._include)) ops.push(supabaseClient.from('icp_settings').insert(clean(aiSuggestions.icp_settings)));

    await Promise.all(ops);

    hidePreview();
    btn.textContent = 'Save selected';
    btn.disabled = false;

    // Open KB section for this product line so user can see what was saved
    openKBSection(plId, currentAIPopulatePlName);
  } catch (e) {
    btn.textContent = 'Error — try again';
    btn.disabled = false;
    console.error(e);
  }
}

// ── KB SECTION ────────────────────────────────────────────────────────────
function openKBSection(plId, plName) {
  currentProductLineId = plId;
  currentProductLineName = plName;
  document.getElementById('kb-pl-name').textContent = plName;
  document.getElementById('kb-section').style.display = 'block';
  document.getElementById('kb-section').scrollIntoView({ behavior: 'smooth' });
  switchTab('capabilities', document.querySelector('.tab-bar .tab-btn'));
}

function closeKBSection() {
  document.getElementById('kb-section').style.display = 'none';
  currentProductLineId = null;
}

function switchTab(tab, btn) {
  currentTab = tab;
  document.querySelectorAll('.kb-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  if (btn) btn.classList.add('active');
  loadCurrentTab();
}

function loadCurrentTab() {
  switch (currentTab) {
    case 'capabilities': loadCapabilities(); break;
    case 'stories':      loadStories();      break;
    case 'competitive':  loadCompetitive();  break;
    case 'icp':          loadICP();          break;
  }
}

// ── CAPABILITIES ──────────────────────────────────────────────────────────
async function loadCapabilities() {
  const { data } = await supabaseClient.from('capabilities')
    .select('*').eq('product_line_id', currentProductLineId).order('name');
  const el = document.getElementById('capabilities-list');
  if (!data || data.length === 0) { el.className = 'empty-state'; el.innerHTML = 'No capabilities yet — use ✦ AI populate or add manually'; return; }
  el.className = '';
  el.innerHTML = `<table class="table">
    <thead><tr><th>Name</th><th>Type</th><th>Description</th><th>Keywords</th><th>Actions</th></tr></thead>
    <tbody>${data.map(c => `<tr>
      <td><strong>${c.name}</strong></td>
      <td style="font-size:11px;text-transform:capitalize;color:var(--muted);">${c.category||'product'}</td>
      <td style="font-size:12px;color:var(--muted);max-width:180px;">${c.description||'—'}</td>
      <td style="font-size:11px;color:var(--muted);">${(c.keywords||[]).slice(0,3).join(', ')}${(c.keywords||[]).length>3?'...':''}</td>
      <td><button class="btn-sm" onclick="editCapability('${c.id}')">Edit</button>
        <button class="btn-sm danger" onclick="deleteCapability('${c.id}')">Delete</button></td>
    </tr>`).join('')}</tbody></table>`;
}

function showAddCapability() {
  ['cap-id','cap-name','cap-desc','cap-keywords','cap-usecases','cap-problems','cap-diff'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('cap-category').value = 'product';
  document.getElementById('cap-form-title').textContent = 'Add product / service';
  document.getElementById('cap-form').style.display = 'block';
}
function hideCap() { document.getElementById('cap-form').style.display = 'none'; }

async function editCapability(id) {
  const { data } = await supabaseClient.from('capabilities').select('*').eq('id', id).single();
  if (!data) return;
  document.getElementById('cap-id').value = data.id;
  document.getElementById('cap-name').value = data.name||'';
  document.getElementById('cap-desc').value = data.description||'';
  document.getElementById('cap-category').value = data.category||'product';
  document.getElementById('cap-problems').value = data.problems_solved||'';
  document.getElementById('cap-diff').value = data.differentiators||'';
  document.getElementById('cap-keywords').value = (data.keywords||[]).join(', ');
  document.getElementById('cap-usecases').value = (data.use_cases||[]).join(', ');
  document.getElementById('cap-form-title').textContent = 'Edit product / service';
  document.getElementById('cap-form').style.display = 'block';
}

async function saveCapability() {
  if (!currentProductLineId) return;
  const id = document.getElementById('cap-id').value;
  const msg = document.getElementById('cap-msg');
  const payload = {
    org_id: currentOrgId, product_line_id: currentProductLineId,
    name: document.getElementById('cap-name').value.trim(),
    description: document.getElementById('cap-desc').value.trim(),
    category: document.getElementById('cap-category').value,
    problems_solved: document.getElementById('cap-problems').value.trim(),
    differentiators: document.getElementById('cap-diff').value.trim(),
    keywords: document.getElementById('cap-keywords').value.split(',').map(k=>k.trim()).filter(Boolean),
    use_cases: document.getElementById('cap-usecases').value.split(',').map(k=>k.trim()).filter(Boolean),
    updated_at: new Date().toISOString()
  };
  if (!payload.name) { msg.textContent = 'Name required'; msg.style.color='#C0320F'; return; }
  const { error } = id ? await supabaseClient.from('capabilities').update(payload).eq('id', id)
    : await supabaseClient.from('capabilities').insert([payload]);
  if (error) { msg.textContent = 'Error: '+error.message; msg.style.color='#C0320F'; }
  else { hideCap(); loadCapabilities(); }
}

async function deleteCapability(id) {
  if (!confirm('Delete?')) return;
  await supabaseClient.from('capabilities').delete().eq('id', id);
  loadCapabilities();
}

// ── STORIES ───────────────────────────────────────────────────────────────
async function loadStories() {
  const { data } = await supabaseClient.from('customer_stories')
    .select('*').eq('product_line_id', currentProductLineId).order('company');
  const el = document.getElementById('stories-list');
  if (!data || data.length === 0) { el.className = 'empty-state'; el.innerHTML = 'No stories yet'; return; }
  el.className = '';
  el.innerHTML = `<table class="table">
    <thead><tr><th>Company</th><th>Industry</th><th>Outcome</th><th>Actions</th></tr></thead>
    <tbody>${data.map(s => `<tr>
      <td><strong>${s.company}</strong><br><span style="font-size:11px;color:var(--muted)">${s.employees||''}</span></td>
      <td style="font-size:12px;">${s.industry||'—'}</td>
      <td style="font-size:12px;color:var(--muted);max-width:220px;">${s.outcome||'—'}</td>
      <td><button class="btn-sm" onclick="editStory('${s.id}')">Edit</button>
        <button class="btn-sm danger" onclick="deleteStory('${s.id}')">Delete</button></td>
    </tr>`).join('')}</tbody></table>`;
}

function showAddStory() {
  ['story-id','story-company','story-industry','story-employees','story-outcome','story-keywords'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('story-form-title').textContent = 'Add story';
  document.getElementById('story-form').style.display = 'block';
}
function hideStory() { document.getElementById('story-form').style.display = 'none'; }

async function editStory(id) {
  const { data } = await supabaseClient.from('customer_stories').select('*').eq('id', id).single();
  if (!data) return;
  document.getElementById('story-id').value = data.id;
  document.getElementById('story-company').value = data.company||'';
  document.getElementById('story-industry').value = data.industry||'';
  document.getElementById('story-employees').value = data.employees||'';
  document.getElementById('story-outcome').value = data.outcome||'';
  document.getElementById('story-keywords').value = (data.keywords||[]).join(', ');
  document.getElementById('story-form-title').textContent = 'Edit story';
  document.getElementById('story-form').style.display = 'block';
}

async function saveStory() {
  if (!currentProductLineId) return;
  const id = document.getElementById('story-id').value;
  const msg = document.getElementById('story-msg');
  const payload = {
    org_id: currentOrgId, product_line_id: currentProductLineId,
    company: document.getElementById('story-company').value.trim(),
    industry: document.getElementById('story-industry').value.trim(),
    employees: document.getElementById('story-employees').value.trim(),
    outcome: document.getElementById('story-outcome').value.trim(),
    keywords: document.getElementById('story-keywords').value.split(',').map(k=>k.trim()).filter(Boolean)
  };
  if (!payload.company) { msg.textContent = 'Company required'; msg.style.color='#C0320F'; return; }
  const { error } = id ? await supabaseClient.from('customer_stories').update(payload).eq('id', id)
    : await supabaseClient.from('customer_stories').insert([payload]);
  if (error) { msg.textContent = 'Error: '+error.message; msg.style.color='#C0320F'; }
  else { hideStory(); loadStories(); }
}

async function deleteStory(id) {
  if (!confirm('Delete?')) return;
  await supabaseClient.from('customer_stories').delete().eq('id', id);
  loadStories();
}

// ── COMPETITIVE ───────────────────────────────────────────────────────────
async function loadCompetitive() {
  const { data } = await supabaseClient.from('competitive_intel')
    .select('*').eq('product_line_id', currentProductLineId).order('competitor');
  const el = document.getElementById('competitive-list');
  if (!data || data.length === 0) { el.className = 'empty-state'; el.innerHTML = 'No competitors yet'; return; }
  el.className = '';
  el.innerHTML = `<table class="table">
    <thead><tr><th>Competitor</th><th>Status</th><th>Displacement angle</th><th>Actions</th></tr></thead>
    <tbody>${data.map(c => `<tr>
      <td><strong>${c.competitor}</strong></td>
      <td><span class="badge badge-${c.status==='sunsetting'?'trial':'active'}">${c.status}</span></td>
      <td style="font-size:12px;color:var(--muted);max-width:220px;">${c.displacement_angle||'—'}</td>
      <td><button class="btn-sm" onclick="editCompetitor('${c.id}')">Edit</button>
        <button class="btn-sm danger" onclick="deleteCompetitor('${c.id}')">Delete</button></td>
    </tr>`).join('')}</tbody></table>`;
}

function showAddCompetitor() {
  document.getElementById('comp-id').value = '';
  document.getElementById('comp-name').value = '';
  document.getElementById('comp-status').value = 'active';
  document.getElementById('comp-angle').value = '';
  document.getElementById('comp-keywords').value = '';
  document.getElementById('comp-form-title').textContent = 'Add competitor';
  document.getElementById('comp-form').style.display = 'block';
}
function hideComp() { document.getElementById('comp-form').style.display = 'none'; }

async function editCompetitor(id) {
  const { data } = await supabaseClient.from('competitive_intel').select('*').eq('id', id).single();
  if (!data) return;
  document.getElementById('comp-id').value = data.id;
  document.getElementById('comp-name').value = data.competitor||'';
  document.getElementById('comp-status').value = data.status||'active';
  document.getElementById('comp-angle').value = data.displacement_angle||'';
  document.getElementById('comp-keywords').value = (data.keywords||[]).join(', ');
  document.getElementById('comp-form-title').textContent = 'Edit competitor';
  document.getElementById('comp-form').style.display = 'block';
}

async function saveCompetitor() {
  if (!currentProductLineId) return;
  const id = document.getElementById('comp-id').value;
  const msg = document.getElementById('comp-msg');
  const payload = {
    org_id: currentOrgId, product_line_id: currentProductLineId,
    competitor: document.getElementById('comp-name').value.trim(),
    status: document.getElementById('comp-status').value,
    displacement_angle: document.getElementById('comp-angle').value.trim(),
    keywords: document.getElementById('comp-keywords').value.split(',').map(k=>k.trim()).filter(Boolean)
  };
  if (!payload.competitor) { msg.textContent = 'Name required'; msg.style.color='#C0320F'; return; }
  const { error } = id ? await supabaseClient.from('competitive_intel').update(payload).eq('id', id)
    : await supabaseClient.from('competitive_intel').insert([payload]);
  if (error) { msg.textContent = 'Error: '+error.message; msg.style.color='#C0320F'; }
  else { hideComp(); loadCompetitive(); }
}

async function deleteCompetitor(id) {
  if (!confirm('Delete?')) return;
  await supabaseClient.from('competitive_intel').delete().eq('id', id);
  loadCompetitive();
}

// ── ICP ───────────────────────────────────────────────────────────────────
async function loadICP() {
  const { data } = await supabaseClient.from('icp_settings')
    .select('*').eq('product_line_id', currentProductLineId).order('tier');
  const el = document.getElementById('icp-list');
  if (!data || data.length === 0) { el.className = 'empty-state'; el.innerHTML = 'No ICP tiers yet'; return; }
  el.className = '';
  el.innerHTML = `<table class="table">
    <thead><tr><th>Tier</th><th>Min employees</th><th>Industries</th><th>Geographies</th><th>Actions</th></tr></thead>
    <tbody>${data.map(i => `<tr>
      <td><span class="badge badge-${i.tier==='primary'?'active':i.tier==='secondary'?'trial':'member'}">${i.tier} ICP</span></td>
      <td>${(i.min_employees||0).toLocaleString()}+</td>
      <td style="font-size:12px;color:var(--muted);">${(i.industries||[]).slice(0,3).join(', ')}${(i.industries||[]).length>3?'...':''}</td>
      <td style="font-size:12px;color:var(--muted);">${(i.geographies||[]).join(', ')||'—'}</td>
      <td><button class="btn-sm" onclick="editICP('${i.id}')">Edit</button>
        <button class="btn-sm danger" onclick="deleteICP('${i.id}')">Delete</button></td>
    </tr>`).join('')}</tbody></table>`;
}

function showAddICP() {
  document.getElementById('icp-id').value = '';
  document.getElementById('icp-tier').value = 'primary';
  document.getElementById('icp-employees').value = '';
  document.getElementById('icp-industries').value = '';
  document.getElementById('icp-geos').value = '';
  document.getElementById('icp-form-title').textContent = 'Add ICP tier';
  document.getElementById('icp-form').style.display = 'block';
}
function hideICP() { document.getElementById('icp-form').style.display = 'none'; }

async function editICP(id) {
  const { data } = await supabaseClient.from('icp_settings').select('*').eq('id', id).single();
  if (!data) return;
  document.getElementById('icp-id').value = data.id;
  document.getElementById('icp-tier').value = data.tier||'primary';
  document.getElementById('icp-employees').value = data.min_employees||'';
  document.getElementById('icp-industries').value = (data.industries||[]).join(', ');
  document.getElementById('icp-geos').value = (data.geographies||[]).join(', ');
  document.getElementById('icp-form-title').textContent = 'Edit ICP tier';
  document.getElementById('icp-form').style.display = 'block';
}

async function saveICP() {
  if (!currentProductLineId) return;
  const id = document.getElementById('icp-id').value;
  const msg = document.getElementById('icp-msg');
  const payload = {
    org_id: currentOrgId, product_line_id: currentProductLineId,
    tier: document.getElementById('icp-tier').value,
    min_employees: parseInt(document.getElementById('icp-employees').value)||0,
    industries: document.getElementById('icp-industries').value.split(',').map(k=>k.trim()).filter(Boolean),
    geographies: document.getElementById('icp-geos').value.split(',').map(k=>k.trim()).filter(Boolean)
  };
  const { error } = id ? await supabaseClient.from('icp_settings').update(payload).eq('id', id)
    : await supabaseClient.from('icp_settings').insert([payload]);
  if (error) { msg.textContent = 'Error: '+error.message; msg.style.color='#C0320F'; }
  else { hideICP(); loadICP(); }
}

async function deleteICP(id) {
  if (!confirm('Delete?')) return;
  await supabaseClient.from('icp_settings').delete().eq('id', id);
  loadICP();
}

// ── Expose globals ─────────────────────────────────────────────────────────
window.initSettings = initSettings;
window.onOrgChange = onOrgChange;
window.loadProductLines = loadProductLines;
window.showAddProductLineForm = showAddProductLineForm;
window.hideProductLineForm = hideProductLineForm;
window.saveProductLine = saveProductLine;
window.editProductLine = editProductLine;
window.deleteProductLine = deleteProductLine;
window.startAIDiscovery = startAIDiscovery;
window.hideAIDiscovery = hideAIDiscovery;
window.runDiscovery = runDiscovery;
window.createDiscoveredLines = createDiscoveredLines;
window.openAIPopulate = openAIPopulate;
window.hideAIPopulate = hideAIPopulate;
window.toggleGuidance = toggleGuidance;
window.runAIPopulate = runAIPopulate;
window.saveSelectedSuggestions = saveSelectedSuggestions;
window.hidePreview = hidePreview;
window.addPreviewItem = addPreviewItem;
window.removePI = removePI;
window.togglePI = togglePI;
window.updatePI = updatePI;
window.openKBSection = openKBSection;
window.closeKBSection = closeKBSection;
window.switchTab = switchTab;
window.showAddCapability = showAddCapability;
window.hideCap = hideCap;
window.editCapability = editCapability;
window.saveCapability = saveCapability;
window.deleteCapability = deleteCapability;
window.showAddStory = showAddStory;
window.hideStory = hideStory;
window.editStory = editStory;
window.saveStory = saveStory;
window.deleteStory = deleteStory;
window.showAddCompetitor = showAddCompetitor;
window.hideComp = hideComp;
window.editCompetitor = editCompetitor;
window.saveCompetitor = saveCompetitor;
window.deleteCompetitor = deleteCompetitor;
window.showAddICP = showAddICP;
window.hideICP = hideICP;
window.editICP = editICP;
window.saveICP = saveICP;
window.deleteICP = deleteICP;
