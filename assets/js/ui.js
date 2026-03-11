import { buildCalculatorContext, calculateLeaveBalance } from "./leave-calculator.js";

const MODE_EXPLANATIONS = {
  annual:
    "モードAでは、現在サイクル・1つ前・2つ前の付与サイクルに対応する消化日数を入力します。古い付与から順に消化へ割り当て、必要最小限の繰越だけ推定します。",
  carryover:
    "モードBでは、過去 2 サイクルの消化欄を無効化し、前年度からの繰越日数だけを使う簡易計算に切り替えます。会社の管理表などで把握している繰越日数がある場合に使います。",
};

const SAMPLE_VALUES = {
  hireDate: "2020-04-01",
  baseDate: "2026-03-11",
  weeklyDays: "5",
  additionalGrantDays: "2",
  mode: "annual",
  twoCyclesAgoUsed: "8.5",
  previousCycleUsed: "10",
  currentCycleUsed: "4.5",
  carryoverDays: "0",
};

export function initLeaveCalculatorApp() {
  const form = document.querySelector("#calculator-form");
  const feedback = document.querySelector("#feedback");
  const resultsPlaceholder = document.querySelector("#results-placeholder");
  const warningMessages = document.querySelector("#warning-messages");
  const results = document.querySelector("#results");
  const segmentControl = document.querySelector(".segment-control");
  const viewButtons = Array.from(document.querySelectorAll("[data-view-trigger]"));
  const viewPanels = Array.from(document.querySelectorAll("[data-view-panel]"));
  const summaryCards = document.querySelector("#summary-cards");
  const rationaleList = document.querySelector("#rationale-list");
  const grantHistoryTable = document.querySelector("#grant-history-table");
  const consumptionTable = document.querySelector("#consumption-table");
  const expirationTable = document.querySelector("#expiration-table");
  const modeExplanation = document.querySelector("#mode-explanation");

  const modeCards = Array.from(document.querySelectorAll("[data-mode-card]"));
  const cycleFields = {
    twoCyclesAgo: {
      container: document.querySelector("#two-cycles-field"),
      input: document.querySelector("#two-cycles-used"),
      label: document.querySelector("#two-cycles-label"),
      hint: document.querySelector("#two-cycles-hint"),
    },
    previousCycle: {
      container: document.querySelector("#previous-cycle-field"),
      input: document.querySelector("#previous-cycle-used"),
      label: document.querySelector("#previous-cycle-label"),
      hint: document.querySelector("#previous-cycle-hint"),
    },
    currentCycle: {
      container: document.querySelector("#current-cycle-field"),
      input: document.querySelector("#current-cycle-used"),
      label: document.querySelector("#current-cycle-label"),
      hint: document.querySelector("#current-cycle-hint"),
    },
    carryover: {
      container: document.querySelector("#carryover-field"),
      input: document.querySelector("#carryover-days"),
      hint: document.querySelector("#carryover-hint"),
    },
  };

  let hasCalculated = false;
  let currentView = "input";
  let viewTransitionToken = 0;
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const panelsByView = Object.fromEntries(viewPanels.map((panel) => [panel.dataset.viewPanel, panel]));

  const syncSegmentIndicator = (viewName) => {
    const activeButton = viewButtons.find((button) => button.dataset.viewTrigger === viewName);
    if (!activeButton) {
      return;
    }

    segmentControl.style.setProperty("--active-left", `${activeButton.offsetLeft}px`);
    segmentControl.style.setProperty("--active-width", `${activeButton.offsetWidth}px`);
  };

  const stopViewAnimations = () => {
    for (const panel of viewPanels) {
      for (const animation of panel.getAnimations()) {
        animation.cancel();
      }
      panel.style.opacity = "";
    }
  };

  const setPanelVisibility = (viewName) => {
    for (const panel of viewPanels) {
      panel.classList.toggle("is-hidden", panel.dataset.viewPanel !== viewName);
      panel.style.opacity = "";
    }
    currentView = viewName;
  };

  const animatePanelFade = async (panel, keyframes) => {
    const animation = panel.animate(keyframes, {
      duration: 220,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      fill: "both",
    });

    try {
      await animation.finished;
    } catch {
      // 新しい切替で cancel された場合は何もしない。
    }
  };

  const setActiveView = async (viewName, { animate = true, force = false } = {}) => {
    for (const button of viewButtons) {
      const isActive = button.dataset.viewTrigger === viewName;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-selected", String(isActive));
    }

    syncSegmentIndicator(viewName);

    if (!force && currentView === viewName) {
      return;
    }

    const previousPanel = panelsByView[currentView];
    const nextPanel = panelsByView[viewName];
    const shouldAnimate = animate && !prefersReducedMotion.matches && previousPanel && nextPanel;

    stopViewAnimations();
    const token = ++viewTransitionToken;

    if (!shouldAnimate) {
      setPanelVisibility(viewName);
      return;
    }

    if (previousPanel && !previousPanel.classList.contains("is-hidden")) {
      await animatePanelFade(previousPanel, [{ opacity: 1 }, { opacity: 0 }]);
    }

    if (token !== viewTransitionToken) {
      return;
    }

    previousPanel.classList.add("is-hidden");
    nextPanel.classList.remove("is-hidden");
    currentView = viewName;
    await animatePanelFade(nextPanel, [{ opacity: 0 }, { opacity: 1 }]);
    nextPanel.style.opacity = "";
  };

  const syncResultsAvailability = () => {
    results.classList.toggle("is-hidden", !hasCalculated);
    resultsPlaceholder.classList.toggle("is-hidden", hasCalculated);
  };

  const syncModeUi = () => {
    const mode = getSelectedMode(form);
    modeExplanation.textContent = MODE_EXPLANATIONS[mode];

    for (const card of modeCards) {
      card.classList.toggle("is-active", card.dataset.modeCard === mode);
    }

    const previewContext = buildCalculatorContext(readFormValues(form));
    applyCycleDescriptors(cycleFields, previewContext.cycleDescriptors, mode);
  };

  const calculateAndRender = ({ switchViewOnSuccess = false } = {}) => {
    const result = calculateLeaveBalance(readFormValues(form));
    feedback.innerHTML = "";
    warningMessages.innerHTML = "";

    if (!result.ok) {
      hasCalculated = false;
      syncResultsAvailability();
      void setActiveView("input");
      results.classList.add("is-hidden");
      renderMessages(feedback, "error", result.errors);
      return;
    }

    hasCalculated = true;
    syncResultsAvailability();

    if (result.warnings.length > 0) {
      renderMessages(warningMessages, "warning", result.warnings);
    }

    renderMessages(feedback, "success", [`${result.modeLabel}で基準日時点の残数を計算しました。`]);
    renderSummary(summaryCards, result.summary);
    renderRationale(rationaleList, result.rationale);
    renderGrantHistory(grantHistoryTable, result.grantHistory);
    renderConsumption(consumptionTable, result.consumptionBreakdown);
    renderExpiration(expirationTable, result.expirationBreakdown);

    if (switchViewOnSuccess) {
      void setActiveView("results");
    }
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    calculateAndRender({ switchViewOnSuccess: true });
  });

  form.addEventListener("change", () => {
    syncModeUi();
    if (hasCalculated) {
      calculateAndRender();
    }
  });

  form.addEventListener("input", () => {
    syncModeUi();
  });

  document.querySelector("#sample-button").addEventListener("click", () => {
    writeSampleValues(form);
    syncModeUi();
    calculateAndRender({ switchViewOnSuccess: true });
  });

  document.querySelector("#reset-button").addEventListener("click", () => {
    window.requestAnimationFrame(() => {
      hasCalculated = false;
      syncModeUi();
      syncResultsAvailability();
      void setActiveView("input");
      feedback.innerHTML = "";
      warningMessages.innerHTML = "";
      summaryCards.innerHTML = "";
      rationaleList.innerHTML = "";
      grantHistoryTable.innerHTML = "";
      consumptionTable.innerHTML = "";
      expirationTable.innerHTML = "";
    });
  });

  for (const button of viewButtons) {
    button.addEventListener("click", () => {
      void setActiveView(button.dataset.viewTrigger);
    });
  }

  window.addEventListener("resize", () => {
    syncSegmentIndicator(currentView);
  });

  void setActiveView("input", { animate: false, force: true });
  syncResultsAvailability();
  syncModeUi();
}

