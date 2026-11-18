const STORAGE_KEY = "local-model-council:v1";
const MAX_HISTORY = 8;
const FAMILY_NAMES = ["Qwen", "LLaMA", "Mistral", "Gemma", "DeepSeek", "MiniMax", "GLM"];

const DISPATCH_SYSTEM_PROMPT = "You are one independent seat in a local model council. Answer the user's question directly and rigorously. Do not refer to other seats, do not defer to an unseen consensus, and do not use tools or outside context. If the question is uncertain, state assumptions and uncertainty clearly.";
const REVIEW_SYSTEM_PROMPT = "You are an anonymous peer reviewer in a local model council. Review every answer on its merits. You do not know which model wrote which answer, and you must not try to infer or reveal authorship. Work only from the brief and the anonymized answers provided.";
const SYNTHESIS_SYSTEM_PROMPT = "You are the active chairman of a local model council. Select and weight the strongest evidence instead of averaging all answers together. You may reject a weak or incorrect answer. State meaningful agreement and disagreement, then give a clear final recommendation. Work only from the supplied brief, answers, and peer reviews; do not browse or use outside tools.";

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
  omlxBaseUrl: "",
  omlxApiKey: "",
};

const $ = (id) => document.getElementById(id);

function isStaticPages() {
  return window.location.protocol === "file:" || window.location.hostname.endsWith(".github.io");
}

function normalizeOmlxAddress(value) {
  let address = String(value || "").trim().replace(/\/+$/, "");
  if (address.endsWith("/v1")) address = address.slice(0, -3).replace(/\/+$/, "");
  return address;
}

function transportMode() {
  if (normalizeOmlxAddress(state.omlxBaseUrl)) return "direct";
  return isStaticPages() ? "unconfigured" : "proxy";
}

function transportDescription() {
  const mode = transportMode();
  if (mode === "direct") return "Browser → configured oMLX";
  if (mode === "proxy") return "Local proxy → oMLX";
  return "Configure oMLX to connect";
}

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
    if (typeof saved.omlxBaseUrl === "string") state.omlxBaseUrl = saved.omlxBaseUrl;
    if (typeof saved.omlxApiKey === "string") state.omlxApiKey = saved.omlxApiKey;
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
    omlxBaseUrl: state.omlxBaseUrl,
    omlxApiKey: state.omlxApiKey,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
}

function setConnection(online, message) {
  $("statusDot").className = `status-dot ${online ? "online" : "offline"}`;
  $("connectionStatus").textContent = message;
}

