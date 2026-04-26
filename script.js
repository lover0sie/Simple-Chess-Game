import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const pieceIcons = {
  p: "\u265F\uFE0E", r: "\u265C\uFE0E", n: "\u265E\uFE0E", b: "\u265D\uFE0E", q: "\u265B\uFE0E", k: "\u265A\uFE0E",
  P: "\u2659\uFE0E", R: "\u2656\uFE0E", N: "\u2658\uFE0E", B: "\u2657\uFE0E", Q: "\u2655\uFE0E", K: "\u2654\uFE0E"
};
const pieceValue = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const files = ["a", "b", "c", "d", "e", "f", "g", "h"];
const ranks = ["8", "7", "6", "5", "4", "3", "2", "1"];

let game = new Chess();
let roomId = "";
let mySide = "";
let myName = "";
let roomRef = null;
let unsubscribe = null;
let state = null;
let selectedSquare = null;
let possibleMoves = [];
let displayTimerId = null;
let lastTimeoutClaim = 0;

const $ = (id) => document.getElementById(id);
const setupPanel = $("setupPanel");
const gamePanel = $("gamePanel");
const boardEl = $("board");
const moveList = $("moveList");

$("showCreateBtn").onclick = () => switchMode("create");
$("showJoinBtn").onclick = () => switchMode("join");
$("createRoomBtn").onclick = createRoom;
$("joinRoomBtn").onclick = joinRoom;
$("copyRoomBtn").onclick = copyRoomCode;
$("leaveBtn").onclick = resetToSetup;
$("newGameBtn").onclick = resetToSetup;
$("returnMainBtn").onclick = resetToSetup;
$("requestUndoBtn").onclick = requestUndo;
$("acceptUndoBtn").onclick = acceptUndo;
$("rejectUndoBtn").onclick = rejectUndo;
$("surrenderBtn").onclick = surrender;

function switchMode(mode) {
  $("createBox").classList.toggle("hidden", mode !== "create");
  $("joinBox").classList.toggle("hidden", mode !== "join");
  $("showCreateBtn").classList.toggle("active", mode === "create");
  $("showJoinBtn").classList.toggle("active", mode === "join");
}

