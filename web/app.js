const STORAGE_KEY = "local-model-council:v1";
const MAX_HISTORY = 8;
const REQUEST_TIMEOUT_MS = 180_000;
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

function transportLabel() {
  const mode = transportMode();
  if (mode === "direct") return message("browserTransport");
  if (mode === "proxy") return message("proxyTransport");
  return message("configure");
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
  setLabel($("connectionStatus"), message);
}

function setSettingsStatus(message, error = false) {
  const target = $("omlxSettingsStatus");
  if (!target) return;
  setLabel(target, message);
  target.className = `settings-status ${error ? "error" : ""}`;
}

function familyFor(modelId) {
  const lower = modelId.toLowerCase();
  return FAMILY_NAMES.find((family) => lower.includes(family.toLowerCase())) || message("localModel");
}

function isLikelyChatModel(model) {
  const id = String(model?.id || "").toLowerCase();
  const type = String(model?.model_type || model?.type || "").toLowerCase();
  const nonChatMarkers = ["asr", "forcedaligner", "reranker", "embedding", "embed", "markitdown"];
  return !nonChatMarkers.some((marker) => id.includes(marker) || type.includes(marker));
}

function chatModels() {
  return state.models.filter(isLikelyChatModel);
}

function isLikelyVisionModel(modelId) {
  const lower = String(modelId || "").toLowerCase();
  return /(^|[-_])(vl|vision|image|llava|pixtral)([-_]|$)/.test(lower) || lower.includes("minicpm-o");
}

function modelOptions(selected) {
  const options = chatModels();
  if (!options.length) return `<option value="" data-i18n="noChatModels">${translate(message("noChatModels"))}</option>`;
  return options.map((model) => {
    const id = String(model.id);
    const selectedAttr = id === selected ? " selected" : "";
    return `<option value="${escapeAttribute(id)}"${selectedAttr}>${escapeHtml(id)}</option>`;
  }).join("");
}

