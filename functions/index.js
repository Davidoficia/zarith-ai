/**
 * Zarith AI — Cloud Functions
 *
 * Endpoints:
 *   POST /api/chat              → chat com Gemini (streaming SSE)
 *   GET  /api/models            → lista modelos custom ativos
 *   POST /api/models            → admin cria modelo
 *   PATCH /api/models/:id       → admin atualiza modelo
 *   DELETE /api/models/:id      → admin desativa modelo
 *   GET  /api/prompt            → retorna prompt global
 *   PUT  /api/prompt            → admin atualiza prompt global
 *   POST /api/users/me          → cria doc do user no Firestore no primeiro login
 *   GET  /api/users/me          → retorna dados do user logado
 *   POST /api/whoami            → debug: retorna uid + admin
 */

const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Carrega .env em dev local; em prod (Cloud Functions) o .env não existe e o
// GEMINI_API_KEY precisa estar configurado via `firebase functions:config:set`
// ou Runtime Env. O fallback seguro é process.env.GEMINI_API_KEY.
try { require("dotenv").config(); } catch (e) {}

admin.initializeApp();
const db = admin.firestore();

// Gemini key via env var
const GEMINI_API_KEY_VALUE = process.env.GEMINI_API_KEY || "";

// ============ AUTH MIDDLEWARE ============

async function getAuthUser(req) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return null;
  try {
    const decoded = await admin.auth().verifyIdToken(match[1]);
    return decoded;
  } catch (e) {
    console.error("Token inválido:", e.message);
    return null;
  }
}

async function getUserDoc(uid) {
  const ref = db.collection("users").doc(uid);
  const snap = await ref.get();
  return snap.exists ? { ref, data: snap.data() } : { ref, data: null };
}

async function isAdminUser(uid) {
  const { data } = await getUserDoc(uid);
  return data?.isAdmin === true;
}

// ============ API ============

