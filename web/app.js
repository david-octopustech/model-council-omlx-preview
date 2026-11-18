const STORAGE_KEY = "local-model-council:v1";
const MAX_HISTORY = 8;
const FAMILY_NAMES = ["Qwen", "LLaMA", "Mistral", "Gemma", "DeepSeek", "MiniMax", "GLM"];

const state = {
  models: [],
  prompt: "",
  selectedModels: ["", "", ""],
  customModels: ["", "", ""],
  thinking: true,
  thinkingBudget: 2048,
  maxTokens: 2500,
  history: [],
  image: null,
  dispatch: null,
  reviewPacket: null,
  running: false,
};

const $ = (id) => document.getElementById(id);

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (typeof saved.prompt === "string") state.prompt = saved.prompt;
    if (Array.isArray(saved.selectedModels)) state.selectedModels = saved.selectedModels.slice(0, 3).concat(["", "", ""]).slice(0, 3);
    if (Array.isArray(saved.customModels)) state.customModels = saved.customModels.slice(0, 3).concat(["", "", ""]).slice(0, 3);
    if (typeof saved.thinking === "boolean") state.thinking = saved.thinking;
    if (Number.isFinite(saved.thinkingBudget)) state.thinkingBudget = saved.thinkingBudget;
    if (Number.isFinite(saved.maxTokens)) state.maxTokens = saved.maxTokens;
    if (Array.isArray(saved.history)) state.history = saved.history.slice(0, MAX_HISTORY);
  } catch {
    // A malformed localStorage entry should never prevent the UI from opening.
  }
}