function renderSeats() {
  const available = chatModels();
  $("seatConfig").innerHTML = [0, 1, 2].map((index) => {
    const selected = state.selectedModels[index] || available[index]?.id || "";
    const model = state.customModels[index] || selected;
    const family = model ? familyFor(model) : message("waitingModel");
    const labels = { number: index + 1 };
    return `
      <div class="seat-card">
        <div class="seat-label"><span class="seat-index">${String.fromCharCode(65 + index)}</span> ${labelMarkup(message("seat", labels))}</div>
        <select class="model-select" data-seat="${index}" ${labelAttribute("aria-label", "seatModel", labels)} ${labelValues(labels)}>${modelOptions(selected)}</select>
        <input class="model-custom" data-custom-seat="${index}" value="${escapeAttribute(state.customModels[index])}" ${labelAttribute("placeholder", "pasteModel")} ${labelAttribute("aria-label", "customModel", labels)} ${labelValues(labels)} />
        <span class="model-family" data-family-seat="${index}">${labelMarkup(family)}</span>
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
  if (target) setLabel(target, value ? familyFor(value) : message("waitingModel"));
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

function errorMessage(payload) {
  if (typeof payload?.error === "string") return payload.error;
  if (typeof payload?.detail === "string") return payload.detail;
  if (payload?.error?.message) return payload.error.message;
  return "";
}

async function omlxRequest(path, options = {}) {
  const mode = transportMode();
  if (mode === "unconfigured") throw new InterfaceError("configurePages");
  const base = mode === "direct" ? `${normalizeOmlxAddress(state.omlxBaseUrl)}/v1` : "/api";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), path === "/models" ? 15_000 : REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${base}${path}`, { ...options, signal: controller.signal, headers: requestHeaders(options, mode === "direct") });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = text ? { error: text } : {}; }
    if (!response.ok) {
      const detail = errorMessage(payload);
      if (detail) throw new Error(detail);
      throw new InterfaceError("requestFailed", { status: response.status });
    }
    return payload;
  } catch (error) {
    if (error?.name === "AbortError") {
      const seconds = path === "/models" ? 15 : REQUEST_TIMEOUT_MS / 1000;
      throw new InterfaceError("timeout", { seconds });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function renderOmlxSettings() {
  if ($("omlxServerAddress")) $("omlxServerAddress").value = state.omlxBaseUrl;
  if ($("omlxApiKey")) $("omlxApiKey").value = state.omlxApiKey;
  if ($("transportDescription")) setLabel($("transportDescription"), transportLabel());
}

function validateOmlxAddress(value) {
  const address = normalizeOmlxAddress(value);
  if (!address) return "";
  try {
    const parsed = new URL(address);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    return address;
  } catch {
    throw new InterfaceError("invalidAddress");
  }
}

async function saveOmlxSettings() {
  try {
    state.omlxBaseUrl = validateOmlxAddress($("omlxServerAddress").value);
    state.omlxApiKey = $("omlxApiKey").value.trim();
    persistState();
    renderOmlxSettings();
    setSettingsStatus(message("savedTesting"));
    await refreshModels();
    setSettingsStatus(message("connectedVia", { transport: transportLabel() }));
  } catch (error) {
    setSettingsStatus(errorLabel(error, "saveFailed"), true);
    showFormError(errorLabel(error, "saveFailed"));
  }
}

async function testOmlxConnection() {
  try {
    state.omlxBaseUrl = validateOmlxAddress($("omlxServerAddress").value);
    state.omlxApiKey = $("omlxApiKey").value.trim();
    persistState();
    renderOmlxSettings();
    setSettingsStatus(message("testing"));
    await refreshModels();
    setSettingsStatus(message("readyVia", { transport: transportLabel() }));
  } catch (error) {
    setSettingsStatus(errorLabel(error, "unreachable"), true);
  }
}

async function refreshModels() {
  renderOmlxSettings();
  if (transportMode() === "unconfigured") {
    state.models = [];
    setConnection(false, message("setServer"));
    renderSeats();
    if (!$('reviewPanel').hidden) renderStageControls();
    return;
  }
  setConnection(false, message("checking"));
  try {
    const payload = await omlxRequest("/models", { cache: "no-store" });
    state.models = Array.isArray(payload.data) ? payload.data : [];
    setConnection(true, message(state.models.length === 1 ? "oneModel" : "modelCount", { count: state.models.length }));
    const available = chatModels();
    const knownIds = new Set(available.map((model) => model.id));
    state.selectedModels = state.selectedModels.map((id, index) => knownIds.has(id) ? id : available[index]?.id || "");
    renderSeats();
    if (!$('reviewPanel').hidden) renderStageControls();
  } catch (error) {
    state.models = [];
    setConnection(false, message("unavailable"));
    renderSeats();
    if (!$('reviewPanel').hidden) renderStageControls();
    if (transportMode() !== "unconfigured") showFormError(errorLabel(error, "connectFailed"));
  }
}

function updatePromptMeta() {
  $("charCount").textContent = `${state.prompt.length.toLocaleString(locale)} / ${(20000).toLocaleString(locale)}`;
  setLabel($("draftStatus"), message(state.prompt ? "draftSaved" : "draftEmpty"));
}

function showProcessing(stage, total, completed = 0, detail = null) {
  const banner = $("processingBanner");
  if (!banner) return;
  const titles = {
    dispatch: message("dispatchProcessing"),
    review: message("reviewProcessing"),
    synthesis: message("chairProcessing"),
  };
  const direct = transportMode() === "direct";
  const indeterminate = !direct;
  const count = $("processingCount");
  const progress = $("processingProgress");
  const track = progress?.parentElement;
  banner.hidden = false;
  banner.className = `processing-banner ${stage}`;
  setLabel($("processingTitle"), titles[stage] || message("working"));
  setLabel($("processingDetail"), detail || message(direct ? "parallelProcessing" : "proxyProcessing"));
  if (indeterminate) {
    setLabel(count, message("waitingServer"));
    progress.classList.add("indeterminate");
    progress.style.width = "";
    if (track) track.setAttribute("aria-valuenow", "0");
  } else {
    setLabel(count, message(stage === "synthesis" ? "stepProgress" : "seatProgress", { completed, total }));
    progress.classList.remove("indeterminate");
    progress.style.width = `${Math.max(0, Math.min(100, (completed / total) * 100))}%`;
    if (track) track.setAttribute("aria-valuenow", String(completed));
  }
}

function finishProcessing() {
  const banner = $("processingBanner");
  if (banner) banner.hidden = true;
}

function showProcessingError(message) {
  const banner = $("processingBanner");
  if (!banner) return;
  banner.hidden = false;
  banner.className = "processing-banner error";
  setLabel($("processingTitle"), message("stopped"));
  setLabel($("processingDetail"), message);
  setLabel($("processingCount"), message("attention"));
  $("processingProgress").classList.remove("indeterminate");
  $("processingProgress").style.width = "100%";
}

function setLoading() {
  setLabel($("resultsNote"), message("thinkingSeats"));
  showProcessing("dispatch", 3);
  $("resultsGrid").innerHTML = [0, 1, 2].map((index) => `
    <article class="response-card loading" aria-busy="true">
      <div class="response-header"><span class="response-model">${labelMarkup(selectedModel(index) || message("seat", { number: index + 1 }))}</span><span class="response-status processing-status"><span class="mini-spinner" aria-hidden="true"></span>${labelMarkup(message("processing"))}</span></div>
      <div class="response-body"><div class="seat-processing-label">${labelMarkup(message("waitingResponse"))}</div><div class="loading-line"></div><div class="loading-line short"></div><div class="loading-line"></div></div>
    </article>`).join("");
}

function renderResults(payload) {
  const results = Array.isArray(payload.results) ? payload.results : [];
  const successful = results.filter((result) => result.status === "ok").length;
  setLabel($("resultsNote"), message("answeredCount", { successful, total: results.length }));
  $("resultsGrid").innerHTML = results.map((result, index) => {
    const status = result.status === "ok" ? message("answered") : message("failed");
    const statusClass = result.status === "ok" ? "ok" : "error";
    const thinking = result.thinking || "";
    const details = result.details || {};
    const detailsRows = Object.entries(details).map(([key, value]) => `<span>${labelMarkup(Object.hasOwn(MESSAGES, key) ? message(key) : prettyKey(key))}</span><span>${escapeHtml(String(value))}</span>`).join("");
    return `
      <article class="response-card ${statusClass === "error" ? "error" : ""}">
        <div class="response-header"><span class="response-model" ${result.model ? `title="${escapeAttribute(result.model)}"` : ""}>${labelMarkup(result.model || message("seat", { number: index + 1 }))}</span><span class="response-status ${statusClass}">${labelMarkup(status)}</span></div>
        <div class="response-body">
          ${result.status === "ok" ? `<p class="response-answer">${labelMarkup(result.answer || message("noAnswer"))}</p>` : `<p class="placeholder-copy">${labelMarkup(result.interfaceError || result.error || message("noSeatResponse"))}</p>`}
          ${thinking ? `<details class="thinking-details"><summary>${labelMarkup(message("thinkingReturned"))}</summary><div class="thinking-copy">${escapeHtml(thinking)}</div></details>` : ""}
          ${detailsRows ? `<details class="meta-details"><summary>${labelMarkup(message("runDetails"))}</summary><div class="meta-copy">${detailsRows}</div></details>` : ""}
        </div>
      </article>`;
  }).join("");
}

function stageModelOptions(selected, excluded = []) {
  const options = chatModels().filter((model) => !excluded.includes(model.id));
  if (!options.length) return `<option value="" data-i18n="noChatModels">${translate(message("noChatModels"))}</option>`;
  return options.map((model) => `<option value="${escapeAttribute(model.id)}"${model.id === selected ? " selected" : ""}>${escapeHtml(model.id)}</option>`).join("");
}

function renderStageControls() {
  const available = chatModels();
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
    <div class="anonymous-answer"><div class="anonymous-label">${labelMarkup(message("answerLabel", { label: item.label }))}</div><div class="anonymous-copy">${escapeHtml(item.answer)}</div></div>`).join("");
  const reviewCards = (payload.reviews || []).map((review, index) => {
    const status = review.status === "ok" ? message("reviewer", { number: index + 1 }) : message("reviewerFailed");
    return `<div class="review-card"><div class="review-card-header"><span>${labelMarkup(status)}</span><span>${labelMarkup(message("authorsHidden"))}</span></div><div class="review-copy">${labelMarkup(review.answer || review.interfaceError || review.error || message("noReview"))}</div>${review.thinking ? `<details class="thinking-details"><summary>${labelMarkup(message("reviewerThinking"))}</summary><div class="thinking-copy">${escapeHtml(review.thinking)}</div></details>` : ""}</div>`;
  }).join("");
  $("reviewResults").innerHTML = `
    <div class="review-block"><h3>${labelMarkup(message("anonymousPacket"))}</h3>${answerCards}</div>
    <div class="review-block"><h3>${labelMarkup(message("independentReviews"))}</h3>${reviewCards || stageNote("noReview")}</div>`;
}

function renderSynthesis(payload) {
  const synthesis = payload.synthesis || {};
  const details = synthesis.details || {};
  const detailRows = Object.entries(details).map(([key, value]) => `<span>${labelMarkup(Object.hasOwn(MESSAGES, key) ? message(key) : prettyKey(key))}</span><span>${escapeHtml(String(value))}</span>`).join("");
  $("synthesisResult").innerHTML = `
    <article class="synthesis-card">
      <div class="response-header"><span class="response-model">${labelMarkup(message("chair"))} · ${labelMarkup(payload.chair || synthesis.model || message("localModel"))}</span><span class="response-status ${synthesis.status === "ok" ? "ok" : "error"}">${labelMarkup(message(synthesis.status === "ok" ? "synthesized" : "failed"))}</span></div>
      <p class="response-answer">${labelMarkup(synthesis.answer || synthesis.interfaceError || synthesis.error || message("noSynthesis"))}</p>
      ${synthesis.thinking ? `<details class="thinking-details"><summary>${labelMarkup(message("chairThinking"))}</summary><div class="thinking-copy">${escapeHtml(synthesis.thinking)}</div></details>` : ""}
      ${detailRows ? `<details class="meta-details"><summary>${labelMarkup(message("runDetails"))}</summary><div class="meta-copy">${detailRows}</div></details>` : ""}
    </article>`;
}

function stageNote(key) {
  return `<p class="stage-empty">${labelMarkup(message(key))}</p>`;
}

function showStagePanels() {
  $("reviewPanel").hidden = false;
  $("synthesisPanel").hidden = false;
  $("reviewResults").innerHTML = stageNote("reviewEmpty");
  $("synthesisResult").innerHTML = stageNote("synthesisEmpty");
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
  if (!choice || typeof message !== "object") throw new InterfaceError("noCompletion");
  const split = splitReasoning(extractText(message.content), extractText(message.reasoning_content || message.reasoning));
  const usage = payload.usage && typeof payload.usage === "object" ? payload.usage : {};
  const detailKeys = ["finish_reason", "prompt_tokens", "completion_tokens", "total_tokens", "model_load_duration", "time_to_first_token", "total_time", "prompt_tokens_per_second", "generation_tokens_per_second"];
  const details = Object.fromEntries(detailKeys.filter((key) => key in usage).map((key) => [key, usage[key]]));
  if ("finish_reason" in choice) details.finish_reason = choice.finish_reason;
  return { model, status: "ok", answer: split.answer, thinking: split.thinking, details };
}

function completionError(model, error) {
  return { model, status: "error", answer: "", thinking: "", details: {}, error: error.message || String(error), interfaceError: error.label };
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
  let completed = 0;
  const results = await Promise.all(models.map(async (model) => {
    const result = await directChat(model, question, councilOptions({ image: state.image }));
    completed += 1;
    showProcessing("dispatch", models.length, completed, message("dispatchProgress", { completed, total: models.length }));
    return result;
  }));
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
  let completed = 0;
  const reviews = await Promise.all(reviewers.map(async (reviewer) => {
    const review = await directChat(reviewer, prompt, councilOptions({ systemPrompt: REVIEW_SYSTEM_PROMPT, maxTokens: 1800, temperature: 0.4 }));
    completed += 1;
    showProcessing("review", reviewers.length, completed, message("reviewProgress", { completed, total: reviewers.length }));
    return review;
  }));
  return { stage: "review", question, anonymous_answers: anonymous, reviews };
}

async function runDirectSynthesis(question, anonymous, reviews, chair) {
  const answerText = anonymous.map((item) => `### Answer ${item.label}\n\n${item.answer}`).join("\n\n");
  const reviewText = reviews.length ? `\n\nPEER REVIEWS:\n${reviews.map((item, index) => `### Reviewer ${index + 1}\n\n${item.answer}`).join("\n\n")}` : "";
  const prompt = `Act as the active chairman for this council. Select and weight the strongest answer; do not average all answers into a vague compromise. Reject errors explicitly.\n\nReturn:\n1. A clear final answer or recommendation.\n2. A short council readout: where the answers agreed, where they disagreed, and why you resolved the disagreement as you did.\n\nQUESTION:\n${question}\n\nANONYMIZED ANSWERS:\n${answerText}${reviewText}`;
  const synthesis = await directChat(chair, prompt, councilOptions({ systemPrompt: SYNTHESIS_SYSTEM_PROMPT, maxTokens: 2500, temperature: 0.4 }));
  showProcessing("synthesis", 1, 1, message("chairDone"));
  return { stage: "synthesis", question, chair, synthesis };
}

async function runReview() {
  hideFormError();
  if (!state.dispatch) return showFormError(message("runSeatsFirst"));
  const answers = state.dispatch.results.filter((result) => result.status === "ok" && result.answer).map((result) => ({ answer: result.answer }));
  const reviewers = [$("reviewerOne").value, $("reviewerTwo").value];
  if (answers.length < 2) return showFormError(message("needTwoAnswers"));
  if (!reviewers[0] || !reviewers[1] || reviewers[0] === reviewers[1]) return showFormError(message("distinctReviewers"));
  $("reviewButton").disabled = true;
  setLabel($("reviewButtonLabel"), message("reviewing"));
  $("reviewResults").innerHTML = stageNote("reviewLoading");
  showProcessing("review", 2, 0, message("reviewSending"));
  try {
    const payload = transportMode() === "direct"
      ? await runDirectReview(state.dispatch.question, answers, reviewers)
      : await omlxRequest("/council/review", { method: "POST", body: JSON.stringify({ question: state.dispatch.question, answers, reviewers, thinking: state.thinking, thinking_budget: state.thinking ? Number(state.thinkingBudget) : 0, max_tokens: 1800 }) });
    state.reviewPacket = payload;
    renderReviewPacket(payload);
    finishProcessing();
    $("synthesisResult").innerHTML = stageNote("reviewsReady");
  } catch (error) {
    showFormError(errorLabel(error, "reviewFailed"));
    showProcessingError(errorLabel(error, "reviewFailed"));
    $("reviewResults").innerHTML = stageNote("noReviewPacket");
  } finally {
    $("reviewButton").disabled = false;
    setLabel($("reviewButtonLabel"), message("runReview"));
  }
}

async function runSynthesis() {
  hideFormError();
  if (!state.dispatch) return showFormError(message("runSeatsFirst"));
  const anonymous = state.reviewPacket?.anonymous_answers || state.dispatch.results.filter((result) => result.status === "ok" && result.answer).map((result, index) => ({ label: String.fromCharCode(65 + index), answer: result.answer }));
  const reviews = (state.reviewPacket?.reviews || []).map((review) => ({ answer: review.answer || review.error || "" })).filter((review) => review.answer);
  const chair = $("chairModel").value;
  if (!chair) return showFormError(message("chooseChair"));
  $("synthesizeButton").disabled = true;
  setLabel($("synthesizeButtonLabel"), message("chairWeighing"));
  $("synthesisResult").innerHTML = stageNote("chairSelecting");
  showProcessing("synthesis", 1, 0, message("chairSelecting"));
  try {
    const payload = transportMode() === "direct"
      ? await runDirectSynthesis(state.dispatch.question, anonymous, reviews, chair)
      : await omlxRequest("/council/synthesize", { method: "POST", body: JSON.stringify({ question: state.dispatch.question, anonymous_answers: anonymous, reviews, chair, thinking: state.thinking, thinking_budget: state.thinking ? Number(state.thinkingBudget) : 0, max_tokens: 2500 }) });
    renderSynthesis(payload);
    finishProcessing();
  } catch (error) {
    showFormError(errorLabel(error, "synthesisFailed"));
    showProcessingError(errorLabel(error, "synthesisFailed"));
    $("synthesisResult").innerHTML = stageNote("noSynthesisProduced");
  } finally {
    $("synthesizeButton").disabled = false;
    setLabel($("synthesizeButtonLabel"), message("askChair"));
  }
}

async function fileAsDataUrl(file) {
  if (!file) return null;
  if (file.size > 8 * 1024 * 1024) throw new InterfaceError("imageLimit");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, data_url: reader.result });
    reader.onerror = () => reject(new InterfaceError("imageReadFailed"));
    reader.readAsDataURL(file);
  });
}

