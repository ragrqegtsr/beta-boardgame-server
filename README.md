# Serveur bêta (Node + Socket.IO)

## Lancer localement
```bash
npm i
npm run dev
# PORT=3000 par défaut
```
Puis ping:
```
curl http://localhost:3000/health
```

## Endpoints
- `GET /health` → 200
- `POST /session` body `{ "lang":"fr", "mode":"long|blitz" }` → `{ code }`
- `POST /session/:code/join` body `{ "profile": {id,key,name} }` (optionnel) → `{ playerId, profile }`
- `GET /session/:code/state?role=host`
- `GET /session/:code/state?role=player&playerId=...`

## WebSocket (path: `/ws`)
- Client → `JOIN_SESSION` `{ code }`
- Host → `HOST_START`, `HOST_NEXT_TURN`, `HOST_KICK {code,playerId}`, `HOST_CORRECT_ACTION {code,actionId,patch}`
- Player → `PLAYER_READY {code,playerId}`, `PLAYER_DECIDE_EVENT {code,playerId,decision: 'accept'|'reject'}`, `PLAYER_LOCK {code,playerId}`

### Server broadcast
- `SESSION_UPDATED`, `TURN_STARTED`, `TIMER_TICK`, `TURN_ENDED`, `MIDGAME_BREAK`

## Rythme de jeu
- Tours: **42** (long) / **10** (blitz)
- **Host manuel**: tours 1–5 et derniers 5 tours
- **Autonomie**: le reste → timer **3:00 + rappel + 1:00**,
  avance auto si tout le monde est **ready** ou timer expiré
- **Mid-game break**: tour **21** (long) / **6** (blitz)

## Déploiement (Render)
- Connecte le repo GitHub, auto-build via `render.yaml` fourni.
- Var env utiles: `CORS_ORIGINS` (CSV des domaines), `DATA_DIR` (par défaut `data`).

## Notes
- Données en mémoire (pas de persistance). Purge 60s après fin de partie.
