const LANGUAGE_KEY = "local-model-council:language";
const THEME_KEY = "local-model-council:theme";
const MESSAGES = {
  home: ["Local Model Council home", "本機模型議會首頁"],
  brand: ["MODEL COUNCIL", "模型議會"],
  local: ["/ LOCAL", "／本機"],
  checking: ["Checking oMLX…", "正在檢查 oMLX…"],
  refreshModels: ["Refresh models", "重新整理模型清單"],
  theme: ["Theme", "外觀主題"],
  system: ["System settings", "跟隨系統"],
  light: ["Light theme", "淺色主題"],
  dark: ["Dark theme", "深色主題"],
  language: ["ENG / 廣東話 — Switch to Cantonese (Hong Kong)", "ENG / 廣東話 — 切換至英文"],
  connection: ["CONNECTION", "連線設定"],
  server: ["oMLX server", "oMLX 伺服器"],
  serverHelp: ["Leave the address empty when using the local Python proxy. For GitHub Pages or a Windows browser, enter a reachable oMLX server URL.", "用本機 Python 代理時，可以留空。用 GitHub Pages 或 Windows 瀏覽器時，請輸入可連線嘅 oMLX 伺服器網址。"],
  configure: ["Configure oMLX to connect", "請設定 oMLX 先可以連線"],
  browserTransport: ["Browser → configured oMLX", "瀏覽器 → 已設定嘅 oMLX"],
  proxyTransport: ["Local proxy → oMLX", "本機代理 → oMLX"],
  address: ["Server address", "伺服器網址"],
  apiKey: ["API key", "API 金鑰"],
  optionalToken: ["Optional Bearer token", "Bearer 權杖（選填）"],
  savedBrowser: ["Saved only in this browser.", "只會儲存喺呢個瀏覽器。"],
  testConnection: ["Test connection", "測試連線"],
  saveSettings: ["Save oMLX", "儲存 oMLX 設定"],
  heroTag: ["INDEPENDENT LOCAL REASONING / OMLX", "本機獨立推理／OMLX"],
  heroTitle: ["Three minds.", "三個模型。"],
  heroAccent: ["One clearer answer.", "答案更清晰。"],
  heroCopy: ["Send one question to three independent local models. Compare the reasoning, spot disagreement, and make the final call yourself.", "將同一條問題交畀三個本機模型各自作答。比較佢哋嘅推理，睇清分歧，再由你自己作最後決定。"],
  parallel: ["Parallel seats", "並行作答"],
  visibleReasoning: ["Visible reasoning", "睇到推理過程"],
  localDefault: ["Local by default", "預設喺本機運行"],
  workspace: ["Council workspace", "議會工作區"],
  brief: ["THE BRIEF", "問題簡報"],
  briefTitle: ["What should the council think through?", "你想議會一齊諗咩問題？"],
  storedBrowser: ["STORED IN YOUR BROWSER", "儲存喺你嘅瀏覽器"],
  questionLabel: ["Question for the council", "畀議會嘅問題"],
  questionHint: ["Ask a hard question, compare a trade-off, or paste a decision brief…", "問條難答嘅問題、比較取捨，或者貼上決策簡報…"],
  draftSaved: ["Draft saved locally", "草稿已儲存喺本機"],
  draftEmpty: ["Draft saved locally · empty", "草稿已儲存喺本機 · 暫時冇內容"],
  seats: ["THE SEATS", "議會席位"],
  seatsHelp: ["Each model sees the same brief, independently.", "每個模型都會收到同一份簡報，各自獨立作答。"],
  deepThinking: ["Deep thinking mode", "深度思考模式"],
  thinkingBudget: ["Think budget", "思考 token 上限"],
  answerMax: ["Answer max", "答案 token 上限"],
  addImage: ["＋ Add image", "＋ 加入圖片"],
  optionalImage: ["Optional VLM input", "圖片輸入（選填，需用視覺模型）"],
  ask: ["Ask the council", "問議會"],
  room: ["THE ROOM", "議會"],
  responses: ["Independent responses", "各模型嘅獨立回覆"],
  waitingQuestion: ["Waiting for a question", "等緊你發問"],
  working: ["The council is working", "議會處理緊"],
  sendingBrief: ["Your brief is being sent to the independent seats.", "正將你嘅簡報發畀各個獨立席位。"],
  progressLabel: ["Council processing progress", "議會處理進度"],
  checkpoint: ["OPTIONAL / HUMAN CHECKPOINT", "選做／由你決定"],
  reviewTitle: ["Blind peer review", "匿名互評"],
  reviewHelp: ["Read the three answers first. Then ask two reviewers to score shuffled, anonymized answers.", "先睇晒三份答案，再請兩個評審為打亂次序後嘅匿名答案評分。"],
  reviewerA: ["Reviewer A", "評審 A"],
  reviewerB: ["Reviewer B", "評審 B"],
  runReview: ["Run anonymous review", "開始匿名互評"],
  synthesisTitle: ["Active chairman synthesis", "由主席整合答案"],
  synthesisHelp: ["Choose one local model to select and weight the evidence. The chairman does not see provider names.", "揀一個本機模型做主席，篩選證據同衡量佢哋嘅分量。主席睇唔到供應商名稱。"],
  chair: ["Chairman", "主席"],
  askChair: ["Ask the chairman", "請主席整合答案"],
  recent: ["Recent questions", "最近嘅問題"],
  notebook: ["YOUR NOTEBOOK", "你嘅筆記簿"],
  clearHistory: ["Clear local history", "清除本機記錄"],
  historyEmpty: ["Your recent briefs will appear here — locally, on this device.", "最近嘅簡報會喺呢度顯示，只儲存喺呢部裝置。"],
  appTitle: ["Local Model Council", "本機模型議會"],
  footer: ["Inspired by the model-council pattern · Powered by oMLX", "設計源自模型議會模式 · 由 oMLX 驅動"],
  localModel: ["Local model", "本機模型"],
  noChatModels: ["No chat-capable models discovered", "搵唔到支援對話嘅模型"],
  waitingModel: ["Waiting for oMLX", "等緊 oMLX"],
  seat: ["Seat {number}", "第 {number} 席"],
  seatModel: ["Seat {number} model", "第 {number} 席嘅模型"],
  pasteModel: ["Or paste model ID", "或者貼上模型 ID"],
  customModel: ["Custom model ID for seat {number}", "第 {number} 席嘅自訂模型 ID"],
  configurePages: ["Set the oMLX server address in Settings before connecting from GitHub Pages.", "由 GitHub Pages 連線之前，請先喺設定填寫 oMLX 伺服器網址。"],
  requestFailed: ["oMLX request failed ({status})", "oMLX 請求失敗（{status}）"],
  timeout: ["oMLX did not respond within {seconds} seconds. Check the server, model load, network, or reduce the thinking budget.", "oMLX 喺 {seconds} 秒內冇回覆。請檢查伺服器、模型載入同網絡狀態，亦可以調低思考 token 上限。"],
  invalidAddress: ["oMLX server address must be a full http:// or https:// URL.", "oMLX 伺服器網址必須係以 http:// 或 https:// 開頭嘅完整網址。"],
  savedTesting: ["Saved locally. Testing connection…", "已儲存喺本機，測試連線中…"],
  connectedVia: ["Connected via {transport}.", "已連線（{transport}）。"],
  saveFailed: ["Could not save oMLX settings.", "儲存唔到 oMLX 設定。"],
  testing: ["Testing connection…", "測試連線中…"],
  readyVia: ["Connection ready via {transport}.", "連線已就緒（{transport}）。"],
  unreachable: ["oMLX is not reachable.", "連唔到 oMLX。"],
  setServer: ["Set oMLX in Settings", "請先設定 oMLX"],
  modelCount: ["{count} local models", "{count} 個本機模型"],
  oneModel: ["1 local model", "1 個本機模型"],
  unavailable: ["oMLX unavailable", "oMLX 暫時用唔到"],
  connectFailed: ["Could not connect to oMLX.", "連唔到 oMLX。"],
  dispatchProcessing: ["Three independent seats are processing", "三個席位各自處理緊"],
  reviewProcessing: ["Anonymous peer review is processing", "匿名互評進行中"],
  chairProcessing: ["The chairman is weighing the evidence", "主席衡量緊各項證據"],
  parallelProcessing: ["The same brief is running in parallel across your selected local models.", "你揀嘅本機模型正並行處理同一份簡報。"],
  proxyProcessing: ["The local proxy is waiting for oMLX to return the council response.", "本機代理等緊 oMLX 傳返議會嘅回覆。"],
  waitingServer: ["Waiting for oMLX…", "等緊 oMLX 回覆…"],
  seatProgress: ["{completed} / {total} seats", "{completed} / {total} 席"],
  stepProgress: ["{completed} / {total} step", "{completed} / {total} 步"],
  stopped: ["Processing stopped", "處理已停止"],
  attention: ["Needs attention", "需要跟進"],
  thinkingSeats: ["Three seats are thinking…", "三個席位諗緊…"],
  processing: ["Processing", "處理中"],
  waitingResponse: ["Waiting for model response", "等緊模型回覆"],
  answeredCount: ["{successful} of {total} seats answered", "{total} 席入面有 {successful} 席已回覆"],
  answered: ["Answered", "已回覆"],
  failed: ["Failed", "失敗"],
  noAnswer: ["(No visible answer returned.)", "（冇傳回可顯示嘅答案。）"],
  noSeatResponse: ["This seat did not return a response.", "呢個席位冇回覆。"],
  thinkingReturned: ["Deep thinking returned", "深度思考過程"],
  runDetails: ["Run details", "運行詳情"],
  answerLabel: ["Answer {label}", "答案 {label}"],
  reviewer: ["Reviewer {number}", "評審 {number}"],
  reviewerFailed: ["Reviewer failed", "評審失敗"],
  authorsHidden: ["Answer authors hidden", "已隱藏答案來源"],
  noReview: ["No review returned.", "冇傳回評審結果。"],
  reviewerThinking: ["Reviewer thinking returned", "評審思考過程"],
  anonymousPacket: ["Anonymous packet", "匿名答案"],
  independentReviews: ["Independent reviews", "獨立評審結果"],
  synthesized: ["Synthesized", "整合完成"],
  noSynthesis: ["No synthesis returned.", "冇傳回整合結果。"],
  chairThinking: ["Chairman thinking returned", "主席思考過程"],
  reviewEmpty: ["The peer-review packet will appear here after you choose to run it.", "開始互評之後，匿名答案同評審結果會喺呢度顯示。"],
  synthesisEmpty: ["The chairman is deliberately manual — run it after reviewing the answers and, optionally, the blind reviews.", "睇完各份答案之後，由你決定幾時請主席整合。你亦可以先睇匿名互評結果。"],
  noCompletion: ["oMLX returned no chat completion choice", "oMLX 冇傳回對話結果"],
  dispatchProgress: ["{completed} of {total} independent seats have returned. The remaining seats are still thinking.", "{total} 席入面有 {completed} 席已經回覆。"],
  reviewProgress: ["{completed} of {total} anonymous reviewers have returned.", "{total} 位匿名評審入面有 {completed} 位已經回覆。"],
  chairDone: ["The chairman has returned a synthesis.", "主席已傳回整合結果。"],
  runSeatsFirst: ["Run the three independent seats first.", "請先畀三個獨立席位作答。"],
  needTwoAnswers: ["At least two seats must answer before peer review can run.", "最少要有兩個席位回覆，先可以開始互評。"],
  distinctReviewers: ["Choose two distinct reviewer models.", "請揀兩個唔同嘅評審模型。"],
  reviewing: ["Reviewing…", "評審中…"],
  reviewLoading: ["Shuffling answers and asking two reviewers in parallel…", "正打亂答案次序，兩位評審會同時評審…"],
  reviewSending: ["Answers are anonymized and sent to two independent reviewers.", "匿名答案已發畀兩位獨立評審。"],
  reviewsReady: ["Reviews are ready. Decide when you want the chairman to synthesize them.", "評審結果已準備好。由你決定幾時請主席整合。"],
  reviewFailed: ["Peer review failed.", "互評失敗。"],
  noReviewPacket: ["No review packet was produced.", "冇產生互評結果。"],
  chooseChair: ["Choose a chairman model.", "請揀一個模型做主席。"],
  chairWeighing: ["Chairman is weighing evidence…", "主席衡量緊證據…"],
  chairSelecting: ["The chairman is selecting, rejecting, and resolving disagreement.", "主席正篩選證據、剔除較弱嘅論點，同處理分歧。"],
  synthesisFailed: ["Chairman synthesis failed.", "主席整合失敗。"],
  noSynthesisProduced: ["No synthesis was produced.", "冇產生整合結果。"],
  imageLimit: ["Images must be 8 MB or smaller.", "圖片唔可以大過 8 MB。"],
  imageReadFailed: ["Could not read the image.", "讀取唔到圖片。"],
  needQuestion: ["Write a question or brief first.", "請先寫低問題或者簡報。"],
  needModels: ["Choose three model IDs before asking the council.", "發問之前，請先揀三個模型 ID。"],
  distinctModels: ["Choose three distinct models so the answers stay independent.", "請揀三個唔同嘅模型，等佢哋可以各自獨立作答。"],
  configureBeforeAsk: ["Set the oMLX server address in Settings before asking the council.", "向議會發問之前，請先喺設定填寫 oMLX 伺服器網址。"],
  visionRequired: ["An image is attached. Choose three VLM seats, such as Qwen3-VL, Qwen2.5-VL, or MiniCPM-o, before asking the council.", "你已經加咗圖片。發問之前，請揀三個視覺語言模型，例如 Qwen3-VL、Qwen2.5-VL 或 MiniCPM-o。"],
  runningSeats: ["Running three seats…", "三個席位作答中…"],
  runIncomplete: ["The run could not be completed", "議會未能完成呢次請求"],
  runFailed: ["The council could not run.", "啟動唔到議會。"],
  load: ["Load", "載入"],
  saved: ["Saved", "已儲存"],
  finish_reason: ["Finish Reason", "結束原因"],
  prompt_tokens: ["Prompt Tokens", "提示 token 數"],
  completion_tokens: ["Completion Tokens", "回覆 token 數"],
  total_tokens: ["Total Tokens", "總 token 數"],
  model_load_duration: ["Model Load Duration", "模型載入時間"],
  time_to_first_token: ["Time To First Token", "首個 token 等候時間"],
  total_time: ["Total Time", "總時間"],
  prompt_tokens_per_second: ["Prompt Tokens Per Second", "每秒處理嘅提示 token 數"],
  generation_tokens_per_second: ["Generation Tokens Per Second", "每秒產生嘅 token 數"],
};