function persistState() {
  const safe = {
    prompt: state.prompt,
    selectedModels: state.selectedModels,
    customModels: state.customModels,
    thinking: state.thinking,
    thinkingBudget: state.thinkingBudget,
    maxTokens: state.maxTokens,
    history: state.history,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
}

function setConnection(online, message) {
  $("statusDot").className = `status-dot ${online ? "online" : "offline"}`;
  $("connectionStatus").textContent = message;
}

function familyFor(modelId) {
  const lower = modelId.toLowerCase();
  return FAMILY_NAMES.find((family) => lower.includes(family.toLowerCase())) || "Local model";
}

function modelOptions(selected) {
  const options = state.models;
  if (!options.length) return `<option value="">No models discovered</option>`;
  return options.map((model) => {
    const id = String(model.id);
    const selectedAttr = id === selected ? " selected" : "";
    return `<option value="${escapeHtml(id)}"${selectedAttr}>${escapeHtml(id)}</option>`;
  }).join("");
}

function renderSeats() {
  $("seatConfig").innerHTML = [0, 1, 2].map((index) => {
    const selected = state.selectedModels[index] || state.models[index]?.id || "";
    const family = selected ? familyFor(selected) : "Waiting for oMLX";
    return `
      <div class="seat-card">
        <div class="seat-label"><span class="seat-index">${String.fromCharCode(65 + index)}</span> Seat ${index + 1}</div>
        <select class="model-select" data-seat="${index}" aria-label="Seat ${index + 1} model">${modelOptions(selected)}</select>
        <input class="model-custom" data-custom-seat="${index}" value="${escapeAttribute(state.customModels[index])}" placeholder="Or paste model ID" aria-label="Custom model ID for seat ${index + 1}" />
        <span class="model-family" data-family-seat="${index}">${escapeHtml(family)}</span>
      </div>`;
  }).join("");

  document.querySelectorAll(".model-select").forEach((select) => {
    select.addEventListener("change", () => {
      const index = Number(select.dataset.seat);
      state.selectedModels[index] = select.value;
      state.customModels[index] = "";
      const custom = document.querySelector(`[data-custom-seat="${index}"]`);
      if (custom) custom.value = "";
      updateFamily(index, select.value);
      persistState();
    });
  });
  document.querySelectorAll(".model-custom").forEach((input) => {
    input.addEventListener("input", () => {
      const index = Number(input.dataset.customSeat);
      state.customModels[index] = input.value;
      updateFamily(index, input.value);
      persistState();
    });
  });
}

function updateFamily(index, value) {
  const target = document.querySelector(`[data-family-seat="${index}"]`);
  if (target) target.textContent = value ? familyFor(value) : "Waiting for oMLX";
}

function selectedModel(index) {
  return (state.customModels[index] || state.selectedModels[index] || "").trim();
}

async function refreshModels() {
  setConnection(false, "Checking oMLX…");
  try {
    const response = await fetch("/api/models", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Could not read the oMLX model catalog");
    state.models = Array.isArray(payload.data) ? payload.data : [];
    setConnection(true, `${state.models.length} local model${state.models.length === 1 ? "" : "s"}`);
    const knownIds = new Set(state.models.map((model) => model.id));
    state.selectedModels = state.selectedModels.map((id, index) => knownIds.has(id) ? id : state.models[index]?.id || "");
    renderSeats();
    if (!$("reviewPanel").hidden) renderStageControls();
  } catch (error) {
    state.models = [];
    setConnection(false, "oMLX unavailable");
    renderSeats();
    if (!$("reviewPanel").hidden) renderStageControls();
    showFormError(error.message || "Could not connect to oMLX.");
  }
}

function updatePromptMeta() {
  $("charCount").textContent = `${state.prompt.length.toLocaleString()} / 20,000`;
  $("draftStatus").textContent = state.prompt ? "Draft saved locally" : "Draft saved locally · empty";
}

function setLoading() {
  $("resultsNote").textContent = "Three seats are thinking…";
  $("resultsGrid").innerHTML = [0, 1, 2].map((index) => `
    <article class="response-card loading">
      <div class="response-header"><span class="response-model">${escapeHtml(selectedModel(index) || `Seat ${index + 1}`)}</span><span class="response-status">Running</span></div>
      <div class="response-body"><div class="loading-line"></div><div class="loading-line short"></div><div class="loading-line"></div></div>
    </article>`).join("");
}

function renderResults(payload) {
  const results = Array.isArray(payload.results) ? payload.results : [];
  const successful = results.filter((result) => result.status === "ok").length;
  $("resultsNote").textContent = `${successful} of ${results.length} seats answered`;
  $("resultsGrid").innerHTML = results.map((result, index) => {
    const status = result.status === "ok" ? "Answered" : "Failed";
    const statusClass = result.status === "ok" ? "ok" : "error";
    const thinking = result.thinking || "";
    const details = result.details || {};
    const detailsRows = Object.entries(details).map(([key, value]) => `<span>${escapeHtml(prettyKey(key))}</span><span>${escapeHtml(String(value))}</span>`).join("");
    return `
      <article class="response-card ${statusClass === "error" ? "error" : ""}">
        <div class="response-header"><span class="response-model" title="${escapeAttribute(result.model || `Seat ${index + 1}`)}">${escapeHtml(result.model || `Seat ${index + 1}`)}</span><span class="response-status ${statusClass}">${status}</span></div>
        <div class="response-body">
          ${result.status === "ok" ? `<p class="response-answer">${escapeHtml(result.answer || "(No visible answer returned.)")}</p>` : `<p class="placeholder-copy">${escapeHtml(result.error || "This seat did not return a response.")}</p>`}
          ${thinking ? `<details class="thinking-details"><summary>Deep thinking returned</summary><div class="thinking-copy">${escapeHtml(thinking)}</div></details>` : ""}
          ${detailsRows ? `<details class="meta-details"><summary>Run details</summary><div class="meta-copy">${detailsRows}</div></details>` : ""}
        </div>
      </article>`;
  }).join("");
}

function stageModelOptions(selected, excluded = []) {
  const options = state.models.filter((model) => !excluded.includes(model.id));
  if (!options.length) return '<option value="">No models discovered</option>';
  return options.map((model) => `<option value="${escapeAttribute(model.id)}"${model.id === selected ? " selected" : ""}>${escapeHtml(model.id)}</option>`).join("");
}

function renderStageControls() {
  const available = state.models;
  const chosen = [0, 1, 2].map(selectedModel).filter(Boolean);
  const reviewerOne = chosen[0] || available[0]?.id || "";
  const reviewerTwo = chosen.find((model) => model !== reviewerOne) || available.find((model) => model.id !== reviewerOne)?.id || "";
  const chair = chosen[2] || chosen[0] || available[0]?.id || "";
  $("reviewerOne").innerHTML = stageModelOptions(reviewerOne);
  $("reviewerTwo").innerHTML = stageModelOptions(reviewerTwo);
  $("chairModel").innerHTML = stageModelOptions(chair);
}

function renderReviewPacket(payload) {
  const answerCards = (payload.anonymous_answers || []).map((item) => `
    <div class="anonymous-answer"><div class="anonymous-label">Answer ${escapeHtml(item.label)}</div><div class="anonymous-copy">${escapeHtml(item.answer)}</div></div>`).join("");
  const reviewCards = (payload.reviews || []).map((review, index) => {
    const status = review.status === "ok" ? `Reviewer ${index + 1}` : "Reviewer failed";
    return `<div class="review-card"><div class="review-card-header"><span>${status}</span><span>Answer authors hidden</span></div><div class="review-copy">${escapeHtml(review.answer || review.error || "No review returned.")}</div>${review.thinking ? `<details class="thinking-details"><summary>Reviewer thinking returned</summary><div class="thinking-copy">${escapeHtml(review.thinking)}</div></details>` : ""}</div>`;
  }).join("");
  $("reviewResults").innerHTML = `
    <div class="review-block"><h3>Anonymous packet</h3>${answerCards}</div>
    <div class="review-block"><h3>Independent reviews</h3>${reviewCards || '<p class="stage-empty">No review returned.</p>'}</div>`;
}

function renderSynthesis(payload) {
  const synthesis = payload.synthesis || {};
  const details = synthesis.details || {};
  const detailRows = Object.entries(details).map(([key, value]) => `<span>${escapeHtml(prettyKey(key))}</span><span>${escapeHtml(String(value))}</span>`).join("");
  $("synthesisResult").innerHTML = `
    <article class="synthesis-card">
      <div class="response-header"><span class="response-model">Chairman · ${escapeHtml(payload.chair || synthesis.model || "local model")}</span><span class="response-status ${synthesis.status === "ok" ? "ok" : "error"}">${synthesis.status === "ok" ? "Synthesized" : "Failed"}</span></div>
      <p class="response-answer">${escapeHtml(synthesis.answer || synthesis.error || "No synthesis returned.")}</p>
      ${synthesis.thinking ? `<details class="thinking-details"><summary>Chairman thinking returned</summary><div class="thinking-copy">${escapeHtml(synthesis.thinking)}</div></details>` : ""}
      ${detailRows ? `<details class="meta-details"><summary>Run details</summary><div class="meta-copy">${detailRows}</div></details>` : ""}
    </article>`;
}

function showStagePanels() {
  $("reviewPanel").hidden = false;
  $("synthesisPanel").hidden = false;
  $("reviewResults").innerHTML = '<p class="stage-empty">The peer-review packet will appear here after you choose to run it.</p>';
  $("synthesisResult").innerHTML = '<p class="stage-empty">The chairman is deliberately manual — run it after reviewing the answers and, optionally, the blind reviews.</p>';
  renderStageControls();
}

async function runReview() {
  hideFormError();
  if (!state.dispatch) return showFormError("Run the three independent seats first.");
  const answers = state.dispatch.results.filter((result) => result.status === "ok" && result.answer).map((result) => ({ answer: result.answer }));
  const reviewers = [$("reviewerOne").value, $("reviewerTwo").value];
  if (answers.length < 2) return showFormError("At least two seats must answer before peer review can run.");
  if (!reviewers[0] || !reviewers[1] || reviewers[0] === reviewers[1]) return showFormError("Choose two distinct reviewer models.");
  $("reviewButton").disabled = true;
  $("reviewButton").firstChild.textContent = "Reviewing… ";
  $("reviewResults").innerHTML = '<p class="stage-empty">Shuffling answers and asking two reviewers in parallel…</p>';
  try {
    const response = await fetch("/api/council/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: state.dispatch.question,
        answers,
        reviewers,
        thinking: state.thinking,
        thinking_budget: state.thinking ? Number(state.thinkingBudget) : 0,
        max_tokens: 1800,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Peer review failed.");
    state.reviewPacket = payload;
    renderReviewPacket(payload);
    $("synthesisResult").innerHTML = '<p class="stage-empty">Reviews are ready. Decide when you want the chairman to synthesize them.</p>';
  } catch (error) {
    showFormError(error.message || "Peer review failed.");
    $("reviewResults").innerHTML = '<p class="stage-empty">No review packet was produced.</p>';
  } finally {
    $("reviewButton").disabled = false;
    $("reviewButton").firstChild.textContent = "Run anonymous review ";
  }
}

async function runSynthesis() {
  hideFormError();
  if (!state.dispatch) return showFormError("Run the three independent seats first.");
  const anonymousAnswers = state.reviewPacket?.anonymous_answers || state.dispatch.results.filter((result) => result.status === "ok" && result.answer).map((result, index) => ({ label: String.fromCharCode(65 + index), answer: result.answer }));
  const reviews = (state.reviewPacket?.reviews || []).map((review) => ({ answer: review.answer || review.error || "" })).filter((review) => review.answer);
  const chair = $("chairModel").value;
  if (!chair) return showFormError("Choose a chairman model.");
  $("synthesizeButton").disabled = true;
  $("synthesizeButton").firstChild.textContent = "Chairman is weighing evidence… ";
  $("synthesisResult").innerHTML = '<p class="stage-empty">The chairman is selecting, rejecting, and resolving disagreement…</p>';
  try {
    const response = await fetch("/api/council/synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: state.dispatch.question,
        anonymous_answers: anonymousAnswers,
        reviews,
        chair,
        thinking: state.thinking,
        thinking_budget: state.thinking ? Number(state.thinkingBudget) : 0,
        max_tokens: 2500,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Chairman synthesis failed.");
    renderSynthesis(payload);
  } catch (error) {
    showFormError(error.message || "Chairman synthesis failed.");
    $("synthesisResult").innerHTML = '<p class="stage-empty">No synthesis was produced.</p>';
  } finally {
    $("synthesizeButton").disabled = false;
    $("synthesizeButton").firstChild.textContent = "Ask the chairman ";
  }
}

async function fileAsDataUrl(file) {
  if (!file) return null;
  if (file.size > 8 * 1024 * 1024) throw new Error("Images must be 8 MB or smaller.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, data_url: reader.result });
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}

async function askCouncil(event) {
  event.preventDefault();
  hideFormError();
  const models = [0, 1, 2].map(selectedModel);
  if (!state.prompt.trim()) return showFormError("Write a question or brief first.");
  if (models.some((model) => !model)) return showFormError("Choose three model IDs before asking the council.");
  if (new Set(models).size !== 3) return showFormError("Choose three distinct models so the answers stay independent.");

  state.running = true;
  state.dispatch = null;
  state.reviewPacket = null;
  $("reviewPanel").hidden = true;
  $("synthesisPanel").hidden = true;
  $("askButton").disabled = true;
  $("askButton span:first-child").textContent = "Running three seats…";
  setLoading();
  try {
    const response = await fetch("/api/council", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: state.prompt,
        models,
        thinking: state.thinking,
        thinking_budget: state.thinking ? Number(state.thinkingBudget) : 0,
        max_tokens: Number(state.maxTokens),
        image: state.image,
      }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "The council could not run.");
    state.dispatch = payload;
    renderResults(payload);
    showStagePanels();
    addHistory(state.prompt, models);
  } catch (error) {
    $("resultsNote").textContent = "The run could not be completed";
    showFormError(error.message || "The council could not run.");
  } finally {
    state.running = false;
    $("askButton").disabled = false;
    $("askButton span:first-child").textContent = "Ask the council";
  }
}

function addHistory(question, models) {
  state.history = [{ question, models, at: new Date().toISOString() }, ...state.history.filter((item) => item.question !== question)].slice(0, MAX_HISTORY);
  persistState();
  renderHistory();
}

function renderHistory() {
  const container = $("historyList");
  if (!state.history.length) {
    container.innerHTML = '<p class="empty-state">Your recent briefs will appear here — locally, on this device.</p>';
    return;
  }
  container.innerHTML = state.history.map((item, index) => `
    <div class="history-item">
      <span class="history-question" title="${escapeAttribute(item.question)}">${escapeHtml(item.question)}</span>
      <span class="history-date">${escapeHtml(formatDate(item.at))}</span>
      <button class="history-load" type="button" data-history-index="${index}">Load</button>
    </div>`).join("");
  document.querySelectorAll(".history-load").forEach((button) => button.addEventListener("click", () => {
    const item = state.history[Number(button.dataset.historyIndex)];
    if (!item) return;
    state.prompt = item.question;
    state.selectedModels = item.models.slice(0, 3);
    state.customModels = ["", "", ""];
    $("question").value = state.prompt;
    renderSeats();
    updatePromptMeta();
    window.scrollTo({ top: 0, behavior: "smooth" });
    persistState();
  }));
}

function formatDate(value) {
  try { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value)); } catch { return "Saved"; }
}

function prettyKey(key) { return key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char])); }
function escapeAttribute(value) { return escapeHtml(value).replace(/`/g, "&#096;"); }
function showFormError(message) { $("formError").textContent = message; $("formError").hidden = false; }
function hideFormError() { $("formError").hidden = true; $("formError").textContent = ""; }

function bindUI() {
  $("question").value = state.prompt;
  $("thinkingToggle").checked = state.thinking;
  $("thinkingBudget").value = state.thinkingBudget;
  $("maxTokens").value = state.maxTokens;
  $("question").addEventListener("input", (event) => { state.prompt = event.target.value; updatePromptMeta(); persistState(); });
  $("thinkingToggle").addEventListener("change", (event) => { state.thinking = event.target.checked; persistState(); });
  $("thinkingBudget").addEventListener("input", (event) => { state.thinkingBudget = Number(event.target.value) || 0; persistState(); });
  $("maxTokens").addEventListener("input", (event) => { state.maxTokens = Number(event.target.value) || 2500; persistState(); });
  $("councilForm").addEventListener("submit", askCouncil);
  $("reviewButton").addEventListener("click", runReview);
  $("synthesizeButton").addEventListener("click", runSynthesis);
  $("refreshModels").addEventListener("click", refreshModels);
  $("clearHistory").addEventListener("click", () => { state.history = []; persistState(); renderHistory(); });
  $("imageInput").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) { state.image = null; $("attachmentName").textContent = "Optional VLM input"; return; }
    try {
      state.image = await fileAsDataUrl(file);
      $("attachmentName").textContent = file.name;
      hideFormError();
    } catch (error) {
      state.image = null;
      event.target.value = "";
      showFormError(error.message);
    }
  });
}

loadState();
bindUI();
updatePromptMeta();
renderHistory();
renderSeats();
refreshModels();
