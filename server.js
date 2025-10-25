// server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    pingTimeout: 60000,
    pingInterval: 25000
});

const PORT = process.env.PORT || 3000;

// --- Game Constants ---
const START_HP = 100; const NORMAL_DAMAGE = 10; const CRIT_DAMAGE = 15; const RESIST_DAMAGE = 5;
const SPECIAL_COST = 100; const CRIT_SPECIAL_CHARGE = 50;
const BASE_SPECIAL_CHARGE = 20; const BASE_SPECIAL_LOSS = 10;
const CONSECUTIVE_WIN_START_BONUS = 30; const CONSECUTIVE_WIN_STACK_BONUS = 10;
const CONSECUTIVE_LOSS_START_PENALTY = 15; const CONSECUTIVE_LOSS_STACK_PENALTY = 5;
const GAMBITS = {
    'gambit_red':    { user: { hp: -25, special: 20 }, opponent: { hp: -35, special: 15 }, text: "Sacrifice: You -25HP,+20Sp | Opp -35HP,+15Sp" },
    'gambit_green':  { user: { hp:  30, special: 10 }, opponent: { hp:  10, special:  5 }, text: "Shared Boon: You +30HP,+10Sp | Opp +10HP,+5Sp" },
    'gambit_purple': { user: { hp: -15, special: 40 }, opponent: { hp:  10, special:-25 }, text: "Meter Burn: You -15HP,+40Sp | Opp +10HP,-25Sp" }
};
const GAMBIT_KEYS = Object.keys(GAMBITS);
const ELEMENTS = ['fire', 'water', 'grass'];
const CHOICES = ['rock', 'paper', 'scissors'];
// --- End Constants ---

let rooms = {};

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/index.html');
});

io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on('createRoom', ({ element }) => {
        try {
            if (!ELEMENTS.includes(element)) throw new Error("Invalid element.");
            const roomId = uuidv4().substring(0, 6);
            rooms[roomId] = {
                id: roomId,
                players: [{ id: socket.id, element: element, hp: START_HP, special: 0, consecutiveWins: 0, consecutiveLosses: 0, gambitAssignments: {}, currentMove: null, maxHp: START_HP }],
                gameState: { status: 'waiting', elementalTriangle: {}, clashMultiplier: 1, roundResultText: 'Waiting for opponent...', specialResultText: '', turnResult: null }
            };
            shuffleElementalTriangle(roomId);
            shuffleGambits(roomId, socket.id);
            socket.join(roomId);
            socket.emit('roomCreated', { roomId: roomId });
            console.log(`Room ${roomId} created by ${socket.id} (Elem: ${element})`);
        } catch (error) { console.error(`Create Room Error for ${socket.id}:`, error.message); socket.emit('errorMsg', `Failed to create room: ${error.message}`); }
    });

    socket.on('joinRoom', ({ roomId, element }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit('errorMsg', 'Room not found.');
        if (room.gameState.status !== 'waiting') return socket.emit('errorMsg', 'Game already started or room invalid.');
        if (room.players.length >= 2) return socket.emit('errorMsg', 'Room is full.');
        if (!ELEMENTS.includes(element)) return socket.emit('errorMsg', 'Invalid element selected.');

        try {
            const newPlayer = { id: socket.id, element: element, hp: START_HP, special: 0, consecutiveWins: 0, consecutiveLosses: 0, gambitAssignments: {}, currentMove: null, maxHp: START_HP };
            room.players.push(newPlayer);
            shuffleGambits(roomId, socket.id);
            socket.join(roomId);
            room.gameState.status = 'playing';
            room.gameState.roundResultText = 'First round... Fight!';

            const initialState = {
                 roomId: roomId,
                 players: room.players.map(p => ({ id: p.id, element: p.element, hp: p.hp, special: p.special, maxHp: p.maxHp })),
                 gameState: { roundResultText: room.gameState.roundResultText }
             };

            console.log(`Emitting startGame to room ${roomId}`);
            io.to(roomId).emit('startGame', initialState);
            console.log(`User ${socket.id} joined room ${roomId}. Game starting.`);
        } catch (error) { console.error(`Join Room Error ${roomId} for ${socket.id}:`, error.message); socket.emit('errorMsg', `Failed to join room: ${error.message}`); if(room && room.players.length < 2) room.gameState.status = 'waiting'; }
    });

    socket.on('playerMove', ({ roomId, choice, isSpecial }) => {
        const room = rooms[roomId];
        if (!room || room.gameState.status !== 'playing' || !room.players || room.players.length !== 2) {
             console.warn(`Move ignored: Room ${roomId} not ready or invalid state.`); return;
        }
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex === -1) { console.warn(`Move ignored: Player ${socket.id} not found.`); return; }
        if (room.players[playerIndex].currentMove) { console.warn(`Move ignored: Player ${socket.id} already moved.`); return; }
        if (!CHOICES.includes(choice)) { console.warn(`Invalid choice from ${socket.id}: ${choice}`); socket.emit('errorMsg', `Invalid move: ${choice}.`); return; }

        room.players[playerIndex].currentMove = { choice, isSpecial };
        console.log(`Move received from P${playerIndex+1} (${socket.id}): ${choice} (Special: ${isSpecial})`);

        const opponentIndex = 1 - playerIndex;
        if (room.players[0].currentMove && room.players[1].currentMove) {
            console.log(`Both moved in ${roomId}. Resolving...`);
            setTimeout(() => resolveTurn(roomId), 50);
        } else {
             const opponentSocket = io.sockets.sockets.get(room.players[opponentIndex].id);
             if (opponentSocket) { opponentSocket.emit('opponentMoved'); console.log(`Notified ${room.players[opponentIndex].id} of move.`); }
             else { console.warn(`Could not find opponent socket ${room.players[opponentIndex].id}.`); }
        }
    });


    socket.on('disconnect', (reason) => {
        console.log(`User disconnected: ${socket.id}. Reason: ${reason}`);
        const roomIds = Object.keys(rooms);
        for (const roomId of roomIds) {
            const room = rooms[roomId];
            if (!room || !room.players) continue;
            const playerIndex = room.players.findIndex(p => p.id === socket.id);
            if (playerIndex !== -1) {
                console.log(`Player ${socket.id} found in room ${roomId}. Cleaning up.`);
                const wasPlaying = room.players.length === 2 && room.gameState.status === 'playing';
                room.players.splice(playerIndex, 1);
                if (wasPlaying && room.players.length === 1) {
                    const opponentId = room.players[0].id;
                    const opponentSocket = io.sockets.sockets.get(opponentId);
                    if (opponentSocket) { opponentSocket.emit('opponentDisconnected'); console.log(`Notified ${opponentId}.`); }
                    else { console.log(`Opponent ${opponentId} already disconnected.`); }
                    if(room.gameState) room.gameState.status = 'finished';
                    console.log(`Room ${roomId} marked finished.`);
                }
                if (room.players.length === 0 || (room.gameState && room.gameState.status === 'waiting')) {
                    delete rooms[roomId]; console.log(`Room ${roomId} deleted.`);
                }
                break;
            }
        }
    });
});

