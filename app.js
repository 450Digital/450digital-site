// Recon by 450digital — Auth & App Logic
const SUPABASE_URL = 'https://rzstxdvchjtzkrhdtlje.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ6c3R4ZHZjaGp0emtyaGR0bGplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5NDI3MTEsImV4cCI6MjA5MTUxODcxMX0.ImPHUaTpb1dsvqrqzChq6KllyC9CXhncGiPxA09sraE';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

checkAuth();

async function checkAuth() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  const path = window.location.pathname;
  const isAuthPage = path.endsWith('index.html') || path === '/' || path.endsWith('/');
  if (session && isAuthPage) {
    window.location.href = 'dashboard.html';
  } else if (!session && !isAuthPage) {
    window.location.href = 'index.html';
  }
}

async function signInWithGoogle() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: 'https://recon.450digital.com/dashboard.html' }
  });
  if (error) showMessage('Error: ' + error.message, 'error');
}

async function signInWithEmail() {
  const email = document.getElementById('email')?.value?.trim();
  const password = document.getElementById('password')?.value;
  if (!email || !password) { showMessage('Please enter your email and password', 'error'); return; }
  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) { showMessage(error.message, 'error'); } else { window.location.href = 'dashboard.html'; }
}

async function signOut() {
  await supabaseClient.auth.signOut();
  window.location.href = 'index.html';
}

function showSignUp() {
  const email = prompt('Enter your work email to request access:');
  if (email) showMessage('Thanks! We\'ll be in touch at ' + email, 'success');
}

function showMessage(msg, type) {
  const el = document.getElementById('auth-message');
  if (el) { el.textContent = msg; el.className = 'auth-message ' + (type || ''); }
}

// ── Get current user session token (used by Chrome extension) ──────────────
async function getSessionToken() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  return session?.access_token || null;
}
