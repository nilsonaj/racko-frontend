// Racko Client v1.1 - Bug fix for duplicate racks
// Connect to WebSocket server
// Change this URL after deploying to Render.com
const SOCKET_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:3000'
  : 'https://YOUR-APP-NAME.onrender.com'; // UPDATE THIS AFTER DEPLOYING!

const CLIENT_VERSION = "1.1";

const socket = io(SOCKET_URL);

const RACK_SIZE = 10;
const getDeckSize = (pc) => pc === 2 ? 40 : pc === 3 ? 50 : 60;

let state = {
  gameState: null,
  roomCode: '',
  playerId: '',
  inputName: '',
  inputCode: '',
  drawnCard: null,
  drawnFromDiscard: false,
  message: '',
  copied: false,
  loading: false,
  maxPlayers: 2,
  useAI: false,
  practiceMode: false,
  lastMove: null,
  canUndo: false
};

const genCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();
const genId = () => 'p_' + Math.random().toString(36).substring(2, 15);

// WebSocket event handlers
socket.on('gameCreated', (data) => {
  state.gameState = data.gameData;
  state.loading = false;
  render();
});

socket.on('gameUpdate', (gameData) => {
  state.gameState = gameData;
  
  // Clear local state if it's not our turn anymore
  if (!isMyTurn(gameData)) {
    state.drawnCard = null;
    state.drawnFromDiscard = false;
    state.canUndo = false;
    state.lastMove = null;
  }
  
  updateMessage();
  render();
});

// Polling backup to catch missed updates
let pollInterval;
socket.on('gameCreated', (data) => {
  state.gameState = data.gameData;
  state.loading = false;
  startPolling();
  render();
});

socket.on('connect', () => {
  console.log('Connected to server');
  if (state.roomCode) {
    startPolling();
  }
});

socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
  state.message = 'Connection error - check server URL';
  render();
});

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  
  pollInterval = setInterval(() => {
    if (state.roomCode) {
      socket.emit('getGame', state.roomCode);
    }
  }, 2000);
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

socket.on('error', (data) => {
  state.message = data.message;
  state.loading = false;
  render();
});

function updateMessage() {
  const game = state.gameState;
  if (!game) return;

  if (game.players.length < game.maxPlayers && !game.useAI) {
    state.message = `Waiting for ${game.maxPlayers - game.players.length} more...`;
  } else if (game.winner) {
    const winner = game.players.find(p => p.id === game.winner);
    state.message = game.winner === state.playerId ? '🎉 You win!' : `${winner?.name} wins!`;
  } else if (game.players[game.currentTurn]?.id === state.playerId) {
    state.message = 'Your turn!';
  } else {
    const curr = game.players[game.currentTurn];
    state.message = `${curr?.name}'s turn...`;
    if (curr?.isAI && !game.winner) {
      setTimeout(() => aiTurn(), 1000);
    }
  }
}

function createGame(name, pc, ai, pm) {
  const code = genCode();
  const pid = genId();
  const deckSize = getDeckSize(pc);
  const deck = Array.from({length: deckSize}, (_, i) => i + 1);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  
  const players = [{id: pid, name, rack: deck.splice(0, RACK_SIZE), score: 0, isAI: false}];
  const pending = [];
  
  if (ai) {
    for (let i = 1; i < pc; i++) {
      // Create a new array for each player's rack to avoid reference issues
      const playerRack = deck.splice(0, RACK_SIZE);
      console.log(`AI ${i} rack:`, playerRack);
      players.push({id: `ai_${i}`, name: `AI ${i}`, rack: [...playerRack], score: 0, isAI: true});
    }
  } else {
    for (let i = 1; i < pc; i++) {
      const pendingRack = deck.splice(0, RACK_SIZE);
      console.log(`Pending player ${i} rack:`, pendingRack);
      pending.push([...pendingRack]);
    }
  }
  
  console.log(`Deck size before discard: ${deck.length}`);
  // Pop discard card BEFORE assigning drawPile to avoid mutation
  const discardCard = deck.pop();
  console.log(`Discard card: ${discardCard}, Remaining deck: ${deck.length}`);
  
  const game = {
    roomCode: code, maxPlayers: pc, useAI: ai, players, pendingPlayerCards: pending,
    drawPile: [...deck], discardPile: [discardCard], currentTurn: 0, winner: null, practiceMode: pm
  };
  
  state.loading = true;
  state.roomCode = code;
  state.playerId = pid;
  state.message = ai ? 'Your turn!' : `Waiting for ${pc-1} more...`;
  
  socket.emit('createGame', { roomCode: code, gameData: game });
  render();
}