// --- Server-Side Game Logic Functions ---

function resolveTurn(roomId) {
    const room = rooms[roomId];
    if (!room || !room.players || room.players.length !== 2 || !room.players[0].currentMove || !room.players[1].currentMove || room.gameState.status !== 'playing') {
         console.error(`ResolveTurn: Invalid room state ${roomId}. Status: ${room?.gameState?.status}`);
         if (room?.players?.length === 2) { room.players[0].currentMove = null; room.players[1].currentMove = null; io.to(roomId)?.emit('errorMsg', 'Turn error.'); }
         return;
    }

    const p1 = room.players[0]; const p2 = room.players[1];
    const move1 = p1.currentMove; const move2 = p2.currentMove;

    let gambitEffects = { p1: null, p2: null };
    if (move1.isSpecial) {
        const gambitKey = p1.gambitAssignments[move1.choice];
        gambitEffects.p1 = applyGambit(roomId, 0, gambitKey);
        if(gambitKey) p1.special = Math.max(0, p1.special - SPECIAL_COST);
        shuffleGambits(roomId, p1.id);
    }
    if (move2.isSpecial) {
        const gambitKey = p2.gambitAssignments[move2.choice];
        gambitEffects.p2 = applyGambit(roomId, 1, gambitKey);
        if(gambitKey) p2.special = Math.max(0, p2.special - SPECIAL_COST);
        shuffleGambits(roomId, p2.id);
    }

    // Check for game over *after* gambits
    if (p1.hp <= 0 || p2.hp <= 0) {
        // Resolve combat ONE LAST TIME to get final text
        resolveCombat(roomId, move1.choice, move2.choice); 
        finishGame(roomId); // Then end the game
        return;
    }

    let combatResult = resolveCombat(roomId, move1.choice, move2.choice);

    p1.currentMove = null; p2.currentMove = null;

    // Check for game over *after* combat
    if (p1.hp <= 0 || p2.hp <= 0) {
        finishGame(roomId);
    } else {
        // Normal turn, game continues
        io.to(roomId).emit('gameStateUpdate', {
            players: [ { id: p1.id, hp: p1.hp, special: p1.special, maxHp: p1.maxHp }, { id: p2.id, hp: p2.hp, special: p2.special, maxHp: p2.maxHp } ],
            gameState: { clashMultiplier: room.gameState.clashMultiplier, roundResultText: room.gameState.roundResultText, specialResultText: room.gameState.specialResultText },
            turnResult: { p1Id: p1.id, p2Id: p2.id, p1Move: move1.choice, p2Move: move2.choice, gambitEffects: gambitEffects, combatResultText: combatResult.result_text, specialChangeText: combatResult.special_text, isClash: combatResult.isClash },
            gameOver: false // Explicitly not over
        });
    }
}

