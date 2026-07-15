#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: >
  Evolve the single-player wave shooter into real-time multiplayer by adding an
  authoritative game server next to the existing FastAPI backend (as recommended
  in the strategic plan), rather than rewriting in a native engine. Implemented
  drop-in PvE co-op: several warriors fight the same enemy waves together, with
  the server owning all game state.

backend:
  - task: "Authoritative real-time co-op WebSocket server"
    implemented: true
    working: true
    file: "backend/realtime.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        -working: true
        -agent: "main"
        -comment: >
          New authoritative room server running a fixed 20Hz simulation.
          WebSocket endpoint /api/ws/battle. Handles matchmaking (drop-in join
          of an open room per map, max 4 players), server-side movement, auto/aim
          firing with weapon cooldowns, all 4 hero abilities, enemy waves, bullets,
          drops, revive-on-wave, and victory/defeat resolution. Match rewards are
          persisted authoritatively via server.apply_match_rewards. Verified with
          18 unit + WebSocket integration tests and a live 2-client sync test.
  - task: "Shared game config extraction"
    implemented: true
    working: true
    file: "backend/game_config.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
        -working: true
        -agent: "main"
        -comment: >
          Heroes/weapons/maps/catalog moved to game_config.py (SSOT) so the REST
          API and realtime server share one source. server.py refactored to import
          from it; existing REST tests still pass (no behavior change).

frontend:
  - task: "Real-time client + co-op battle screen"
    implemented: true
    working: "NA"
    file: "frontend/app/coop.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
        -working: "NA"
        -agent: "main"
        -comment: >
          Added src/game/realtime.ts (typed WebSocket client + arena->screen
          scaling) and app/coop.tsx which connects, streams joystick/ability input
          and renders the server's authoritative snapshots (self + allies, enemies,
          bullets, drops, kill feed, wave/HP/players HUD). Lobby has a new
          "CO-OP BATTLE" entry (testID lobby-coop-btn). Passes tsc + expo lint.
          Needs on-device/browser UI verification (not runnable in this sandbox).

metadata:
  created_by: "main_agent"
  version: "1.1"
  test_sequence: 1
  run_ui: false

test_plan:
  current_focus:
    - "Real-time client + co-op battle screen"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
    -agent: "main"
    -message: >
      Implemented authoritative co-op multiplayer (backend + frontend). Backend
      is fully tested (backend/tests/test_realtime.py: 18 passing). Frontend
      co-op screen compiles/lints cleanly but needs a real device/browser run to
      confirm rendering and input feel. Note: 4 pre-existing failures in
      test_dharma_battle.py (TestShop) are unrelated to this change — they expect
      an item_type="coins" /shop/purchase path the server intentionally routes
      through Stripe now.