function joinGame(code, name) {
  state.loading = true;
  render();

  socket.emit('getGame', code);
  
  socket.once('gameUpdate', (game) => {
    if (game.players.length >= game.maxPlayers) {
      state.message = 'Game full';
      state.loading = false;
      render();
      return;
    }
    
    const pid = genId();
    const rack = game.pendingPlayerCards.shift();
    const playerData = {id: pid, name, rack, score: 0, isAI: false};
    
    state.roomCode = code;
    state.playerId = pid;
    
    socket.emit('joinGame', { roomCode: code, playerData });
  });
}

const isMyTurn = (g) => g && (g.players.length >= g.maxPlayers || g.useAI) && g.players[g.currentTurn]?.id === state.playerId;
const getMyRack = (g) => g?.players.find(p => p.id === state.playerId)?.rack || [];
const getOthers = (g) => g?.players.filter(p => p.id !== state.playerId) || [];

const calcScore = (rack) => {
  let s = 0;
  for (let i = 0; i < rack.length - 1; i++) if (rack[i] < rack[i+1]) s += 5;
  return s;
};

const checkWin = (rack) => {
  for (let i = 0; i < rack.length - 1; i++) if (rack[i] >= rack[i+1]) return false;
  return true;
};

function aiTurn() {
  const game = state.gameState;
  const cp = game.players[game.currentTurn];
  if (!cp?.isAI || game.winner) return;
  
  const ai = cp;
  const topD = game.discardPile[game.discardPile.length - 1];
  let useD = false, bestP = -1, bestS = calcScore(ai.rack);

  for (let i = 0; i < ai.rack.length; i++) {
    const test = [...ai.rack];
    test[i] = topD;
    const s = calcScore(test);
    const fits = (i === 0 && topD < ai.rack[1]) || 
                 (i === ai.rack.length - 1 && topD > ai.rack[i-1]) ||
                 (i > 0 && i < ai.rack.length - 1 && topD > ai.rack[i-1] && topD < ai.rack[i+1]);
    if (fits && s > bestS) { bestS = s; bestP = i; useD = true; }
  }

  let card;
  if (useD && bestP >= 0) {
    card = game.discardPile.pop();
  } else {
    // If draw pile is empty, reshuffle discard pile
    if (game.drawPile.length === 0) {
      if (game.discardPile.length <= 1) return; // Can't draw
      const topCard = game.discardPile.pop();
      game.drawPile = [...game.discardPile];
      game.discardPile = [topCard];
      
      // Shuffle
      for (let i = game.drawPile.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [game.drawPile[i], game.drawPile[j]] = [game.drawPile[j], game.drawPile[i]];
      }
    }
    
    card = game.drawPile.pop();
    bestS = calcScore(ai.rack); bestP = -1;
    for (let i = 0; i < ai.rack.length; i++) {
      const test = [...ai.rack]; test[i] = card;
      const s = calcScore(test);
      if (s > bestS) { bestS = s; bestP = i; }
    }
  }

  if (bestP === -1) {
    let worst = 0, worstD = 0;
    const ds = getDeckSize(game.maxPlayers);
    for (let i = 0; i < ai.rack.length; i++) {
      const ideal = (i + 1) * (ds / RACK_SIZE);
      const dev = Math.abs(ai.rack[i] - ideal);
      if (dev > worstD) { worstD = dev; worst = i; }
    }
    bestP = worst;
  }

  const replaced = ai.rack[bestP];
  ai.rack[bestP] = card;
  game.discardPile.push(replaced);
  if (checkWin(ai.rack)) { game.winner = ai.id; ai.score++; }
  game.currentTurn = (game.currentTurn + 1) % game.players.length;
  
  socket.emit('updateGame', { roomCode: state.roomCode, gameData: game });
}