function applyGambit(roomId, playerIndex, gambitKey) {
    const room = rooms[roomId];
    if (!room || !room.players || room.players.length !== 2) return null;
    const player = room.players[playerIndex];
    const opponent = room.players[1 - playerIndex];
    const gambitData = GAMBITS[gambitKey];
    if (!gambitData) { console.error(`Invalid gambit key: ${gambitKey} for P${playerIndex+1}`); return null; }

    let userHpChange = 0, userSpChange = 0, oppHpChange = 0, oppSpChange = 0;
    switch (gambitKey) {
        case 'gambit_red': userHpChange = -25; userSpChange = 20; oppHpChange = -35; oppSpChange = 15; break;
        case 'gambit_green': userHpChange = 30; userSpChange = 10; oppHpChange = 10; oppSpChange = 5; break;
        case 'gambit_purple': userHpChange = -15; userSpChange = 40; oppHpChange = 10; oppSpChange = -25; break;
        default: console.warn("Unknown gambit key:", gambitKey); return null;
    }

    player.hp = Math.min(player.maxHp, Math.max(0, player.hp + userHpChange));
    player.special = Math.max(0, Math.min(100, player.special + userSpChange));
    opponent.hp = Math.min(opponent.maxHp, Math.max(0, opponent.hp + oppHpChange));
    opponent.special = Math.max(0, Math.min(100, opponent.special + oppSpChange));

    console.log(`Gambit ${gambitKey} applied by P${playerIndex+1}. P1 HP:${room.players[0].hp}, Sp:${room.players[0].special} | P2 HP:${room.players[1].hp}, Sp:${room.players[1].special}`);
    return { key: gambitKey, text: gambitData.text };
}

