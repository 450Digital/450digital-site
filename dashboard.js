// Recon Admin Dashboard Logic

async function loadDashboard() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) { window.location.href = 'index.html'; return; }
  loadStats();
  loadCustomers();
  loadUsage();
}

async function loadStats() {
  const { data: orgs } = await supabaseClient.from('organizations').select('*');
  const { data: users } = await supabaseClient.from('org_users').select('*');
  const { data: logs } = await supabaseClient.from('usage_logs')
    .select('*')
    .gte('created_at', new Date().toISOString().split('T')[0]);

  document.getElementById('stat-customers').textContent = orgs?.length || 0;
  document.getElementById('stat-users').textContent = users?.length || 0;
  document.getElementById('stat-lookups').textContent = logs?.length || 0;

  const seats = orgs?.reduce((sum, o) => sum + (o.seats || 0), 0) || 0;
  document.getElementById('stat-mrr').textContent = '$' + (seats * 99).toLocaleString();
}

async function loadCustomers() {
  const { data: orgs } = await supabaseClient.from('organizations').select('*')
    .order('created_at', { ascending: false });

  const tbody = document.getElementById('customers-table');
  if (!orgs || orgs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No customers yet — add your first one!</td></tr>';
    return;
  }

  tbody.innerHTML = orgs.map(org => `
    <tr>
      <td><strong>${org.name}</strong><br>
        <span style="font-size:11px;color:var(--muted)">${org.slug}</span>
      </td>
      <td><span class="badge badge-${org.plan === 'trial' ? 'trial' : 'active'}">${org.plan}</span></td>
      <td>${org.seats} seats</td>
      <td>${new Date(org.created_at).toLocaleDateString()}</td>
      <td><button class="btn-sm" onclick="manageOrg('${org.id}')">Manage</button></td>
    </tr>
  `).join('');
}

async function loadUsage() {
  const { data: logs } = await supabaseClient.from('usage_logs').select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  const tbody = document.getElementById('usage-table');
  if (!logs || logs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No lookups yet</td></tr>';
    return;
  }

  tbody.innerHTML = logs.map(log => `
    <tr>
      <td><strong>${log.company_name || '—'}</strong></td>
      <td>${log.user_id?.substring(0, 8)}...</td>
      <td>${log.org_id?.substring(0, 8)}...</td>
      <td>${new Date(log.created_at).toLocaleString()}</td>
    </tr>
  `).join('');
}

async function addCustomer() {
  const name = document.getElementById('new-org-name').value.trim();
  const slug = document.getElementById('new-org-slug').value.trim();
  const plan = document.getElementById('new-org-plan').value;
  const seats = parseInt(document.getElementById('new-org-seats').value);
  const msg = document.getElementById('form-message');

  if (!name || !slug) {
    msg.textContent = 'Please fill in all fields';
    msg.style.color = '#C0320F';
    return;
  }

  const { error } = await supabaseClient.from('organizations').insert([{ name, slug, plan, seats }]);

  if (error) {
    msg.textContent = 'Error: ' + error.message;
    msg.style.color = '#C0320F';
  } else {
    msg.textContent = 'Customer added!';
    msg.style.color = 'var(--teal)';
    setTimeout(() => { hideAddCustomer(); loadDashboard(); }, 1000);
  }
}

function showAddCustomer() {
  document.getElementById('add-customer-form').style.display = 'block';
}

function hideAddCustomer() {
  document.getElementById('add-customer-form').style.display = 'none';
  document.getElementById('form-message').textContent = '';
}

function manageOrg(id) {
  alert('Org management coming soon — org ID: ' + id);
}

loadDashboard();
