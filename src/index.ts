import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { AppState, Quiz, QuizSubmission, Player, QuizHistoryItem } from './types';

// ExpressアプリとHTTPサーバーの初期化
const app = express();
const server = http.createServer(app);

// Socket.IOサーバーの初期化
const io = new Server(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST"]
  }
});

// アプリケーションの初期状態
const initialQuizState: Quiz = {
  question: '',
  options: Array(5).fill(''),
  correctAnswerIndex: null,
  timeLimit: 30,
};

let appState: AppState = {
  quizMode: 'idle',
  currentQuiz: initialQuizState,
  submissions: [],
  timer: 0,
  participants: [], 
  winners: [],      
  history: [],      
};

let timerInterval: ReturnType<typeof setInterval> | null = null;

// 全てのクライアントに最新の状態を送信する関数
const broadcastState = () => {
  io.emit('stateUpdate', appState);
};

// タイマーをクリアする関数
const stopTimer = () => {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
};

// クイズを終了し「回答締切」状態にする関数
const endQuizAndLogHistory = () => {
  stopTimer();
  
  appState.quizMode = 'reveal_answer';
  
  // 重複防止チェックを削除済み (同じ問題文でも履歴に保存される)
  appState.history.push({
    quiz: appState.currentQuiz,
    submissions: appState.submissions,
  });
  
  broadcastState();
}

// タイマーを開始する関数
const startTimer = () => {
  stopTimer();
  appState.timer = appState.currentQuiz.timeLimit;
  broadcastState();

  timerInterval = setInterval(() => {
    if (appState.timer > 0) {
      appState.timer -= 1;
      broadcastState();
    } else {
      endQuizAndLogHistory();
    }
  }, 1000);
};