// --- **** FIXED COMBAT LOGIC **** ---
function resolveCombat(roomId, p1_choice, p2_choice) {
    const room = rooms[roomId];
    if (!room || !room.players || room.players.length !== 2) return { result_text: "Error", special_text: "", isClash: false};
    const p1 = room.players[0]; const p2 = room.players[1];
    let state = room.gameState;
    let p1_damage = 0, p2_damage = 0, p1_heal = 0, p2_heal = 0;
    let result_text = "", special_text = ""; let isClash = false;
    
    const rps_result = getRPSResult(p1_choice, p2_choice);
    const elem_result = getElementResult(p1.element, p2.element, roomId);

    if (rps_result === 'tie') {
        state.clashMultiplier++; 
        result_text = `CLASH! Next round is worth ${state.clashMultiplier}x!`; 
        isClash = true;
        if (p1.consecutiveWins > 0 || p1.consecutiveLosses > 0 || p2.consecutiveWins > 0 || p2.consecutiveLosses > 0) special_text += " Streak broken!";
        // RESET ALL STREAKS
        p1.consecutiveWins = 0; p1.consecutiveLosses = 0; 
        p2.consecutiveWins = 0; p2.consecutiveLosses = 0;
    
    } else {
        // --- A WIN OR LOSS OCCURRED ---
        let charge = 0, penalty = 0, hp_swing = 0;
        let winnerPlayer, loserPlayer, winnerIndex, winnerElemResult;
        
        if (rps_result === 'win') { // Player 1 wins RPS
            winnerPlayer = p1; loserPlayer = p2; winnerIndex = 0;
            winnerElemResult = elem_result; // P1's element result
        } else { // Player 2 wins RPS
            winnerPlayer = p2; loserPlayer = p1; winnerIndex = 1;
            // Invert element result for P2's perspective
            winnerElemResult = (elem_result === 'win' ? 'lose' : (elem_result === 'lose' ? 'win' : 'tie'));
        }

        // *** NEW STREAK LOGIC ***
        winnerPlayer.consecutiveWins++;
        loserPlayer.consecutiveWins = 0;
        winnerPlayer.consecutiveLosses = 0;
        loserPlayer.consecutiveLosses++;
        
        if (winnerElemResult === 'win') { // CRITICAL HIT
            hp_swing = CRIT_DAMAGE;
            charge = calculateStreakCharge(winnerPlayer.consecutiveWins) * 2; // Double Charge
            penalty = calculateStreakPenalty(loserPlayer.consecutiveLosses) * 2; // Double Penalty
            result_text = `Player ${winnerIndex + 1} CRITICAL HIT!`;
        
        } else if (winnerElemResult === 'tie') { // NORMAL HIT
            hp_swing = NORMAL_DAMAGE;
            charge = calculateStreakCharge(winnerPlayer.consecutiveWins);
            penalty = calculateStreakPenalty(loserPlayer.consecutiveLosses);
            result_text = `Player ${winnerIndex + 1} wins!`;
        
        } else { // DAMPENED / RESISTED (winnerElemResult === 'lose')
            hp_swing = RESIST_DAMAGE;
            charge = Math.floor(calculateStreakCharge(winnerPlayer.consecutiveWins) / 2); // Half Charge
            penalty = Math.floor(calculateStreakPenalty(loserPlayer.consecutiveLosses) / 2); // Half Penalty
            
            // This logic was flawed. Corrected:
            if (winnerIndex === 0) { // P1 won RPS but lost element
                 result_text = `Player 1's hit was DAMPENED!`;
            } else { // P2 won RPS but lost element (so P1 Resisted)
                 result_text = `Player 2's hit was DAMPENED!`; // P1 resisted
            }
        }
        // *** END NEW STREAK LOGIC ***

        // Apply Clash Multiplier
        charge = Math.round(charge * state.clashMultiplier);
        penalty = Math.round(penalty * state.clashMultiplier);
        hp_swing = Math.round(hp_swing * state.clashMultiplier);

        // Apply HP/Special changes
        if (winnerIndex === 0) { // P1 was the winner
            p1_heal = hp_swing; p2_damage = hp_swing;
            p1.special = Math.min(100, p1.special + charge);
            p2.special = Math.max(0, p2.special - penalty);
            special_text = `P1 +${charge} Sp! (P2 -${penalty} Sp)`;
            if(p1.consecutiveWins > 1) special_text += ` (${p1.consecutiveWins}x win!)`;
        
        } else { // P2 was the winner
            p2_heal = hp_swing; p1_damage = hp_swing;
            p2.special = Math.min(100, p2.special + charge);
            p1.special = Math.max(0, p1.special - penalty);
            special_text = `P1 -${penalty} Sp! (P2 +${charge} Sp)`;
            if(p2.consecutiveWins > 1) special_text += ` (${p2.consecutiveWins}x win!)`;
        }
        
        state.clashMultiplier = 1; // Reset clash
        result_text += ` (±${hp_swing} HP)`;
    }

    // Final HP application
    p1.hp = Math.min(p1.maxHp, Math.max(0, p1.hp - p1_damage + p1_heal));
    p2.hp = Math.min(p2.maxHp, Math.max(0, p2.hp - p2_damage + p2_heal));
    state.roundResultText = result_text.trim();
    state.specialResultText = special_text.trim();
    
    console.log(`Combat resolved in ${roomId}. P1 HP:${p1.hp}, Sp:${p1.special}, Wins:${p1.consecutiveWins}, Losses:${p1.consecutiveLosses} | P2 HP:${p2.hp}, Sp:${p2.special}, Wins:${p2.consecutiveWins}, Losses:${p2.consecutiveLosses}`);
    return { result_text: state.roundResultText, special_text: state.specialResultText, isClash: isClash };
}
// --- **** END FIXED COMBAT LOGIC **** ---


