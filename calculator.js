(() => {
  "use strict";

  const DAY_MS = 86_400_000;
  const DAILY_RATE = 25_000;
  const ROOM_LIMITS = { seoul: 100_000, metro: 80_000, other: 70_000 };

  function dateNumber(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return NaN;
    const date = new Date(value + "T00:00:00Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
      ? date.getTime() / DAY_MS
      : NaN;
  }

  function integer(value, minimum, maximum, message) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new Error(message);
    }
    return value;
  }

  function money(value) {
    return integer(value, 0, Number.MAX_SAFE_INTEGER, "금액은 0 이상의 원 단위 정수로 입력하세요.");
  }

  function checkedDay(value, first, last) {
    const day = dateNumber(value);
    if (!Number.isFinite(day) || day < first || day > last) {
      throw new Error("상세 적용일과 체재지 도착일은 출장 기간 안에서 선택하세요.");
    }
    return day;
  }

  function distinctDays(rows, first, last) {
    const days = new Map();
    for (const row of rows) {
      const day = checkedDay(row.date, first, last);
      if (days.has(day)) throw new Error("같은 날짜의 조건은 한 줄에 입력하세요.");
      days.set(day, row);
    }
    return days;
  }

  function row(label, amount, detail = "") {
    return { label, amount: money(amount), detail };
  }

  function calculateLocal(trip, first, last) {
    const days = distinctDays(trip.localDays, first, last);
    if (!days.size) throw new Error("실제로 출장한 날짜와 시간을 입력하세요.");
    return [...days.values()].sort((a, b) => a.date.localeCompare(b.date)).map(item => {
      const hours = integer(item.hours, 0, 24, "출장 시간은 0~24시간으로 입력하세요.");
      const mins = integer(item.minutes, 0, 59, "출장 분은 0~59분으로 입력하세요.");
      const minutes = integer(hours * 60 + mins, 1, 1440, "출장 시간은 1분 이상 24시간 이하로 입력하세요.");
      const base = minutes >= 240 ? 20_000 : 10_000;
      const amount = item.vehicle === "assigned" ? 0 : base - (item.vehicle === "public" ? 10_000 : 0);
      const vehicleDetail = { assigned: " · 전용 차량 배정", public: " · 1만 원 감액" }[item.vehicle] || "";
      return row(item.date + " 출장여비", amount, hours + "시간 " + mins + "분" + vehicleDetail);
    });
  }

  function allowances(trip, first, last) {
    if (trip.explicitAllowances) {
      const { daily, meals } = trip.explicitAllowances;
      return [row("일비", daily, "입력한 지급액"), row("식비", meals, "입력한 지급액")];
    }

    const conditions = distinctDays(trip.dailyConditions, first, last);
    const arrival = trip.longStay ? checkedDay(trip.arrival, first, last) : Infinity;
    const days = last - first + 1;
    const reducedDays = Math.max(0, last - arrival - 15)
      + Math.max(0, last - arrival - 30)
      + Math.max(0, last - arrival - 60);
    let halfDays = trip.halfAll ? days : 0;
    let excludedMeals = trip.noMealsAll ? days : 0;
    let overlapping = trip.halfAll && reducedDays > 0;

    for (const [day, condition] of conditions) {
      if (!condition.half && !condition.noMeals) {
        throw new Error("적용일마다 일비 50% 또는 식비 제외 중 하나 이상을 선택하세요.");
      }
      if (condition.half && !trip.halfAll) halfDays++;
      if (condition.noMeals && !trip.noMealsAll) excludedMeals++;
      overlapping ||= condition.half && day > arrival + 15;
    }
    if (overlapping) {
      throw new Error("같은 날에 장기 체재 감액과 일비 50% 조건이 겹칩니다. 기관에서 확인한 금액을 ‘일비·식비 산정액 직접 입력’에 입력하세요.");
    }

    const daily = days * DAILY_RATE - halfDays * (DAILY_RATE / 2) - reducedDays * (DAILY_RATE / 10);
    const dailyDetail = days + "일" + (halfDays ? " · 50% 지급 " + halfDays + "일" : "")
      + (reducedDays ? " · 장기 체재 감액 적용" : "");
    return [
      row("일비", daily, dailyDetail),
      row("식비", (days - excludedMeals) * DAILY_RATE, "지급 " + (days - excludedMeals) + "일"),
    ];
  }

  function calculateAway(trip, first, last) {
    const entries = allowances(trip, first, last);
    let savings = 0;
    let fares = 0;
    for (const fare of trip.fares) {
      if (fare.type !== "public") fares += money(fare.amount);
      if (fare.type === "air") savings += money(fare.savings);
    }
    entries.push(row("운임", fares, trip.fares.length ? trip.fares.length + "건" : ""));

    const maxNights = last - first;
    let nights = 0;
    let rooms = 0;
    let supplement = 0;
    for (const stay of trip.stays) {
      nights += integer(stay.nights, 1, maxNights, "출장 기간에 포함되는 숙박 박수를 입력하세요.");
      if (nights > maxNights) throw new Error("숙박 박수 합계가 출장 기간의 최대 숙박 박수를 넘습니다.");
      const paid = money(stay.amount);
      if (stay.eligibility === "ineligible") continue;
      const cap = trip.grade === "2" ? ROOM_LIMITS[stay.region] : Infinity;
      rooms += Math.min(paid, cap) * stay.nights;
      if (stay.extra && Number.isFinite(cap)) {
        supplement += Math.min(Math.max(0, paid - cap), cap * 0.3) * stay.nights;
      }
    }
    entries.push(row("숙박비", rooms, nights ? "입력한 숙박 " + nights + "박" : ""));
    if (supplement) entries.push(row("숙박비 추가 지급", supplement, "상한액 초과분 중 최대 30%"));

    const confirmedExtra = money(trip.mileageExtra);
    if (savings && confirmedExtra) {
      entries.push(row("공적 항공마일리지 추가 일비",
        Math.min(confirmedExtra, savings, Math.floor(entries[0].amount / 2)), "확인액 및 지급 상한 적용"));
    }
    return entries;
  }

  function calculate(trip) {
    const first = dateNumber(trip.start);
    const last = dateNumber(trip.end);
    if (!Number.isFinite(first) || !Number.isFinite(last)) throw new Error("출장일과 복귀일을 입력하세요.");
    if (first > last) throw new Error("복귀일은 출장일과 같거나 그 이후여야 합니다.");
    const entries = trip.scope === "local" ? calculateLocal(trip, first, last) : calculateAway(trip, first, last);
    return {
      entries,
      days: last - first + 1,
      total: money(entries.reduce((total, entry) => total + entry.amount, 0)),
    };
  }

  globalThis.TravelCalculator = { calculate };
})();
