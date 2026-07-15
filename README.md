# Dharma Battle

A 2D, top-down single-player arena shooter built with Expo React Native,
FastAPI, and MongoDB.

## Browser controls

- Move: `WASD` or arrow keys
- Fire: click/tap inside the arena (the nearest enemy is also targeted automatically)
- Hero ability: `Space`
- Pause: `Esc`

Touch devices retain the virtual joystick and on-screen ability control.

## Run locally

The backend expects these environment variables in `backend/.env`:

```dotenv
MONGO_URL=mongodb://localhost:27017
DB_NAME=dharma_battle
STRIPE_API_KEY=your_test_key
EMERGENT_AUTH_URL=https://your-auth-service.example
GAME_URL=http://localhost:8081
```

Start the API:

```bash
python -m pip install -r backend/requirements.txt
uvicorn backend.server:app --host 0.0.0.0 --port 8001
```

Set the frontend API URL, install its packages, and start Expo web:

```bash
cd frontend
export EXPO_PUBLIC_BACKEND_URL=http://localhost:8001
yarn install
yarn web
```

Open the URL printed by Expo. MongoDB must be running before creating a
player.