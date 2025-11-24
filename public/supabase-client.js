// Configuration Supabase côté client
let _supabaseClient = null;

async function initSupabase() {
  if (_supabaseClient) return _supabaseClient;

  try {
    const response = await fetch('/api/config');
    const config = await response.json();

    const { createClient } = window.supabase;
    _supabaseClient = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

    return _supabaseClient;
  } catch (error) {
    console.error('Failed to initialize Supabase:', error);
    throw error;
  }
}

// Helpers pour l'authentification
function getAuthToken() {
  return localStorage.getItem('sb-access-token');
}

function setAuthToken(token) {
  localStorage.setItem('sb-access-token', token);
}

function clearAuthToken() {
  localStorage.removeItem('sb-access-token');
}

async function requireAuth() {
  const token = getAuthToken();
  if (!token) {
    window.location.href = '/login';
    return false;
  }

  try {
    const supabaseClient = await initSupabase();
    const { data: { user }, error } = await supabaseClient.auth.getUser(token);

    if (error || !user) {
      clearAuthToken();
      window.location.href = '/login';
      return false;
    }

    return true;
  } catch (err) {
    clearAuthToken();
    window.location.href = '/login';
    return false;
  }
}

async function checkAuth() {
  const token = getAuthToken();
  if (!token) return false;

  try {
    const supabaseClient = await initSupabase();
    const { data: { user }, error } = await supabaseClient.auth.getUser(token);
    return !error && !!user;
  } catch {
    return false;
  }
}

async function logout() {
  try {
    const supabaseClient = await initSupabase();
    await supabaseClient.auth.signOut();
  } catch (err) {
    console.error('Logout error:', err);
  } finally {
    clearAuthToken();
    window.location.href = '/login';
  }
}
