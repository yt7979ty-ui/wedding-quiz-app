// 参加者の情報を表す型
export interface Player {
  id: number;
  name: string;
}

// 5択クイズの情報を表す型
export interface Quiz {
  question: string;
  options: string[];
  correctAnswerIndex: number | null;
  timeLimit: number; // 制限時間
}

// 早押しやクイズの回答情報を表す型
export interface QuizSubmission {
  playerId: number;
  playerName: string;
  timestamp: number;
  answerIndex?: number; // どの選択肢を選んだか (0-4)
}

// ★★★ 修正: クイズモードを4段階に変更 ★★★
// 'quiz_ended' を 'reveal_answer' (回答締切) と 'show_results' (結果発表) に分割
export type QuizMode = 'idle' | 'fastest_finger' | 'reveal_answer' | 'show_results';

// ★★★ 新規追加: 1問ごとの履歴を保存する型 ★★★
export interface QuizHistoryItem {
  quiz: Quiz;
  submissions: QuizSubmission[];
}

// ★★★ 修正: App.tsx でも使うため ViewMode をここに移動 ★★★
export type ViewMode = 'participant' | 'admin';

// アプリケーション全体の状態を管理する型
export interface AppState {
  quizMode: QuizMode;
  currentQuiz: Quiz;
  submissions: QuizSubmission[];
  timer: number;
  participants: Player[];
  winners: number[];
  history: QuizHistoryItem[];
}