function drawCard(fromDiscard) {
  if (!isMyTurn(state.gameState) || state.drawnCard !== null) return;
  const g = {...state.gameState};
  let card;
  
  if (fromDiscard) {
    if (g.discardPile.length === 0) return;
    card = g.discardPile.pop();
    state.drawnFromDiscard = true;
  } else {
    // If draw pile is empty, reshuffle discard pile
    if (g.drawPile.length === 0) {
      if (g.discardPile.length <= 1) {
        state.message = 'No cards left to draw!';
        render();
        return;
      }
      // Keep top card of discard pile, shuffle rest into draw pile
      const topCard = g.discardPile.pop();
      g.drawPile = [...g.discardPile];
      g.discardPile = [topCard];
      
      // Shuffle the draw pile
      for (let i = g.drawPile.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [g.drawPile[i], g.drawPile[j]] = [g.drawPile[j], g.drawPile[i]];
      }
    }
    
    card = g.drawPile.pop();
    state.drawnFromDiscard = false;
  }
  
  state.drawnCard = card;
  state.message = fromDiscard ? 'Must use card' : 'Place or discard';
  
  socket.emit('updateGame', { roomCode: state.roomCode, gameData: g });
  render();
}

function placeCard(pos) {
  if (state.drawnCard === null || !isMyTurn(state.gameState)) return;
  const g = {...state.gameState};
  const me = g.players.find(p => p.id === state.playerId);
  if (!me) return;
  
  // Save state for undo
  state.lastMove = {
    gameState: JSON.parse(JSON.stringify(state.gameState)),
    drawnCard: state.drawnCard,
    drawnFromDiscard: state.drawnFromDiscard,
    position: pos
  };
  state.canUndo = true;
  
  const replaced = me.rack[pos];
  me.rack[pos] = state.drawnCard;
  g.discardPile.push(replaced);
  
  if (checkWin(me.rack)) { g.winner = state.playerId; me.score++; state.canUndo = false; }
  g.currentTurn = (g.currentTurn + 1) % g.players.length;
  
  state.drawnCard = null;
  state.drawnFromDiscard = false;
  
  socket.emit('updateGame', { roomCode: state.roomCode, gameData: g });
  render();
  
  // Auto-disable undo after 3 seconds
  setTimeout(() => {
    if (state.canUndo) {
      state.canUndo = false;
      render();
    }
  }, 3000);
}

function discardCard() {
  if (state.drawnCard === null || !isMyTurn(state.gameState) || state.drawnFromDiscard) return;
  const g = {...state.gameState};
  
  // Save state for undo
  state.lastMove = {
    gameState: JSON.parse(JSON.stringify(state.gameState)),
    drawnCard: state.drawnCard,
    drawnFromDiscard: state.drawnFromDiscard,
    wasDiscard: true
  };
  state.canUndo = true;
  
  g.discardPile.push(state.drawnCard);
  g.currentTurn = (g.currentTurn + 1) % g.players.length;
  
  state.drawnCard = null;
  state.drawnFromDiscard = false;
  
  socket.emit('updateGame', { roomCode: state.roomCode, gameData: g });
  render();
  
  // Auto-disable undo after 3 seconds
  setTimeout(() => {
    if (state.canUndo) {
      state.canUndo = false;
      render();
    }
  }, 3000);
}