function setSettingsStatus(message, error = false) {
  const target = $("omlxSettingsStatus");
  if (!target) return;
  target.textContent = message;
  target.className = `settings-status ${error ? "error" : ""}`;
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
    return `<option value="${escapeAttribute(id)}"${selectedAttr}>${escapeHtml(id)}</option>`;
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

function requestHeaders(options = {}, direct = false) {
  const headers = { ...(options.headers || {}) };
  if (direct && state.omlxApiKey.trim()) headers.Authorization = `Bearer ${state.omlxApiKey.trim()}`;
  if (options.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  return headers;
}

function errorMessage(payload, fallback) {
  if (typeof payload?.error === "string") return payload.error;
  if (typeof payload?.detail === "string") return payload.detail;
  if (payload?.error?.message) return payload.error.message;
  return fallback;
}

async function omlxRequest(path, options = {}) {
  const mode = transportMode();
  if (mode === "unconfigured") throw new Error("Set the oMLX server address in Settings before connecting from GitHub Pages.");
  const base = mode === "direct" ? `${normalizeOmlxAddress(state.omlxBaseUrl)}/v1` : "/api";
  const response = await fetch(`${base}${path}`, { ...options, headers: requestHeaders(options, mode === "direct") });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { error: text || "Non-JSON response" }; }
  if (!response.ok) throw new Error(errorMessage(payload, `oMLX request failed (${response.status})`));
  return payload;
}

function renderOmlxSettings() {
  if ($("omlxServerAddress")) $("omlxServerAddress").value = state.omlxBaseUrl;
  if ($("omlxApiKey")) $("omlxApiKey").value = state.omlxApiKey;
  if ($("transportDescription")) $("transportDescription").textContent = transportDescription();
}

function validateOmlxAddress(value) {
  const address = normalizeOmlxAddress(value);
  if (!address) return "";
  try {
    const parsed = new URL(address);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    return address;
  } catch {
    throw new Error("oMLX server address must be a full http:// or https:// URL.");
  }
}

async function saveOmlxSettings() {
  try {
    state.omlxBaseUrl = validateOmlxAddress($("omlxServerAddress").value);
    state.omlxApiKey = $("omlxApiKey").value.trim();
    persistState();
    renderOmlxSettings();
    setSettingsStatus("Saved locally. Testing connection…");
    await refreshModels();
    setSettingsStatus(`Connected via ${transportDescription()}.`);
  } catch (error) {
    setSettingsStatus(error.message || "Could not save oMLX settings.", true);
    showFormError(error.message || "Could not save oMLX settings.");
  }
}

async function testOmlxConnection() {
  try {
    state.omlxBaseUrl = validateOmlxAddress($("omlxServerAddress").value);
    state.omlxApiKey = $("omlxApiKey").value.trim();
    persistState();
    renderOmlxSettings();
    setSettingsStatus("Testing connection…");
    await refreshModels();
    setSettingsStatus(`Connection ready via ${transportDescription()}.`);
  } catch (error) {
    setSettingsStatus(error.message || "oMLX is not reachable.", true);
  }
}

async function refreshModels() {
  renderOmlxSettings();
  if (transportMode() === "unconfigured") {
    state.models = [];
    setConnection(false, "Set oMLX in Settings");
    renderSeats();
    if (!$('reviewPanel').hidden) renderStageControls();
    return;
  }
  setConnection(false, "Checking oMLX…");
  try {
    const payload = await omlxRequest("/models", { cache: "no-store" });
    state.models = Array.isArray(payload.data) ? payload.data : [];
    setConnection(true, `${state.models.length} local model${state.models.length === 1 ? "" : "s"}`);
    const knownIds = new Set(state.models.map((model) => model.id));
    state.selectedModels = state.selectedModels.map((id, index) => knownIds.has(id) ? id : state.models[index]?.id || "");
    renderSeats();
    if (!$('reviewPanel').hidden) renderStageControls();
  } catch (error) {
    state.models = [];
    setConnection(false, "oMLX unavailable");
    renderSeats();
    if (!$('reviewPanel').hidden) renderStageControls();
    if (transportMode() !== "unconfigured") showFormError(error.message || "Could not connect to oMLX.");
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

function extractText(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => typeof part === "string" ? part : (part && typeof part.text === "string" ? part.text : "")).join("");
}

function splitReasoning(text, explicitReasoning = "") {
  const inlineParts = [];
  const tagged = /<think\s*>([\s\S]*?)<\/think\s*>/gi;
  let answer = String(text || "");
  for (const match of answer.matchAll(tagged)) inlineParts.push(match[1].trim());
  answer = answer.replace(tagged, "");
  const open = /<think\s*>/i.exec(answer);
  if (open) {
    const close = /<\/think\s*>/i.exec(answer.slice(open.index + open[0].length));
    if (close) {
      const closeStart = open.index + open[0].length + close.index;
      inlineParts.push(answer.slice(open.index + open[0].length, closeStart).trim());
      answer = answer.slice(0, open.index) + answer.slice(closeStart + close[0].length);
    } else {
      inlineParts.push(answer.slice(open.index + open[0].length).trim());
      answer = answer.slice(0, open.index);
    }
  }
  return {
    answer: answer.trim(),
    thinking: [String(explicitReasoning || "").trim(), ...inlineParts].filter(Boolean).join("\n\n"),
  };
}

function normalizeCompletion(model, payload) {
  const choice = payload?.choices?.[0];
  const message = choice?.message || {};
  if (!choice || typeof message !== "object") throw new Error("oMLX returned no chat completion choice");
  const split = splitReasoning(extractText(message.content), extractText(message.reasoning_content || message.reasoning));
  const usage = payload.usage && typeof payload.usage === "object" ? payload.usage : {};
  const detailKeys = ["finish_reason", "prompt_tokens", "completion_tokens", "total_tokens", "model_load_duration", "time_to_first_token", "total_time", "prompt_tokens_per_second", "generation_tokens_per_second"];
  const details = Object.fromEntries(detailKeys.filter((key) => key in usage).map((key) => [key, usage[key]]));
  if ("finish_reason" in choice) details.finish_reason = choice.finish_reason;
  return { model, status: "ok", answer: split.answer, thinking: split.thinking, details };
}

function completionError(model, error) {
  return { model, status: "error", answer: "", thinking: "", details: {}, error: error.message || String(error) };
}

function buildChatPayload(question, model, options = {}) {
  const userContent = options.image?.data_url
    ? [{ type: "text", text: question }, { type: "image_url", image_url: { url: options.image.data_url, detail: "auto" } }]
    : question;
  const payload = {
    model,
    messages: [
      { role: "system", content: options.systemPrompt || DISPATCH_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    stream: false,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 2500,
    enable_thinking: options.thinking ?? true,
  };
  if (options.thinkingBudget !== undefined && options.thinkingBudget !== null) payload.thinking_budget = options.thinking ? options.thinkingBudget : 0;
  return payload;
}

async function directChat(model, prompt, options = {}) {
  try {
    const payload = await omlxRequest("/chat/completions", {
      method: "POST",
      body: JSON.stringify(buildChatPayload(prompt, model, options)),
    });
    return normalizeCompletion(model, payload);
  } catch (error) {
    return completionError(model, error);
  }
}

function councilOptions(overrides = {}) {
  return {
    thinking: state.thinking,
    thinkingBudget: state.thinking ? Number(state.thinkingBudget) : 0,
    maxTokens: Number(overrides.maxTokens ?? state.maxTokens),
    ...overrides,
  };
}

async function runDirectDispatch(question, models) {
  const results = await Promise.all(models.map((model) => directChat(model, question, councilOptions({ image: state.image }))));
  return { stage: "dispatch", question, thinking: state.thinking, results };
}

function secureShuffle(items) {
  const shuffled = items.slice();
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const random = new Uint32Array(1);
    const randomValue = globalThis.crypto?.getRandomValues
      ? globalThis.crypto.getRandomValues(random)[0]
      : Math.floor(Math.random() * 0x100000000);
    const swapIndex = randomValue % (index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function anonymousAnswers(answers) {
  return secureShuffle(answers.map((item) => ({ answer: item.answer }))).map((item, index) => ({ label: String.fromCharCode(65 + index), answer: item.answer }));
}

async function runDirectReview(question, answers, reviewers) {
  const anonymous = anonymousAnswers(answers);
  const formatted = anonymous.map((item) => `### Answer ${item.label}\n\n${item.answer}`).join("\n\n");
  const prompt = `Review the following council answers anonymously.\n\nFor every answer, provide:\n1. Strengths.\n2. Weaknesses, omissions, or errors.\n3. A score from 1 to 10.\n\nFinish with a ranking from best to worst, for example: B > A > C. Be specific and fair.\n\nQUESTION:\n${question}\n\nANONYMIZED ANSWERS:\n${formatted}`;
  const reviews = await Promise.all(reviewers.map((reviewer) => directChat(reviewer, prompt, councilOptions({ systemPrompt: REVIEW_SYSTEM_PROMPT, maxTokens: 1800, temperature: 0.4 }))));
  return { stage: "review", question, anonymous_answers: anonymous, reviews };
}

async function runDirectSynthesis(question, anonymous, reviews, chair) {
  const answerText = anonymous.map((item) => `### Answer ${item.label}\n\n${item.answer}`).join("\n\n");
  const reviewText = reviews.length ? `\n\nPEER REVIEWS:\n${reviews.map((item, index) => `### Reviewer ${index + 1}\n\n${item.answer}`).join("\n\n")}` : "";
  const prompt = `Act as the active chairman for this council. Select and weight the strongest answer; do not average all answers into a vague compromise. Reject errors explicitly.\n\nReturn:\n1. A clear final answer or recommendation.\n2. A short council readout: where the answers agreed, where they disagreed, and why you resolved the disagreement as you did.\n\nQUESTION:\n${question}\n\nANONYMIZED ANSWERS:\n${answerText}${reviewText}`;
  const synthesis = await directChat(chair, prompt, councilOptions({ systemPrompt: SYNTHESIS_SYSTEM_PROMPT, maxTokens: 2500, temperature: 0.4 }));
  return { stage: "synthesis", question, chair, synthesis };
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
    const payload = transportMode() === "direct"
      ? await runDirectReview(state.dispatch.question, answers, reviewers)
      : await omlxRequest("/council/review", { method: "POST", body: JSON.stringify({ question: state.dispatch.question, answers, reviewers, thinking: state.thinking, thinking_budget: state.thinking ? Number(state.thinkingBudget) : 0, max_tokens: 1800 }) });
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
  const anonymous = state.reviewPacket?.anonymous_answers || state.dispatch.results.filter((result) => result.status === "ok" && result.answer).map((result, index) => ({ label: String.fromCharCode(65 + index), answer: result.answer }));
  const reviews = (state.reviewPacket?.reviews || []).map((review) => ({ answer: review.answer || review.error || "" })).filter((review) => review.answer);
  const chair = $("chairModel").value;
  if (!chair) return showFormError("Choose a chairman model.");
  $("synthesizeButton").disabled = true;
  $("synthesizeButton").firstChild.textContent = "Chairman is weighing evidence… ";
  $("synthesisResult").innerHTML = '<p class="stage-empty">The chairman is selecting, rejecting, and resolving disagreement…</p>';
  try {
    const payload = transportMode() === "direct"
      ? await runDirectSynthesis(state.dispatch.question, anonymous, reviews, chair)
      : await omlxRequest("/council/synthesize", { method: "POST", body: JSON.stringify({ question: state.dispatch.question, anonymous_answers: anonymous, reviews, chair, thinking: state.thinking, thinking_budget: state.thinking ? Number(state.thinkingBudget) : 0, max_tokens: 2500 }) });
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
  if (transportMode() === "unconfigured") return showFormError("Set the oMLX server address in Settings before asking the council.");

  state.running = true;
  state.dispatch = null;
  state.reviewPacket = null;
  $("reviewPanel").hidden = true;
  $("synthesisPanel").hidden = true;
  $("askButton").disabled = true;
  $("askButton span:first-child").textContent = "Running three seats…";
  setLoading();
  try {
    const payload = transportMode() === "direct"
      ? await runDirectDispatch(state.prompt, models)
      : await omlxRequest("/council", { method: "POST", body: JSON.stringify({ question: state.prompt, models, thinking: state.thinking, thinking_budget: state.thinking ? Number(state.thinkingBudget) : 0, max_tokens: Number(state.maxTokens), image: state.image }) });
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
  renderOmlxSettings();
  $("question").addEventListener("input", (event) => { state.prompt = event.target.value; updatePromptMeta(); persistState(); });
  $("thinkingToggle").addEventListener("change", (event) => { state.thinking = event.target.checked; persistState(); });
  $("thinkingBudget").addEventListener("input", (event) => { state.thinkingBudget = Number(event.target.value) || 0; persistState(); });
  $("maxTokens").addEventListener("input", (event) => { state.maxTokens = Number(event.target.value) || 2500; persistState(); });
  $("councilForm").addEventListener("submit", askCouncil);
  $("reviewButton").addEventListener("click", runReview);
  $("synthesizeButton").addEventListener("click", runSynthesis);
  $("refreshModels").addEventListener("click", refreshModels);
  $("omlxSettingsButton").addEventListener("click", () => {
    const panel = $("omlxSettingsPanel");
    panel.hidden = !panel.hidden;
    if (!panel.hidden) $("omlxServerAddress").focus();
  });
  $("saveOmlxSettings").addEventListener("click", saveOmlxSettings);
  $("testOmlxConnection").addEventListener("click", testOmlxConnection);
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
