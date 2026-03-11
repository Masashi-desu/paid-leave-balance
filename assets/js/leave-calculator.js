import {
  addMonths,
  addYears,
  compareDates,
  formatDate,
  formatDateRange,
  parseDateInput,
  subtractDays,
} from "./date-utils.js";
import { getGrantDaysForWeeklyDays, getGrantRuleLabel } from "./grant-rules.js";

const MODE_ANNUAL = "annual";
const MODE_CARRYOVER = "carryover";

const CYCLE_META = [
  { key: "twoCyclesAgo", offset: 2, title: "2つ前の付与サイクル" },
  { key: "previousCycle", offset: 1, title: "1つ前の付与サイクル" },
  { key: "currentCycle", offset: 0, title: "現在の付与サイクル" },
];

export function formatDays(value) {
  const rounded = Math.round((Number(value) + Number.EPSILON) * 2) / 2;
  if (Number.isInteger(rounded)) {
    return String(rounded);
  }

  return rounded.toFixed(1);
}

export function buildCalculatorContext(rawInput) {
  const parsed = parseRawInput(rawInput);
  const basicErrors = [];

  if (!parsed.hireDate) {
    basicErrors.push("入社日を入力してください。");
  }
  if (!parsed.baseDate) {
    basicErrors.push("計算基準日を入力してください。");
  }
  if (!Number.isInteger(parsed.weeklyDays) || parsed.weeklyDays < 1 || parsed.weeklyDays > 5) {
    basicErrors.push("週の所定労働日数は 1〜5 日の整数で入力してください。");
  }
  if (parsed.hireDate && parsed.baseDate && compareDates(parsed.baseDate, parsed.hireDate) < 0) {
    basicErrors.push("計算基準日は入社日以降の日付にしてください。");
  }

  if (basicErrors.length > 0) {
    return {
      parsed,
      basicErrors,
      schedule: { grants: [], nextGrantDate: parsed.hireDate ? addMonths(parsed.hireDate, 6) : null },
      currentGrantIndex: -1,
      cycleDescriptors: buildFallbackCycleDescriptors(parsed),
    };
  }

  const schedule = generateGrantSchedule(parsed.hireDate, parsed.baseDate, parsed.weeklyDays);
  const currentGrantIndex = schedule.grants.length - 1;
  return {
    parsed,
    basicErrors: [],
    schedule,
    currentGrantIndex,
    cycleDescriptors: buildCycleDescriptors(schedule.grants, schedule.nextGrantDate, parsed.baseDate),
  };
}

export function calculateLeaveBalance(rawInput) {
  const context = buildCalculatorContext(rawInput);
  const errors = [...context.basicErrors, ...validateNumericalInputs(context.parsed, context.cycleDescriptors)];

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      warnings: [],
      cycleDescriptors: context.cycleDescriptors,
    };
  }

  if (context.parsed.mode === MODE_CARRYOVER) {
    return {
      ok: true,
      cycleDescriptors: context.cycleDescriptors,
      ...calculateCarryoverMode(context),
    };
  }

  return {
    ok: true,
    cycleDescriptors: context.cycleDescriptors,
    ...calculateAnnualMode(context),
  };
}

function parseRawInput(rawInput) {
  return {
    hireDate: parseDateInput(rawInput.hireDate),
    baseDate: parseDateInput(rawInput.baseDate),
    weeklyDays: Number(rawInput.weeklyDays),
    additionalGrantDays: parseHalfDayField(rawInput.additionalGrantDays),
    mode: rawInput.mode === MODE_CARRYOVER ? MODE_CARRYOVER : MODE_ANNUAL,
    twoCyclesAgoUsed: parseHalfDayField(rawInput.twoCyclesAgoUsed),
    previousCycleUsed: parseHalfDayField(rawInput.previousCycleUsed),
    currentCycleUsed: parseHalfDayField(rawInput.currentCycleUsed),
    carryoverDays: parseHalfDayField(rawInput.carryoverDays),
  };
}

