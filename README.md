# RPS Battle: God Mode ⚔️

**RPS Battle: God Mode** is a highly complex, real-time multiplayer implementation of Rock, Paper, Scissors, built with Node.js, Express, and Socket.IO. It transforms the classic hand game into a strategic fighting game featuring HP bars, elemental matchups, and unpredictable "Gambit" power-ups.

## 🚀 Live Demo & How to Play

The game is currently deployed and live on Render.

**Live URL:** `https://rps-battle.onrender.com/`

### Multiplayer Setup (The intended experience)

1.  Open the **Live URL** on your device.
2.  Share the **exact same URL** with a friend.
3.  Both players select their **Element** on the Setup page.
4.  **Player 1 (Host):** Clicks **Multiplayer** then **Create Room**. A 6-digit Room ID will appear.
5.  **Player 2 (Joiner):** Enters the 6-digit Room ID and clicks **Join Room**.
6.  The battle begins simultaneously!

---

## 💡 Core Mechanics (God Mode Rules)

This is not standard RPS. Success relies on understanding the complex modifiers and being able to quickly adapt.

### 1. The Unknown Elemental Triangle (🔥💧🌿)

The elemental weakness cycle is **randomly shuffled and hidden** at the start of every match. You must discover the current winning relationship through observation and deduction.

| Outcome | RPS Result + Element Result | HP Swing (Base) | Special Boost/Penalty | Streak Status |
| :--- | :--- | :--- | :--- | :--- |
| **CRITICAL HIT!** | Win + Element Win | 1.5x (Winner gains/Loser loses) | Winner: **Double Boost** | Builds Streak |
| **NORMAL HIT** | Win + Element Tie | 1.0x (Winner gains/Loser loses) | Builds Streak | Builds Streak |
| **DAMPENED HIT** | Win + Element Lose | **0.5x** (Winner gains/Loser loses) | Winner: **Half Boost** | **Streak Broken** |
| **RESISTED HIT** | Lose + Element Win | **0.5x** (Loser takes/Winner gains) | Loser: **Half Penalty** | Builds Loss Streak |
| **PUNISHING HIT!** | Lose + Element Lose | **1.5x** (Loser takes/Winner gains) | Loser: **Double Penalty** | Builds Loss Streak |

### 2. Clash Mechanic

A standard RPS tie (Rock vs Rock, etc.) triggers a **CLASH!** The *next* round's HP swing and Special meter changes are **doubled**. This multiplier increases with consecutive Clashes!

### 3. Secret Dual-Effect Gambits (Cost: 100 Special)

When your meter is full, you can use a Gambit. The selected move (Rock, Paper, or Scissors) is randomly assigned one of these three devastating powers, affecting **both** players:

| Gambit Name | Type | User Effect | Opponent Effect |
| :--- | :--- | :--- | :--- |
| **Sacrifice** | Aggressive | **-25 HP**, **+20 Special** | **-35 HP**, **+15 Special** |
| **Shared Boon**| Healing | **+30 HP**, **+10 Special** | **+10 HP**, **+5 Special** |
| **Meter Burn** | Disruptive | **-15 HP**, **+40 Special** | **+10 HP**, **-25 Special** |

---

## 🛠️ Technology Stack & Setup

This application requires a server environment to handle real-time communication and game state.

* **Backend:** Node.js (with Express)
* **Real-Time:** Socket.IO
* **Frontend:** HTML5, CSS3, JavaScript
* **Deployment:** Render

### Local Development Setup

1.  **Clone the repository:**
    ```bash
    git clone [https://github.com/Tejsai973973/RPS_BATTLE.git](https://github.com/Tejsai973973/RPS_BATTLE.git)
    cd RPS_BATTLE
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
3.  **Start the server:**
    ```bash
    npm start
    ```
4.  Open your browser to `http://localhost:3000`. Use an incognito window or another device to simulate a second player.