function readPreference(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function savePreference(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Apply the preference for this visit even if storage is unavailable.
  }
}

let locale = readPreference(LANGUAGE_KEY) === "yue-HK" ? "yue-HK" : "en";
const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");

function message(key, values = {}) {
  return { key, values };
}

function translate(value) {
  if (!value || typeof value !== "object") return String(value ?? "");
  const { key, values } = value;
  const template = MESSAGES[key][locale === "yue-HK" ? 1 : 0];
  return template.replace(/\{(\w+)\}/g, (_, name) => translate(values[name] ?? ""));
}

class InterfaceError extends Error {
  constructor(key, values) {
    const label = message(key, values);
    super(translate(label));
    this.label = label;
  }
}

function errorLabel(error, fallback) {
  return error.label || error.message || message(fallback);
}

const liveLabels = new WeakMap();
const localizedAttributes = ["aria-label", "title", "placeholder"];

function refreshLabel(element) {
  const bound = liveLabels.get(element);
  const key = element.dataset.i18n;
  const values = JSON.parse(element.dataset.i18nValues || "{}");
  if (bound !== undefined || key) element.textContent = translate(bound ?? message(key, values));
  for (const attribute of localizedAttributes) {
    const attributeKey = element.getAttribute(`data-i18n-${attribute}`);
    if (attributeKey) element.setAttribute(attribute, translate(message(attributeKey, values)));
  }
}

