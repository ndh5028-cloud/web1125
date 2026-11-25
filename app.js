(() => {
  "use strict";

  const byId = id => document.getElementById(id);
  const form = byId("trip-form");
  const formatWon = amount => new Intl.NumberFormat("ko-KR").format(amount) + "원";
  const start = byId("start");
  const end = byId("end");
  const error = byId("form-error");
  const printButton = byId("print-result");
  const excelButton = byId("download-excel");
  const exportError = byId("export-error");
  const containers = Object.fromEntries(["fare", "stay", "daily", "local"].map(kind => [kind, byId(kind + "-rows")]));
  const groupLabel = { fare: "운임", stay: "숙박", daily: "날짜별 조건", local: "근무지 내 출장일" };
  let exportData = null;

  const templates = {
    fare: `
      <label>교통수단<select name="type">
        <option value="rail">철도</option><option value="ship">선박</option>
        <option value="air">항공</option><option value="bus">버스</option>
        <option value="car">자가용</option><option value="public">공용 차량·선박·항공기 등</option>
        <option value="other">기타 인정 운임</option>
      </select></label>
      <label data-car hidden>자가용 지급 기준<select name="carRule">
        <option value="equivalent">철도·버스 상당액</option>
        <option value="necessary">업무상 부득이한 이용으로 인정된 연료비·통행료 등</option>
      </select></label>
      <label data-amount><span data-amount-label>지급 대상 운임 (원)</span><input name="amount" type="number" min="0" step="1" placeholder="0" required></label>
      <label data-air hidden>공적 항공마일리지로 절약한 운임 (원)<input name="savings" type="number" min="0" step="1" placeholder="0"></label>`,
    stay: `
      <div class="two-fields">
        <label data-region>숙박 지역<select name="region">
          <option value="seoul">서울특별시</option><option value="metro">광역시</option><option value="other">그 밖의 지역</option>
        </select></label>
        <label>숙박 박수<input name="nights" type="number" min="1" step="1" value="1" required></label>
      </div>
      <label>숙박 상황<select name="eligibility">
        <option value="regular">일반 숙박</option>
        <option value="ineligible">항공·선박 여행 중 숙박</option>
        <option value="necessary">항공·선박 여행 중 부득이한 육지 숙박</option>
      </select></label>
      <label data-amount>1박당 결제액 (원)<input name="amount" type="number" min="0" step="1" placeholder="0" required></label>
      <label data-extra class="check"><input name="extra" type="checkbox">부득이한 상한 초과 지출로 추가 지급 요건을 충족함</label>`,
    daily: `
      <label>적용일<input name="date" type="date" required></label>
      <label class="check"><input name="half" type="checkbox">일비 50% 지급 조건에 해당함</label>
      <label class="check"><input name="noMeals" type="checkbox">항공·선박 여행 중 별도 식비가 필요하지 않음</label>`,
    local: `
      <label>출장일<input name="date" type="date" required></label>
      <div class="two-fields">
        <label>시간<input name="hours" type="number" min="0" max="24" step="1" value="0" required></label>
        <label>분<input name="minutes" type="number" min="0" max="59" step="1" value="0" required></label>
      </div>
      <label>차량 조건<select name="vehicle">
        <option value="none">해당 없음</option>
        <option value="public">공무용 차량 이용 등 1만 원 감액 대상</option>
        <option value="assigned">전용 차량 배정자</option>
      </select></label>`,
  };

  const fields = (row, name) => row.querySelector('[name="' + name + '"]');
  const rows = kind => [...containers[kind].children];
  const number = input => input.value === "" ? 0 : input.valueAsNumber;
  const scope = () => form.elements.scope.value;

  function show(element, visible) {
    element.hidden = !visible;
    for (const input of element.querySelectorAll("input, select, button")) input.disabled = !visible;
  }

  function addRow(kind, focus = true) {
    const container = containers[kind];
    const row = document.createElement("fieldset");
    row.className = "item";
    row.innerHTML = '<legend>' + groupLabel[kind] + '</legend>'
      + '<button class="remove" type="button" aria-label="' + groupLabel[kind] + ' 삭제">삭제</button>'
      + templates[kind];
    container.append(row);
    const date = fields(row, "date");
    if (date) {
      const occupied = rows(kind).map(item => fields(item, "date").value);
      if (start.value && !occupied.includes(start.value)) date.value = start.value;
    }
    sync();
    if (focus) row.querySelector("input:not(:disabled), select:not(:disabled)")?.focus();
  }

  function syncFare(fare) {
    const type = fields(fare, "type").value;
    show(fare.querySelector("[data-car]"), type === "car");
    show(fare.querySelector("[data-air]"), type === "air");
    show(fare.querySelector("[data-amount]"), type !== "public");
    const carRule = fields(fare, "carRule").value;
    const carLabel = carRule === "necessary" ? "지급 대상 연료비·통행료 등 (원)" : "철도·버스 상당액 (원)";
    fare.querySelector("[data-amount-label]").textContent = type === "car" ? carLabel : "지급 대상 운임 (원)";
  }

  function syncStay(stay, grade) {
    const eligible = fields(stay, "eligibility").value !== "ineligible";
    show(stay.querySelector("[data-region]"), grade === "2" && eligible);
    show(stay.querySelector("[data-extra]"), grade === "2" && eligible);
    show(stay.querySelector("[data-amount]"), eligible);
  }

  function sync() {
    const local = scope() === "local";
    byId("away-fields").hidden = byId("away-fields").disabled = local;
    byId("local-fields").hidden = byId("local-fields").disabled = !local;
    const grade = byId("grade").value;
    const actual = grade === "actual";
    show(byId("actual-fields"), actual);
    show(byId("standard-fields"), !actual);
    show(byId("long-fields"), !actual && byId("long-stay").checked && !byId("manual-allowances").checked);
    show(byId("manual-fields"), !actual && byId("manual-allowances").checked);
    for (const input of byId("daily-rows").querySelectorAll("input")) {
      input.disabled = actual || byId("manual-allowances").checked;
    }

    end.min = start.value;
    const dates = form.querySelectorAll("#arrival, .item input[type=date]");
    for (const date of dates) {
      date.min = start.value;
      date.max = end.value;
    }
    if (!byId("arrival").value && byId("long-stay").checked) byId("arrival").value = start.value;
    if (rows("local").length === 1 && !fields(rows("local")[0], "date").value) {
      fields(rows("local")[0], "date").value = start.value;
    }
    const fares = rows("fare");
    for (const fare of fares) syncFare(fare);
    for (const stay of rows("stay")) syncStay(stay, grade);
    show(byId("mileage-fields"), fares.some(fare => fields(fare, "type").value === "air"
      && number(fields(fare, "savings")) > 0));
    byId("fare-hint").textContent = grade === "2"
      ? "철도 일반실·선박 2등급 기준입니다. 할인 적용 후 지급 대상 운임을 입력하세요."
      : "철도 특실·선박 1등급 기준입니다. 할인 적용 후 지급 대상 운임을 입력하세요.";
  }

  function readTrip() {
    const trip = { start: start.value, end: end.value, scope: scope() };
    if (trip.scope === "local") {
      trip.localDays = rows("local").map(row => ({
        date: fields(row, "date").value,
        hours: number(fields(row, "hours")),
        minutes: number(fields(row, "minutes")),
        vehicle: fields(row, "vehicle").value,
      }));
      return trip;
    }
    trip.grade = byId("grade").value;
    const allowanceSource = trip.grade === "actual" ? "actual" : byId("manual-allowances").checked ? "manual" : "";
    trip.explicitAllowances = allowanceSource ? {
      daily: number(byId(allowanceSource + "-daily")),
      meals: number(byId(allowanceSource + "-meals")),
    } : null;
    trip.longStay = byId("long-stay").checked;
    trip.arrival = byId("arrival").value;
    trip.halfAll = byId("half-all").checked;
    trip.noMealsAll = byId("no-meals-all").checked;
    trip.dailyConditions = rows("daily").map(row => ({
      date: fields(row, "date").value,
      half: fields(row, "half").checked,
      noMeals: fields(row, "noMeals").checked,
    }));
    trip.fares = rows("fare").map(row => ({
      type: fields(row, "type").value,
      amount: number(fields(row, "amount")),
      savings: number(fields(row, "savings")),
    }));
    trip.stays = rows("stay").map(row => ({
      region: fields(row, "region").value,
      nights: number(fields(row, "nights")),
      amount: number(fields(row, "amount")),
      eligibility: fields(row, "eligibility").value,
      extra: fields(row, "extra").checked,
    }));
    trip.mileageExtra = number(byId("mileage-extra"));
    return trip;
  }

  function clearResult(message) {
    byId("total").textContent = "—";
    byId("result-period").textContent = message;
    byId("print-trip-type").textContent = "";
    byId("breakdown").replaceChildren();
    byId("result-note").hidden = true;
    printButton.disabled = true;
    excelButton.disabled = true;
    exportError.hidden = true;
    exportData = null;
  }

  function invalidate() {
    error.hidden = true;
    if (exportData) {
      clearResult("입력이 변경되었습니다. 다시 계산하세요.");
    }
  }

  function render(trip, result) {
    byId("total").textContent = formatWon(result.total);
    const local = trip.scope === "local";
    const days = local ? result.entries.length : result.days;
    const tripType = local ? "근무지 내 출장" : "근무지 외 출장";
    byId("result-period").textContent = trip.start + " ~ " + trip.end + " · " + (local ? "출장 입력 " : "") + days + "일";
    byId("print-trip-type").textContent = tripType;
    const elements = result.entries.map(entry => {
      const line = document.createElement("div");
      const term = document.createElement("dt");
      term.textContent = entry.label;
      if (entry.detail) {
        const detail = document.createElement("small");
        detail.textContent = entry.detail;
        term.append(detail);
      }
      const value = document.createElement("dd");
      value.textContent = formatWon(entry.amount);
      line.append(term, value);
      return line;
    });
    byId("breakdown").replaceChildren(...elements);
    const mileagePending = trip.fares?.some(fare => fare.type === "air" && fare.savings > 0) && !trip.mileageExtra;
    const note = byId("result-note");
    note.hidden = !mileagePending;
    note.textContent = mileagePending ? "확인된 공적 항공마일리지 추가 일비를 입력하면 합계에 반영합니다." : "";
    exportData = {
      ...result, start: trip.start, end: trip.end, days, tripType,
      daysLabel: local ? "입력한 출장일수" : "여행일수",
      note: note.textContent,
    };
    printButton.disabled = false;
    excelButton.disabled = false;
    exportError.hidden = true;
    byId("result").focus();
  }

  printButton.addEventListener("click", () => window.print());
  const referenceDialog = byId("references");
  for (const trigger of document.querySelectorAll("[data-open-references]")) {
    trigger.addEventListener("click", () => {
      referenceDialog.showModal();
      referenceDialog.scrollTop = 0;
    });
  }
  excelButton.addEventListener("click", async () => {
    const snapshot = exportData;
    if (!snapshot) return;
    excelButton.disabled = true;
    exportError.hidden = true;
    try {
      const blob = await globalThis.TravelExcel.createBlob(snapshot);
      if (exportData !== snapshot) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "출장여비_" + snapshot.start + "_" + snapshot.end + ".xlsx";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      if (exportData === snapshot) {
        exportError.textContent = "엑셀 파일을 만들지 못했습니다. 다시 다운로드해 주세요.";
        exportError.hidden = false;
      }
    } finally {
      if (exportData === snapshot) excelButton.disabled = false;
    }
  });
  form.addEventListener("input", () => {
    sync();
    invalidate();
  });
  form.addEventListener("invalid", event => {
    const details = event.target.closest("details");
    if (details) details.open = true;
  }, true);
  form.addEventListener("click", event => {
    const add = event.target.closest("[data-add]");
    const remove = event.target.closest(".remove");
    if (add) {
      addRow(add.dataset.add);
      invalidate();
    }
    if (remove) {
      const item = remove.closest(".item");
      const kind = item.parentElement.id.replace("-rows", "");
      item.remove();
      sync();
      invalidate();
      form.querySelector('[data-add="' + kind + '"]').focus();
    }
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    try {
      const trip = readTrip();
      render(trip, globalThis.TravelCalculator.calculate(trip));
      error.hidden = true;
    } catch (problem) {
      error.textContent = problem.message;
      error.hidden = false;
    }
  });
  form.addEventListener("reset", () => {
    queueMicrotask(() => {
      for (const container of Object.values(containers)) container.replaceChildren();
      for (const details of form.querySelectorAll("details")) details.open = false;
      addRow("local", false);
      clearResult("출장 정보를 입력하고 계산하세요.");
      error.hidden = true;
      start.focus();
    });
  });
  addRow("local", false);
})();