function newGame() {
  if (!state.gameState) return;
  const ds = getDeckSize(state.gameState.maxPlayers);
  const deck = Array.from({length: ds}, (_, i) => i + 1);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  
  const g = {...state.gameState};
  g.players.forEach(p => p.rack = deck.splice(0, RACK_SIZE));
  g.drawPile = deck;
  g.discardPile = [deck.pop()];
  g.currentTurn = 0;
  g.winner = null;
  
  state.drawnCard = null;
  state.drawnFromDiscard = false;
  state.canUndo = false;
  state.lastMove = null;
  
  socket.emit('updateGame', { roomCode: state.roomCode, gameData: g });
  render();
}

function undoMove() {
  if (!state.canUndo || !state.lastMove) return;
  
  state.gameState = state.lastMove.gameState;
  state.drawnCard = state.lastMove.drawnCard;
  state.drawnFromDiscard = state.lastMove.drawnFromDiscard;
  state.canUndo = false;
  state.lastMove = null;
  
  socket.emit('updateGame', { roomCode: state.roomCode, gameData: state.gameState });
  render();
}

function render() {
  const root = document.getElementById('root');
  
  if (!state.gameState) {
    root.innerHTML = renderLobby();
    attachLobbyHandlers();
  } else {
    root.innerHTML = renderGame();
  }
}

function renderLobby() {
  return `
    <div class="min-h-screen bg-gradient-to-br from-green-800 via-green-700 to-emerald-800 p-8 flex items-center justify-center">
      <div class="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full">
        <div class="text-center mb-8">
          <h1 class="text-5xl font-bold text-green-800 mb-2">Racko</h1>
          <p class="text-xs text-gray-400">v${CLIENT_VERSION}</p>
        </div>
        
        <div class="space-y-6">
          <div>
            <h2 class="text-xl font-bold text-gray-800 mb-4">Create Game</h2>
            <input type="text" id="inputName" placeholder="Your name" value="${state.inputName}"
              class="w-full px-4 py-3 border-2 rounded-lg mb-3 focus:border-green-500 focus:outline-none" />
            
            <div class="mb-3">
              <label class="block text-sm font-medium mb-2">Opponents</label>
              <div class="grid grid-cols-2 gap-2">
                <button id="humanBtn" class="py-3 rounded-lg font-bold ${!state.useAI ? 'bg-green-600 text-white' : 'bg-gray-200'}">Human</button>
                <button id="aiBtn" class="py-3 rounded-lg font-bold ${state.useAI ? 'bg-green-600 text-white' : 'bg-gray-200'}">AI</button>
              </div>
            </div>
            
            <div class="mb-3">
              <label class="block text-sm font-medium mb-2">Players</label>
              <div class="grid grid-cols-3 gap-2">
                <button id="players2" class="py-3 rounded-lg font-bold ${state.maxPlayers === 2 ? 'bg-green-600 text-white' : 'bg-gray-200'}">2</button>
                <button id="players3" class="py-3 rounded-lg font-bold ${state.maxPlayers === 3 ? 'bg-green-600 text-white' : 'bg-gray-200'}">3</button>
                <button id="players4" class="py-3 rounded-lg font-bold ${state.maxPlayers === 4 ? 'bg-green-600 text-white' : 'bg-gray-200'}">4</button>
              </div>
              <p class="text-xs text-gray-500 mt-2">Deck: ${getDeckSize(state.maxPlayers)} cards</p>
            </div>
            
            <div class="mb-3">
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" id="practiceMode" ${state.practiceMode ? 'checked' : ''} class="w-4 h-4" />
                <span>Practice Mode</span>
              </label>
            </div>
            
            <button id="createBtn" ${state.loading || !state.inputName.trim() ? 'disabled' : ''}
              class="w-full bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-bold py-3 rounded-lg">
              ${state.loading ? 'Creating...' : 'Create'}
            </button>
          </div>
          
          <div class="relative">
            <div class="absolute inset-0 flex items-center"><div class="w-full border-t"></div></div>
            <div class="relative flex justify-center text-sm"><span class="px-2 bg-white">OR</span></div>
          </div>
          
          <div>
            <h2 class="text-xl font-bold mb-4">Join Game</h2>
            <input type="text" id="inputNameJoin" placeholder="Your name" value="${state.inputName}"
              class="w-full px-4 py-3 border-2 rounded-lg mb-3 focus:border-green-500 focus:outline-none" />
            <input type="text" id="inputCode" placeholder="Room code" value="${state.inputCode}"
              class="w-full px-4 py-3 border-2 rounded-lg mb-3 focus:border-green-500 focus:outline-none" />
            <button id="joinBtn" ${state.loading || !state.inputName.trim() || !state.inputCode.trim() ? 'disabled' : ''}
              class="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-bold py-3 rounded-lg">
              ${state.loading ? 'Joining...' : 'Join'}
            </button>
          </div>
        </div>
        
        ${state.message ? `<div class="mt-6 p-4 bg-blue-50 border rounded-lg text-center">${state.message}</div>` : ''}
      </div>
    </div>
  `;
}