function getSelectedMode(form) {
  const selected = form.querySelector('input[name="mode"]:checked');
  return selected?.value === "carryover" ? "carryover" : "annual";
}

function readFormValues(form) {
  const formData = new FormData(form);
  return Object.fromEntries(formData.entries());
}

function writeSampleValues(form) {
  for (const [key, value] of Object.entries(SAMPLE_VALUES)) {
    const element = form.elements.namedItem(key);
    if (!element) {
      continue;
    }

    if (element instanceof RadioNodeList) {
      Array.from(element).forEach((radio) => {
        radio.checked = radio.value === value;
      });
      continue;
    }

    element.value = value;
  }
}

function applyCycleDescriptors(cycleFields, cycleDescriptors, mode) {
  for (const descriptor of cycleDescriptors) {
    const field = cycleFields[descriptor.key];
    if (!field) {
      continue;
    }

    field.label.textContent = descriptor.label;
    field.hint.textContent = descriptor.helperText;

    const shouldDisableByMode =
      mode === "carryover" && (descriptor.key === "twoCyclesAgo" || descriptor.key === "previousCycle");
    const shouldDisable = shouldDisableByMode || !descriptor.exists;
    field.input.disabled = shouldDisable;
    field.container.classList.toggle("is-disabled", shouldDisable);
  }

  const carryoverEnabled = mode === "carryover" && cycleDescriptors.some((descriptor) => descriptor.key === "currentCycle" && descriptor.exists);
  cycleFields.carryover.input.disabled = !carryoverEnabled;
  cycleFields.carryover.container.classList.toggle("is-disabled", !carryoverEnabled);
  cycleFields.carryover.hint.textContent =
    mode === "carryover"
      ? "モードB専用です。会社の管理表などで把握している現時点有効な繰越日数を入力します。"
      : "モードAでは使用しません。モードBに切り替えると入力できます。";
}

