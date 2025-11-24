import express from "express";
import { WebSocketServer } from "ws";
import { createServer } from "http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 8080;
const TTL_SECONDS = parseInt(process.env.SANDBOX_TTL || "43200");
const MAX_CONTENT_SIZE = 256 * 1024;

// Supabase admin client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Middleware
app.use(express.json());
app.use(cookieParser());

// Store sandbox states
const sandboxes = new Map();

class Sandbox {
  constructor(id, ownerId) {
    this.id = id;
    this.ownerId = ownerId;
    this.content = "";
    this.updatedBy = "Système";
    this.updatedAt = new Date();
    this.viewers = new Set();
    this.ttlTimer = null;
    this.resetTTL();
  }

  resetTTL() {
    if (this.ttlTimer) clearTimeout(this.ttlTimer);
    this.ttlTimer = setTimeout(() => {
      console.log(`[TTL] Purge sandbox: ${this.id}`);
      this.content = "";
      this.updatedBy = "Système (purge TTL)";
      this.updatedAt = new Date();
      this.broadcast({
        type: "state",
        content: this.content,
        updatedBy: this.updatedBy,
        updatedAt: this.updatedAt,
        users: this.viewers.size,
      });
    }, TTL_SECONDS * 1000);
  }

  addViewer(ws) {
    this.viewers.add(ws);
    this.resetTTL();
  }

  removeViewer(ws) {
    this.viewers.delete(ws);
  }

  broadcast(message) {
    const payload = JSON.stringify(message);
    this.viewers.forEach((client) => {
      if (client.readyState === 1) {
        client.send(payload);
      }
    });
  }
}

function getSandbox(name, ownerId) {
  if (!sandboxes.has(name)) {
    sandboxes.set(name, new Sandbox(name, ownerId));
  }
  return sandboxes.get(name);
}

// Helper function to get username from user ID
async function getUsernameFromId(userId) {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", userId)
      .single();

    if (error || !data) {
      console.error(`[Helper] Username not found for user ${userId}`);
      return null;
    }

    return data.username;
  } catch (err) {
    console.error("[Helper] Error fetching username:", err);
    return null;
  }
}

// Auth middleware
async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Token manquant" });
  }

  const token = authHeader.substring(7);

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return res.status(401).json({ error: "Token invalide" });
    }

    req.user = data.user;
    
    // Récupérer le username
    const username = await getUsernameFromId(data.user.id);
    req.username = username;
    
    next();
  } catch (err) {
    console.error("[Auth] Error:", err);
    res.status(500).json({ error: "Erreur d'authentification" });
  }
}

// ============================================
// ROUTES HTML (avant les fichiers statiques)
// ============================================

// Route: Page d'accueil
app.get("/", (req, res) => {
  res.sendFile(join(__dirname, "public", "index.html"));
});

// Route: Login
app.get("/login", (req, res) => {
  res.sendFile(join(__dirname, "public", "login.html"));
});

// Route: Register
app.get("/register", (req, res) => {
  res.sendFile(join(__dirname, "public", "register.html"));
});

// Route: Dashboard
app.get("/dashboard", (req, res) => {
  res.sendFile(join(__dirname, "public", "dashboard.html"));
});

// Route: Sandbox (dynamique)
app.get("/sandbox/:name", (req, res) => {
  res.sendFile(join(__dirname, "public", "sandbox.html"));
});

// ============================================
// FICHIERS STATIQUES
// ============================================

app.use(express.static(join(__dirname, "public")));

// ============================================
// API ENDPOINTS
// ============================================

// Endpoint pour exposer la config publique
app.get("/api/config", (req, res) => {
  res.json({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY
  });
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    sandboxes: sandboxes.size,
    timestamp: new Date().toISOString(),
  });
});