function renderGame() {
  const game = state.gameState;
  const myTurn = isMyTurn(game);
  const myRack = getMyRack(game);
  const deckSize = getDeckSize(game.maxPlayers);
  
  let html = `<div class="min-h-screen bg-gradient-to-br from-green-800 to-emerald-800 p-4">
    <div class="max-w-7xl mx-auto">
      <div class="text-center mb-4">
        <h1 class="text-4xl font-bold text-white mb-2">Racko <span class="text-xs text-green-200">v${CLIENT_VERSION}</span></h1>
        <div class="flex items-center justify-center gap-2 mb-2">
          <span class="text-green-100 text-sm">Room:</span>
          <code class="bg-white/20 px-3 py-1 rounded text-white font-bold">${state.roomCode}</code>
          <button id="copyBtn" class="bg-white/20 hover:bg-white/30 p-2 rounded">📋</button>
        </div>
        ${game.practiceMode ? '<div class="text-yellow-300 text-sm mb-2">⚠️ Practice Mode</div>' : ''}
        <p class="text-green-100">${state.message}</p>
      </div>

      <div class="grid grid-cols-2 gap-4 mb-6 max-w-lg mx-auto">`;
  
  game.players.forEach(p => {
    html += `<div class="rounded-lg p-3 text-center ${p.id === state.playerId ? 'bg-yellow-400/30 border-2 border-yellow-400' : 'bg-white/20'}">
      <div class="text-green-100 text-sm mb-1">${p.name} ${p.id === state.playerId ? '(You)' : ''} ${p.isAI ? '🤖' : ''}</div>
      <div class="text-white text-2xl font-bold">${p.score || 0}</div>
    </div>`;
  });
  
  if (!game.useAI) {
    for (let i = 0; i < game.maxPlayers - game.players.length; i++) {
      html += `<div class="bg-white/10 rounded-lg p-3 text-center border-2 border-dashed border-white/30">
        <div class="text-green-100 text-sm mb-1">Waiting...</div>
        <div class="text-white/50 text-2xl font-bold">-</div>
      </div>`;
    }
  }
  
  html += `</div>`;

  if (game.winner) {
    const winnerName = game.players.find(p => p.id === game.winner)?.name;
    html += `<div class="${game.winner === state.playerId ? 'bg-yellow-400' : 'bg-red-400'} p-4 rounded-lg mb-6 text-center font-bold text-xl">
      ${game.winner === state.playerId ? '🎉 You Win!' : `${winnerName} Wins!`}
    </div>`;
  }

  if (game.practiceMode) {
    getOthers(game).forEach(p => {
      html += `<div class="bg-white/10 rounded-lg p-4 mb-6">
        <h2 class="text-white text-xl font-bold mb-3 text-center">${p.name}'s Rack</h2>
        <div class="grid grid-cols-5 md:grid-cols-10 gap-2">`;
      p.rack.forEach((c, i) => {
        html += `<div class="aspect-[2/3] bg-blue-900 rounded-lg shadow-lg flex flex-col items-center justify-center">
          <div class="text-xs text-blue-300 mb-1">#${i+1}</div>
          <div class="text-2xl md:text-3xl text-white font-bold">${c}</div>
        </div>`;
      });
      html += `</div></div>`;
    });
  }

  html += `<div class="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-4xl mx-auto mb-6">
    <div class="md:space-y-3">
      <div class="grid grid-cols-3 md:grid-cols-1 gap-2 md:gap-3 mb-2 md:mb-0">
        <!-- Draw Pile -->
        <div class="bg-white/10 rounded-lg p-2 md:p-3">
          <h2 class="text-white text-xs md:text-sm font-bold mb-1 md:mb-2 text-center">Draw</h2>
          <button id="drawBtn" ${!myTurn || state.drawnCard !== null || game.drawPile.length === 0 ? 'disabled' : ''}
            class="w-full h-20 md:h-24 rounded-lg shadow-lg flex items-center justify-center font-bold transition-all ${
              myTurn && state.drawnCard === null && game.drawPile.length > 0
                ? 'bg-blue-600 hover:bg-blue-500 text-white cursor-pointer'
                : 'bg-gray-600 text-gray-400 cursor-not-allowed opacity-50'
            }">
            <div class="text-center">
              <div class="text-xl md:text-2xl mb-1">🎴</div>
              <div class="text-xs">${game.drawPile.length}</div>
            </div>
          </button>
        </div>

        <!-- Current Card -->
        <div class="bg-white/10 rounded-lg p-2 md:p-3">
          <h2 class="text-white text-xs md:text-sm font-bold mb-1 md:mb-2 text-center">Current</h2>
          <div class="w-full h-20 md:h-24 rounded-lg shadow-lg flex items-center justify-center text-2xl md:text-4xl font-bold ${
            state.drawnCard ? 'bg-white text-gray-800 border-4 border-yellow-400' : 'bg-gray-700 text-gray-500'
          }">
            ${state.drawnCard || '<span class="text-xs">Empty</span>'}
          </div>
        </div>

        <!-- Discard Pile -->
        <div class="bg-white/10 rounded-lg p-2 md:p-3">
          <h2 class="text-white text-xs md:text-sm font-bold mb-1 md:mb-2 text-center">Discard</h2>
          <button id="discardPileBtn" ${!myTurn || state.drawnCard !== null || game.discardPile.length === 0 ? 'disabled' : ''}
            class="w-full h-20 md:h-24 rounded-lg shadow-lg flex items-center justify-center font-bold text-2xl md:text-4xl transition-all ${
              myTurn && state.drawnCard === null && game.discardPile.length > 0
                ? 'bg-red-600 hover:bg-red-500 text-white cursor-pointer'
                : 'bg-gray-600 text-gray-400 cursor-not-allowed opacity-50'
            }">
            ${game.discardPile.length > 0 ? game.discardPile[game.discardPile.length - 1] : '-'}
          </button>
        </div>
      </div>

      <!-- Discard button (full width on mobile, normal on desktop) -->
      <div class="bg-white/10 rounded-lg p-2 md:p-3">
        <button id="discardBtn" ${!state.drawnCard || !myTurn || state.drawnFromDiscard ? 'disabled' : ''}
          class="w-full font-bold py-2 rounded text-sm flex items-center justify-center gap-2 transition-all ${
            state.drawnCard && myTurn && !state.drawnFromDiscard
              ? 'bg-red-600 hover:bg-red-500 text-white cursor-pointer'
              : 'bg-gray-600 text-gray-400 cursor-not-allowed opacity-50'
          }">
          🗑️ Discard
        </button>
      </div>
    </div>

    <!-- Your Rack -->
    <div class="bg-white/10 rounded-lg p-2 md:p-3">
      <h2 class="text-white text-xs md:text-sm font-bold mb-1 md:mb-2 text-center">Your Rack</h2>
      <div class="flex gap-1 md:gap-2">
        <div class="flex flex-col gap-1 md:gap-1.5">`;
  
  myRack.forEach((c, i) => {
    html += `<div class="h-10 md:h-12 flex items-center justify-center text-white font-bold text-xs md:text-sm w-8 md:w-10">#${i+1}</div>`;
  });
  
  html += `</div><div class="flex flex-col gap-1 md:gap-1.5 flex-1">`;
  
  myRack.forEach((c, i) => {
    const position = ((c - 1) / (deckSize - 1)) * 80 + 10;
    html += `<button data-pos="${i}" class="rackCard h-10 md:h-12 bg-white rounded-lg shadow-lg flex items-center font-bold relative ${
      state.drawnCard && myTurn ? 'hover:bg-yellow-100 hover:scale-105 cursor-pointer' : 'cursor-not-allowed'
    }" ${!state.drawnCard || !myTurn ? 'disabled' : ''}>
      <div class="text-xl md:text-2xl text-gray-800 absolute pointer-events-none" style="left: ${position}%; transform: translateX(-50%)">${c}</div>
    </button>`;
  });
  
  html += `</div></div></div></div>`;

  html += `<div class="text-center">
    <div class="flex items-center justify-center gap-3">
      ${state.canUndo ? `
        <button id="undoBtn" class="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-3 px-6 rounded-lg shadow-lg">
          ↩️ Undo Last Move
        </button>
      ` : ''}
      <button id="newGameBtn" ${!game || (game.players.length < game.maxPlayers && !game.useAI) ? 'disabled' : ''}
        class="bg-white hover:bg-gray-100 disabled:bg-gray-400 text-gray-800 font-bold py-3 px-6 rounded-lg shadow-lg">
        🔄 New Round
      </button>
    </div>
  </div></div></div>`;

  return html;
}

