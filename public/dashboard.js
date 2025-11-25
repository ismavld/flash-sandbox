let supabaseClient;
let currentUser = null;
let currentUserProfile = null;
let currentSandboxForShare = null;
let autocompleteCache = []; // Cache pour les résultats
let selectedAutocompleteIndex = -1;

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

// Fonction pour rechercher les utilisateurs par username
async function searchUsers(query) {
  try {
    // Enlever le @ si présent
    const cleanQuery = query.startsWith('@') ? query.slice(1) : query;

    if (cleanQuery.length < 2) {
      return [];
    }

    const { data, error } = await supabaseClient
      .from('profiles')
      .select('username, email, id')
      .ilike('username', `%${cleanQuery}%`)
      .neq('id', currentUser.id) // Exclure l'utilisateur actuel
      .limit(10);

    if (error) {
      console.error('Error searching users:', error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error('Error:', err);
    return [];
  }
}

// Afficher les suggestions d'autocomplétion
function showAutocomplete(users) {
  const list = document.getElementById('autocompleteList');
  selectedAutocompleteIndex = -1;

  if (users.length === 0) {
    list.innerHTML = '<div class="autocomplete-empty">Aucun utilisateur trouvé</div>';
    list.classList.add('show');
    return;
  }

  list.innerHTML = users.map((user, index) => `
    <div class="autocomplete-item" data-index="${index}" data-username="${user.username}" data-email="${user.email}">
      <span class="username">@${user.username}</span>
      <span class="email">${user.email}</span>
    </div>
  `).join('');

  list.classList.add('show');

  // Ajouter les event listeners sur chaque item
  list.querySelectorAll('.autocomplete-item').forEach(item => {
    item.addEventListener('click', () => {
      selectAutocompleteItem(item.dataset.username);
    });
  });
}

// Cacher l'autocomplétion
function hideAutocomplete() {
  const list = document.getElementById('autocompleteList');
  list.classList.remove('show');
  list.innerHTML = '';
  selectedAutocompleteIndex = -1;
}

// Sélectionner un item
function selectAutocompleteItem(username) {
  const input = document.getElementById('shareUsername');
  input.value = username;
  hideAutocomplete();
  input.focus();
}

// Navigation au clavier dans l'autocomplétion
function handleAutocompleteKeyboard(e) {
  const list = document.getElementById('autocompleteList');
  const items = list.querySelectorAll('.autocomplete-item');

  if (items.length === 0) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    selectedAutocompleteIndex = Math.min(selectedAutocompleteIndex + 1, items.length - 1);
    updateAutocompleteSelection(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    selectedAutocompleteIndex = Math.max(selectedAutocompleteIndex - 1, -1);
    updateAutocompleteSelection(items);
  } else if (e.key === 'Enter' && selectedAutocompleteIndex >= 0) {
    e.preventDefault();
    const selectedItem = items[selectedAutocompleteIndex];
    selectAutocompleteItem(selectedItem.dataset.username);
  } else if (e.key === 'Escape') {
    hideAutocomplete();
  }
}

// Mettre à jour la sélection visuelle
function updateAutocompleteSelection(items) {
  items.forEach((item, index) => {
    if (index === selectedAutocompleteIndex) {
      item.classList.add('selected');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('selected');
    }
  });
}

// Modal de partage
function openShareModal(sandboxName) {
  currentSandboxForShare = sandboxName;
  const modal = document.getElementById('shareModal');
  modal.classList.add('show');
  modal.style.display = 'flex';
  
  const input = document.getElementById('shareUsername');
  input.value = '';
  hideAutocomplete();
  
  document.getElementById('shareError').style.display = 'none';
  document.getElementById('shareSuccess').style.display = 'none';

  // Focus sur l'input après un court délai
  setTimeout(() => input.focus(), 100);
}

function closeShareModal() {
  const modal = document.getElementById('shareModal');
  modal.classList.remove('show');
  modal.style.display = 'none';
  currentSandboxForShare = null;
  hideAutocomplete();
}

// Fermer modal en cliquant en dehors
document.getElementById('shareModal').addEventListener('click', (e) => {
  if (e.target.id === 'shareModal') {
    closeShareModal();
  }
});

// Autocomplétion sur l'input username
const shareUsernameInput = document.getElementById('shareUsername');
let autocompleteTimeout = null;

shareUsernameInput.addEventListener('input', async (e) => {
  const query = e.target.value.trim();

  // Annuler la recherche précédente
  if (autocompleteTimeout) {
    clearTimeout(autocompleteTimeout);
  }

  if (query.length < 2) {
    hideAutocomplete();
    return;
  }

  // Afficher "Recherche..."
  const list = document.getElementById('autocompleteList');
  list.innerHTML = '<div class="autocomplete-loading">Recherche...</div>';
  list.classList.add('show');

  // Debounce: attendre 300ms avant de rechercher
  autocompleteTimeout = setTimeout(async () => {
    const users = await searchUsers(query);
    autocompleteCache = users;
    showAutocomplete(users);
  }, 300);
});

// Navigation au clavier
shareUsernameInput.addEventListener('keydown', handleAutocompleteKeyboard);

// Cacher l'autocomplétion quand on clique ailleurs
document.addEventListener('click', (e) => {
  if (!e.target.closest('.autocomplete-container')) {
    hideAutocomplete();
  }
});

// Fonction pour récupérer l'email à partir du username
async function getEmailFromUsername(username) {
  try {
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
  hideAutocomplete();

  try {
    const email = await getEmailFromUsername(username);

    if (!email) {
      errorDiv.textContent = 'Utilisateur introuvable';
      errorDiv.style.display = 'block';
      return;
    }

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
