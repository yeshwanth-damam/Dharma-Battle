# Dharma Battle

2D mythology wave shooter — Expo (full UI) + FastAPI backend + Unity prototype.

## Play the Expo game (Windows)

### 1. Frontend env

```cmd
cd D:\Dharma-Battle\frontend
copy env.example .env
```

`.env` is optional in dev — the app defaults to `http://localhost:8001`. Override with:

```
EXPO_PUBLIC_BACKEND_URL=http://localhost:8001
```

Restart Expo after creating or changing `.env`.

### 2. Backend env + start API

```cmd
cd D:\Dharma-Battle\backend
copy env.example .env
pip install fastapi uvicorn motor pymongo python-dotenv httpx pydantic
set PYTHONPATH=D:\Dharma-Battle\backend
python -m uvicorn server:app --host 0.0.0.0 --port 8001
```

With `DEV_MODE=true` in `backend/.env`, the API uses an **in-memory database** — no MongoDB install required for local play.

For production-like persistence, set `DEV_MODE=false` and run MongoDB on `127.0.0.1:27017`.

### 3. Start Expo (separate CMD window)

```cmd
cd D:\Dharma-Battle\frontend
npm install
npx expo start --web
```

Open `http://localhost:8081`, enter a warrior name, and click **BEGIN QUEST**.

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Unexpected token '<'` / HTML instead of JSON | Backend not running on port 8001, or missing `frontend/.env` |
| `Backend URL not set` | Only in production builds — set `EXPO_PUBLIC_BACKEND_URL` in `frontend/.env` |
| `Cannot reach backend` | Start uvicorn in `backend/` (see step 2) |
| npm `preinstall` fails in Git Bash | Use **CMD** or run `npm install` from CMD |

## Unity prototype

See [unity/README.md](unity/README.md) for the C# battle prototype and editor setup wizard.
