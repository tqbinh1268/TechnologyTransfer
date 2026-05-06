const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/sample', (req, res) => {
  const filePath = path.join(__dirname, 'data', 'technology_transfer.json');
  if (fs.existsSync(filePath)) {
    res.download(filePath, 'sample_game.json');
  } else {
    // If not exists, return the default structure
    res.json({
      "id": "new_game",
      "name": "Game Mới",
      "verticalAnswerValue": "TUKHOA",
      "verticalAnswerHint": "Gợi ý từ khóa dọc...",
      "words": [
        { "answer": "DAPAN1", "question": "Câu hỏi 1...", "offset": 0, "verticalIndex": 0 }
      ]
    });
  }
});


// In-memory Game State
const state = {
  players: {}, // socketId -> { name, score }
  revealedWords: {}, // index -> true (which horizontal words are revealed)
  activeQuestion: null, // index of the active question (0-8)
  leaderboard: [],
  currentAnswers: {}, // socketId -> { answer, time }
  verticalBuzzer: {
    locked: false,
    bySocketId: null,
    playerName: null,
    timeoutId: null,
    answerSubmitted: null
  }
};

const gameLogs = [];
function addLog(msg) {
  const time = new Date().toLocaleTimeString('vi-VN');
  const logStr = `[${time}] ${msg}`;
  gameLogs.push(logStr);
  io.emit('new_log', logStr);
}



let games = {};
try {
  const dataDir = path.join(__dirname, 'data');
  if (fs.existsSync(dataDir)) {
    const files = fs.readdirSync(dataDir);
    for (const f of files) {
      if (f.endsWith('.json')) {
        const g = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf-8'));
        games[g.id] = g;
      }
    }
  }
} catch (e) {
  console.error("Error loading games:", e);
}

if (Object.keys(games).length === 0) {
  games['default'] = { id: 'default', name: 'Mặc định', verticalAnswerValue: '', verticalAnswerHint: '', words: [] };
}

let currentGameId = Object.keys(games)[0];
function getGame() {
  return games[currentGameId] || Object.values(games)[0];
}


let activeQuestionStartTime = 0;