function parseHalfDayField(value) {
  if (value === "" || value === null || value === undefined) {
    return 0;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function validateNumericalInputs(parsed, cycleDescriptors) {
  const errors = [];
  const numericLabels = [
    { value: parsed.additionalGrantDays, label: "会社独自付与日数" },
    { value: parsed.twoCyclesAgoUsed, label: "2つ前の付与サイクルの消化日数" },
    { value: parsed.previousCycleUsed, label: "1つ前の付与サイクルの消化日数" },
    { value: parsed.currentCycleUsed, label: "現在の付与サイクルの消化日数" },
    { value: parsed.carryoverDays, label: "前年度からの繰越日数" },
  ];

  for (const item of numericLabels) {
    if (!Number.isFinite(item.value) || item.value < 0) {
      errors.push(`${item.label}は 0 以上の数値で入力してください。`);
      continue;
    }

    if (!isHalfStep(item.value)) {
      errors.push(`${item.label}は 0.5 日単位で入力してください。`);
    }
  }

  const descriptorByKey = Object.fromEntries(cycleDescriptors.map((descriptor) => [descriptor.key, descriptor]));
  if (!descriptorByKey.twoCyclesAgo.exists && parsed.twoCyclesAgoUsed > 0) {
    errors.push("2つ前の付与サイクルが存在しないため、その消化日数は 0 のままにしてください。");
  }
  if (!descriptorByKey.previousCycle.exists && parsed.previousCycleUsed > 0) {
    errors.push("1つ前の付与サイクルが存在しないため、その消化日数は 0 のままにしてください。");
  }
  if (!descriptorByKey.currentCycle.exists && parsed.currentCycleUsed > 0) {
    errors.push("現在の付与サイクルがまだ始まっていないため、その消化日数は 0 のままにしてください。");
  }
  if (!descriptorByKey.currentCycle.exists && parsed.carryoverDays > 0) {
    errors.push("現在の付与サイクルがまだ始まっていないため、前年度からの繰越日数は 0 のままにしてください。");
  }

  return errors;
}

function isHalfStep(value) {
  return Math.abs(value * 2 - Math.round(value * 2)) < 1e-9;
}

function generateGrantSchedule(hireDate, baseDate, weeklyDays) {
  const grants = [];
  let cursor = addMonths(hireDate, 6);
  let grantIndex = 0;

  while (compareDates(cursor, baseDate) <= 0) {
    const grantedDays = getGrantDaysForWeeklyDays(weeklyDays, grantIndex);
    grants.push({
      id: `grant-${grantIndex}`,
      grantIndex,
      grantDate: cursor,
      grantedDays,
      expiryDate: addYears(cursor, 2),
      label: `${formatDate(cursor)} 付与分`,
    });
    cursor = addYears(cursor, 1);
    grantIndex += 1;
  }

  return {
    grants,
    nextGrantDate: cursor,
  };
}

function buildFallbackCycleDescriptors(parsed) {
  const firstGrantDate = parsed.hireDate ? addMonths(parsed.hireDate, 6) : null;
  return CYCLE_META.map((meta) => {
    if (meta.key === "currentCycle" && firstGrantDate) {
      return {
        key: meta.key,
        title: meta.title,
        exists: false,
        isCurrentCycle: true,
        label: `${meta.title}（初回付与前）`,
        helperText: `初回の法定付与予定日は ${formatDate(firstGrantDate)} です。`,
      };
    }

    return {
      key: meta.key,
      title: meta.title,
      exists: false,
      isCurrentCycle: meta.key === "currentCycle",
      label: meta.title,
      helperText: "入社日と計算基準日を入力すると対象期間を表示します。",
    };
  });
}

function buildCycleDescriptors(grants, nextGrantDate, baseDate) {
  const currentGrantIndex = grants.length - 1;

  if (currentGrantIndex < 0) {
    return buildFallbackCycleDescriptors({
      hireDate: nextGrantDate ? addMonths(nextGrantDate, -6) : null,
    });
  }

  return CYCLE_META.map((meta) => {
    const grantIndex = currentGrantIndex - meta.offset;
    if (grantIndex < 0) {
      return {
        key: meta.key,
        title: meta.title,
        exists: false,
        isCurrentCycle: meta.key === "currentCycle",
        label: `${meta.title}（該当なし）`,
        helperText: "この付与サイクルはまだ存在しません。0 日のままにしてください。",
      };
    }

    const startDate = grants[grantIndex].grantDate;
    const rangeEndDate =
      grantIndex === currentGrantIndex
        ? baseDate
        : subtractDays(grants[grantIndex + 1].grantDate, 1);
    const fullCycleEndDate =
      grantIndex === currentGrantIndex && nextGrantDate
        ? subtractDays(nextGrantDate, 1)
        : rangeEndDate;

    return {
      key: meta.key,
      title: meta.title,
      exists: true,
      isCurrentCycle: meta.key === "currentCycle",
      grantIndex,
      label: `${meta.title}（${formatDateRange(startDate, fullCycleEndDate)}）`,
      helperText:
        grantIndex === currentGrantIndex
          ? `${formatDate(startDate)} から基準日 ${formatDate(baseDate)} までに消化した日数を入力します。`
          : `${formatDateRange(startDate, rangeEndDate)} に消化した日数を入力します。`,
      periodLabel: formatDateRange(startDate, rangeEndDate),
    };
  });
}

function createGrantTrackingRows(grants) {
  return grants.map((grant) => ({
    grant,
    trackedDays: 0,
    usedDays: 0,
    expiredDays: 0,
    remainingDays: 0,
    treatment: "履歴表示のみ",
  }));
}

function calculateAnnualMode(context) {
  const { parsed, schedule, currentGrantIndex, cycleDescriptors } = context;
  const trackingRows = createGrantTrackingRows(schedule.grants);
  const consumptionRows = [];
  const expiryRows = [];
  const warnings = [];
  const buckets = [];

  let currentCycleCarryover = 0;
  let inferredCarryover = 0;
  let unresolvedShortage = 0;

  const startIndex = currentGrantIndex >= 0 ? Math.max(0, currentGrantIndex - 2) : 0;
  const inputsByIndex = new Map();

  if (currentGrantIndex >= 2) {
    inputsByIndex.set(currentGrantIndex - 2, parsed.twoCyclesAgoUsed);
  }
  if (currentGrantIndex >= 1) {
    inputsByIndex.set(currentGrantIndex - 1, parsed.previousCycleUsed);
  }
  if (currentGrantIndex >= 0) {
    inputsByIndex.set(currentGrantIndex, parsed.currentCycleUsed);
  }

  for (let grantIndex = startIndex; grantIndex <= currentGrantIndex; grantIndex += 1) {
    const cycleDescriptor = cycleDescriptors.find((item) => item.grantIndex === grantIndex);
    const currentGrant = schedule.grants[grantIndex];
    const cycleUsed = inputsByIndex.get(grantIndex) ?? 0;

    // 失効は各サイクル境界でのみ起きる前提なので、サイクル開始時点で残日数を整理する。
    expireBucketsAt(schedule.grants[grantIndex].grantDate, buckets, trackingRows, expiryRows);

    if (grantIndex === startIndex && startIndex > 0) {
      const priorGrant = schedule.grants[startIndex - 1];
      const requiredCarry = Math.max(0, cycleUsed - currentGrant.grantedDays);
      inferredCarryover = Math.min(priorGrant.grantedDays, requiredCarry);

      if (inferredCarryover > 0) {
        trackingRows[startIndex - 1].trackedDays += inferredCarryover;
        trackingRows[startIndex - 1].treatment = "最古サイクル開始時の推定繰越として一部反映";
        buckets.push({
          sourceGrantIndex: startIndex - 1,
          label: `${priorGrant.label}（推定繰越）`,
          remainingDays: inferredCarryover,
          expiryDate: priorGrant.expiryDate,
          inferred: true,
        });
      }
    }

    if (grantIndex === currentGrantIndex) {
      currentCycleCarryover = sumRemainingDays(buckets);
    }

    trackingRows[grantIndex].trackedDays += currentGrant.grantedDays;
    trackingRows[grantIndex].treatment = "今回の残数計算に反映";

    buckets.push({
      sourceGrantIndex: grantIndex,
      label: currentGrant.label,
      remainingDays: currentGrant.grantedDays,
      expiryDate: currentGrant.expiryDate,
      inferred: false,
    });

    const consumption = applyConsumption(cycleUsed, buckets, trackingRows);
    unresolvedShortage += consumption.shortageDays;

    consumptionRows.push({
      cycle: cycleDescriptor ? cycleDescriptor.title : `${formatDate(currentGrant.grantDate)} 開始サイクル`,
      period: cycleDescriptor?.periodLabel ?? formatDate(currentGrant.grantDate),
      inputDays: `${formatDays(cycleUsed)} 日`,
      appliedDays: `${formatDays(cycleUsed - consumption.shortageDays)} 日`,
      allocation: consumption.allocationText,
      note:
        consumption.shortageDays > 0
          ? `${formatDays(consumption.shortageDays)} 日分は、この簡易再現だけでは根拠を追い切れません。`
          : inferredCarryover > 0 && grantIndex === startIndex
            ? `不足を避けるため、さらに前の繰越を ${formatDays(inferredCarryover)} 日だけ推定しました。`
            : "古い付与から順に消化しました。",
    });
  }

  expireBucketsAt(parsed.baseDate, buckets, trackingRows, expiryRows);
  updateRemainingDays(trackingRows, buckets);

  if (inferredCarryover > 0) {
    warnings.push(
      `モードAでは最古サイクル以前の詳細履歴を入力しないため、${formatDays(inferredCarryover)} 日分だけ繰越を最小限推定しました。`,
    );
  }

  if (unresolvedShortage > 0) {
    warnings.push(
      `入力された消化日数のうち ${formatDays(unresolvedShortage)} 日分は、直近 3 サイクルだけでは説明しきれません。繰越日数が分かる場合はモードBの利用を検討してください。`,
    );
  }

  const statutoryBalance = sumRemainingDays(buckets);
  const totalStatutoryGranted = schedule.grants.reduce((sum, grant) => sum + grant.grantedDays, 0);
  const totalExpiredDays = expiryRows.reduce((sum, row) => sum + row.days, 0);
  const totalUsedDays = parsed.twoCyclesAgoUsed + parsed.previousCycleUsed + parsed.currentCycleUsed;

  return {
    modeLabel: "モードA: 年ごとの消化数入力",
    warnings,
    summary: buildSummary({
      totalStatutoryGranted,
      additionalGrantDays: parsed.additionalGrantDays,
      currentCycleCarryover,
      totalUsedDays,
      totalExpiredDays,
      currentBalance: statutoryBalance + parsed.additionalGrantDays,
      nextGrantDate: schedule.nextGrantDate,
    }),
    rationale: [
      `${getGrantRuleLabel(parsed.weeklyDays)}を使い、入社 6 か月後から毎年の法定付与を生成しました。`,
      "付与サイクルは各法定付与日から次回付与日の前日までとし、現在サイクルは付与日から基準日までを消化入力の対象にしました。",
      "モードAでは、現在サイクルとその直前 2 サイクルの消化入力を、古い付与から順に割り当てています。",
      "会社独自付与は履歴管理せず、基準日時点で有効な追加付与として残数にのみ加算しています。",
      "法定付与分は付与日から 2 年後に失効する前提で、基準日時点までに残っていた分のみ失効日数へ計上しました。",
    ],
    grantHistory: trackingRows.map((row) => toGrantHistoryRecord(row)),
    consumptionBreakdown: consumptionRows,
    expirationBreakdown: expiryRows.length > 0 ? expiryRows.map(toExpirationRecord) : [],
  };
}

function calculateCarryoverMode(context) {
  const { parsed, schedule, currentGrantIndex } = context;
  const trackingRows = createGrantTrackingRows(schedule.grants);
  const buckets = [];
  const consumptionRows = [];
  const warnings = [];

  let currentCycleCarryover = parsed.carryoverDays;

  if (parsed.carryoverDays > 0) {
    buckets.push({
      sourceGrantIndex: null,
      label: "前年度からの繰越入力",
      remainingDays: parsed.carryoverDays,
      expiryDate: schedule.nextGrantDate,
      inferred: false,
    });
  }

  if (currentGrantIndex >= 0) {
    const currentGrant = schedule.grants[currentGrantIndex];
    trackingRows[currentGrantIndex].trackedDays += currentGrant.grantedDays;
    trackingRows[currentGrantIndex].treatment = "現在サイクルの法定付与として反映";
    buckets.push({
      sourceGrantIndex: currentGrantIndex,
      label: currentGrant.label,
      remainingDays: currentGrant.grantedDays,
      expiryDate: currentGrant.expiryDate,
      inferred: false,
    });
  } else {
    currentCycleCarryover = 0;
  }

  const consumption = applyConsumption(parsed.currentCycleUsed, buckets, trackingRows);
  updateRemainingDays(trackingRows, buckets);

  consumptionRows.push({
    cycle: "現在の付与サイクル",
    period:
      currentGrantIndex >= 0
        ? `${formatDate(schedule.grants[currentGrantIndex].grantDate)} から基準日まで`
        : "初回付与前",
    inputDays: `${formatDays(parsed.currentCycleUsed)} 日`,
    appliedDays: `${formatDays(parsed.currentCycleUsed - consumption.shortageDays)} 日`,
    allocation: consumption.allocationText,
    note:
      parsed.carryoverDays > 0
        ? "繰越入力を先に消化し、残りを現在サイクルの法定付与へ割り当てました。"
        : "現在サイクルの法定付与から消化しました。",
  });

  if (consumption.shortageDays > 0) {
    warnings.push(
      `入力された当年度消化のうち ${formatDays(consumption.shortageDays)} 日分は、繰越入力と現在サイクル付与だけでは賄えません。`,
    );
  }

  warnings.push("モードBでは過去 2 サイクルの詳細消化と失効は再現せず、前年度繰越入力をそのまま有効日数として扱います。");

  const statutoryBalance = sumRemainingDays(buckets);
  const totalStatutoryGranted = schedule.grants.reduce((sum, grant) => sum + grant.grantedDays, 0);

  return {
    modeLabel: "モードB: 繰越日数入力",
    warnings,
    summary: buildSummary({
      totalStatutoryGranted,
      additionalGrantDays: parsed.additionalGrantDays,
      currentCycleCarryover,
      totalUsedDays: parsed.currentCycleUsed,
      totalExpiredDays: 0,
      currentBalance: statutoryBalance + parsed.additionalGrantDays,
      nextGrantDate: schedule.nextGrantDate,
    }),
    rationale: [
      `${getGrantRuleLabel(parsed.weeklyDays)}を使い、現在サイクルまでの法定付与日だけを履歴として生成しました。`,
      "モードBでは、前年度からの繰越日数入力を現在も有効な残日数として扱い、当年度消化はその繰越から先に差し引いています。",
      "過去 2 サイクルの詳細消化や失効は再現していないため、失効日数は今回再現分のみ 0 日表示になります。",
      "会社独自付与は履歴管理せず、基準日時点で有効な追加付与として残数にのみ加算しています。",
      "法定付与分の有効期限自体は 2 年ルールを前提にしていますが、モードBでは過去の失効再現を簡略化しています。",
    ],
    grantHistory: trackingRows.map((row, index) =>
      toGrantHistoryRecord(
        index === currentGrantIndex
          ? row
          : {
              ...row,
              treatment:
                index === currentGrantIndex - 1
                  ? "前年度分の詳細残数は再現せず、繰越入力側でまとめて扱います。"
                  : row.treatment,
            },
      ),
    ),
    consumptionBreakdown: consumptionRows,
    expirationBreakdown: [],
  };
}

function buildSummary({
  totalStatutoryGranted,
  additionalGrantDays,
  currentCycleCarryover,
  totalUsedDays,
  totalExpiredDays,
  currentBalance,
  nextGrantDate,
}) {
  return [
    {
      label: "総法定付与日数",
      value: `${formatDays(totalStatutoryGranted)} 日`,
      note: "入社日から基準日までに発生した法定付与の合計です。",
    },
    {
      label: "会社独自付与日数",
      value: `${formatDays(additionalGrantDays)} 日`,
      note: "履歴ではなく、基準日時点で有効な追加分として別加算しています。",
    },
    {
      label: "利用可能開始時点の繰越日数",
      value: `${formatDays(currentCycleCarryover)} 日`,
      note: "現在の付与サイクル開始時点で使えた繰越分です。",
    },
    {
      label: "総消化日数",
      value: `${formatDays(totalUsedDays)} 日`,
      note: "今回入力して反映した消化日数の合計です。",
    },
    {
      label: "失効済み日数",
      value: `${formatDays(totalExpiredDays)} 日`,
      note: "今回の計算で再現できた範囲の失効のみを集計しています。",
    },
    {
      label: "現在の残有給日数",
      value: `${formatDays(currentBalance)} 日`,
      note: "法定付与の残数に、会社独自付与を足した基準日時点の値です。",
    },
    {
      label: "次回付与予定日",
      value: formatDate(nextGrantDate),
      note: "基準日より後で最も近い法定付与予定日です。",
    },
  ];
}

function applyConsumption(requestedDays, buckets, trackingRows) {
  let remaining = requestedDays;
  const allocations = [];

  for (const bucket of buckets) {
    if (remaining <= 0) {
      break;
    }
    if (bucket.remainingDays <= 0) {
      continue;
    }

    const appliedDays = Math.min(bucket.remainingDays, remaining);
    bucket.remainingDays -= appliedDays;
    remaining -= appliedDays;
    allocations.push(`${bucket.label} から ${formatDays(appliedDays)} 日`);

    if (bucket.sourceGrantIndex !== null) {
      trackingRows[bucket.sourceGrantIndex].usedDays += appliedDays;
    }
  }

  return {
    shortageDays: remaining,
    allocationText: allocations.length > 0 ? allocations.join(" / ") : "消化反映なし",
  };
}

function expireBucketsAt(boundaryDate, buckets, trackingRows, expiryRows) {
  for (const bucket of buckets) {
    if (bucket.remainingDays <= 0 || !bucket.expiryDate) {
      continue;
    }
    if (compareDates(bucket.expiryDate, boundaryDate) > 0) {
      continue;
    }

    expiryRows.push({
      source: bucket.label,
      grantDate: bucket.sourceGrantIndex !== null ? boundaryDate : null,
      expiryDate: bucket.expiryDate,
      days: bucket.remainingDays,
      note: bucket.inferred ? "推定繰越として反映した残日数が失効しました。" : "法定付与の未消化分が失効しました。",
    });

    if (bucket.sourceGrantIndex !== null) {
      trackingRows[bucket.sourceGrantIndex].expiredDays += bucket.remainingDays;
    }

    bucket.remainingDays = 0;
  }
}

function updateRemainingDays(trackingRows, buckets) {
  for (const row of trackingRows) {
    row.remainingDays = 0;
  }

  for (const bucket of buckets) {
    if (bucket.sourceGrantIndex === null) {
      continue;
    }
    trackingRows[bucket.sourceGrantIndex].remainingDays += bucket.remainingDays;
  }
}

function sumRemainingDays(buckets) {
  return buckets.reduce((sum, bucket) => sum + bucket.remainingDays, 0);
}

function toGrantHistoryRecord(row) {
  return {
    grantDate: formatDate(row.grant.grantDate),
    grantedDays: `${formatDays(row.grant.grantedDays)} 日`,
    expiryDate: formatDate(row.grant.expiryDate),
    trackedDays: row.trackedDays > 0 ? `${formatDays(row.trackedDays)} 日` : "—",
    usedDays: row.trackedDays > 0 ? `${formatDays(row.usedDays)} 日` : "—",
    expiredDays: row.trackedDays > 0 ? `${formatDays(row.expiredDays)} 日` : "—",
    remainingDays: row.trackedDays > 0 ? `${formatDays(row.remainingDays)} 日` : "—",
    treatment: row.treatment,
  };
}

function toExpirationRecord(row) {
  return {
    source: row.source,
    expiryDate: formatDate(row.expiryDate),
    expiredDays: `${formatDays(row.days)} 日`,
    note: row.note,
  };
}
