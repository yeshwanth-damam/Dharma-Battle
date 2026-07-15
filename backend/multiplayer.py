"""Real-time co-op multiplayer: REST room management + authoritative
WebSocket game loop, wired on top of `game_rooms.py`.

`create_multiplayer_router(db)` builds a self-contained APIRouter (no import
of server.py / Stripe / emergentintegrations), so it can be mounted into the
main app and, separately, into a minimal test app.
"""
import asyncio
import logging

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from game_rooms import Room, RoomManager, TICK_DT
from rewards import apply_match_result, fetch_player

logger = logging.getLogger(__name__)

# Grace period the room stays around (broadcasting the final snapshot / ack)
# after the match ends, before it's evicted from memory.
POST_MATCH_LINGER_SECONDS = 8.0


class CreateRoomRequest(BaseModel):
    player_id: str
    map_id: str = "kurukshetra"
    max_players: int = 4


class JoinRoomRequest(BaseModel):
    player_id: str


class LeaveRoomRequest(BaseModel):
    player_id: str


class StartRoomRequest(BaseModel):
    player_id: str


class ConnectionManager:
    """Tracks live WebSocket connections per room code."""

    def __init__(self):
        self._conns: dict[str, dict[str, WebSocket]] = {}

    def register(self, code: str, player_id: str, ws: WebSocket) -> None:
        self._conns.setdefault(code, {})[player_id] = ws

    def unregister(self, code: str, player_id: str) -> None:
        room_conns = self._conns.get(code)
        if room_conns:
            room_conns.pop(player_id, None)
            if not room_conns:
                self._conns.pop(code, None)

    async def broadcast(self, code: str, message: dict) -> None:
        room_conns = self._conns.get(code)
        if not room_conns:
            return
        dead = []
        for player_id, ws in list(room_conns.items()):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(player_id)
        for player_id in dead:
            self.unregister(code, player_id)


def create_multiplayer_router(db) -> APIRouter:
    router = APIRouter()
    rooms = RoomManager()
    manager = ConnectionManager()

    async def _run_room_loop(room: Room) -> None:
        try:
            while room.state in ("countdown", "playing"):
                room.step(TICK_DT)
                await manager.broadcast(room.code, room.snapshot())
                await asyncio.sleep(TICK_DT)

            if room.state == "finished" and not room.rewards_granted:
                room.rewards_granted = True
                for res in room.match_results():
                    try:
                        await apply_match_result(
                            db, res["player_id"], res["kills"], res["survived_seconds"], res["victory"],
                        )
                    except Exception:
                        logger.exception("Failed to persist co-op reward for %s", res["player_id"])
                await manager.broadcast(room.code, room.snapshot())
        finally:
            await asyncio.sleep(POST_MATCH_LINGER_SECONDS)
            rooms.remove(room.code)

    @router.post("/multiplayer/rooms")
    async def create_room(req: CreateRoomRequest):
        doc = await fetch_player(db, req.player_id)
        room = rooms.create_room(host_id=req.player_id, map_id=req.map_id, max_players=req.max_players)
        room.add_player(
            req.player_id, doc.get("name", "Warrior"),
            doc.get("selected_hero", "arjuna"), doc.get("selected_weapon", "brahmastra"),
        )
        return room.lobby_summary()

    @router.get("/multiplayer/rooms")
    async def list_rooms():
        return [r.lobby_summary() for r in rooms.list_open()]

    @router.get("/multiplayer/rooms/{code}")
    async def get_room(code: str):
        room = rooms.get(code)
        if not room:
            raise HTTPException(404, "Room not found")
        return room.lobby_summary()

    @router.post("/multiplayer/rooms/{code}/join")
    async def join_room(code: str, req: JoinRoomRequest):
        room = rooms.get(code)
        if not room:
            raise HTTPException(404, "Room not found")
        doc = await fetch_player(db, req.player_id)
        try:
            room.add_player(
                req.player_id, doc.get("name", "Warrior"),
                doc.get("selected_hero", "arjuna"), doc.get("selected_weapon", "brahmastra"),
            )
        except ValueError as e:
            raise HTTPException(400, str(e))
        await manager.broadcast(room.code, {"type": "lobby", **room.lobby_summary()})
        return room.lobby_summary()

    @router.post("/multiplayer/rooms/{code}/leave")
    async def leave_room(code: str, req: LeaveRoomRequest):
        room = rooms.get(code)
        if room:
            room.remove_player(req.player_id)
            if room.is_empty():
                rooms.remove(code)
            else:
                await manager.broadcast(room.code, {"type": "lobby", **room.lobby_summary()})
        return {"ok": True}

    @router.post("/multiplayer/rooms/{code}/start")
    async def start_room(code: str, req: StartRoomRequest):
        room = rooms.get(code)
        if not room:
            raise HTTPException(404, "Room not found")
        try:
            room.start(req.player_id)
        except ValueError as e:
            raise HTTPException(400, str(e))
        await manager.broadcast(room.code, {"type": "lobby", **room.lobby_summary()})
        asyncio.create_task(_run_room_loop(room))
        return room.lobby_summary()

    @router.websocket("/ws/room/{code}")
    async def room_socket(ws: WebSocket, code: str, player_id: str):
        room = rooms.get(code)
        if not room or player_id not in room.players:
            await ws.close(code=4404)
            return

        await ws.accept()
        manager.register(room.code, player_id, ws)
        room.set_connected(player_id, True)
        await ws.send_json(room.snapshot())
        await manager.broadcast(room.code, {"type": "lobby", **room.lobby_summary()})

        try:
            while True:
                data = await ws.receive_json()
                if data.get("type") == "input":
                    room.apply_input(
                        player_id,
                        joystick=data.get("joystick"),
                        fire=data.get("fire"),
                        ability=bool(data.get("ability")),
                    )
        except WebSocketDisconnect:
            pass
        except Exception:
            logger.exception("WS error in room %s for player %s", code, player_id)
        finally:
            manager.unregister(room.code, player_id)
            room.set_connected(player_id, False)
            if room.state == "waiting":
                room.remove_player(player_id)
                if room.is_empty():
                    rooms.remove(room.code)
                else:
                    await manager.broadcast(room.code, {"type": "lobby", **room.lobby_summary()})
            else:
                await manager.broadcast(room.code, {"type": "lobby", **room.lobby_summary()})

    return router
