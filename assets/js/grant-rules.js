export const FULL_TIME_GRANTS = [10, 11, 12, 14, 16, 18, 20];

// 労基法の一般的な比例付与表を、週の所定労働日数ベースで簡略化して採用する。
// 1回目は入社6か月後、それ以降は1年ごとに同順で付与日数を適用する。
export const PROPORTIONAL_GRANTS_BY_WEEKLY_DAYS = {
  4: [7, 8, 9, 10, 12, 13, 15],
  3: [5, 6, 6, 8, 9, 10, 11],
  2: [3, 4, 4, 5, 6, 6, 7],
  1: [1, 2, 2, 2, 3, 3, 3],
};

export function getGrantDaysForWeeklyDays(weeklyDays, grantIndex) {
  const grantTable =
    weeklyDays >= 5
      ? FULL_TIME_GRANTS
      : PROPORTIONAL_GRANTS_BY_WEEKLY_DAYS[weeklyDays] ?? FULL_TIME_GRANTS;

  return grantTable[Math.min(grantIndex, grantTable.length - 1)];
}

export function getGrantRuleLabel(weeklyDays) {
  if (weeklyDays >= 5) {
    return "週5日以上向けの一般的な法定付与表";
  }

  return `週${weeklyDays}日勤務向けの一般的な比例付与表`;
}
