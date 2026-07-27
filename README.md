# Zarith AI

Cliente de chat com IA powered by **Firebase + Google Gemini**.

## Stack

- **Firebase Auth** — login com e-mail + senha
- **Firestore** — banco (users, modelos, conversas, mensagens, prompt global)
- **Firebase Storage** — anexos (imagens, PDFs, arquivos)
- **Cloud Functions** — proxy seguro pra Gemini API (esconde a key no server)
- **Frontend** — HTML/CSS/JS puro, sem build step (vai pro Firebase Hosting)

## Estrutura

```
zarith-ai/
├── public/                  ← Frontend (vai pro Firebase Hosting)
│   └── index.html
├── functions/               ← Cloud Functions (Node.js 20)
│   ├── index.js             ← API completa
│   └── package.json
├── firebase.json            ← Config do Firebase
├── .firebaserc              ← Projeto default (zarith-os)
├── firestore.rules          ← Regras de segurança do Firestore
├── firestore.indexes.json   ← Índices do Firestore
└── storage.rules            ← Regras do Storage
```

## Setup (passo a passo)

### 1. Instalar Firebase CLI

```bash
npm install -g firebase-tools
firebase login
```

### 2. Configurar o secret da Gemini API

```bash
firebase functions:secrets:set GEMINI_API_KEY
# Cola a key quando pedir: AIzaSy... (a que você me passou)
```

### 3. Instalar dependências das functions

```bash
cd functions
npm install
cd ..
```

### 4. Deploy

```bash
firebase deploy
```

Isso deploya:
- ✅ Hosting (seu `index.html`)
- ✅ Cloud Functions (`api`)
- ✅ Regras do Firestore
- ✅ Regras do Storage
- ✅ Índices do Firestore

### 5. (Opcional) Tornar alguém admin

Por padrão, todo user é `isAdmin: false`. Pra ter um admin, edite no **Firebase Console → Firestore → users/{uid}** e mude o campo `isAdmin` pra `true`.

## Endpoints da API

Todos exigem header `Authorization: Bearer <firebase-id-token>`.

| Método | Path | Descrição | Quem |
|---|---|---|---|
| GET | `/api/health` | Health check | público |
| GET | `/api/whoami` | Retorna uid + admin | logado |
| POST | `/api/users/me` | Cria doc do user (auto no 1º login) | logado |
| GET | `/api/users/me` | Lê doc do user | logado |
| GET | `/api/models` | Lista modelos ativos | logado |
| POST | `/api/models` | Cria modelo | **admin** |
| PATCH | `/api/models/:id` | Edita modelo | **admin** |
| DELETE | `/api/models/:id` | Desativa modelo (soft delete) | **admin** |
| GET | `/api/prompt` | Lê prompt global | logado |
| PUT | `/api/prompt` | Atualiza prompt global | **admin** |
| POST | `/api/chat` | Chat com Gemini (streaming SSE) | logado |

## Modelo de dados (Firestore)

### `users/{uid}`
```json
{
  "email": "user@email.com",
  "name": "Nome",
  "isAdmin": false,
  "createdAt": <timestamp>
}
```

### `models/{modelId}`
```json
{
  "name": "Aurora",
  "description": "Rápida e equilibrada",
  "iconColor": "#7c5cff",
  "geminiModelId": "gemini-2.5-flash",
  "systemPrompt": "Você é uma IA...",
  "isActive": true,
  "createdBy": "<uid>",
  "createdAt": <timestamp>
}
```

### `prompts/global`
```json
{
  "text": "Você é o assistente da Zarith AI. Sempre responda em português brasileiro.",
  "updatedAt": <timestamp>,
  "updatedBy": "<uid>"
}
```

### `conversas/{conversaId}`
```json
{
  "userId": "<uid>",
  "title": "Ordenar dicionários em Python",
  "modelId": "<modelId>",
  "modelName": "Aurora",
  "createdAt": <timestamp>,
  "updatedAt": <timestamp>
}
```

### `conversas/{conversaId}/messages/{msgId}`
```json
{
  "role": "user" | "assistant",
  "content": "texto da mensagem",
  "attachments": [{ "name": "...", "size": 123, "type": "...", "isImage": false, "storageUrl": "..." }],
  "modelName": "Aurora",
  "userId": "<uid>",
  "createdAt": <timestamp>
}
```

## Próximos passos

- [ ] Montar modal de admin pra criar/editar modelos sem ir no console
- [ ] Editar prompt global pelo admin
- [ ] Exportar conversa (markdown / JSON)
- [ ] Voz (TTS + STT)
- [ ] Compartilhamento de conversa por link
- [ ] Dark/Light theme toggle
- [ ] PWA (instalável no celular)
