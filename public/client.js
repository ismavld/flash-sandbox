(async function() {
  // Protection : vérifier authentification
  const authed = await requireAuth();
  if (!authed) return;

  const token = getAuthToken();
  
  // Récupérer le nom depuis /sandbox/:name
  const pathParts = window.location.pathname.split('/');
  const sandboxName = pathParts[2];

  if (!sandboxName) {
    window.location.href = '/dashboard';
    return;
  }

  // Vérifier l'accès à cette sandbox
  try {
    const res = await fetch(`/api/sandboxes/${sandboxName}/access`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!res.ok) {
      alert('Vous n\'avez pas accès à cette sandbox');
      window.location.href = '/dashboard';
      return;
    }
  } catch (err) {
    console.error('Access check error:', err);
    alert('Erreur lors de la vérification des accès');
    window.location.href = '/dashboard';
    return;
  }

  // Mettre à jour le titre
  document.getElementById('sandboxTitle').textContent = sandboxName;
  document.title = `${sandboxName} · Flash Sandbox`;

  // Éléments DOM
  const editor = document.getElementById('editor');
  const statusEl = document.getElementById('status');
  const charCount = document.getElementById('charCount');
  const btnCopy = document.getElementById('btnCopy');
  const btnClear = document.getElementById('btnClear');

  let ws;
  let reconnectTimer;

  function updateStatus(status, text) {
    statusEl.className = `status ${status}`;
    statusEl.textContent = text;
  }

  function updateCharCount() {
    charCount.textContent = `${editor.value.length.toLocaleString()} caractères`;
  }

  function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/${sandboxName}/ws?token=${token}`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('✅ WebSocket connecté');
      updateStatus('connected', '✓ Connecté');
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'state') {
          if (editor.value !== data.content) {
            const scrollPos = editor.scrollTop;
            editor.value = data.content;
            editor.scrollTop = scrollPos;
            updateCharCount();
          }

          if (data.users) {
            updateStatus('connected', `✓ ${data.users} utilisateur${data.users > 1 ? 's' : ''}`);
          }
        } else if (data.type === 'cleared') {
          console.log(`Effacé par ${data.by}`);
        } else if (data.type === 'error') {
          alert(data.message);
        }
      } catch (err) {
        console.error('Message parse error:', err);
      }
    };

    ws.onerror = (error) => {
      console.error('❌ WebSocket error:', error);
      updateStatus('error', '× Erreur de connexion');
    };

    ws.onclose = () => {
      console.log('WebSocket fermé');
      updateStatus('connecting', 'Reconnexion...');
      
      reconnectTimer = setTimeout(() => {
        console.log('Tentative de reconnexion...');
        connectWebSocket();
      }, 2000);
    };
  }

  // Connexion initiale
  connectWebSocket();

  // Édition
  let editTimer;
  editor.addEventListener('input', () => {
    updateCharCount();
    
    if (ws && ws.readyState === WebSocket.OPEN) {
      clearTimeout(editTimer);
      editTimer = setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'edit',
          content: editor.value
        }));
      }, 300);
    }
  });

  // Copier
  btnCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(editor.value);
      btnCopy.textContent = '✓ Copié !';
      setTimeout(() => {
        btnCopy.textContent = '📋 Copier';
      }, 2000);
    } catch (err) {
      console.error('Copy failed:', err);
      alert('Erreur lors de la copie');
    }
  });

  // Effacer
  btnClear.addEventListener('click', () => {
    if (!confirm('Effacer tout le contenu ?')) return;

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'clear' }));
    }
  });

  // Cleanup
  window.addEventListener('beforeunload', () => {
    if (ws) ws.close();
  });
})();
