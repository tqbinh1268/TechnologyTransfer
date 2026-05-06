const socket = io();

// DOM Elements
const loginView = document.getElementById('login-view');
const gameView = document.getElementById('game-view');
const btnJoin = document.getElementById('btn-join');
const inputName = document.getElementById('player-name');

const displayName = document.getElementById('display-name');
const displayScore = document.getElementById('display-score');

const questionNumber = document.getElementById('question-number');
const questionText = document.getElementById('question-text');

const answerInput = document.getElementById('answer-input');
const btnSubmit = document.getElementById('btn-submit');
const feedbackMsg = document.getElementById('feedback-msg');

const resultModal = document.getElementById('result-modal');
const resultTitle = document.getElementById('result-title');
const resultMessage = document.getElementById('result-message');
const resultBox = document.querySelector('.result-box');
const btnCloseModal = document.getElementById('btn-close-modal');

// Vertical Buzzer Elements
const btnBuzz = document.getElementById('btn-buzz');
const verticalModal = document.getElementById('vertical-modal');
const verticalInput = document.getElementById('vertical-input');
const btnSubmitVertical = document.getElementById('btn-submit-vertical');
const verticalTimer = document.getElementById('vertical-timer');
const verticalHintText = document.getElementById('vertical-hint-text');

let verticalInterval = null;

btnCloseModal.addEventListener('click', () => {
  resultModal.style.display = 'none';
});

btnBuzz.addEventListener('click', () => {
    if(window.SoundManager) window.SoundManager.playPop();
    socket.emit('buzz_vertical');
});

btnSubmitVertical.addEventListener('click', () => {
    const val = verticalInput.value;
    if(val) {
        socket.emit('submit_vertical', val);
        verticalModal.style.display = 'none';
        verticalInput.value = '';
    }
});

let currentActiveQuestion = null;
let cwLayout = [];


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


btnSubmit.addEventListener('click', () => {
  if(window.SoundManager) window.SoundManager.playPop();
  const answer = answerInput.value.trim();
  if (!answer) return;
  socket.emit('submit_answer', answer);
  answerInput.value = "";
  btnSubmit.disabled = true;
  feedbackMsg.className = "feedback";
  feedbackMsg.textContent = "Đang gửi đáp án...";
});

// Socket Listeners
socket.on('joined', (data) => {
  loginView.style.display = 'none';
  gameView.style.display = 'flex';
  displayName.textContent = data.name;
  displayScore.textContent = data.score;
});

socket.on('init_state', (state) => {
  cwLayout = state.crosswordLayout;
  if (state.activeQuestion !== null) {
    currentActiveQuestion = state.activeQuestion;
    const wordLen = cwLayout[state.activeQuestion].length;
    questionNumber.textContent = `Câu Số ${state.activeQuestion + 1} (${wordLen} chữ cái)`;
    questionText.textContent = state.questionText;
    answerInput.disabled = false;
    btnSubmit.disabled = false;
    feedbackMsg.textContent = "";
  } else {
    currentActiveQuestion = null;
    questionNumber.textContent = "Chờ câu hỏi mới...";
    questionText.textContent = "Host vẫn chưa mở câu hỏi nào, vui lòng chờ trong giây lát.";
    answerInput.disabled = true;
    btnSubmit.disabled = true;
  }
});

socket.on('new_question', (data) => {
  if(window.SoundManager) window.SoundManager.playOpen();
  currentActiveQuestion = data.index;
  const wordLen = cwLayout[data.index].length;
  questionNumber.textContent = `Câu Số ${data.index + 1} (${wordLen} chữ cái)`;
  questionText.textContent = data.text;
  answerInput.disabled = false;
  btnSubmit.disabled = false;
  feedbackMsg.textContent = "";
  answerInput.focus();
});

socket.on('word_revealed', (data) => {
  if (data.index === currentActiveQuestion) {
    currentActiveQuestion = null;
    questionNumber.textContent = "Câu hỏi đã đóng";
    questionText.textContent = `Đáp án là: ${data.word} - Người trả lời nhanh nhất: ${data.winner}`;
    answerInput.disabled = true;
    btnSubmit.disabled = true;
  }
});

socket.on('answer_received', (data) => {
  feedbackMsg.className = "feedback success";
  feedbackMsg.textContent = data.message;
});

socket.on('question_result', (data) => {
  if(data.win) {
    if(window.SoundManager) window.SoundManager.playCorrect();
    resultTitle.textContent = "🎉 Chính Xác!";
    resultBox.className = "result-box glass-panel win";
  } else {
    if(window.SoundManager) window.SoundManager.playWrong();
    resultTitle.textContent = "😅 Rất Tiếc!";
    resultBox.className = "result-box glass-panel lose";
  }
  
  resultMessage.textContent = data.message;
  displayScore.textContent = data.score;
  resultModal.style.display = 'flex';
  
  setTimeout(() => {
    resultModal.style.display = 'none';
  }, 7000);
});

socket.on('answer_feedback', (data) => {
  feedbackMsg.className = `feedback ${data.success ? 'success' : 'error'}`;
  feedbackMsg.textContent = data.message;
  
  if (data.success) {
    displayScore.textContent = data.score;
  } else {
    // If failed, allow to submit again if question is still open
    if (currentActiveQuestion !== null) {
      btnSubmit.disabled = false;
      answerInput.focus();
    }
  }
});

socket.on('game_reset', () => {
  window.location.reload();
});

// Vertical Buzzer Sockets
socket.on('buzzer_locked', (data) => {
    btnBuzz.disabled = true;
    btnBuzz.textContent = `🔒 ${data.playerName} đang giải`;
    btnBuzz.style.opacity = '0.5';
});

socket.on('buzzer_unlocked', () => {
    btnBuzz.disabled = false;
    btnBuzz.textContent = `🔔 GIÀNH QUYỀN TRẢ LỜI KHÓA DỌC`;
    btnBuzz.style.opacity = '1';
    verticalModal.style.display = 'none';
    if (verticalInterval) clearInterval(verticalInterval);
});

socket.on('buzzer_granted', (data) => {
    if(window.SoundManager) window.SoundManager.playBuzzer();
    verticalInput.value = ''; // Clear previous input
    if (verticalHintText) {
        verticalHintText.innerHTML = `💡 Gợi ý: <strong>${data.hint}</strong>`;
    }
    verticalModal.style.display = 'flex';
    let timeLeft = data.timeout;
    verticalTimer.textContent = timeLeft;
    verticalInput.focus();
    
    if (verticalInterval) clearInterval(verticalInterval);
    verticalInterval = setInterval(() => {
        timeLeft--;
        verticalTimer.textContent = timeLeft;
        if (timeLeft <= 0) {
            clearInterval(verticalInterval);
        }
    }, 1000);
});

socket.on('vertical_winner', (data) => {
   if(window.SoundManager) window.SoundManager.playWin();
   if (verticalInterval) clearInterval(verticalInterval);
   verticalModal.style.display = 'none';
   
   resultTitle.textContent = "🏆 HẾT GAME!";
   resultBox.className = "result-box glass-panel win";
   resultMessage.innerHTML = `Vinh danh <strong>${data.playerName}</strong> đã tìm ra từ khóa dọc:<br/><br/><strong style="font-size: 2rem; color: #fff;">${data.correctWord}</strong>`;
   resultModal.style.display = 'flex';
});