function calculateStreakCharge(wins) { if (wins <= 0) return 0; if (wins === 1) return BASE_SPECIAL_CHARGE; if (wins === 2) return CONSECUTIVE_WIN_START_BONUS; return CONSECUTIVE_WIN_START_BONUS + (wins - 2) * CONSECUTIVE_WIN_STACK_BONUS; }
function calculateStreakPenalty(losses) { if (losses <= 0) return 0; if (losses === 1) return BASE_SPECIAL_LOSS; if (losses === 2) return CONSECUTIVE_LOSS_START_PENALTY; return CONSECUTIVE_LOSS_START_PENALTY + (losses - 2) * CONSECUTIVE_LOSS_STACK_PENALTY; }
function getRPSResult(p1, p2) { if (p1 === p2) return 'tie'; if ((p1 === 'rock' && p2 === 'scissors') || (p1 === 'paper' && p2 === 'rock') || (p1 === 'scissors' && p2 === 'paper')) return 'win'; return 'lose'; }
function getElementResult(p1_elem, p2_elem, roomId) { const room = rooms[roomId]; if (!room || !room.gameState || !room.gameState.elementalTriangle) return 'tie'; const triangle = room.gameState.elementalTriangle; if (!p1_elem || !p2_elem) return 'tie'; if (p1_elem === p2_elem) return 'tie'; if (triangle[p1_elem] === p2_elem) return 'win'; if (triangle[p2_elem] === p1_elem) return 'lose'; return 'tie'; }
function shuffleElementalTriangle(roomId) { const room = rooms[roomId]; if (!room || !room.gameState) return; let shuffledElements = [...ELEMENTS]; for (let i = shuffledElements.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffledElements[i], shuffledElements[j]] = [shuffledElements[j], shuffledElements[i]]; } room.gameState.elementalTriangle = { [shuffledElements[0]]: shuffledElements[1], [shuffledElements[1]]: shuffledElements[2], [shuffledElements[2]]: shuffledElements[0] }; console.log(`Room ${roomId} new triangle:`, room.gameState.elementalTriangle); }
function shuffleGambits(roomId, playerId) {
    const room = rooms[roomId];
    if (!room || !room.players) return;
    const playerIndex = room.players.findIndex(p => p.id === playerId);
    if (playerIndex === -1) return;
    let shuffledGambits = [...GAMBIT_KEYS]; // Corrected scope
    for (let i = shuffledGambits.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffledGambits[i], shuffledGambits[j]] = [shuffledGambits[j], shuffledGambits[i]];
    }
    room.players[playerIndex].gambitAssignments = { 'rock': shuffledGambits[0], 'paper': shuffledGambits[1], 'scissors': shuffledGambits[2] };
    console.log(`Shuffled gambits for P${playerIndex+1} (${playerId}) in ${roomId}`);
}

// --- **** FIXED finishGame FUNCTION **** ---
function finishGame(roomId) {
    const room = rooms[roomId];
    if (!room || room.gameState.status === 'finished') return; // Prevent double finish
    room.gameState.status = 'finished';
    
    const p1 = room.players[0]; 
    const p2 = room.players.length > 1 ? room.players[1] : null;
    let winnerId = null;

    if (p1 && p2) {
        if (p1.hp <= 0 && p2.hp <= 0) winnerId = null; // Draw
        else if (p2.hp <= 0) winnerId = p1.id; // P1 wins
        else if (p1.hp <= 0) winnerId = p2.id; // P2 wins
    } else if (p1 && p1.hp > 0) {
        winnerId = p1.id; // P1 wins by default if P2 missing
        console.log(`Game in ${roomId} ended with only P1.`);
    } else {
        console.log(`Game in ${roomId} ended inconclusively.`);
    }

     const finalPlayersState = room.players.map(p => ({ 
         id: p.id, 
         hp: p.hp, 
         special: p.special, 
         maxHp: p.maxHp 
     }));
     
     // Send ONE final update. The client will handle the "Game Over" display.
     io.to(roomId).emit('gameStateUpdate', { 
         players: finalPlayersState, 
         gameState: { 
             clashMultiplier: room.gameState.clashMultiplier, 
             roundResultText: room.gameState.roundResultText, 
             specialResultText: room.gameState.specialResultText 
         }, 
         turnResult: null, // No turn animation, just final state
         gameOver: true,  // <-- This is the key
         winnerId: winnerId // Pass the winner ID in the final update
     });
     
     console.log(`Game over in room ${roomId}. Winner: ${winnerId === null ? 'Draw' : winnerId}.`);
     
     // Remove the old 'gameOver' event
     // setTimeout(() => { ... }, 100); // THIS IS GONE
}

// --- Start Server ---
server.listen(PORT, () => { console.log(`Server listening on *:${PORT}`); });