const api = onRequest(
  {
    region: "southamerica-east1",
    cors: true,
    timeoutSeconds: 120,
    memory: "512MiB",
  },
  async (req, res) => {
    const path = req.path.replace(/^\/+/, "").replace(/\/+$/, "");
    const parts = path.split("/");

    try {
      // ==== HEALTH ====
      if (req.method === "GET" && path === "health") {
        return res.json({ ok: true, ts: Date.now() });
      }

      // ==== WHOAMI ====
      if (req.method === "GET" && path === "whoami") {
        const u = await getAuthUser(req);
        if (!u) return res.status(401).json({ error: "Não autenticado" });
        const { data } = await getUserDoc(u.uid);
        return res.json({
          uid: u.uid,
          email: u.email,
          name: u.name,
          isAdmin: data?.isAdmin === true,
        });
      }

      // ==== USER: criar doc no primeiro login ====
      if (req.method === "POST" && path === "users/me") {
        const u = await getAuthUser(req);
        if (!u) return res.status(401).json({ error: "Não autenticado" });
        const { ref, data } = await getUserDoc(u.uid);
        if (!data) {
          await ref.set({
            email: u.email || "",
            name: u.name || u.email?.split("@")[0] || "Usuário",
            isAdmin: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
        const fresh = await ref.get();
        return res.json({ uid: u.uid, ...fresh.data() });
      }

      // ==== USER: ler ====
      if (req.method === "GET" && path === "users/me") {
        const u = await getAuthUser(req);
        if (!u) return res.status(401).json({ error: "Não autenticado" });
        const { data } = await getUserDoc(u.uid);
        if (!data) return res.status(404).json({ error: "Doc não encontrado" });
        return res.json({ uid: u.uid, ...data });
      }

      // ==== MODELS: listar ====
      if (req.method === "GET" && path === "models") {
        const u = await getAuthUser(req);
        if (!u) return res.status(401).json({ error: "Não autenticado" });
        const snap = await db
          .collection("models")
          .where("isActive", "==", true)
          .orderBy("createdAt", "asc")
          .get();
        const models = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        return res.json({ models });
      }

      // ==== MODELS: criar ====
      if (req.method === "POST" && path === "models") {
        const u = await getAuthUser(req);
        if (!u) return res.status(401).json({ error: "Não autenticado" });
        if (!(await isAdminUser(u.uid))) {
          return res.status(403).json({ error: "Apenas admin pode criar modelos" });
        }
        const { name, description, iconColor, geminiModelId, systemPrompt } = req.body || {};
        if (!name || !geminiModelId) {
          return res.status(400).json({ error: "name e geminiModelId são obrigatórios" });
        }
        const ref = await db.collection("models").add({
          name: String(name).slice(0, 60),
          description: String(description || "").slice(0, 200),
          iconColor: iconColor || "#7c5cff",
          geminiModelId,
          systemPrompt: String(systemPrompt || "").slice(0, 4000),
          isActive: true,
          createdBy: u.uid,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        const snap = await ref.get();
        return res.json({ id: ref.id, ...snap.data() });
      }

      // ==== MODELS: atualizar / desativar ====
      if (req.method === "PATCH" && parts[0] === "models" && parts[1]) {
        const u = await getAuthUser(req);
        if (!u) return res.status(401).json({ error: "Não autenticado" });
        if (!(await isAdminUser(u.uid))) {
          return res.status(403).json({ error: "Apenas admin pode editar" });
        }
        const ref = db.collection("models").doc(parts[1]);
        const update = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
        const allowed = ["name", "description", "iconColor", "geminiModelId", "systemPrompt", "isActive"];
        for (const k of allowed) {
          if (req.body && k in req.body) update[k] = req.body[k];
        }
        await ref.update(update);
        const snap = await ref.get();
        return res.json({ id: ref.id, ...snap.data() });
      }

      if (req.method === "DELETE" && parts[0] === "models" && parts[1]) {
        const u = await getAuthUser(req);
        if (!u) return res.status(401).json({ error: "Não autenticado" });
        if (!(await isAdminUser(u.uid))) {
          return res.status(403).json({ error: "Apenas admin pode deletar" });
        }
        // soft delete: só desativa
        await db.collection("models").doc(parts[1]).update({
          isActive: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return res.json({ ok: true });
      }

      // ==== PROMPT GLOBAL: ler ====
      if (req.method === "GET" && path === "prompt") {
        const u = await getAuthUser(req);
        if (!u) return res.status(401).json({ error: "Não autenticado" });
        const ref = db.collection("prompts").doc("global");
        const snap = await ref.get();
        return res.json(snap.exists ? snap.data() : { text: "" });
      }

      // ==== PROMPT GLOBAL: atualizar ====
      if (req.method === "PUT" && path === "prompt") {
        const u = await getAuthUser(req);
        if (!u) return res.status(401).json({ error: "Não autenticado" });
        if (!(await isAdminUser(u.uid))) {
          return res.status(403).json({ error: "Apenas admin pode editar" });
        }
        const text = String(req.body?.text || "").slice(0, 8000);
        await db.collection("prompts").doc("global").set(
          {
            text,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedBy: u.uid,
          },
          { merge: true }
        );
        return res.json({ ok: true });
      }

      // ==== CHAT (streaming SSE) ====
      if (req.method === "POST" && path === "chat") {
        const u = await getAuthUser(req);
        if (!u) return res.status(401).json({ error: "Não autenticado" });

        const { message, modelId, conversaId, history, attachments } = req.body || {};
        if (!message && (!attachments || attachments.length === 0)) {
          return res.status(400).json({ error: "Mensagem vazia" });
        }

        // 1. Buscar modelo escolhido (ou usar default)
        let modelDoc;
        if (modelId) {
          const snap = await db.collection("models").doc(modelId).get();
          if (snap.exists && snap.data().isActive) modelDoc = snap.data();
        }
        if (!modelDoc) {
          // fallback: primeiro modelo ativo
          const snap = await db
            .collection("models")
            .where("isActive", "==", true)
            .limit(1)
            .get();
          if (snap.empty) {
            return res.status(503).json({ error: "Nenhum modelo disponível" });
          }
          modelDoc = snap.docs[0].data();
        }

        // 2. Buscar prompt global
        const promptSnap = await db.collection("prompts").doc("global").get();
        const globalPrompt = promptSnap.exists ? promptSnap.data().text || "" : "";

        // 3. Montar system prompt final
        const systemParts = [];
        if (globalPrompt) systemParts.push(globalPrompt);
        if (modelDoc.systemPrompt) systemParts.push(modelDoc.systemPrompt);
        const systemPrompt = systemParts.join("\n\n").trim();

        // 4. Montar histórico (formato Gemini: {role, parts: [{text}]})
        const geminiHistory = (history || []).map((m) => ({
          role: m.role === "user" ? "user" : "model",
          parts: [{ text: m.content || "" }],
        }));

        // 5. Montar mensagem atual com anexos
        const currentParts = [];
        if (message) currentParts.push({ text: message });
        if (attachments && attachments.length > 0) {
          for (const a of attachments) {
            if (a.inlineData) {
              currentParts.push({
                inlineData: {
                  mimeType: a.mimeType || "image/png",
                  data: a.inlineData,
                },
              });
            } else if (a.fileUri) {
              currentParts.push({
                fileData: { mimeType: a.mimeType, fileUri: a.fileUri },
              });
            }
          }
        }

        // 6. Chamar Gemini com streaming
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY_VALUE);
        const genModel = genAI.getGenerativeModel({
          model: modelDoc.geminiModelId,
          systemInstruction: systemPrompt || undefined,
        });

        const chat = genModel.startChat({ history: geminiHistory });
        const result = await chat.sendMessageStream(currentParts);

        // 7. Responder com Server-Sent Events
        res.set({
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        });
        res.flushHeaders();

        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) {
            res.write(`data: ${JSON.stringify({ text })}\n\n`);
          }
        }
        res.write(`data: ${JSON.stringify({ done: true, conversaId })}\n\n`);
        res.end();
        return;
      }

      // ==== 404 ====
      return res.status(404).json({ error: "Endpoint não encontrado", path });
    } catch (err) {
      console.error("Erro:", err);
      // se headers ja foram enviados (stream), so encerra
      if (res.headersSent) {
        res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
        res.end();
        return;
      }
      return res.status(500).json({ error: err.message || "Erro interno" });
    }
  }
);

module.exports = { api };
