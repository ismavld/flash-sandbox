# ⚡ Flash Sandbox v2.0

Éditeur de texte partagé en temps réel avec authentification Supabase.

## 🚀 Fonctionnalités

- ✅ Authentification utilisateur (Supabase Auth)
- ✅ Création de sandboxes personnelles
- ✅ Partage de sandboxes avec d'autres utilisateurs
- ✅ Synchronisation temps réel (WebSocket)
- ✅ Gestion des permissions (propriétaire/invité)
- ✅ Purge automatique après 12h d'inactivité
- ✅ Interface responsive et moderne
- ✅ Protection des clés API côté serveur

## 📋 Prérequis

1. **Compte Supabase** : https://supabase.com
2. **Docker & Docker Compose** (recommandé)
3. **Node.js 20+** (pour développement local)

## 🔧 Configuration Supabase

### 1. Créer un projet Supabase

Allez sur [supabase.com](https://supabase.com) et créez un nouveau projet.

### 2. Créer les tables SQL

Dans l'éditeur SQL de Supabase, exécutez :

```sql
-- Table des sandboxes
CREATE TABLE sandboxes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour les recherches
CREATE INDEX idx_sandboxes_owner ON sandboxes(owner_id);
CREATE INDEX idx_sandboxes_name ON sandboxes(name);

-- Table des partages
CREATE TABLE sandbox_shares (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sandbox_id UUID NOT NULL REFERENCES sandboxes(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shared_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sandbox_id, user_id)
);

-- Index pour les partages
CREATE INDEX idx_shares_sandbox ON sandbox_shares(sandbox_id);
CREATE INDEX idx_shares_user ON sandbox_shares(user_id);

-- RLS (Row Level Security)
ALTER TABLE sandboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandbox_shares ENABLE ROW LEVEL SECURITY;

-- Policies pour sandboxes
CREATE POLICY "Users can view their own sandboxes"
  ON sandboxes FOR SELECT
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can create sandboxes"
  ON sandboxes FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own sandboxes"
  ON sandboxes FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "Users can delete their own sandboxes"
  ON sandboxes FOR DELETE
  USING (auth.uid() = owner_id);

-- Policies pour sandbox_shares
CREATE POLICY "Users can view shares for their sandboxes"
  ON sandbox_shares FOR SELECT
  USING (
    auth.uid() IN (
      SELECT owner_id FROM sandboxes WHERE id = sandbox_id
    )
    OR auth.uid() = user_id
  );

CREATE POLICY "Owners can create shares"
  ON sandbox_shares FOR INSERT
  WITH CHECK (
    auth.uid() IN (
      SELECT owner_id FROM sandboxes WHERE id = sandbox_id
    )
  );

CREATE POLICY "Owners can delete shares"
  ON sandbox_shares FOR DELETE
  USING (
    auth.uid() IN (
      SELECT owner_id FROM sandboxes WHERE id = sandbox_id
    )
  );

-- Fonction pour récupérer un utilisateur par email (nécessaire pour le partage)
CREATE OR REPLACE FUNCTION get_user_by_email(email_param TEXT)
RETURNS TABLE (id UUID, email TEXT) 
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT au.id, au.email::TEXT
  FROM auth.users au
  WHERE au.email = email_param;
END;
$$;