function refreshLanguage() {
  document.documentElement.lang = locale;
  document.querySelectorAll("[data-i18n], [data-i18n-live], [data-i18n-aria-label], [data-i18n-title], [data-i18n-placeholder]").forEach(refreshLabel);
}

function setLabel(element, value) {
  liveLabels.set(element, value);
  element.dataset.i18nLive = "";
  element.textContent = translate(value);
}

function labelMarkup(value) {
  if (!value || typeof value !== "object") return escapeHtml(value ?? "");
  return `<span data-i18n="${value.key}" ${labelValues(value.values)}>${escapeHtml(translate(value))}</span>`;
}

function labelValues(values) {
  return Object.keys(values).length ? `data-i18n-values="${escapeAttribute(JSON.stringify(values))}"` : "";
}

function labelAttribute(attribute, key, values = {}) {
  return `${attribute}="${escapeAttribute(translate(message(key, values)))}" data-i18n-${attribute}="${key}"`;
}

function applyTheme(preference) {
  const dark = preference === "dark" || (preference === "system" && colorScheme.matches);
  const theme = dark ? "dark" : "light";
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content = dark ? "#101418" : "#f7f3eb";
}

function bindPreferences() {
  const themeChoice = $("themeChoice");
  const savedTheme = readPreference(THEME_KEY);
  themeChoice.value = ["light", "dark"].includes(savedTheme) ? savedTheme : "system";
  applyTheme(themeChoice.value);
  themeChoice.addEventListener("change", () => {
    applyTheme(themeChoice.value);
    savePreference(THEME_KEY, themeChoice.value);
  });
  colorScheme.addEventListener("change", () => applyTheme(themeChoice.value));
  $("languageToggle").addEventListener("click", () => {
    locale = locale === "en" ? "yue-HK" : "en";
    savePreference(LANGUAGE_KEY, locale);
    refreshLanguage();
    updatePromptMeta();
    updateHistoryDates();
  });
  refreshLanguage();
}