// API: Get user's sandboxes
app.get("/api/sandboxes", verifyToken, async (req, res) => {
  try {
    const { data: owned, error: ownedError } = await supabase
      .from("sandboxes")
      .select("*")
      .eq("owner_id", req.user.id)
      .order("created_at", { ascending: false });

    if (ownedError) throw ownedError;

    const { data: shared, error: sharedError } = await supabase
      .from("sandbox_shares")
      .select(`
        sandbox_id,
        sandboxes (
          id,
          name,
          owner_id,
          created_at,
          updated_at
        )
      `)
      .eq("user_id", req.user.id);

    if (sharedError) throw sharedError;

    const sharedSandboxes = shared
      .filter((s) => s.sandboxes)
      .map((s) => ({
        ...s.sandboxes,
        shared: true,
      }));

    res.json([
      ...owned.map((s) => ({ ...s, shared: false })),
      ...sharedSandboxes,
    ]);
  } catch (err) {
    console.error("[API] Error fetching sandboxes:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// API: Create sandbox
app.post("/api/sandboxes", verifyToken, async (req, res) => {
  const { name } = req.body;

  if (!name || typeof name !== "string" || name.length < 3) {
    return res.status(400).json({ error: "Nom invalide (min 3 caractères)" });
  }

  const sanitizedName = name.trim().toLowerCase().replace(/[^a-z0-9-_]/g, "-");

  try {
    const { data, error } = await supabase
      .from("sandboxes")
      .insert({
        name: sanitizedName,
        owner_id: req.user.id,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return res.status(409).json({ error: "Ce nom existe déjà" });
      }
      throw error;
    }

    res.json(data);
  } catch (err) {
    console.error("[API] Create error:", err);
    res.status(500).json({ error: "Erreur lors de la création" });
  }
});

// API: Check sandbox access
app.get("/api/sandboxes/:name/access", verifyToken, async (req, res) => {
  const { name } = req.params;

  try {
    const { data: sandbox, error: sandboxError } = await supabase
      .from("sandboxes")
      .select("id, owner_id")
      .eq("name", name)
      .single();

    if (sandboxError || !sandbox) {
      return res.status(404).json({ error: "Sandbox introuvable" });
    }

    if (sandbox.owner_id === req.user.id) {
      return res.json({ access: true, role: "owner" });
    }

    const { data: share, error: shareError } = await supabase
      .from("sandbox_shares")
      .select("id")
      .eq("sandbox_id", sandbox.id)
      .eq("user_id", req.user.id)
      .single();

    if (shareError || !share) {
      return res.status(403).json({ error: "Accès refusé" });
    }

    res.json({ access: true, role: "viewer" });
  } catch (err) {
    console.error("[API] Access check error:", err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

// API: Share sandbox
app.post("/api/sandboxes/:name/share", verifyToken, async (req, res) => {
  const { name } = req.params;
  const { email } = req.body;

  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Email invalide" });
  }

  try {
    const { data: sandbox, error: sandboxError } = await supabase
      .from("sandboxes")
      .select("id, owner_id")
      .eq("name", name)
      .single();

    if (sandboxError || !sandbox) {
      return res.status(404).json({ error: "Sandbox introuvable" });
    }

    if (sandbox.owner_id !== req.user.id) {
      return res.status(403).json({ error: "Seul le propriétaire peut partager" });
    }

    // Rechercher l'utilisateur par email (qui provient de la conversion username -> email côté client)
    const { data: targetProfile, error: profileError } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", email.toLowerCase())
      .single();

    if (profileError || !targetProfile) {
      return res.status(404).json({ error: "Utilisateur introuvable" });
    }

    const userId = targetProfile.id;

    if (userId === req.user.id) {
      return res.status(400).json({ error: "Vous ne pouvez pas vous partager à vous-même" });
    }

    const { error: shareError } = await supabase
      .from("sandbox_shares")
      .insert({
        sandbox_id: sandbox.id,
        user_id: userId,
      });

    if (shareError) {
      if (shareError.code === "23505") {
        return res.status(409).json({ error: "Déjà partagé avec cet utilisateur" });
      }
      throw shareError;
    }

    res.json({ success: true, message: "Sandbox partagée avec succès" });
  } catch (err) {
    console.error("[API] Share error:", err);
    res.status(500).json({ error: "Erreur lors du partage" });
  }
});

// API: Delete sandbox
app.delete("/api/sandboxes/:name", verifyToken, async (req, res) => {
  const { name } = req.params;

  try {
    const { data: sandbox, error: sandboxError } = await supabase
      .from("sandboxes")
      .select("id, owner_id")
      .eq("name", name)
      .single();

    if (sandboxError || !sandbox) {
      return res.status(404).json({ error: "Sandbox introuvable" });
    }

    if (sandbox.owner_id !== req.user.id) {
      return res.status(403).json({ error: "Seul le propriétaire peut supprimer" });
    }

    const { error: deleteError } = await supabase
      .from("sandboxes")
      .delete()
      .eq("id", sandbox.id);

    if (deleteError) throw deleteError;

    if (sandboxes.has(name)) {
      const sb = sandboxes.get(name);
      if (sb.ttlTimer) clearTimeout(sb.ttlTimer);
      sb.viewers.forEach((ws) => ws.close());
      sandboxes.delete(name);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("[API] Delete error:", err);
    res.status(500).json({ error: "Erreur lors de la suppression" });
  }
});

// ============================================
// WEBSOCKET
// ============================================

const server = createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", async (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const sandboxName = url.pathname.split("/")[1];
  const token = url.searchParams.get("token");

  if (!sandboxName || !token) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const { data: sandbox, error: sandboxError } = await supabase
      .from("sandboxes")
      .select("id, owner_id")
      .eq("name", sandboxName)
      .single();

    if (sandboxError) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    const isOwner = sandbox.owner_id === data.user.id;

    if (!isOwner) {
      const { data: share } = await supabase
        .from("sandbox_shares")
        .select("id")
        .eq("sandbox_id", sandbox.id)
        .eq("user_id", data.user.id)
        .single();

      if (!share) {
        socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
        socket.destroy();
        return;
      }
    }

    // Récupérer le username
    const username = await getUsernameFromId(data.user.id);

    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.sandboxName = sandboxName;
      ws.userId = data.user.id;
      ws.userEmail = data.user.email;
      ws.username = username || data.user.email; // Fallback sur email si pas de username
      wss.emit("connection", ws, req);
    });
  } catch (err) {
    console.error("[WS] Upgrade error:", err);
    socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
    socket.destroy();
  }
});

wss.on("connection", (ws) => {
  const sandbox = getSandbox(ws.sandboxName, ws.userId);
  sandbox.addViewer(ws);

  console.log(
    `[WS] Connexion: @${ws.username} → ${ws.sandboxName} (${sandbox.viewers.size} users)`
  );

  ws.send(
    JSON.stringify({
      type: "state",
      content: sandbox.content,
      updatedBy: sandbox.updatedBy,
      updatedAt: sandbox.updatedAt,
      users: sandbox.viewers.size,
    })
  );

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data);

      if (msg.type === "edit") {
        if (msg.content.length > MAX_CONTENT_SIZE) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Contenu trop volumineux (max 256 KB)",
            })
          );
          return;
        }

        sandbox.content = msg.content;
        sandbox.updatedBy = `@${ws.username}`;
        sandbox.updatedAt = new Date();

        sandbox.broadcast({
          type: "state",
          content: sandbox.content,
          updatedBy: sandbox.updatedBy,
          updatedAt: sandbox.updatedAt,
          users: sandbox.viewers.size,
        });

        sandbox.resetTTL();
      } else if (msg.type === "clear") {
        sandbox.content = "";
        sandbox.updatedBy = `@${ws.username}`;
        sandbox.updatedAt = new Date();

        sandbox.broadcast({
          type: "state",
          content: "",
          updatedBy: sandbox.updatedBy,
          updatedAt: sandbox.updatedAt,
          users: sandbox.viewers.size,
        });

        sandbox.broadcast({
          type: "cleared",
          by: `@${ws.username}`,
          at: sandbox.updatedAt,
        });

        sandbox.resetTTL();
      }
    } catch (err) {
      console.error("[WS] Message error:", err);
    }
  });

  ws.on("close", () => {
    sandbox.removeViewer(ws);
    console.log(
      `[WS] Déconnexion: @${ws.username} (${sandbox.viewers.size} restants)`
    );

    sandbox.broadcast({
      type: "presence",
      users: sandbox.viewers.size,
    });

    if (sandbox.viewers.size === 0) {
      console.log(`[Sandbox] Plus d'utilisateurs sur ${ws.sandboxName}`);
    }
  });

  ws.on("error", (err) => {
    console.error("[WS] Error:", err);
  });
});

// Start server
server.listen(port, () => {
  console.log(`
╔═══════════════════════════════════════╗
║   🚀 Flash Sandbox Server Running    ║
╠═══════════════════════════════════════╣
║  Port: ${port.toString().padEnd(31)} ║
║  TTL:  ${(TTL_SECONDS + "s (" + (TTL_SECONDS / 3600).toFixed(1) + "h)").padEnd(31)} ║
║  URL:  http://localhost:${port.toString().padEnd(18)} ║
╚═══════════════════════════════════════╝
  `);
});