function attachLobbyHandlers() {
  document.getElementById('inputName').oninput = (e) => { state.inputName = e.target.value; };
  document.getElementById('inputNameJoin').oninput = (e) => { state.inputName = e.target.value; };
  document.getElementById('inputCode').oninput = (e) => { state.inputCode = e.target.value.toUpperCase(); render(); };
  document.getElementById('practiceMode').onchange = (e) => { state.practiceMode = e.target.checked; };
  document.getElementById('humanBtn').onclick = () => { state.useAI = false; render(); };
  document.getElementById('aiBtn').onclick = () => { state.useAI = true; render(); };
  document.getElementById('players2').onclick = () => { state.maxPlayers = 2; render(); };
  document.getElementById('players3').onclick = () => { state.maxPlayers = 3; render(); };
  document.getElementById('players4').onclick = () => { state.maxPlayers = 4; render(); };
  document.getElementById('createBtn').onclick = () => {
    if (state.inputName.trim()) createGame(state.inputName.trim(), state.maxPlayers, state.useAI, state.practiceMode);
  };
  document.getElementById('joinBtn').onclick = () => {
    if (state.inputName.trim() && state.inputCode.trim()) joinGame(state.inputCode.trim(), state.inputName.trim());
  };
}

// Event delegation for game screen
document.addEventListener('click', (e) => {
  // Use closest() to handle clicks on child elements
  const target = e.target;
  
  if (target.id === 'copyBtn' || target.closest('#copyBtn')) {
    navigator.clipboard.writeText(state.roomCode);
    state.copied = true;
    render();
    setTimeout(() => { state.copied = false; render(); }, 2000);
  }
  if (target.id === 'drawBtn' || target.closest('#drawBtn')) drawCard(false);
  if (target.id === 'discardPileBtn' || target.closest('#discardPileBtn')) drawCard(true);
  if (target.id === 'discardBtn' || target.closest('#discardBtn')) discardCard();
  if (target.id === 'newGameBtn' || target.closest('#newGameBtn')) newGame();
  if (target.id === 'undoBtn' || target.closest('#undoBtn')) undoMove();
  
  // For rack cards, find the closest button with rackCard class
  const rackCard = target.classList.contains('rackCard') ? target : target.closest('.rackCard');
  if (rackCard) {
    const pos = parseInt(rackCard.dataset.pos);
    if (!isNaN(pos)) placeCard(pos);
  }
});

// Initial render
render();