function updateLeaderboard() {
  state.leaderboard = Object.values(state.players).sort((a, b) => b.score - a.score);
  io.emit('update_leaderboard', state.leaderboard);
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.emit('init_state', {
    games: Object.values(games).map(g => ({id: g.id, name: g.name})),
    currentGameId: currentGameId,
    activeQuestion: state.activeQuestion,
    questionText: state.activeQuestion !== null ? getGame().words[state.activeQuestion].question : "",
    revealedWords: state.revealedWords,
    leaderboard: state.leaderboard,
    crosswordLayout: getGame().words.map((w, i) => ({ length: w.answer.length, index: i, offset: w.offset, verticalIndex: w.verticalIndex })),
    verticalBuzzerLocked: state.verticalBuzzer.locked,
    buzzedPlayer: state.verticalBuzzer.playerName,
    gameLogs: gameLogs
  });

  socket.on('join_game', (data) => {
    let name = '';
    let playerId = socket.id;

    if (typeof data === 'object') {
       name = data.name.trim();
       playerId = data.playerId;
    } else {
       name = data.trim();
    }

    socket.playerId = playerId;
    socket.join(playerId);

    if (!state.players[playerId]) {
      state.players[playerId] = { name: name, score: 0 };
      addLog(`👤 Người chơi "${name}" đã tham gia.`);
    } else {
      state.players[playerId].name = name;
    }

    updateLeaderboard();
    socket.emit('joined', { name: state.players[playerId].name, score: state.players[playerId].score });
  });

  socket.on('submit_answer', (answer) => {
    if (state.activeQuestion === null) {
      socket.emit('answer_feedback', { success: false, message: "Chưa có câu hỏi nào được mở." });
      return;
    }
    
    if (state.revealedWords[state.activeQuestion]) {
      socket.emit('answer_feedback', { success: false, message: "Câu hỏi này đã khép lại." });
      return;
    }
    
    state.currentAnswers[socket.playerId] = {
      answer: answer.trim().toUpperCase(),
      time: Date.now()
    };
    const pName = state.players[socket.playerId] ? state.players[socket.playerId].name : "Ẩn danh";
    addLog(`✍️ ${pName} đã nộp đáp án: "${answer.trim().toUpperCase()}"`);
    
    socket.emit('answer_received', { message: 'Đã lưu đáp án! Cùng nín thở chờ kết quả nhé... 🫣' });
  });
  
  // Vertical Buzzer Logic
  socket.on('buzz_vertical', () => {
    if (state.verticalBuzzer.locked) {
      socket.emit('answer_feedback', { success: false, message: "Người khác đã giành quyền!" });
      return;
    }
    
    state.verticalBuzzer.locked = true;
    state.verticalBuzzer.bySocketId = socket.playerId;
    state.verticalBuzzer.playerName = state.players[socket.playerId] ? state.players[socket.playerId].name : "Ẩn danh";
    state.verticalBuzzer.answerSubmitted = null;
    state.verticalBuzzer.answerSubmitted = null;

    addLog(`🔔 ${state.verticalBuzzer.playerName} đã bấm chuông giành quyền trả lời từ khóa dọc!`);
    io.emit('buzzer_locked', { playerName: state.verticalBuzzer.playerName });
    socket.emit('buzzer_granted', { timeout: 30, hint: getGame().verticalAnswerHint });

    state.verticalBuzzer.timeoutId = setTimeout(() => {
      if (state.verticalBuzzer.bySocketId === socket.playerId && !state.verticalBuzzer.answerSubmitted) {
         io.emit('answer_feedback', { success: false, message: `Hết 30 giây! ${state.verticalBuzzer.playerName} chưa kịp trả lời.` });
         state.verticalBuzzer.locked = false;
         state.verticalBuzzer.bySocketId = null;
         state.verticalBuzzer.playerName = null;
         io.emit('buzzer_unlocked');
      }
    }, 30000);
  });

  socket.on('submit_vertical', (answer) => {
     if (state.verticalBuzzer.bySocketId !== socket.playerId) return;
     
     if (state.verticalBuzzer.timeoutId) {
        clearTimeout(state.verticalBuzzer.timeoutId);
     }
     
     state.verticalBuzzer.answerSubmitted = answer.trim().toUpperCase();
     addLog(`🎯 ${state.verticalBuzzer.playerName} chốt hạ từ khóa dọc: "${answer.trim().toUpperCase()}"`);
     socket.emit('answer_received', { message: "Đã nộp bài! Đang chờ Host phán quyết..." });
     
     io.emit('host_vertical_submission', { 
       playerName: state.verticalBuzzer.playerName, 
       answer: state.verticalBuzzer.answerSubmitted 
     });
  });

  socket.on('admin_open_question', (index) => {
    state.activeQuestion = index;
    state.currentAnswers = {}; // reset answers for the new question
    activeQuestionStartTime = Date.now();
    addLog(`📖 Host đã mở Câu ${index + 1}`);
    io.emit('new_question', { index, text: getGame().words[index].question });
  });

  socket.on('admin_reveal_word', (index) => {
    if (!state.revealedWords[index]) {
      state.revealedWords[index] = true;
      const correctAnswer = getGame().words[index].answer.toUpperCase();
      let fastestPlayer = null;
      let fastestTime = Infinity;

      if (state.activeQuestion === index) {
        Object.entries(state.currentAnswers).forEach(([playerId, data]) => {
          if (data.answer === correctAnswer) {
            // Correct
            const timeTaken = data.time - activeQuestionStartTime;
            if (timeTaken < fastestTime) {
                fastestTime = timeTaken;
                fastestPlayer = state.players[playerId] ? state.players[playerId].name : "Ẩn danh";
            }
            const baseScore = 100;
            const timePenalty = Math.floor((timeTaken / 1000) * 2);
            let earned = baseScore - timePenalty;
            if (earned < 20) earned = 20;

            if (state.players[playerId]) {
              state.players[playerId].score += earned;
            }
            io.to(playerId).emit('question_result', { win: true, earned, score: state.players[playerId].score, message: `Tuyệt Vời! Bạn nộp bài nhanh và được cộng ${earned} điểm! 🎉` });
          } else {
            // Wrong
            io.to(playerId).emit('question_result', { win: false, earned: 0, score: state.players[playerId] ? state.players[playerId].score : 0, message: "Ối giời ơi, sai bét! Chúc bạn may mắn câu sau nhé 🥲" });
          }
        });
      }

      state.activeQuestion = null; // Close question
      state.currentAnswers = {};
      updateLeaderboard();
      addLog(`🔓 Host công bố đáp án Câu ${index + 1}: ${correctAnswer} (Nhanh nhất: ${fastestPlayer || 'Không có ai'})`);
      io.emit('word_revealed', { index, word: getGame().words[index].answer, winner: fastestPlayer || "Quá chậm hoặc Không ai đúng" });
    }
  });

  socket.on('admin_resolve_vertical', () => {
      const isCorrect = (state.verticalBuzzer.answerSubmitted === getGame().verticalAnswerValue);
      if (isCorrect) {
          addLog(`🏆 XUẤT SẮC! ${state.verticalBuzzer.playerName} đã trả lời ĐÚNG từ khóa dọc!`);
          io.emit('vertical_winner', {
             playerName: state.verticalBuzzer.playerName,
             answer: state.verticalBuzzer.answerSubmitted,
             correctWord: getGame().verticalAnswerValue
          });
      } else {
          addLog(`❌ Rất tiếc! ${state.verticalBuzzer.playerName} đã trả lời SAI từ khóa dọc.`);
          io.emit('vertical_wrong', { playerName: state.verticalBuzzer.playerName });
          io.emit('answer_feedback', { success: false, message: `Oài! Khán giả ${state.verticalBuzzer.playerName} chốt hạ sai rồi. Chuông giành quyền đã mở lại nhé!` });
          state.verticalBuzzer.locked = false;
          state.verticalBuzzer.bySocketId = null;
          state.verticalBuzzer.playerName = null;
          state.verticalBuzzer.answerSubmitted = null;
          io.emit('buzzer_unlocked');
      }
  });

  socket.on('admin_select_game', (gameId) => {
    if (games[gameId]) {
      currentGameId = gameId;
      state.players = {};
      state.revealedWords = {};
      state.activeQuestion = null;
      state.leaderboard = [];
      state.currentAnswers = {};
      state.verticalBuzzer = { locked: false, bySocketId: null, playerName: null, timeoutId: null, answerSubmitted: null };
      updateLeaderboard();
      addLog(`🔄 Đã chuyển sang trò chơi mới: ${games[gameId].name}`);
      io.emit('game_reset', { newLayout: getGame().words.map((w, i) => ({ length: w.answer.length, index: i, offset: w.offset, verticalIndex: w.verticalIndex })) });
      io.emit('init_state', {
        games: Object.values(games).map(g => ({id: g.id, name: g.name})),
        currentGameId: currentGameId,
        activeQuestion: state.activeQuestion,
        questionText: "",
        revealedWords: state.revealedWords,
        leaderboard: state.leaderboard,
        crosswordLayout: getGame().words.map((w, i) => ({ length: w.answer.length, index: i, offset: w.offset, verticalIndex: w.verticalIndex })),
        verticalBuzzerLocked: state.verticalBuzzer.locked,
        buzzedPlayer: state.verticalBuzzer.playerName,
        gameLogs: gameLogs
      });
    }
  });

  socket.on('admin_upload_game', (gameData) => {
    try {
      const dataDir = path.join(__dirname, 'data');
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir);
      }
      // Basic sanitization of ID
      const safeId = gameData.id.replace(/[^a-zA-Z0-9_-]/g, '');
      if(!safeId) return;
      gameData.id = safeId;
      
      const filePath = path.join(dataDir, safeId + '.json');
      fs.writeFileSync(filePath, JSON.stringify(gameData, null, 2));
      
      games[safeId] = gameData;
      currentGameId = safeId;
      
      // Reset state
      state.players = {};
      state.revealedWords = {};
      state.activeQuestion = null;
      state.leaderboard = [];
      state.currentAnswers = {};
      state.verticalBuzzer = { locked: false, bySocketId: null, playerName: null, timeoutId: null, answerSubmitted: null };
      updateLeaderboard();
      
      addLog(`📤 Host đã tải lên và chuyển sang trò chơi mới: ${gameData.name}`);
      io.emit('game_reset', { newLayout: getGame().words.map((w, i) => ({ length: w.answer.length, index: i, offset: w.offset, verticalIndex: w.verticalIndex })) });
      io.emit('init_state', {
        games: Object.values(games).map(g => ({id: g.id, name: g.name})),
        currentGameId: currentGameId,
        activeQuestion: state.activeQuestion,
        questionText: "",
        revealedWords: state.revealedWords,
        leaderboard: state.leaderboard,
        crosswordLayout: getGame().words.map((w, i) => ({ length: w.answer.length, index: i, offset: w.offset, verticalIndex: w.verticalIndex })),
        verticalBuzzerLocked: state.verticalBuzzer.locked,
        buzzedPlayer: state.verticalBuzzer.playerName,
        gameLogs: gameLogs
      });
    } catch (e) {
      console.error("Error uploading game:", e);
    }
  });

  socket.on('admin_reset_game', () => {
    state.players = {};
    state.revealedWords = {};
    state.activeQuestion = null;
    state.leaderboard = [];
    state.currentAnswers = {};
    state.verticalBuzzer = { locked: false, bySocketId: null, playerName: null, timeoutId: null, answerSubmitted: null };
    updateLeaderboard();
    addLog(`🔄 Trò chơi đã được reset (Bắt đầu lại từ đầu)`);
    io.emit('game_reset');
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const os = require('os');
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

server.listen(PORT, '0.0.0.0', () => {
  const ip = getLocalIpAddress();
  console.log(`Crossword server listening on http://${ip}:${PORT}`);
});
