let supabaseClient;

(async function() {
  try {
    supabaseClient = await initSupabase();
    console.log('✅ Supabase initialisé');

    // Vérifier si déjà connecté
    const isAuthed = await checkAuth();
    if (isAuthed) {
      window.location.href = '/dashboard';
    }
  } catch (error) {
    console.error('❌ Erreur init Supabase:', error);
    document.body.innerHTML = `
      <div style="text-align:center;padding:50px;background:white;margin:2rem;border-radius:12px;">
        <h2>⚠️ Erreur de configuration</h2>
        <p>Impossible de charger la configuration Supabase</p>
        <p style="color:#999;font-size:0.9rem;">Vérifiez votre fichier .env</p>
      </div>
    `;
  }
})();
