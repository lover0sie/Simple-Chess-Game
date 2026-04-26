import { firebaseConfig } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, onSnapshot,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const pieceIcons = {
  p: "♟", r: "♜", n: "♞", b: "♝", q: "♛", k: "♚",
  P: "♙", R: "♖", N: "♘", B: "♗", Q: "♕", K: "♔"
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
$("surrenderBtn").onclick = surrender;
$("acceptUndoBtn").onclick = acceptUndo;
$("rejectUndoBtn").onclick = rejectUndo;

function switchMode(mode) {
  $("createBox").classList.toggle("hidden", mode !== "create");
  $("joinBox").classList.toggle("hidden", mode !== "join");
  $("showCreateBtn").classList.toggle("active", mode === "create");
  $("showJoinBtn").classList.toggle("active", mode === "join");
}

async function createRoom() {
  myName = $("hostNameInput").value.trim() || "White Player";
  mySide = "w";
  roomId = makeRoomCode();
  roomRef = doc(db, "chessRooms", roomId);
  const baseTime = Number($("timerSelect").value);

  await setDoc(roomRef, {
    roomId,
    status: "waiting",
    resultMessage: "",
    fen: new Chess().fen(),
    history: [],
    recentMove: null,
    whiteName: myName,
    blackName: "Waiting...",
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
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  enterGame();
}

async function joinRoom() {
  myName = $("guestNameInput").value.trim() || "Black Player";
  roomId = $("roomCodeInput").value.trim().toUpperCase();
  if (!roomId) return alert("Please enter a room code.");

  roomRef = doc(db, "chessRooms", roomId);
  const snap = await getDoc(roomRef);
  if (!snap.exists()) return alert("Room not found.");

  const data = snap.data();
  if (data.blackName && data.blackName !== "Waiting...") {
    return alert("This room already has two players.");
  }

  mySide = "b";
  await updateDoc(roomRef, {
    blackName: myName,
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
        const key = piece.color === "w" ? piece.type.toUpperCase() : piece.type;
        const pieceSpan = document.createElement("span");
        pieceSpan.className = `piece ${piece.color === "w" ? "white-piece" : "black-piece"}`;
        pieceSpan.textContent = pieceIcons[key];
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
  if (game.turn() !== mySide) return setMessage("Not your turn.");

  const piece = game.get(squareName);
  if (!selectedSquare) {
    if (!piece || piece.color !== mySide) return;
    selectSquare(squareName);
    return;
  }

  if (squareName === selectedSquare) return clearSelection();

  const before = new Chess(game.fen());
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

  await updateDoc(roomRef, {
    fen: game.fen(),
    history: game.history(),
    recentMove: { from: move.from, to: move.to },
    turn: game.turn(),
    [currentRemainingField]: newRemaining,
    capturedWhite: captured.capturedWhite,
    capturedBlack: captured.capturedBlack,
    whiteScore: scores.whiteScore,
    blackScore: scores.blackScore,
    status: nextStatus,
    resultMessage,
    undoRequestedBy: "",
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
    $("undoRequestBox").classList.add("hidden");
    return;
  }

  if (state.status === "finished") {
    $("turnText").textContent = "Game Over";
    $("messageText").textContent = state.resultMessage || "Game finished.";
    $("undoRequestBox").classList.add("hidden");
    return;
  }

  const hasPendingUndo =
    state.undoRequest &&
    state.undoRequest.status === "pending";

  const isOpponentRequest =
    hasPendingUndo && state.undoRequest.requestedBy !== mySide;

  $("undoRequestBox").classList.toggle("hidden", !isOpponentRequest);

  if (isOpponentRequest) {
    const requester =
      state.undoRequest.requestedBy === "w"
        ? state.whiteName
        : state.blackName;

    $("undoRequestText").textContent =
      `${requester} requested to undo the previous move.`;
  }

  $("requestUndoBtn").disabled = state.status !== "playing" || hasPendingUndo;

  if (hasPendingUndo && !isOpponentRequest) {
    $("messageText").textContent = "Undo request sent. Waiting for opponent.";
  } else {
    $("messageText").textContent = game.in_check() ? "Check!" : "Select a piece to move.";
  }

  const currentPlayer = game.turn() === "w" ? state.whiteName : state.blackName;
  $("turnText").textContent = `${currentPlayer} to move`;
}

async function requestUndo() {
  if (!roomRef || !mySide || state.status !== "playing") return;

  await updateDoc(roomRef, {
    undoRequest: {
      requestedBy: mySide,
      status: "pending",
      requestedAt: Date.now()
    },
    updatedAt: serverTimestamp()
  });
}

async function acceptUndo() {
  if (!roomRef || !state.undoRequest) return;

  game.undo();

  await updateDoc(roomRef, {
    fen: game.fen(),
    history: game.history(),
    turn: game.turn(),
    recentMove: null,
    undoRequest: null,
    updatedAt: serverTimestamp()
  });
}


async function rejectUndo() {
  await updateDoc(roomRef, {
    undoRequest: null,
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
  if (state.status === "playing") {
    const elapsed = getElapsedTurnSeconds();
    if (state.turn === "w") w = Math.max(0, w - elapsed);
    if (state.turn === "b") b = Math.max(0, b - elapsed);
  }
  $("whiteTimer").textContent = formatTime(w);
  $("blackTimer").textContent = formatTime(b);

  if (state.status === "playing" && (w <= 0 || b <= 0)) claimTimeout(w, b);
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
    const winner = game.turn() === "w" ? state.blackName : state.whiteName;
    return `${winner} wins by checkmate.`;
  }
  if (game.in_draw()) return "The game ended in a draw.";
  return "";
}

function makeRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
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