// Socket.IOの接続イベントハンドラ
io.on('connection', (socket) => {
  console.log(`クライアントが接続しました: ${socket.id}`);
  
  socket.emit('stateUpdate', appState);

  socket.on('participant:join', (player: Player) => {
    socket.data.playerId = player.id;
    socket.data.playerName = player.name;

    const existingPlayer = appState.participants.find(p => p.id === player.id);
    if (!existingPlayer) {
      appState.participants.push(player);
      console.log(`参加者追加: ${player.name} (ID: ${player.id})`);
    }
    broadcastState();
  });


  // --- 管理者からのイベント ---
  socket.on('admin:startQuiz', (quiz: Quiz) => {
    console.log('クイズ開始イベントを受信:', quiz);
    appState = {
      ...appState, // 履歴(history)や参加者(participants), winnersを引き継ぐ
      quizMode: 'fastest_finger',
      currentQuiz: quiz,
      submissions: [], // 回答履歴を（新しい空の配列で）リセット
    };
    startTimer();
    broadcastState();
  });

  socket.on('admin:forceEndQuiz', () => {
    console.log('クイズ強制終了(回答締切)イベントを受信');
    if (appState.quizMode === 'fastest_finger') {
      endQuizAndLogHistory();
    }
  });

  socket.on('admin:showResults', () => {
    console.log('結果発表イベントを受信');
    if (appState.quizMode === 'reveal_answer') {
      
      // 1. この問題の正解者を「早押し順」でソートする
      const correctIndex = appState.currentQuiz.correctAnswerIndex;
      let fastestCorrectSubmissions: QuizSubmission[] = [];

      if (correctIndex !== null) {
        fastestCorrectSubmissions = appState.submissions
          .filter(sub => sub.answerIndex === correctIndex)
          .sort((a, b) => a.timestamp - b.timestamp);
      }

      // 2. ソートされたリストから、上位2名（1位と2位）だけを取得
      const top2Winners = fastestCorrectSubmissions.slice(0, 2);
      
      // 3. 永続的な winners リストに、今回の上位2名「だけ」を追加する
      top2Winners.forEach(submission => {
        const id = submission.playerId;
        // 既に（過去のゲームで）winnersリストに入っている人は追加しない
        if (!appState.winners.includes(id)) {
          appState.winners.push(id);
          console.log(`永続的な正解者(winners)リストに ${submission.playerName} (ID: ${id}) を追加`);
        }
      });

      // 4. モードを変更してブロードキャスト
      appState.quizMode = 'show_results';
      broadcastState();
    }
  });

  socket.on('admin:resetQuiz', () => {
    console.log('クイズリセット（次の問題へ）イベントを受信');
    stopTimer();
    
    appState = {
      ...appState, // history, participants, winners を引き継ぐ
      quizMode: 'idle',
      currentQuiz: initialQuizState,
      submissions: [], 
      timer: 0,
    };
    broadcastState();
  });

  socket.on('admin:resetWinner', (playerId: number) => {
    console.log(`正解者(${playerId})を復帰させます`);
    appState.winners = appState.winners.filter(id => id !== playerId);
    broadcastState();
  });

  socket.on('admin:resetAllWinners', () => {
    console.log('全ての正解者を復帰させます');
    appState.winners = [];
    broadcastState();
  });

  socket.on('admin:forceLogoutParticipant', (playerId: number) => {
    console.log(`参加者(${playerId})を強制ログアウトさせます`);

    let foundSocket = null;
    for (const [socketId, targetSocket] of io.sockets.sockets) {
      if (targetSocket.data.playerId === playerId) {
        foundSocket = targetSocket;
        break;
      }
    }

    if (foundSocket) {
      console.log(`対象ソケット(${foundSocket.id})にログアウト命令を送信`);
      foundSocket.emit('server:forceLogout');
      foundSocket.disconnect(true);
    } else {
      console.log('対象のソケットは見つかりませんでしたが、リストからは削除します');
    }

    appState.participants = appState.participants.filter(p => p.id !== playerId);
    appState.winners = appState.winners.filter(id => id !== playerId);
    
    broadcastState();
  });

  // ★ (機能追加) 全履歴を削除するイベント
  socket.on('admin:clearHistory', () => {
    console.log('全履歴の削除イベントを受信');
    appState.history = []; // 履歴配列を空にする
    broadcastState(); // 全員に最新の状態を送信
  });


  // --- 参加者からのイベント ---
  socket.on('participant:submitAnswer', (submission: { answerIndex?: number; }) => {
    const { playerId, playerName } = socket.data;

    if (!playerId || !playerName) return;
    
    // (永続的な)winnersリストに含まれていたらブロック
    if (appState.winners.includes(playerId)) {
      console.log(`[${playerName}] は(過去の)正解済みのため回答をブロック`);
      return;
    }
    // (この問題で)回答済みか、時間切れならブロック
    if (appState.quizMode !== 'fastest_finger' || appState.submissions.some(s => s.playerId === playerId)) {
      console.log(`[${playerName}] は(この問題で)回答済みか、時間切れのため回答をブロック`);
      return;
    }
    
    const newSubmission: QuizSubmission = {
      playerId: playerId,
      playerName: playerName,
      answerIndex: submission.answerIndex,
      timestamp: Date.now(),
    };
    appState.submissions.push(newSubmission);
    
    // (winners リストへの追加は showResults で行うため、ここでは何もしない)
    
    broadcastState();
  });

  // --- 切断イベント ---
  socket.on('disconnect', () => {
    console.log(`クライアントが切断しました: ${socket.id}`);
    if (socket.data.playerId) {
      appState.participants = appState.participants.filter(p => p.id !== socket.data.playerId);
      console.log(`参加者削除: ${socket.data.playerName}`);
      appState.winners = appState.winners.filter(id => id !== socket.data.playerId);

      broadcastState();
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`サーバーがポート ${PORT} で起動しました。`);
  console.log(`ローカルIPで http://[あなたのPCのIPアドレス]:${PORT} でアクセス可能です`);
});