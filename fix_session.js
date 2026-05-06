const fs = require('fs');

// Fix client.js
let clientJs = fs.readFileSync('public/js/client.js', 'utf-8');

const clientSessionLogic = `
let playerId = localStorage.getItem('playerId');
if (!playerId) {
  playerId = Math.random().toString(36).substring(2, 15);
  localStorage.setItem('playerId', playerId);
}

socket.on('connect', () => {
  const savedName = localStorage.getItem('playerName');
  if (savedName) {
    inputName.value = savedName;
    socket.emit('join_game', { playerId, name: savedName });
  }
});

btnJoin.addEventListener('click', () => {
  const name = inputName.value.trim();
  if (name.length < 2) {
    alert("Vui lòng nhập tên hợp lệ (ít nhất 2 ký tự).");
    return;
  }
  localStorage.setItem('playerName', name);
  socket.emit('join_game', { playerId, name });
});
`;

clientJs = clientJs.replace(/btnJoin\.addEventListener\('click', \(\) => \{[\s\S]*?\}\);/, clientSessionLogic);
fs.writeFileSync('public/js/client.js', clientJs);

// Fix server.js
let serverJs = fs.readFileSync('server.js', 'utf-8');

// Replace join_game
const joinRegex = /socket\.on\('join_game', \(name\) => \{[\s\S]*?\}\);/;
const newJoin = `socket.on('join_game', (data) => {
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
      addLog(\`👤 Người chơi "\${name}" đã tham gia.\`);
    } else {
      state.players[playerId].name = name;
    }

    updateLeaderboard();
    socket.emit('joined', { name: state.players[playerId].name, score: state.players[playerId].score });
  });`;
serverJs = serverJs.replace(joinRegex, newJoin);

// Replace socket.id with socket.playerId in handlers
serverJs = serverJs.replace(/state\.currentAnswers\[socket\.id\]/g, 'state.currentAnswers[socket.playerId]');
serverJs = serverJs.replace(/state\.players\[socket\.id\]/g, 'state.players[socket.playerId]');
serverJs = serverJs.replace(/state\.verticalBuzzer\.bySocketId === socket\.id/g, 'state.verticalBuzzer.bySocketId === socket.playerId');
serverJs = serverJs.replace(/state\.verticalBuzzer\.bySocketId !== socket\.id/g, 'state.verticalBuzzer.bySocketId !== socket.playerId');
serverJs = serverJs.replace(/state\.verticalBuzzer\.bySocketId = socket\.id/g, 'state.verticalBuzzer.bySocketId = socket.playerId');
serverJs = serverJs.replace(/const pName = state\.players\[socket\.id\] \? state\.players\[socket\.id\]\.name : "Ẩn danh";/, 'const pName = state.players[socket.playerId] ? state.players[socket.playerId].name : "Ẩn danh";');

// In admin_reveal_word, replace socket logic with io.to()
const revealRegex = /Object\.entries\(state\.currentAnswers\)\.forEach\(\(\[socketId, data\]\) => \{[\s\S]*?\}\);/g;

const newReveal = `Object.entries(state.currentAnswers).forEach(([playerId, data]) => {
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
            io.to(playerId).emit('question_result', { win: true, earned, score: state.players[playerId].score, message: \`Tuyệt Vời! Bạn nộp bài nhanh và được cộng \${earned} điểm! 🎉\` });
          } else {
            // Wrong
            io.to(playerId).emit('question_result', { win: false, earned: 0, score: state.players[playerId] ? state.players[playerId].score : 0, message: "Ối giời ơi, sai bét! Chúc bạn may mắn câu sau nhé 🥲" });
          }
        });`;
serverJs = serverJs.replace(revealRegex, newReveal);

fs.writeFileSync('server.js', serverJs);
console.log("Done refactoring sessions");