async function askCouncil(event) {
  event.preventDefault();
  hideFormError();
  const models = [0, 1, 2].map(selectedModel);
  if (!state.prompt.trim()) return showFormError(message("needQuestion"));
  if (models.some((model) => !model)) return showFormError(message("needModels"));
  if (new Set(models).size !== 3) return showFormError(message("distinctModels"));
  if (transportMode() === "unconfigured") return showFormError(message("configureBeforeAsk"));
  if (state.image && models.some((model) => !isLikelyVisionModel(model))) return showFormError(message("visionRequired"));

  state.running = true;
  state.dispatch = null;
  state.reviewPacket = null;
  $("reviewPanel").hidden = true;
  $("synthesisPanel").hidden = true;
  $("askButton").disabled = true;
  setLabel($("askButtonLabel"), message("runningSeats"));
  setLoading();
  try {
    const payload = transportMode() === "direct"
      ? await runDirectDispatch(state.prompt, models)
      : await omlxRequest("/council", { method: "POST", body: JSON.stringify({ question: state.prompt, models, thinking: state.thinking, thinking_budget: state.thinking ? Number(state.thinkingBudget) : 0, max_tokens: Number(state.maxTokens), image: state.image }) });
    state.dispatch = payload;
    renderResults(payload);
    finishProcessing();
    showStagePanels();
    addHistory(state.prompt, models);
  } catch (error) {
    setLabel($("resultsNote"), message("runIncomplete"));
    showFormError(errorLabel(error, "runFailed"));
    showProcessingError(errorLabel(error, "runFailed"));
  } finally {
    state.running = false;
    $("askButton").disabled = false;
    setLabel($("askButtonLabel"), message("ask"));
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
    container.innerHTML = `<p class="empty-state">${labelMarkup(message("historyEmpty"))}</p>`;
    return;
  }
  container.innerHTML = state.history.map((item, index) => `
    <div class="history-item">
      <span class="history-question" title="${escapeAttribute(item.question)}">${escapeHtml(item.question)}</span>
      <span class="history-date" data-history-date="${index}">${escapeHtml(formatDate(item.at))}</span>
      <button class="history-load" type="button" data-history-index="${index}">${labelMarkup(message("load"))}</button>
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

function updateHistoryDates() {
  $("historyList").querySelectorAll("[data-history-date]").forEach((element) => {
    element.textContent = formatDate(state.history[Number(element.dataset.historyDate)].at);
  });
}

function formatDate(value) {
  try { return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(new Date(value)); } catch { return translate(message("saved")); }
}

function prettyKey(key) { return key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char])); }
function escapeAttribute(value) { return escapeHtml(value).replace(/`/g, "&#096;"); }
function showFormError(message) { setLabel($("formError"), message); $("formError").hidden = false; }
function hideFormError() { $("formError").hidden = true; setLabel($("formError"), ""); }

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
    if (!file) { state.image = null; setLabel($("attachmentName"), message("optionalImage")); return; }
    try {
      state.image = await fileAsDataUrl(file);
      setLabel($("attachmentName"), file.name);
      hideFormError();
    } catch (error) {
      state.image = null;
      event.target.value = "";
      showFormError(errorLabel(error, "imageReadFailed"));
    }
  });
}

loadState();
bindPreferences();
bindUI();
updatePromptMeta();
renderHistory();
renderSeats();
refreshModels();
