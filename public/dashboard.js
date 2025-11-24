let supabaseClient;
let currentUser = null;
let currentUserProfile = null;
let currentSandboxForShare = null;

(async function() {
  supabaseClient = await initSupabase();
  await checkAuthAndLoad();
})();

async function checkAuthAndLoad() {
  const authed = await requireAuth();
  if (!authed) return;
  
  try {
    const { data: { user } } = await supabaseClient.auth.getUser(getAuthToken());
    currentUser = user;
    
    // Récupérer le profil avec le username
    const { data: profile, error } = await supabaseClient
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .single();
    
    if (error) {
      console.error('Error loading profile:', error);
      // Fallback sur l'email si pas de profil
      document.getElementById('usernameText').textContent = user.email;
    } else {
      currentUserProfile = profile;
      document.getElementById('usernameText').textContent = profile.username;
    }
    
    await loadSandboxes();
  } catch (err) {
    console.error('Error loading user:', err);
    logout();
  }
}

// Déconnexion
document.getElementById('logoutBtn').addEventListener('click', logout);

// Création de sandbox
const createForm = document.getElementById('createForm');
const sandboxNameInput = document.getElementById('sandboxName');

createForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const name = sandboxNameInput.value.trim();
  
  try {
    const res = await fetch('/api/sandboxes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify({ name })
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'Erreur lors de la création');
      return;
    }

    window.location.href = `/sandbox/${data.name}`;
  } catch (err) {
    console.error('Create error:', err);
    alert('Erreur de connexion au serveur');
  }
});

// Charger les sandboxes
async function loadSandboxes() {
  const list = document.getElementById('sandboxList');
  
  try {
    const res = await fetch('/api/sandboxes', {
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`
      }
    });

    if (!res.ok) throw new Error('Failed to load');

    const sandboxes = await res.json();

    if (sandboxes.length === 0) {
      list.innerHTML = '<p class="empty">Aucune sandbox pour le moment</p>';
      return;
    }

    list.innerHTML = '';
    sandboxes.forEach((sandbox) => {
      const li = document.createElement('li');
      li.className = 'sandbox-card';
      
      li.innerHTML = `
        <div class="sandbox-info">
          <a href="/sandbox/${sandbox.name}" class="sandbox-name">
            ${sandbox.name}
            ${sandbox.shared ? '<span class="badge shared">Partagé</span>' : '<span class="badge owner">Propriétaire</span>'}
          </a>
          <small>Créé le ${new Date(sandbox.created_at).toLocaleDateString('fr-FR')}</small>
        </div>
        <div class="sandbox-actions">
          <a href="/sandbox/${sandbox.name}" class="btn btn-primary">Ouvrir</a>
          ${!sandbox.shared ? `
            <button onclick="openShareModal('${sandbox.name}')" class="btn btn-secondary">📤 Partager</button>
            <button onclick="deleteSandbox('${sandbox.name}')" class="btn btn-danger">🗑️</button>
          ` : ''}
        </div>
      `;
      
      list.appendChild(li);
    });
  } catch (err) {
    console.error('Load error:', err);
    list.innerHTML = '<p class="error">Erreur lors du chargement</p>';
  }
}

// Modal de partage
function openShareModal(sandboxName) {
  currentSandboxForShare = sandboxName;
  const modal = document.getElementById('shareModal');
  modal.classList.add('show');
  modal.style.display = 'flex';
  document.getElementById('shareUsername').value = '';
  document.getElementById('shareError').style.display = 'none';
  document.getElementById('shareSuccess').style.display = 'none';
}

function closeShareModal() {
  const modal = document.getElementById('shareModal');
  modal.classList.remove('show');
  modal.style.display = 'none';
  currentSandboxForShare = null;
}

// Fermer modal en cliquant en dehors
document.getElementById('shareModal').addEventListener('click', (e) => {
  if (e.target.id === 'shareModal') {
    closeShareModal();
  }
});

// Fonction pour récupérer l'email à partir du username
async function getEmailFromUsername(username) {
  try {
    // Enlever le @ si l'utilisateur l'a tapé
    const cleanUsername = username.startsWith('@') ? username.slice(1) : username;
    
    const { data, error } = await supabaseClient
      .from('profiles')
      .select('email')
      .eq('username', cleanUsername)
      .maybeSingle();

    if (error) {
      console.error('Error fetching email from username:', error);
      return null;
    }

    return data ? data.email : null;
  } catch (err) {
    console.error('Error:', err);
    return null;
  }
}

// Formulaire de partage
document.getElementById('shareForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const username = document.getElementById('shareUsername').value.trim();
  const errorDiv = document.getElementById('shareError');
  const successDiv = document.getElementById('shareSuccess');
  
  errorDiv.style.display = 'none';
  successDiv.style.display = 'none';

  try {
    // Convertir le username en email
    const email = await getEmailFromUsername(username);
    
    if (!email) {
      errorDiv.textContent = 'Utilisateur introuvable';
      errorDiv.style.display = 'block';
      return;
    }

    // Vérifier qu'on ne partage pas avec soi-même
    if (email === currentUser.email) {
      errorDiv.textContent = 'Vous ne pouvez pas partager avec vous-même';
      errorDiv.style.display = 'block';
      return;
    }

    const res = await fetch(`/api/sandboxes/${currentSandboxForShare}/share`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getAuthToken()}`
      },
      body: JSON.stringify({ email })
    });

    const data = await res.json();

    if (!res.ok) {
      errorDiv.textContent = data.error || 'Erreur lors du partage';
      errorDiv.style.display = 'block';
      return;
    }

    const displayUsername = username.startsWith('@') ? username : `@${username}`;
    successDiv.textContent = `Sandbox partagée avec ${displayUsername} !`;
    successDiv.style.display = 'block';

    setTimeout(() => {
      closeShareModal();
    }, 2000);
  } catch (err) {
    console.error('Share error:', err);
    errorDiv.textContent = 'Erreur de connexion au serveur';
    errorDiv.style.display = 'block';
  }
});

// Supprimer sandbox
async function deleteSandbox(name) {
  if (!confirm(`Êtes-vous sûr de vouloir supprimer "${name}" ?`)) {
    return;
  }

  try {
    const res = await fetch(`/api/sandboxes/${name}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${getAuthToken()}`
      }
    });

    if (!res.ok) {
      const data = await res.json();
      alert(data.error || 'Erreur lors de la suppression');
      return;
    }

    await loadSandboxes();
  } catch (err) {
    console.error('Delete error:', err);
    alert('Erreur de connexion au serveur');
  }
}