function renderMessages(target, type, messages) {
  target.innerHTML = "";

  if (!messages || messages.length === 0) {
    return;
  }

  const box = document.createElement("div");
  box.className = `message ${type}`;

  if (messages.length === 1) {
    box.textContent = messages[0];
    target.appendChild(box);
    return;
  }

  const list = document.createElement("ul");
  for (const message of messages) {
    const item = document.createElement("li");
    item.textContent = message;
    list.appendChild(item);
  }

  box.appendChild(list);
  target.appendChild(box);
}

function renderSummary(target, summaryItems) {
  target.innerHTML = "";

  for (const item of summaryItems) {
    const card = document.createElement("article");
    card.className = "summary-card";
    card.innerHTML = `
      <div class="label">${escapeHtml(item.label)}</div>
      <div class="value">${escapeHtml(item.value)}</div>
      <div class="note">${escapeHtml(item.note)}</div>
    `;
    target.appendChild(card);
  }
}

function renderRationale(target, rationaleItems) {
  target.innerHTML = "";

  for (const reason of rationaleItems) {
    const item = document.createElement("li");
    item.textContent = reason;
    target.appendChild(item);
  }
}

function renderGrantHistory(target, rows) {
  if (!rows || rows.length === 0) {
    target.innerHTML = '<div class="empty-state">基準日までに法定付与がまだ発生していません。</div>';
    return;
  }

  target.innerHTML = renderTable(
    [
      "付与日",
      "法定付与",
      "失効日",
      "今回追跡した日数",
      "消化反映",
      "失効反映",
      "残日数",
      "扱い",
    ],
    rows.map((row) => [
      row.grantDate,
      row.grantedDays,
      row.expiryDate,
      row.trackedDays,
      row.usedDays,
      row.expiredDays,
      row.remainingDays,
      row.treatment,
    ]),
  );
}

function renderConsumption(target, rows) {
  if (!rows || rows.length === 0) {
    target.innerHTML = '<div class="empty-state">今回の入力で消化反映された付与サイクルはありません。</div>';
    return;
  }

  target.innerHTML = renderTable(
    ["対象サイクル", "対象期間", "入力日数", "反映日数", "割当先", "備考"],
    rows.map((row) => [row.cycle, row.period, row.inputDays, row.appliedDays, row.allocation, row.note]),
  );
}

function renderExpiration(target, rows) {
  if (!rows || rows.length === 0) {
    target.innerHTML = '<div class="empty-state">今回の計算で再現された失効はありません。</div>';
    return;
  }

  target.innerHTML = renderTable(
    ["失効元", "失効日", "失効日数", "備考"],
    rows.map((row) => [row.source, row.expiryDate, row.expiredDays, row.note]),
  );
}

function renderTable(headers, rows) {
  const headerHtml = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const bodyHtml = rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell ?? "—"))}</td>`).join("")}</tr>`,
    )
    .join("");

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>${headerHtml}</tr>
        </thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    </div>
  `;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