async function createRoom() {
  mySide = $("hostSideSelect").value;
  myName = $("hostNameInput").value.trim() || `${sideName(mySide)} Player`;
  roomId = makeRoomCode();
  roomRef = doc(db, "chessRooms", roomId);
  const baseTime = Number($("timerSelect").value);
  const hostIsWhite = mySide === "w";

  await setDoc(roomRef, {
    roomId,
    status: "waiting",
    resultMessage: "",
    fen: new Chess().fen(),
    history: [],
    recentMove: null,
    whiteName: hostIsWhite ? myName : "Waiting...",
    blackName: hostIsWhite ? "Waiting..." : myName,
    hostSide: mySide,
    whiteRemaining: baseTime,
    blackRemaining: baseTime,
    baseTime,
    turn: "w",
    turnStartedAt: serverTimestamp(),
    capturedWhite: [],
    capturedBlack: [],
    whiteScore: 0,
    blackScore: 0,
    undoRequest: null,
    resultReason: "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  enterGame();
}

async function joinRoom() {
  roomId = $("roomCodeInput").value.trim().toUpperCase();
  if (!roomId) return alert("Please enter a room code.");

  roomRef = doc(db, "chessRooms", roomId);
  const snap = await getDoc(roomRef);
  if (!snap.exists()) return alert("Room not found.");

  const data = snap.data();
  const hostSide = data.hostSide || (isOpenPlayerSlot(data.whiteName) ? "b" : "w");
  const joinSide = hostSide === "w" ? "b" : "w";
  const joinNameField = joinSide === "w" ? "whiteName" : "blackName";

  if (data.status !== "waiting" || !isOpenPlayerSlot(data[joinNameField])) {
    return alert("This room already has two players.");
  }

  mySide = joinSide;
  myName = $("guestNameInput").value.trim() || `${sideName(mySide)} Player`;

  await updateDoc(roomRef, {
    [joinNameField]: myName,
    status: "playing",
    turnStartedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  enterGame();
}

function enterGame() {
  setupPanel.classList.add("hidden");
  gamePanel.classList.remove("hidden");
  $("roomCodeText").textContent = roomId;
  $("youAreText").textContent = `You are ${mySide === "w" ? "White" : "Black"}`;

  clearInterval(displayTimerId);
  displayTimerId = setInterval(updateLiveTimers, 500);

  if (unsubscribe) unsubscribe();
  unsubscribe = onSnapshot(roomRef, (snap) => {
    if (!snap.exists()) return;
    state = snap.data();
    game = new Chess(state.fen || undefined);
    selectedSquare = null;
    possibleMoves = [];
    renderAll();
  });
}

function renderAll() {
  $("whiteName").textContent = state.whiteName || "White";
  $("blackName").textContent = state.blackName || "Black";
  $("whiteScore").textContent = `${state.whiteScore || 0} pts`;
  $("blackScore").textContent = `${state.blackScore || 0} pts`;
  $("whiteCaptured").textContent = iconsFromCaptured(state.capturedWhite).join(" ") || "-";
  $("blackCaptured").textContent = iconsFromCaptured(state.capturedBlack).join(" ") || "-";

  updateLiveTimers();
  renderBoard();
  renderHistory();
  renderStatus();
}

function renderBoard() {
  boardEl.innerHTML = "";
  const isBlack = mySide === "b";
  const showRanks = isBlack ? [...ranks].reverse() : ranks;
  const showFiles = isBlack ? [...files].reverse() : files;

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const squareName = showFiles[f] + showRanks[r];
      const square = document.createElement("div");
      const boardRankIndex = ranks.indexOf(showRanks[r]);
      const boardFileIndex = files.indexOf(showFiles[f]);
      const isLight = (boardRankIndex + boardFileIndex) % 2 === 0;
      square.className = `square ${isLight ? "light" : "dark"}`;
      square.dataset.square = squareName;

      if (squareName === selectedSquare) square.classList.add("selected");
      if (state.recentMove && (squareName === state.recentMove.from || squareName === state.recentMove.to)) square.classList.add("recent");
      if (possibleMoves.includes(squareName)) square.classList.add("possible");

      const piece = game.get(squareName);
      if (piece) {
        const pieceSpan = document.createElement("span");
        pieceSpan.className = "piece";
        pieceSpan.innerHTML = getPieceSvg(piece);
        square.appendChild(pieceSpan);
      }

      if (f === 0) addCoord(square, "coord-rank", showRanks[r]);
      if (r === 7) addCoord(square, "coord-file", showFiles[f]);
      square.onclick = () => handleSquareClick(squareName);
      boardEl.appendChild(square);
    }
  }
}

function addCoord(square, className, text) {
  const label = document.createElement("span");
  label.className = className;
  label.textContent = text;
  square.appendChild(label);
}

async function handleSquareClick(squareName) {
  if (!state || state.status !== "playing") return;
  if (hasPendingUndo()) return setMessage("Undo request is pending. Timer is paused.");
  if (game.turn() !== mySide) return setMessage("Not your turn.");

  const piece = game.get(squareName);
  if (!selectedSquare) {
    if (!piece || piece.color !== mySide) return;
    selectSquare(squareName);
    return;
  }

  if (squareName === selectedSquare) return clearSelection();

  const elapsed = getElapsedTurnSeconds();
  const move = game.move({ from: selectedSquare, to: squareName, promotion: "q" });

  if (!move) {
    if (piece && piece.color === mySide) selectSquare(squareName);
    else setMessage("Invalid move. Try again.");
    return;
  }

  const currentRemainingField = mySide === "w" ? "whiteRemaining" : "blackRemaining";
  const newRemaining = Math.max(0, Number(state[currentRemainingField] || 0) - elapsed);
  const captured = buildCaptured(new Chess(), game);
  const scores = calculateScores(captured.capturedWhite, captured.capturedBlack);
  const nextStatus = game.game_over() ? "finished" : "playing";
  const resultMessage = getResultMessage();
  const resultReason = game.in_checkmate() ? "checkmate" : game.in_draw() ? "draw" : "";
  const newHistory = [...(state.history || []), move.san];

  await updateDoc(roomRef, {
    fen: game.fen(),
    history: newHistory,
    recentMove: { from: move.from, to: move.to },
    turn: game.turn(),
    [currentRemainingField]: newRemaining,
    capturedWhite: captured.capturedWhite,
    capturedBlack: captured.capturedBlack,
    whiteScore: scores.whiteScore,
    blackScore: scores.blackScore,
    status: nextStatus,
    resultMessage,
    resultReason,
    undoRequest: null,
    turnStartedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

function selectSquare(squareName) {
  selectedSquare = squareName;
  possibleMoves = game.moves({ square: squareName, verbose: true }).map(m => m.to);
  renderBoard();
}
function clearSelection() { selectedSquare = null; possibleMoves = []; renderBoard(); }
function setMessage(text) { $("messageText").textContent = text; }

function getPieceSvg(piece) {
  const isWhite = piece.color === "w";
  const isBlack = !isWhite;
  const fill = isWhite ? "#fffdf0" : "#161d15";
  const stroke = isWhite ? "#b8ae78" : "#9d9663";
  const detail = isWhite ? "#b8ae78" : "#9d9663";
  const eye = isWhite ? "#b8ae78" : "#fffdf0";
  const shapes = {
    p: `
      <circle cx="32" cy="17" r="7.5"/>
      <path d="M24.5 30.5c0-5 3.2-8.5 7.5-8.5s7.5 3.5 7.5 8.5v7h-15z"/>
      <path d="M22 38.5h20v6H22z"/>
      <path d="M17.5 45h29l4.5 8.5H13z"/>
      <path class="piece-detail" d="M21 49.5h22"/>
    `,
    r: `
      <path d="M17 12h8v6h5v-6h4v6h5v-6h8v13H17z"/>
      <path d="M21.5 25h21v19.5h-21z"/>
      <path d="M18.5 44.5h27l5.5 9H13z"/>
      <path class="piece-detail" d="M23 31h18M23 38h18"/>
    `,
    n: `
      <path d="M17 52.5h31.5l-4.8-7.8H25.2c4.2-7.7 7-15.6 4.9-23.8-1.2-4.6-.3-9.2 2.4-13.4-9.4 5.7-15.1 14.5-14.2 25.2.3 4 1.5 7.4 3.1 10.7L17 52.5z"/>
      <path d="M29 14.8c3.4 4.8 8.5 7.7 15.2 10.1 4.1 1.5 6.3 4.2 6.5 7.8.2 3.9-2.8 5.9-6 5.3-5.2-.9-9.7-4.4-14-8.5 6.2 11.7 8.2 18.4-.8 23H18.7c6.9-9.6 8.2-17.5 5.8-25.8-1.5-5.2-.3-9.3 4.5-11.9z"/>
      <path d="M17.5 52.5h32.5v4.5H14.5c0-2.4 1.1-4.5 3-4.5z"/>
      <path d="M21.8 44.4h23.3c1.4 0 2.5 1.1 2.5 2.5s-1.1 2.5-2.5 2.5H20.5c-1.4 0-2.5-1.1-2.5-2.5s1.1-2.5 3.8-2.5z"/>
      <path class="piece-detail" d="${isBlack ? "M22.2 14.1c-6.7 8.5-8.1 18-4.2 28.4" : "M27.5 9.3c-7.8 8.2-9.9 18.2-5.8 29.8"}"/>
      <path class="piece-detail" d="M31.6 27.2c4.7 2.6 9.7 3 14.8 1.5"/>
      <circle cx="39.9" cy="22.9" r="1.3" fill="${eye}" stroke="none"/>
    `,
    b: `
      <rect x="27" y="6.5" width="10" height="4.8" rx="2.4"/>
      <path d="M31.5 11.5c-5.7 7.3-9.2 12.1-9.2 18.4 0 6.8 4.3 11.4 9.7 13.8 5.4-2.4 9.7-7 9.7-13.8 0-6.3-3.5-11.1-9.2-18.4z"/>
      <path d="M28.8 43.5h6.4l1.8 12H27z"/>
      <path d="M22.2 47h19.6v4.8H22.2z"/>
      <path d="M19.5 51.8h25v4.8h-25z"/>
      <path d="M16.5 56.6h31l5.3 6.3H11.2z"/>
      <path d="M13.5 62.9h37v3.8h-37z"/>
      <path class="piece-detail" d="${isBlack ? "M26.3 20.5c-4.3 6.2-4.7 11.8-1.4 16.8" : "M26.2 20.5c-4.3 6.2-4.8 11.7-1.6 16.3"}"/>
      <path class="piece-detail" d="${isWhite ? "M24.6 33.8c.7 1.6 1.6 2.9 2.8 3.9" : ""}"/>
    `,
    q: `
      <circle cx="15.5" cy="18.5" r="4.7"/>
      <circle cx="24.5" cy="13.2" r="4.7"/>
      <circle cx="32" cy="11" r="4.7"/>
      <circle cx="39.5" cy="13.2" r="4.7"/>
      <circle cx="48.5" cy="18.5" r="4.7"/>
      <path d="M16 24l6.5 19h19L48 24 38.5 34.5 32 19 25.5 34.5z"/>
      <path d="M18 44.5h28l5 9H13z"/>
      <path class="piece-detail" d="M23 42.5h18"/>
    `,
    k: `
      <path d="M29 8h6v8.5h8.5v6H35V31h-6v-8.5h-8.5v-6H29z"/>
      <path d="M22.5 34c0-5.6 4.2-9 9.5-9s9.5 3.4 9.5 9v10.5h-19z"/>
      <path d="M18 44.5h28l5 9H13z"/>
      <path class="piece-detail" d="M24.5 38h15"/>
    `
  };

  return `
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" class="${isWhite ? "white-svg-piece" : "black-svg-piece"}">
      <g fill="${fill}" stroke="${stroke}" stroke-width="${piece.type === "n" || piece.type === "b" ? "2.2" : "2.8"}" stroke-linejoin="round" stroke-linecap="round" style="--piece-detail:${detail};--piece-eye:${eye}">
        ${shapes[piece.type]}
      </g>
    </svg>
  `;
}

function hideUndoPopup() {
  $("undoRequestBox").classList.add("hidden");
  $("undoActions").classList.add("hidden");
}

function hideGameOverPopup() {
  $("gameOverBox").classList.add("hidden");
}

function renderGameOverPopup() {
  if (state.resultReason !== "checkmate") {
    hideGameOverPopup();
    return;
  }

  $("gameOverText").textContent = state.resultMessage || "Game finished by checkmate.";
  $("gameOverBox").classList.remove("hidden");
}

function renderHistory() {
  moveList.innerHTML = "";
  (state.history || []).forEach((move) => {
    const li = document.createElement("li");
    li.textContent = move;
    moveList.appendChild(li);
  });
}

function renderStatus() {
  $("whiteCard").classList.toggle("active-player", state.status === "playing" && game.turn() === "w");
  $("blackCard").classList.toggle("active-player", state.status === "playing" && game.turn() === "b");

  $("newGameBtn").classList.toggle("hidden", state.status !== "finished");
  $("surrenderBtn").disabled = state.status !== "playing";

  if (state.status === "waiting") {
    $("turnText").textContent = "Waiting for opponent";
    $("messageText").textContent = "Share the room code with your friend.";
    hideUndoPopup();
    hideGameOverPopup();
    return;
  }

  if (state.status === "finished") {
    $("turnText").textContent = "Game Over";
    $("messageText").textContent = state.resultMessage || "Game finished.";
    hideUndoPopup();
    renderGameOverPopup();
    return;
  }

  hideGameOverPopup();

  const pendingUndo = hasPendingUndo();

  const isOpponentRequest =
    pendingUndo && state.undoRequest.requestedBy !== mySide;

  $("undoRequestBox").classList.toggle("hidden", !pendingUndo);
  $("undoActions").classList.toggle("hidden", !isOpponentRequest);

  if (pendingUndo) {
    const requester =
      state.undoRequest.requestedBy === "w"
        ? state.whiteName
        : state.blackName;
    const moveLabel = getUndoMoveLabel(state.undoRequest.undoPlyCount);

    $("undoRequestTitle").textContent = isOpponentRequest
      ? "Undo request"
      : "Request sent";
    $("undoRequestText").textContent =
      isOpponentRequest
        ? `${requester} wants to undo ${moveLabel}.`
        : `Waiting for your opponent to respond to your request to undo ${moveLabel}.`;
    $("undoRequestHint").textContent = isOpponentRequest
      ? "The game clock is paused until you accept or reject."
      : "The game clock is paused while your opponent decides.";
  }

  $("requestUndoBtn").disabled =
    state.status !== "playing" ||
    pendingUndo ||
    !(state.history || []).length;

  if (pendingUndo && !isOpponentRequest) {
    $("messageText").textContent = "Awaiting response from opponent. Timer paused.";
  } else if (isOpponentRequest) {
    $("messageText").textContent = "Undo request received. Timer paused.";
  } else {
    $("messageText").textContent = game.in_check() ? "Check!" : "Select a piece to move.";
  }

  const currentPlayer = game.turn() === "w" ? state.whiteName : state.blackName;
  $("turnText").textContent = `${currentPlayer} to move`;
}

async function requestUndo() {
  if (!roomRef || !mySide || state.status !== "playing") return;
  if (hasPendingUndo()) return;
  if (!(state.history || []).length) {
    return setMessage("No move is available to undo yet.");
  }

  const undoPlyCount = getUndoPlyCount(mySide);
  const activeSide = state.turn === "w" ? "white" : "black";
  const activeRemainingField = activeSide === "white" ? "whiteRemaining" : "blackRemaining";
  const activeRemaining = Math.max(
    0,
    Number(state[activeRemainingField] || 0) - getElapsedTurnSeconds()
  );

  await updateDoc(roomRef, {
    undoRequest: {
      requestedBy: mySide,
      status: "pending",
      undoPlyCount,
      requestedAt: Date.now()
    },
    [activeRemainingField]: activeRemaining,
    updatedAt: serverTimestamp()
  });
}

async function acceptUndo() {
  if (!roomRef || !hasPendingUndo() || state.undoRequest.requestedBy === mySide) return;

  const undoPlyCount = state.undoRequest.undoPlyCount || getUndoPlyCount(state.undoRequest.requestedBy);
  const restoredState = buildStateAfterUndo(undoPlyCount);

  await updateDoc(roomRef, {
    fen: restoredState.game.fen(),
    history: restoredState.history,
    turn: restoredState.game.turn(),
    recentMove: restoredState.recentMove,
    capturedWhite: restoredState.capturedWhite,
    capturedBlack: restoredState.capturedBlack,
    whiteScore: restoredState.whiteScore,
    blackScore: restoredState.blackScore,
    undoRequest: null,
    turnStartedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}


async function rejectUndo() {
  if (!roomRef || !hasPendingUndo() || state.undoRequest.requestedBy === mySide) return;
  await updateDoc(roomRef, {
    undoRequest: null,
    turnStartedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

async function surrender() {
  if (!state || state.status !== "playing") return;
  const myDisplayName = mySide === "w" ? state.whiteName : state.blackName;
  const winnerName = mySide === "w" ? state.blackName : state.whiteName;
  const ok = confirm(`${myDisplayName}, are you sure you want to surrender?`);
  if (!ok) return;
  await updateDoc(roomRef, {
    status: "finished",
    resultMessage: `${winnerName} wins. ${myDisplayName} surrendered.`,
    updatedAt: serverTimestamp()
  });
  alert(`Game Over! ${winnerName} wins.`);
  resetToSetup();
}

function updateLiveTimers() {
  if (!state) return;
  let w = Number(state.whiteRemaining || 0);
  let b = Number(state.blackRemaining || 0);
  if (state.status === "playing" && !hasPendingUndo()) {
    const elapsed = getElapsedTurnSeconds();
    if (state.turn === "w") w = Math.max(0, w - elapsed);
    if (state.turn === "b") b = Math.max(0, b - elapsed);
  }
  $("whiteTimer").textContent = formatTime(w);
  $("blackTimer").textContent = formatTime(b);

  if (state.status === "playing" && !hasPendingUndo() && (w <= 0 || b <= 0)) claimTimeout(w, b);
}

function hasPendingUndo() {
  return Boolean(state && state.undoRequest && state.undoRequest.status === "pending");
}

function getUndoPlyCount(requestedBy) {
  const historyLength = (state.history || []).length;
  const requestedOnOwnTurn = state.turn === requestedBy;
  return Math.min(requestedOnOwnTurn ? 2 : 1, historyLength);
}

function getUndoMoveLabel(undoPlyCount = 1) {
  return undoPlyCount > 1 ? "the previous two moves" : "the previous move";
}

function buildStateAfterUndo(undoPlyCount) {
  const targetHistory = (state.history || []).slice(0, -undoPlyCount);
  const rebuiltGame = new Chess();
  let recentMove = null;

  targetHistory.forEach((san) => {
    const move = rebuiltGame.move(san);
    if (move) recentMove = { from: move.from, to: move.to };
  });

  const captured = buildCaptured(new Chess(), rebuiltGame);
  const scores = calculateScores(captured.capturedWhite, captured.capturedBlack);

  return {
    game: rebuiltGame,
    history: rebuiltGame.history(),
    recentMove,
    capturedWhite: captured.capturedWhite,
    capturedBlack: captured.capturedBlack,
    whiteScore: scores.whiteScore,
    blackScore: scores.blackScore
  };
}

async function claimTimeout(w, b) {
  const now = Date.now();
  if (now - lastTimeoutClaim < 3000) return;
  lastTimeoutClaim = now;
  const winner = w <= 0 ? state.blackName : state.whiteName;
  const loser = w <= 0 ? state.whiteName : state.blackName;
  await updateDoc(roomRef, {
    status: "finished",
    resultMessage: `${winner} wins. ${loser} ran out of time.`,
    updatedAt: serverTimestamp()
  });
}

function getElapsedTurnSeconds() {
  if (!state.turnStartedAt) return 0;
  let startMs = Date.now();
  if (state.turnStartedAt instanceof Timestamp) startMs = state.turnStartedAt.toDate().getTime();
  else if (state.turnStartedAt.toDate) startMs = state.turnStartedAt.toDate().getTime();
  return Math.max(0, Math.floor((Date.now() - startMs) / 1000));
}

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function buildCaptured(startGame, currentGame) {
  const initial = countPieces(startGame.board());
  const current = countPieces(currentGame.board());
  const capturedWhite = [];
  const capturedBlack = [];
  for (const key of Object.keys(initial)) {
    const missing = initial[key] - (current[key] || 0);
    for (let i = 0; i < missing; i++) {
      const color = key[0];
      const type = key[1];
      if (color === "w") capturedBlack.push(type);
      else capturedWhite.push(type);
    }
  }
  return { capturedWhite, capturedBlack };
}

function countPieces(board) {
  const counts = {};
  board.flat().forEach(p => {
    if (!p) return;
    const key = p.color + p.type;
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function calculateScores(capturedWhite, capturedBlack) {
  return {
    whiteScore: capturedWhite.reduce((sum, p) => sum + (pieceValue[p] || 0), 0),
    blackScore: capturedBlack.reduce((sum, p) => sum + (pieceValue[p] || 0), 0)
  };
}

function iconsFromCaptured(list = []) {
  return list.map(type => pieceIcons[type]);
}

function getResultMessage() {
  if (game.in_checkmate()) {
    const winnerSide = game.turn() === "w" ? "Black" : "White";
    const winnerName = winnerSide === "White" ? state.whiteName : state.blackName;
    return `${winnerSide} ${winnerName} wins by checkmate.`;
  }
  if (game.in_draw()) return "The game ended in a draw.";
  return "";
}

function makeRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function sideName(side) {
  return side === "w" ? "White" : "Black";
}

function isOpenPlayerSlot(name) {
  return !name || String(name).trim().toLowerCase().startsWith("waiting");
}

async function copyRoomCode() {
  await navigator.clipboard.writeText(roomId);
  alert("Room code copied.");
}

function resetToSetup() {
  if (unsubscribe) unsubscribe();
  unsubscribe = null;
  clearInterval(displayTimerId);
  state = null;
  roomId = "";
  roomRef = null;
  mySide = "";
  myName = "";
  selectedSquare = null;
  possibleMoves = [];
  setupPanel.classList.remove("hidden");
  gamePanel.classList.add("hidden");
}
