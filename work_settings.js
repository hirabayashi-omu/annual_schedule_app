/**
 * 勤務設定管理プログラム
 */

const WORK_SHIFTS = {
    'A': { start: '08:00', end: '16:30', name: 'A勤務' },
    'B': { start: '08:45', end: '17:15', name: 'B勤務' },
    'C': { start: '09:30', end: '18:00', name: 'C勤務' },
    'D': { start: '10:30', end: '19:00', name: 'D勤務' },
    'E': { start: '11:30', end: '20:00', name: 'E勤務' },
    'Other': { name: 'その他' }
};

const WORK_PERIODS = [
    { id: 'spring_vac', name: '春季休業期間（4月1日～）', icon: '🌸', color: '#db2777', bgColor: '#fdf2f8' },
    { id: 'first_semester', name: '前期平日（4月～9月）', icon: '🌱', color: '#000000', bgColor: '#ffffff' },
    { id: 'summer_vac', name: '夏季休業期間', icon: '☀️', color: '#ea580c', bgColor: '#fff7ed' },
    { id: 'second_semester', name: '後期平日（10月～3月）', icon: '🍂', color: '#000000', bgColor: '#ffffff' },
    { id: 'winter_vac', name: '冬季休業期間', icon: '❄️', color: '#2563eb', bgColor: '#eff6ff' },
    { id: 'end_year_vac', name: '学年末休業期間（～3月31日）', icon: '🌸', color: '#7c3aed', bgColor: '#f5f3ff' }
];

const WEEKDAYS_SHORT = ['月', '火', '水', '木', '金'];

let workSettings = {}; // { 2026: { spring_vac: { 1: { shift: 'B' } } } }

let workOverrides = {}; // { '2026-04-01': { shift: 'B' }, ... }


/**
 * 現在選択されている年度（会計年度）を取得するヘルパー
 */
function getCurrentFiscalYear() {
    const yearSelect = document.getElementById('globalYearSelect');
    if (yearSelect && yearSelect.value) {
        return parseInt(yearSelect.value);
    }
    // app.jsの変数が定義されている場合はそこから計算
    if (typeof currentYear !== 'undefined' && typeof currentMonth !== 'undefined') {
        return (currentMonth <= 3) ? currentYear - 1 : currentYear;
    }
    const now = new Date();
    const m = now.getMonth() + 1;
    const y = now.getFullYear();
    return (m <= 3) ? y - 1 : y;
}

/**
 * 勤務設定の初期化
 */
function initWorkSettings() {
    const saved = localStorage.getItem('workSettings');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            // 互換性チェック：トップレベルが period_id の場合は古い形式（2025年度以前とみなす）
            if (parsed.spring_vac || parsed.first_semester) {
                const legacyYear = 2025; // 便宜上
                workSettings = {};
                workSettings[legacyYear] = parsed;
            } else {
                workSettings = parsed;
            }
        } catch (e) {
            console.error('Failed to load workSettings:', e);
        }
    }

    const savedOverrides = localStorage.getItem('workOverrides');
    if (savedOverrides) {
        try {
            workOverrides = JSON.parse(savedOverrides);
        } catch (e) {
            console.error('Failed to load workOverrides:', e);
        }
    }

    // 現在選択されている年度の初期設定を確認
    const targetYear = getCurrentFiscalYear();
    ensureWorkSettingsYear(targetYear);

    renderWorkPeriodConfig();
    if (typeof updateCalendar === 'function') updateCalendar();
}

/**
 * 特定の年度の勤務設定が存在することを保証する
 */
function ensureWorkSettingsYear(year) {
    if (!workSettings) workSettings = {};
    if (!workSettings[year]) {
        workSettings[year] = {};
        WORK_PERIODS.forEach(period => {
            workSettings[year][period.id] = {};
            let defaultShift = period.id.includes('vac') ? 'C' : 'B';
            WEEKDAYS_SHORT.forEach((day, idx) => {
                workSettings[year][period.id][idx + 1] = { shift: defaultShift };
            });
        });
    }
}

/**
 * 現在の年度の勤務設定を取得
 */
function getCurrentWorkSettings() {
    const targetYear = getCurrentFiscalYear();
    ensureWorkSettingsYear(targetYear);
    return workSettings[targetYear];
}

/**
 * カレンダーデータから休業期間を抽出
 */
function getVacationPeriods() {
    const periods = {
        spring_vac: { start: null, end: null },
        summer_vac: { start: null, end: null },
        winter_vac: { start: null, end: null },
        end_year_vac: { start: null, end: null }
    };

    if (typeof scheduleData === 'undefined' || !scheduleData.length) return periods;

    const currentTargetYear = getCurrentFiscalYear();

    scheduleData.forEach(item => {
        const name = item.event || "";
        const date = item.date;
        const fy = typeof getFiscalYear === 'function' ? getFiscalYear(date) : date.getFullYear();

        if (fy !== currentTargetYear) return;

        if (name.includes('夏季休業') || name.includes('夏休み') || name.includes('学校閉鎖')) {
            if (!periods.summer_vac.start || date < periods.summer_vac.start) periods.summer_vac.start = new Date(date);
            if (!periods.summer_vac.end || date > periods.summer_vac.end) periods.summer_vac.end = new Date(date);
        } else if (name.includes('冬季休業') || name.includes('冬休み') || name.includes('学校閉鎖')) {
            if (!periods.winter_vac.start || date < periods.winter_vac.start) periods.winter_vac.start = new Date(date);
            if (!periods.winter_vac.end || date > periods.winter_vac.end) periods.winter_vac.end = new Date(date);
        } else if (name.includes('春季休業')) {
            // 4/1以降の春季休業を特定
            if (date.getMonth() === 3) { // 4月
                if (!periods.spring_vac.start) periods.spring_vac.start = new Date(currentTargetYear, 3, 1);
                if (!periods.spring_vac.end || date > periods.spring_vac.end) periods.spring_vac.end = new Date(date);
            }
        } else if (name.includes('学年末休業') || name.includes('春休み')) {
            if (!periods.end_year_vac.start || date < periods.end_year_vac.start) {
                periods.end_year_vac.start = new Date(date);
            }
            // 学年末休業は年度末（3/31）までとする
            periods.end_year_vac.end = typeof getFiscalYearEnd === 'function' ? getFiscalYearEnd(currentTargetYear) : new Date(currentTargetYear + 1, 2, 31);
        }
    });

    return periods;
}
/**
 * 特定の学期・曜日の授業時限を取得
 */
function getOccupiedPeriods(periodId, dayNum) {
    if (typeof myClasses === 'undefined' || !myClasses) return [];

    let targetSemester = '';
    if (periodId === 'first_semester') targetSemester = 'first';
    if (periodId === 'second_semester') targetSemester = 'second';

    if (!targetSemester) return [];

    const occupied = new Set();
    myClasses.forEach(cls => {
        const applies = (cls.semesterType === 'full') || (cls.semesterType === targetSemester);
        if (!applies) return;

        [cls.firstSemester, cls.secondSemester].forEach(s => {
            if (s && String(s.weekday) === String(dayNum)) {
                const p = s.period;
                if (typeof p === 'string' && p.includes('-')) {
                    const parts = p.split('-');
                    const start = parseInt(parts[0]);
                    const end = parseInt(parts[1]);
                    if (!isNaN(start) && !isNaN(end)) {
                        for (let i = start; i <= end; i++) occupied.add(String(i));
                    }
                } else {
                    occupied.add(String(p));
                }
            }
        });
    });

    return Array.from(occupied).sort((a, b) => {
        const order = { '1': 1, '2': 2, '3': 3, '4': 4, 'HR': 5, 'after': 6 };
        return (order[a] || 99) - (order[b] || 99);
    });
}

/**
 * 授業時間を考慮した推奨勤務パターンを提案
 */
function recommendShift(periods, periodId) {
    // 授業がない日の推奨は一律で C勤務(9:30~)
    if (!periods || periods.length === 0) {
        return 'C';
    }

    const periodStarts = { '1': 540, '2': 645, '3': 785, '4': 890, 'HR': 890, 'after': 990 };
    const periodEnds = { '1': 635, '2': 740, '3': 880, '4': 985, 'HR': 935, 'after': 1080 };

    let minStart = Infinity;
    let maxEnd = -Infinity;

    periods.forEach(p => {
        if (periodStarts[p] !== undefined) minStart = Math.min(minStart, periodStarts[p]);
        if (periodEnds[p] !== undefined) maxEnd = Math.max(maxEnd, periodEnds[p]);
    });

    // 授業の15分前には勤務開始したい（ユーザー確認済み）
    const neededStart = minStart - 15;
    const neededEnd = maxEnd;

    // 定義済みの勤務シフト（遅い順にチェックして、条件を満たす最も遅いシフトを提案する）
    const shifts = [
        { id: 'E', start: 690, end: 1200 }, // 11:30 - 20:00
        { id: 'D', start: 630, end: 1140 }, // 10:30 - 19:00
        { id: 'C', start: 570, end: 1080 }, // 09:30 - 18:00
        { id: 'B', start: 525, end: 1035 }, // 08:45 - 17:15
        { id: 'A', start: 480, end: 990 }   // 08:00 - 16:30
    ];

    // まず、開始と終了の両方を完全にカバーできる最も遅いシフトを探す
    const bestFit = shifts.find(s => s.start <= neededStart && s.end >= neededEnd);
    if (bestFit) return bestFit.id;

    // 終了時間がはみ出す場合でも、開始時間を最優先でカバーできるシフトを探す
    const startFit = shifts.find(s => s.start <= neededStart);
    if (startFit) return startFit.id;

    return 'Other';
}

/**
 * 勤務設定画面のレンダリング
 */
function renderWorkPeriodConfig() {
    const container = document.getElementById('workPeriodConfigContainer');
    if (!container) return;

    container.innerHTML = '';
    const vacationDates = getVacationPeriods();
    const currentSettings = getCurrentWorkSettings();

    // タイトルの更新
    const globalYearSelect = document.getElementById('globalYearSelect');
    const fiscalYear = globalYearSelect ? globalYearSelect.value : (new Date().getFullYear());
    const workTitle = document.getElementById('workSettingTitle');
    if (workTitle) workTitle.textContent = `勤務パターンの設定（${fiscalYear}年度）`;

    WORK_PERIODS.forEach(period => {
        const periodCard = document.createElement('div');
        periodCard.className = 'work-period-card';
        periodCard.style.cssText = `
            background: white;
            border-radius: 12px;
            border: 1px solid var(--neutral-200);
            padding: 20px;
            box-shadow: var(--shadow-sm);
        `;

        // 期間の補足テキスト
        let dateInfo = '';
        if (vacationDates[period.id]) {
            const p = vacationDates[period.id];
            if (p.start && p.end) {
                const startStr = `${p.start.getMonth() + 1}/${p.start.getDate()}`;
                const endStr = `${p.end.getMonth() + 1}/${p.end.getDate()}`;
                dateInfo = `<span style="font-size: 0.85rem; background: ${period.color}22; color: ${period.color}; padding: 2px 8px; border-radius: 12px; margin-left: 10px; font-weight: 500;">実日程: ${startStr} ～ ${endStr}</span>`;
            }
        }

        let html = `
            <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid ${period.color}44; padding-bottom: 10px; margin-bottom: 20px;">
                <h3 style="color: ${period.color}; margin: 0; display: flex; align-items: center; gap: 8px; font-weight: 700;">
                    <span style="font-size: 1.2rem;">${period.icon}</span> ${period.name}
                    ${dateInfo}
                </h3>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px;">
        `;

        WEEKDAYS_SHORT.forEach((dayName, idx) => {
            const dayNum = idx + 1; // 1=月, 5=金
            const current = currentSettings[period.id][dayNum] || { shift: 'B' };

            // 授業情報の取得と推奨の計算
            const occupiedPeriods = getOccupiedPeriods(period.id, dayNum);
            const recommendation = recommendShift(occupiedPeriods, period.id);
            const periodLabels = occupiedPeriods.map(p => {
                const labels = { '1': '1限', '2': '2限', '3': '3限', '4': '4限', 'HR': 'HR', 'after': '放' };
                return labels[p] || p;
            });

            html += `
                <div style="background: ${period.bgColor}; padding: 12px; border-radius: 8px; border: 1px solid ${period.color}22; display: flex; flex-direction: column; justify-content: space-between;">
                    <div>
                        <div style="font-weight: 700; margin-bottom: 8px; color: ${period.color}; text-align: center; font-size: 0.9rem;">${dayName}曜日</div>
                        <select class="form-select work-shift-select" 
                                style="width: 100%; padding: 6px; font-size: 0.9rem; border-color: ${period.color}44;"
                                onchange="updateWorkSettingInMemory('${period.id}', ${dayNum}, this.value)">
                            ${Object.keys(WORK_SHIFTS).map(s => `
                                <option value="${s}" ${current.shift === s ? 'selected' : ''}>${WORK_SHIFTS[s].name}</option>
                            `).join('')}
                        </select>
                        
                        <div id="custom-time-${period.id}-${dayNum}" style="margin-top: 8px; display: ${current.shift === 'Other' ? 'block' : 'none'};">
                            <div style="display: flex; flex-direction: column; gap: 5px;">
                                <input type="time" class="form-input" style="padding: 2px 5px; font-size: 0.8rem;" 
                                       value="${current.start || '08:30'}"
                                       onchange="updateWorkTimeInMemory('${period.id}', ${dayNum}, 'start', this.value)">
                                <div style="text-align: center; font-size: 0.7rem; color: var(--neutral-400);">～</div>
                                <input type="time" class="form-input" style="padding: 2px 5px; font-size: 0.8rem;" 
                                       value="${current.end || '17:00'}"
                                       onchange="updateWorkTimeInMemory('${period.id}', ${dayNum}, 'end', this.value)">
                            </div>
                        </div>
                    </div>

                    <div style="margin-top: 10px; padding-top: 8px; border-top: 1px dashed ${period.color}33; font-size: 0.75rem; color: var(--neutral-600);">
                        <div style="display: flex; justify-content: space-between;">
                            <span>授業:</span>
                            <span style="font-weight: 600;">${periodLabels.length > 0 ? periodLabels.join(',') : 'なし'}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; margin-top: 2px;">
                            <span>推奨:</span>
                            <span style="color: ${recommendation === current.shift ? 'var(--success-700)' : 'var(--primary-600)'}; font-weight: 700;">
                                ${recommendation}勤務
                            </span>
                        </div>
                    </div>
                </div>
            `;
        });

        html += `</div>`;
        periodCard.innerHTML = html;
        container.appendChild(periodCard);
    });
}

/**
 * メモリ内の設定を更新（セレクトボックス変更時）
 */
window.updateWorkSettingInMemory = function (periodId, dayNum, shift) {
    const targetYear = getCurrentFiscalYear();
    ensureWorkSettingsYear(targetYear);
    if (!workSettings[targetYear][periodId]) workSettings[targetYear][periodId] = {};
    if (!workSettings[targetYear][periodId][dayNum]) workSettings[targetYear][periodId][dayNum] = {};

    workSettings[targetYear][periodId][dayNum].shift = shift;

    // 「その他」の入力欄の表示切り替え
    const customDiv = document.getElementById(`custom-time-${periodId}-${dayNum}`);
    if (customDiv) {
        customDiv.style.display = shift === 'Other' ? 'block' : 'none';
    }

    // カレンダー表示に即座に同期（年休カードなどの計算に反映）
    if (typeof updateCalendar === 'function') updateCalendar();

    // localStorageに保存
    if (typeof saveAllToLocal === 'function') saveAllToLocal();
};

/**
 * メモリ内の自由入力時間を更新
 */
window.updateWorkTimeInMemory = function (periodId, dayNum, field, value) {
    const targetYear = getCurrentFiscalYear();
    ensureWorkSettingsYear(targetYear);
    if (!workSettings[targetYear][periodId]) workSettings[targetYear][periodId] = {};
    if (!workSettings[targetYear][periodId][dayNum]) workSettings[targetYear][periodId][dayNum] = {};

    workSettings[targetYear][periodId][dayNum][field] = value;

    // カレンダー表示に即座に同期
    if (typeof updateCalendar === 'function') updateCalendar();

    // localStorageに保存
    if (typeof saveAllToLocal === 'function') saveAllToLocal();
};

/**
 * 勤務設定の保存
 */
/**
 * 時間文字列に分を加算/減算
 */
window.addMinutes = function addMinutes(timeStr, minutes) {
    if (!timeStr) return "";
    const [h, m] = timeStr.split(':').map(Number);
    const date = new Date(2000, 0, 1, h, m);
    date.setMinutes(date.getMinutes() + minutes);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * 年休をカレンダーに追加
 */
window.addAnnualLeaveCard = function (dateStr, label, leaveType, hours, extra = 0) {
    const id = 'original-leave-' + Date.now();
    const normalizedDate = dateStr.replace(/\//g, '-');
    const newEvent = {
        type: 'custom',
        id: id,
        date: normalizedDate,
        startDate: normalizedDate,
        endDate: normalizedDate,
        action: 'add',
        data: {
            event: label,
            leaveType: leaveType, // 'early', 'late', 'full'
            leaveHours: hours,
            leaveExtra: extra,
            allDay: false,
            memo: 'オリジナルの年休（勤務時間と完全同期）',
            isParticipating: true,
            color: '#ef4444',
            isLeaveCard: true
        }
    };

    if (typeof classOverrides === 'undefined') window.classOverrides = [];
    classOverrides.push(newEvent);

    if (typeof saveAllToLocal === 'function') saveAllToLocal();
    if (typeof updateCalendar === 'function') updateCalendar();
};

/**
 * 日付セル右クリック時の操作メニューを表示
 */
window.showDayInteractionMenu = function (e, dateStr) {
    e.preventDefault();
    e.stopPropagation();

    // 既存のメニューがあれば削除
    const existing = document.getElementById('day-interaction-menu');
    if (existing) existing.remove();

    const d = parseDateKey(dateStr);
    const weekday = d.getDay();
    const isHolidayDay = typeof getHolidayName === 'function' && getHolidayName(d, getHolidaysForYear(d.getFullYear())) !== null;
    const isBusinessDay = weekday !== 0 && weekday !== 6 && !isHolidayDay;

    const menu = document.createElement('div');
    menu.id = 'day-interaction-menu';
    menu.className = 'context-menu'; // CSSで定義されたスタイルを利用
    menu.style.cssText = `
        position: fixed;
        top: ${e.clientY}px;
        left: ${e.clientX}px;
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        padding: 5px;
        z-index: 6000;
        min-width: 180px;
        border: 1px solid var(--neutral-200);
        display: block;
    `;

    const title = document.createElement('div');
    title.textContent = `${dateStr} の操作`;
    title.style.cssText = `padding: 8px 12px; font-size: 0.75rem; color: var(--neutral-500); font-weight: 700; border-bottom: 1px solid var(--neutral-100);`;
    menu.appendChild(title);

    const items = [
        { label: '&#x1F343; 年休の登録...', action: () => openAnnualLeaveModal(dateStr), disabled: !isBusinessDay },
        { label: '&#x1F4BC; 出張の登録...', action: () => openBusinessTripModal(dateStr) },
        { label: '&#x1F3E1; 在宅勤務の登録...', action: () => openWfhModal(dateStr) },
    ];

    if (!isBusinessDay) {
        items.push({ label: '&#x1F4BC; 休日出勤の登録...', action: () => openHolidayWorkModal(dateStr) });
    }

    items.forEach(item => {
        const div = document.createElement('div');
        div.innerHTML = item.label;
        div.style.cssText = `padding: 10px 12px; cursor: ${item.disabled ? 'not-allowed' : 'pointer'}; border-radius: 4px; font-size: 0.9rem; transition: background 0.2s; opacity: ${item.disabled ? '0.5' : '1'};`;

        if (!item.disabled) {
            div.onmouseover = () => div.style.background = 'var(--neutral-50)';
            div.onmouseout = () => div.style.background = 'transparent';
            div.onclick = () => {
                item.action();
                menu.remove();
            };
        }
        menu.appendChild(div);
    });

    document.body.appendChild(menu);

    // 画面外クリックで閉じる
    setTimeout(() => {
        const closeMenu = (ev) => {
            if (!menu.contains(ev.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        document.addEventListener('click', closeMenu);
    }, 10);
};

// 互換性のために古い名前も残すか差し替える（app.jsで呼び出しているため）
window.showAnnualLeaveMenu = window.showDayInteractionMenu;

/**
 * 指定した期間内のイベント重複をチェックする
 */
/**
 * 指定した期間内のイベント重複をチェックする
 * @param {string} startDate 'yyyy/mm/dd'
 * @param {string} endDate 'yyyy/mm/dd'
 * @param {Object} newEventTimes { startTime, endTime, isTrip } (新規登録する予定の時間情報)
 */
window.checkEventConflicts = function (startDate, endDate, newEventTimes = null) {
    const conflicts = [];
    const dStart = parseDateKey(startDate);
    const dEnd = parseDateKey(endDate);
    const curr = new Date(dStart);

    while (curr <= dEnd) {
        const dStr = formatDateKey(curr);

        // 新しい予定のこの日における時間帯を決定
        let nStart = '00:00';
        let nEnd = '23:59';
        if (newEventTimes) {
            if (newEventTimes.isTrip) {
                if (dStr === startDate) nStart = newEventTimes.startTime || '00:00';
                if (dStr === endDate) nEnd = newEventTimes.endTime || '23:59';
            } else {
                nStart = newEventTimes.startTime || '00:00';
                nEnd = newEventTimes.endTime || '23:59';
            }
        }

        const checkOverlap = (s1, e1, s2, e2) => {
            return s1 < e2 && s2 < e1;
        };

        // 1. 年間行事(Excel)との重複チェック
        if (typeof scheduleData !== 'undefined') {
            scheduleData.forEach(item => {
                if (formatDateKey(item.date) === dStr && item.event) {
                    // Excel行事は時間指定がない場合が多いので原則重複とするが、
                    // もし時間があれば時間でチェックする
                    const eStart = item.startTime || '00:00';
                    const eEnd = item.endTime || '23:59';
                    if (checkOverlap(nStart, nEnd, eStart, eEnd)) {
                        conflicts.push(`${dStr}: ${item.event}`);
                    }
                }
            });
        }

        // 2. 自分の授業との重複チェック
        if (typeof getDisplayableClassesForDate === 'function') {
            const classes = getDisplayableClassesForDate(curr, []);
            classes.forEach(cls => {
                const PERIOD_TIMES_LOCAL = window.PERIOD_TIMES || (typeof PERIOD_TIMES !== 'undefined' ? PERIOD_TIMES : {});
                const pKey = cls.displayPeriod || cls.originalPeriod;
                let times = PERIOD_TIMES_LOCAL[pKey];
                if (!times && typeof pKey === 'string' && pKey.includes('-')) {
                    const parts = pKey.split('-');
                    const first = PERIOD_TIMES_LOCAL[parts[0]];
                    const last = PERIOD_TIMES_LOCAL[parts[parts.length - 1]];
                    if (first && last) times = { start: first.start, end: last.end };
                }
                const cStart = times ? times.start : '00:00';
                const cEnd = times ? times.end : '23:59';

                if (checkOverlap(nStart, nEnd, cStart, cEnd)) {
                    conflicts.push(`${dStr}: 【授業】${cls.name} (${cls.originalPeriod}限)`);
                }
            });
        }

        // 3. 他のカスタム予定（年休など）との重複チェック
        if (typeof classOverrides !== 'undefined') {
            classOverrides.forEach(ov => {
                if (ov.type === 'custom' && ov.action === 'add' && ov.data) {
                    const ovStart = ov.startDate || ov.date;
                    const ovEnd = ov.endDate || ov.date || ov.startDate;
                    if (dStr >= ovStart && dStr <= ovEnd) {
                        // 既存予定のこの日における時間帯
                        let eStart = ov.data.startTime || '00:00';
                        let eEnd = ov.data.endTime || '23:59';

                        // 出張や年休の特殊な時間計算
                        if (ov.data.isTripCard) {
                            if (dStr !== ovStart) eStart = '00:00';
                            if (dStr !== ovEnd) eEnd = '23:59';
                        } else if (ov.data.isLeaveCard) {
                            // 年休の時間は render 時のロジックと同様に算出
                            const d = parseDateKey(dStr);
                            const work = getWorkTimeForDate(d, true);
                            if (work && work.start && work.end) {
                                if (ov.data.leaveType === 'early' || ov.data.leaveType === 'full') eStart = work.start;
                                if (ov.data.leaveType === 'late') eStart = addMinutes(work.end, -(ov.data.leaveHours * 60 + (ov.data.leaveExtra || 0)));
                                if (ov.data.leaveType === 'late' || ov.data.leaveType === 'full') eEnd = work.end;
                                if (ov.data.leaveType === 'early') eEnd = addMinutes(work.start, ov.data.leaveHours * 60 + (ov.data.leaveExtra || 0));
                            }
                        }

                        if (checkOverlap(nStart, nEnd, eStart, eEnd)) {
                            conflicts.push(`${dStr}: ${ov.data.event}`);
                        }
                    }
                }
            });
        }

        curr.setDate(curr.getDate() + 1);
    }

    return [...new Set(conflicts)];
};

/**
 * 年休モーダルを開く
 */
window.openAnnualLeaveModal = function (dateStr) {
    const d = parseDateKey(dateStr);
    const workTime = getWorkTimeForDate(d);
    if (!workTime || !workTime.start || !workTime.end) {
        alert('この日の勤務時間が設定されていないため、年休を登録できません。');
        return;
    }

    const modal = document.getElementById('annualLeaveModal');
    document.getElementById('leaveDateLabel').textContent = `日付: ${dateStr}`;
    document.getElementById('leaveWorkTimeLabel').textContent = `勤務時間: ${workTime.start} ～ ${workTime.end}`;

    const list = document.getElementById('leaveOptionsList');
    list.innerHTML = '';

    const { start, end } = workTime;
    const options = [
        { label: '前半1時間休', type: 'early', hours: 1 },
        { label: '前半2時間休', type: 'early', hours: 2 },
        { label: '前半3時間休', type: 'early', hours: 3 },
        { label: '前半4時間休（半日）', type: 'early', hours: 4 },
        { label: '前半5時間休（45分休含）', type: 'early', hours: 5, extra: 45 },
        { label: '前半6時間休（45分休含）', type: 'early', hours: 6, extra: 45 },
        { divider: true },
        { label: '後半1時間休', type: 'late', hours: 1 },
        { label: '後半2時間休', type: 'late', hours: 2 },
        { label: '後半3時間休', type: 'late', hours: 3 },
        { label: '後半4時間休（半日）', type: 'late', hours: 4 },
        { label: '後半5時間休（45分休含）', type: 'late', hours: 5, extra: 45 },
        { label: '後半6時間休（45分休含）', type: 'late', hours: 6, extra: 45 },
        { divider: true },
        { label: '1日休', type: 'full' }
    ];

    options.forEach(opt => {
        if (opt.divider) {
            const hr = document.createElement('div');
            hr.style.cssText = `height: 1px; background: var(--neutral-100); margin: 4px 0;`;
            list.appendChild(hr);
            return;
        }

        const btn = document.createElement('button');
        btn.className = 'btn btn-outline-primary';
        btn.style.justifyContent = 'space-between';

        let timeRange = '';
        if (opt.type === 'early') {
            timeRange = `${start}-${addMinutes(start, opt.hours * 60 + (opt.extra || 0))}`;
        } else if (opt.type === 'late') {
            timeRange = `${addMinutes(end, -(opt.hours * 60 + (opt.extra || 0)))}-${end}`;
        } else {
            timeRange = `${start}-${end}`;
        }

        btn.innerHTML = `<span>${opt.label}</span> <span style="font-size: 0.75rem; opacity: 0.7;">${timeRange}</span>`;
        btn.onclick = () => {
            // 重複チェック
            const conflicts = checkEventConflicts(dateStr, dateStr, { startTime: timeRange.split('-')[0], endTime: timeRange.split('-')[1], isTrip: false });
            if (conflicts.length > 0) {
                if (!confirm(`以下の予定と重複していますが、登録しますか？\n\n${conflicts.join('\n')}`)) {
                    return;
                }
            }
            addAnnualLeaveCard(dateStr, opt.label.split('（')[0], opt.type, opt.hours || 0, opt.extra || 0);
            closeAnnualLeaveModal();
        };
        list.appendChild(btn);
    });

    modal.classList.remove('hidden');
};

window.closeAnnualLeaveModal = function () {
    document.getElementById('annualLeaveModal').classList.add('hidden');
};

/**
 * 出張モーダルを開く
 * @param {string} dateStr 対象日
 * @param {string|null} editId 編集対象のID（新規の場合はnull）
 */
window.openBusinessTripModal = function (dateStr, editId = null) {
    const modal = document.getElementById('businessTripModal');
    modal.dataset.editId = editId || ''; // 編集用IDを保持

    // デフォルトの設定
    const isoDate = dateStr.replace(/\//g, '-');
    let dest = '';
    let startDate = isoDate;
    let endDate = isoDate;
    let depPoint = 'school';
    let arrPoint = 'home';
    const d = parseDateKey(dateStr);
    const workTime = getWorkTimeForDate(d) || { start: '08:30', end: '17:00' };
    let depTime = workTime.start;
    let arrTime = workTime.end;
    let isApplied = false;

    // 編集モードなら既存データをロード
    if (editId) {
        const ov = classOverrides.find(o => String(o.id) === String(editId));
        if (ov && ov.data) {
            const item = ov.data;
            dest = item.location || item.tripDetails?.destination || '';
            startDate = (ov.startDate || ov.date).replace(/\//g, '-');
            endDate = (ov.endDate || ov.date).replace(/\//g, '-');
            depTime = item.startTime || item.tripDetails?.depTime || depTime;
            arrTime = item.endTime || item.tripDetails?.arrTime || arrTime;
            depPoint = item.tripDetails?.depPoint || depPoint;
            arrPoint = item.tripDetails?.arrPoint || arrPoint;
            isApplied = !!item.isApplied;
        }
    }

    document.getElementById('tripDestination').value = dest;
    document.getElementById('tripStartDate').value = startDate;
    document.getElementById('tripEndDate').value = endDate;
    document.getElementById('tripDeparturePoint').value = depPoint;
    document.getElementById('tripArrivalPoint').value = arrPoint;
    document.getElementById('tripDepartureTime').value = depTime;
    document.getElementById('tripArrivalTime').value = arrTime;
    if (document.getElementById('tripApplied')) {
        document.getElementById('tripApplied').checked = isApplied;
    }

    modal.classList.remove('hidden');
};

window.closeBusinessTripModal = function () {
    document.getElementById('businessTripModal').classList.add('hidden');
};

window.saveBusinessTrip = function () {
    const dest = document.getElementById('tripDestination').value;
    const startDate = document.getElementById('tripStartDate').value;
    const endDate = document.getElementById('tripEndDate').value;
    const depPoint = document.getElementById('tripDeparturePoint').value;
    const arrPoint = document.getElementById('tripArrivalPoint').value;
    const depTime = document.getElementById('tripDepartureTime').value;
    const arrTime = document.getElementById('tripArrivalTime').value;

    if (!dest) {
        alert('用務先を入力してください。');
        return;
    }
    if (!startDate || !endDate) {
        alert('期間を選択してください。');
        return;
    }

    const dStart = parseDateKey(startDate);
    const dEnd = parseDateKey(endDate);

    // 日付の前後チェック
    if (dEnd < dStart) {
        alert('終了日が開始日より前になっています。');
        return;
    }

    // 📌予定や授業との重複チェック
    const conflicts = checkEventConflicts(startDate, endDate, { startTime: depTime, endTime: arrTime, isTrip: true });
    if (conflicts.length > 0) {
        if (!confirm(`以下の予定と重複していますが、登録しますか？\n\n${conflicts.join('\n')}`)) {
            return;
        }
    }

    let memo = `${dest} (${depPoint === 'school' ? '学校発' : '自宅発'} / ${arrPoint === 'school' ? '学校着' : '自宅着'})`;

    const editId = document.getElementById('businessTripModal').dataset.editId;
    const id = editId || ('trip-' + Date.now());

    // 既存データを削除（編集時）
    if (editId) {
        classOverrides = classOverrides.filter(ov => String(ov.id) !== String(editId));
    }

    const newEvent = {
        type: 'custom',
        id: id,
        date: startDate,
        startDate: startDate,
        endDate: endDate,
        action: 'add',
        data: {
            event: `出張: ${dest}`,
            startTime: depTime,
            endTime: arrTime,
            // 期間予定の場合、時間は初日と最終日にのみ表示される（app.jsのロジック）
            allDay: false,
            memo: memo,
            location: dest,
            isParticipating: true,
            color: '#3b82f6',
            isTripCard: true,
            isApplied: document.getElementById('tripApplied') ? document.getElementById('tripApplied').checked : false,
            tripDetails: {
                destination: dest,
                depPoint,
                arrPoint,
                depTime,
                arrTime
            }
        }
    };

    if (typeof classOverrides === 'undefined') window.classOverrides = [];
    classOverrides.push(newEvent);

    if (typeof saveAllToLocal === 'function') saveAllToLocal();
    if (typeof updateCalendar === 'function') updateCalendar();
    closeBusinessTripModal();
};

/**
 * 在宅勤務モーダル
 */
let currentWfhDate = '';
window.openWfhModal = function (dateStr, editId = null) {
    currentWfhDate = dateStr;
    const modal = document.getElementById('wfhModal');
    modal.dataset.editId = editId || '';

    let location = '自宅';
    let allDay = true;
    const d = parseDateKey(dateStr);
    const workTime = getWorkTimeForDate(d) || { start: '08:30', end: '17:00' };
    let startTime = workTime.start;
    let endTime = workTime.end;
    let isApplied = false;

    if (editId) {
        const ov = classOverrides.find(o => String(o.id) === String(editId));
        if (ov && ov.data) {
            const item = ov.data;
            location = item.location || '自宅';
            allDay = item.allDay !== undefined ? item.allDay : true;
            startTime = item.startTime || startTime;
            endTime = item.endTime || endTime;
            isApplied = !!item.isApplied;
        }
    }

    document.getElementById('wfhDateLabel').textContent = `日付: ${dateStr}`;
    document.getElementById('wfhLocation').value = location;
    document.getElementById('wfhAllDay').checked = allDay;
    document.getElementById('wfhStartTime').value = startTime;
    document.getElementById('wfhEndTime').value = endTime;
    if (document.getElementById('wfhApplied')) {
        document.getElementById('wfhApplied').checked = isApplied;
    }

    toggleWfhTimeFields();
    modal.classList.remove('hidden');
};

window.closeWfhModal = function () {
    document.getElementById('wfhModal').classList.add('hidden');
};

window.toggleWfhTimeFields = function () {
    const isAllDay = document.getElementById('wfhAllDay').checked;
    const fields = document.getElementById('wfhTimeFields');
    if (isAllDay) {
        fields.classList.add('hidden');
    } else {
        fields.classList.remove('hidden');
    }
};

window.saveWfh = function () {
    const location = document.getElementById('wfhLocation').value || '自宅';
    const allDay = document.getElementById('wfhAllDay').checked;
    const startTime = document.getElementById('wfhStartTime').value;
    const endTime = document.getElementById('wfhEndTime').value;
    const normalizedDate = currentWfhDate.replace(/\//g, '-');

    // 重複チェック
    const conflicts = checkEventConflicts(normalizedDate, normalizedDate, {
        startTime: allDay ? '00:00' : startTime,
        endTime: allDay ? '23:59' : endTime,
        isTrip: false
    });
    if (conflicts.length > 0) {
        if (!confirm(`以下の予定と重複していますが、登録しますか？\n\n${conflicts.join('\n')}`)) {
            return;
        }
    }

    const editId = document.getElementById('wfhModal').dataset.editId;
    const id = editId || ('wfh-' + Date.now());

    if (editId) {
        classOverrides = classOverrides.filter(ov => String(ov.id) !== String(editId));
    }

    const newEvent = {
        type: 'custom',
        id: id,
        date: normalizedDate,
        startDate: normalizedDate,
        endDate: normalizedDate,
        action: 'add',
        data: {
            event: `在宅勤務 (${location})`,
            startTime: allDay ? null : startTime,
            endTime: allDay ? null : endTime,
            allDay: allDay,
            isParticipating: true,
            color: '#10b981',
            isWfhCard: true,
            isApplied: document.getElementById('wfhApplied') ? document.getElementById('wfhApplied').checked : false,
            location: location
        }
    };

    if (typeof classOverrides === 'undefined') window.classOverrides = [];
    classOverrides.push(newEvent);

    if (typeof saveAllToLocal === 'function') saveAllToLocal();
    if (typeof updateCalendar === 'function') updateCalendar();
    closeWfhModal();
};

/**
 * 休日出勤モーダル
 */
let currentHolidayWorkDate = '';
window.openHolidayWorkModal = function (dateStr, editId = null) {
    currentHolidayWorkDate = dateStr;
    const modal = document.getElementById('holidayWorkModal');
    modal.dataset.editId = editId || '';

    document.getElementById('holidayWorkDateLabel').textContent = `日付: ${dateStr}`;
    let content = '';
    let startTime = '08:30';
    let endTime = '17:00';
    let subDate = '';
    let subType = 'none';
    let isApplied = false;

    if (editId) {
        const ov = classOverrides.find(o => String(o.id) === String(editId));
        if (ov && ov.data) {
            const item = ov.data;
            content = item.holidayWorkDetails?.content || item.event.replace('休日出勤: ', '');
            startTime = item.startTime || startTime;
            endTime = item.endTime || endTime;
            subDate = item.holidayWorkDetails?.subDate || '';
            subType = item.holidayWorkDetails?.subType || 'none';
            isApplied = !!item.isApplied;
        }
    }

    document.getElementById('holidayWorkContent').value = content;
    document.getElementById('holidayWorkStartTime').value = startTime;
    document.getElementById('holidayWorkEndTime').value = endTime;
    document.getElementById('holidayWorkSubstituteDate').value = subDate;
    document.getElementById('holidayWorkSubstituteType').value = subType;
    document.getElementById('holidayWorkApplied').checked = isApplied;

    modal.classList.remove('hidden');
};

window.closeHolidayWorkModal = function () {
    document.getElementById('holidayWorkModal').classList.add('hidden');
};

window.saveHolidayWork = function () {
    const content = document.getElementById('holidayWorkContent').value;
    const startTime = document.getElementById('holidayWorkStartTime').value;
    const endTime = document.getElementById('holidayWorkEndTime').value;
    const subDate = document.getElementById('holidayWorkSubstituteDate').value;
    const subType = document.getElementById('holidayWorkSubstituteType').value;
    const isApplied = document.getElementById('holidayWorkApplied').checked;

    if (!content) {
        alert('業務内容を入力してください。');
        return;
    }

    // 時間計算（休憩の推算）
    let breakMinutes = 0;
    const [sH, sM] = startTime.split(':').map(Number);
    const [eH, eM] = endTime.split(':').map(Number);
    const diffMinutes = (eH * 60 + eM) - (sH * 60 + sM);
    if (diffMinutes >= 4 * 60) {
        breakMinutes = 45;
    }

    const editId = document.getElementById('holidayWorkModal').dataset.editId;
    const id = editId || ('holiday-work-' + Date.now());

    if (editId) {
        classOverrides = classOverrides.filter(ov => String(ov.id) !== String(editId));
    }

    const normalizedDate = currentHolidayWorkDate.replace(/\//g, '-');
    const newEvent = {
        type: 'custom',
        id: id,
        date: normalizedDate,
        startDate: normalizedDate,
        endDate: normalizedDate,
        action: 'add',
        data: {
            event: `休日出勤: ${content}`,
            startTime: startTime,
            endTime: endTime,
            allDay: false,
            isParticipating: true,
            color: '#f59e0b', // Amber/Orange
            isHolidayWorkCard: true,
            isApplied: isApplied,
            holidayWorkDetails: {
                content,
                startTime,
                endTime,
                breakMinutes,
                workMinutes: diffMinutes - breakMinutes,
                subDate,
                subType
            }
        }
    };

    if (typeof classOverrides === 'undefined') window.classOverrides = [];
    classOverrides.push(newEvent);

    if (typeof saveAllToLocal === 'function') saveAllToLocal();
    if (typeof updateCalendar === 'function') updateCalendar();
    closeHolidayWorkModal();
};

window.saveWorkSettings = function () {
    localStorage.setItem('workSettings', JSON.stringify(workSettings));
    localStorage.setItem('workOverrides', JSON.stringify(workOverrides));
    alert('勤務設定を保存しました。カレンダー表示に反映します。');

    if (typeof updateCalendar === 'function') {
        updateCalendar();
    }
};

/**
 * 個別の日の勤務変更を表示
 */
window.showWorkShiftMenu = function (event, dateStr) {
    event.preventDefault();
    event.stopPropagation();

    // 既存のメニューがあれば削除
    const existing = document.getElementById('work-shift-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.id = 'work-shift-menu';
    menu.style.cssText = `
        position: fixed;
        top: ${event.clientY}px;
        left: ${event.clientX}px;
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.15);
        padding: 5px;
        z-index: 5000;
        min-width: 140px;
        border: 1px solid var(--neutral-200);
    `;

    const title = document.createElement('div');
    title.textContent = `${dateStr} の勤務変更`;
    title.style.cssText = `padding: 8px 12px; font-size: 0.75rem; color: var(--neutral-500); font-weight: 700; border-bottom: 1px solid var(--neutral-100);`;
    menu.appendChild(title);

    Object.keys(WORK_SHIFTS).forEach(shiftKey => {
        const item = document.createElement('div');
        item.style.cssText = `padding: 10px 12px; cursor: pointer; border-radius: 4px; font-size: 0.9rem; transition: background 0.2s; display: flex; justify-content: space-between; align-items: center; gap: 15px;`;

        const shift = WORK_SHIFTS[shiftKey];
        const timeInfo = shift.start ? `<span style="font-size: 0.7rem; color: var(--neutral-400); font-family: monospace;">${shift.start}-${shift.end}</span>` : '';

        item.innerHTML = `<span>${shift.name}</span>${timeInfo}`;

        item.onmouseover = () => item.style.background = 'var(--neutral-100)';
        item.onmouseout = () => item.style.background = 'transparent';
        item.onclick = () => {
            // 本来の（オーバーライドなしの）勤務時間を取得
            const d = parseDateKey(dateStr);
            const defaultWork = getWorkTimeForDate(d, true);
            const defaultShiftKey = Object.keys(WORK_SHIFTS).find(k => WORK_SHIFTS[k].name === (defaultWork ? defaultWork.name : ''));

            if (shiftKey === 'Other') {
                const start = prompt('開始時間を入力 (例 08:30)', '08:30');
                const end = prompt('終了時間を入力 (例 17:00)', '17:00');
                if (start && end) {
                    workOverrides[dateStr] = { shift: 'Other', start, end };
                }
            } else if (shiftKey === defaultShiftKey) {
                // 本来の設定と同じものを選んだ場合は、オーバーライドを削除して元の色に戻す
                delete workOverrides[dateStr];
            } else {
                workOverrides[dateStr] = { shift: shiftKey };
            }
            localStorage.setItem('workOverrides', JSON.stringify(workOverrides));
            menu.remove();
            if (typeof updateCalendar === 'function') updateCalendar();
        };
        menu.appendChild(item);
    });

    // リセットボタン
    if (workOverrides[dateStr]) {
        const resetItem = document.createElement('div');
        resetItem.style.cssText = `padding: 10px 12px; cursor: pointer; border-top: 1px solid var(--neutral-100); color: var(--error-red); font-size: 0.9rem; font-weight: 700;`;
        resetItem.textContent = '初期設定（自動計算）に戻す';
        resetItem.onclick = () => {
            delete workOverrides[dateStr];
            localStorage.setItem('workOverrides', JSON.stringify(workOverrides));
            menu.remove();
            if (typeof updateCalendar === 'function') updateCalendar();
        };
        menu.appendChild(resetItem);
    }

    document.body.appendChild(menu);

    // 画面外クリックで閉じる
    setTimeout(() => {
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };
        document.addEventListener('click', closeMenu);
    }, 10);
};

/**
 * 指定された日付の勤務時間を取得
 * @param {Date} date 
 * @param {boolean} ignoreOverride trueの場合、個別の変更（琥珀色バッジ）を無視して本来の設定を返す
 */
function getWorkTimeForDate(date, ignoreOverride = false) {
    const month = date.getMonth() + 1;
    const dayNum = date.getDay(); // 0=日, 6=土
    const dateStr = formatDateKey(date);

    if (dayNum === 0 || dayNum === 6) return null;

    // 個別オーバーライドを優先確認
    if (!ignoreOverride && workOverrides[dateStr]) {
        const ov = workOverrides[dateStr];
        const res = ov.shift === 'Other'
            ? { start: ov.start || '08:30', end: ov.end || '17:00', name: 'その他' }
            : WORK_SHIFTS[ov.shift];
        return { ...res, isOverride: true, isApplied: !!ov.isApplied };
    }

    const ranges = getVacationPeriods();
    let periodId = '';

    // 休業期間の判定
    if (ranges.spring_vac.start && date >= ranges.spring_vac.start && date <= ranges.spring_vac.end) {
        periodId = 'spring_vac';
    } else if (ranges.summer_vac.start && date >= ranges.summer_vac.start && date <= ranges.summer_vac.end) {
        periodId = 'summer_vac';
    } else if (ranges.winter_vac.start && date >= ranges.winter_vac.start && date <= ranges.winter_vac.end) {
        periodId = 'winter_vac';
    } else if (ranges.end_year_vac.start && date >= ranges.end_year_vac.start && date <= ranges.end_year_vac.end) {
        periodId = 'end_year_vac';
    } else {
        // 学期平日
        if (month >= 4 && month <= 9) {
            periodId = 'first_semester';
        } else {
            periodId = 'second_semester';
        }
    }

    const targetYear = getFiscalYear(date);
    const yearSettings = workSettings[targetYear] || getCurrentWorkSettings();

    const config = yearSettings[periodId] ? yearSettings[periodId][dayNum] : null;
    if (!config) {
        const defaultShift = periodId.includes('vac') ? 'C' : 'B';
        return WORK_SHIFTS[defaultShift];
    }

    if (config.shift === 'Other') {
        return {
            start: config.start || '08:30',
            end: config.end || '17:00',
            name: 'その他'
        };
    }

    return WORK_SHIFTS[config.shift] || WORK_SHIFTS['A'];
}
/**
 * 申請統計モーダルを開く
 */
window.openApplicationStatsModal = function () {
    const btn = document.getElementById('navStatsBtn');
    if (btn) btn.click();
};

window.closeApplicationStatsModal = function () {
    // モーダルではなくなったので何もしない、またはカレンダーに戻る
    const btn = document.getElementById('navCalendarBtn');
    if (btn) btn.click();
};

// 勤怠管理のソート状態
let statsSortKey = 'date';
let statsSortOrder = 'asc';

window.sortApplicationStats = function (key) {
    if (statsSortKey === key) {
        statsSortOrder = statsSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        statsSortKey = key;
        statsSortOrder = 'asc';
    }
    renderApplicationStats();
};

window.renderApplicationStats = function () {
    const body = document.getElementById('applicationStatsBody');
    if (!body) return;

    // タイトルの更新
    const globalYearSelect = document.getElementById('globalYearSelect');
    const fiscalYear = globalYearSelect ? globalYearSelect.value : (new Date().getFullYear());
    const statsTitle = document.getElementById('statsTitle');
    if (statsTitle) statsTitle.textContent = `勤怠管理 (${fiscalYear}年/${fiscalYear}年度）`;

    body.innerHTML = '';
    const filterPeriod = document.getElementById('statsFilterPeriod')?.value || 'all';
    const filterType = document.getElementById('statsFilterType')?.value || 'all';

    let leaveTotalMinutes = 0;
    let leaveFullDays = 0;
    let leaveHalfDays = 0;
    let leaveHoursOnlyMins = 0;

    let tripCount = 0;
    let tripDays = 0;

    let wfhCount = 0;
    let holidayWorkCount = 0;
    let holidayWorkTotalMinutes = 0;
    let shiftChangeCount = 0;

    let statsData = [];

    // 1. 年休・出張・在宅勤務・休日出勤 (classOverrides)
    if (typeof classOverrides !== 'undefined') {
        classOverrides.forEach(ov => {
            // 注意: 年休集計期間を考慮するため、ここでは全てのデータを一旦収集し、後のフィルターで絞り込む
            // ただし、明らかに無関係な年度（currentYearから2年以上離れているなど）は除外しても良い
            const ovDate = parseDateKey(ov.date);
            const ovYear = ovDate.getFullYear();

            // 表示年度に関連する可能性のある範囲（currentYearの前後1年程度）に限定して収集を高速化
            if (currentYear !== null && (ovYear < currentYear - 1 || ovYear > currentYear + 1)) return;

            if (ov.type === 'custom' && ov.action === 'add' && ov.data) {
                const item = ov.data;
                let type = '';
                let content = item.event;
                let condition = '';
                let type_id = ''; // フィルター用
                let type_class = '';

                if (item.isLeaveCard) {
                    type = '年休';
                    type_id = 'leave';
                    type_class = 'leave';
                    const mins = (item.leaveHours || 0) * 60 + (item.leaveExtra || 0);
                    // 集計はフィルター後のループで行うため、ここでは行わない
                } else if (item.isTripCard) {
                    type = '出張';
                    type_id = 'trip';
                    type_class = 'trip';
                    const startStr = ov.startDate || ov.date;
                    const endStr = ov.endDate || ov.date || ov.startDate;
                    const startTime = item.startTime || '--:--';
                    const endTime = item.endTime || '--:--';

                    const formatMD = (s) => s.replace(/^\d{4}[\/-]/, '').replace(/[\/-]/, '/');
                    condition = `${formatMD(startStr)} ${startTime} ～ ${formatMD(endStr)} ${endTime}`;
                    content = `${item.tripDetails?.destination || item.location || '不明'}`;
                } else if (item.isWfhCard) {
                    type = '在宅勤務';
                    type_id = 'wfh';
                    type_class = 'wfh';
                    let breakMins = 0;
                    let periodStr = '終日';
                    if (!item.allDay && item.startTime && item.endTime) {
                        const [sH, sM] = item.startTime.split(':').map(Number);
                        const [eH, eM] = item.endTime.split(':').map(Number);
                        const diff = (eH * 60 + eM) - (sH * 60 + sM);
                        if (diff >= 4 * 60) breakMins = 45;
                        periodStr = `${item.startTime}～${item.endTime}`;
                    } else {
                        breakMins = 45;
                    }
                    condition = `${periodStr}${breakMins ? ' (休憩' + breakMins + '分)' : ''}`;
                } else if (item.isHolidayWorkCard) {
                    type = '休日出勤';
                    type_id = 'holiday-work';
                    type_class = 'holiday-work';
                    const details = item.holidayWorkDetails || {};
                    condition = `${details.startTime}～${details.endTime} ${details.breakMinutes ? '(休憩' + details.breakMinutes + '分)' : ''}`;
                    if (details.subDate) {
                        condition += `<br><small style="color:var(--primary-600)">振替希望: ${details.subDate} (${details.subType === 'full' ? '全日' : details.subType === 'early' ? '前半' : '後半'})</small>`;
                    }
                    content = details.content || content;
                } else {
                    return;
                }

                statsData.push({
                    date: ov.date,
                    type,
                    type_id,
                    type_class,
                    content,
                    condition,
                    id: ov.id,
                    isApplied: !!item.isApplied,
                    source: 'custom',
                    details: item // 集計用に元のデータを保持
                });
            }
        });
    }

    // 2. 勤務パターン変更 (workOverrides)
    if (typeof workOverrides !== 'undefined') {
        Object.entries(workOverrides).forEach(([dateStr, ov]) => {
            const dateObj = parseDateKey(dateStr);
            const ovYear = dateObj.getFullYear();
            if (currentYear !== null && (ovYear < currentYear - 1 || ovYear > currentYear + 1)) return;

            let shiftName = ov.shift;
            if (shiftName === 'Other') shiftName = `その他 (${ov.start}-${ov.end})`;
            else if (WORK_SHIFTS[shiftName]) shiftName = WORK_SHIFTS[shiftName].name;

            const origShift = getWorkTimeForDate(dateObj, true);
            const origShiftName = origShift ? origShift.name : '不明';

            statsData.push({
                date: dateStr,
                type: '勤務変更',
                type_id: 'shift',
                type_class: 'shift',
                content: `区分変更: ${origShiftName} → ${shiftName}`,
                condition: '-',
                id: dateStr,
                isApplied: !!ov.isApplied,
                source: 'work'
            });
        });
    }

    // フィルター適用
    if (filterType !== 'all') {
        statsData = statsData.filter(d => d.type_id === filterType);
    }

    if (filterPeriod !== 'all') {
        statsData = statsData.filter(d => {
            const date = parseDateKey(d.date);
            const y = date.getFullYear();
            const m = date.getMonth() + 1; // 1-12

            if (filterPeriod === 'calendar_year') {
                // currentYear (年度) の開始年と同じ暦年の1月-12月
                return y === currentYear;
            }

            // 以下の月別・学期フィルターは currentYear (年度) 内のデータに限定
            if (getFiscalYear(date) !== currentYear) return false;

            if (filterPeriod === 'first_half') return m >= 4 && m <= 9;
            if (filterPeriod === 'second_half') return (m >= 10 && m <= 12) || (m >= 1 && m <= 3);
            if (filterPeriod.startsWith('month-')) {
                const targetM = parseInt(filterPeriod.split('-')[1]);
                return m === targetM;
            }
            return true;
        });
    } else {
        // 'all' の場合 (年度内: 4月-3月)
        statsData = statsData.filter(d => {
            const date = parseDateKey(d.date);
            return getFiscalYear(date) === currentYear;
        });
    }

    // フィルター後のデータで再集計を行う
    statsData.forEach(item => {
        if (item.source === 'custom' && item.details) {
            const data = item.details;
            if (data.isLeaveCard) {
                const mins = (data.leaveHours || 0) * 60 + (data.leaveExtra || 0);
                leaveTotalMinutes += mins;
                if (data.leaveType === 'full') {
                    leaveFullDays++;
                } else if ((data.leaveHours || 0) >= 4) {
                    // 4時間以上は 0.5日分としてカウント
                    leaveHalfDays++;
                } else {
                    leaveHoursOnlyMins += mins;
                }
            } else if (data.isTripCard) {
                tripCount++;
                const dStart = parseDateKey(item.date); // 簡易化
                const dEnd = parseDateKey(data.endDate || item.date);
                const days = Math.floor((dEnd - dStart) / (1000 * 60 * 60 * 24)) + 1;
                tripDays += days;
            } else if (data.isWfhCard) {
                wfhCount++;
            } else if (data.isHolidayWorkCard) {
                holidayWorkCount++;
                holidayWorkTotalMinutes += (data.holidayWorkDetails?.workMinutes || 0);
            }
        } else if (item.source === 'work') {
            shiftChangeCount++;
        }
    });

    // ソート適用
    statsData.sort((a, b) => {
        let valA, valB;
        switch (statsSortKey) {
            case 'date':
                valA = a.date; valB = b.date; break;
            case 'type':
                valA = a.type; valB = b.type; break;
            case 'status':
                valA = a.isApplied ? 1 : 0; valB = b.isApplied ? 1 : 0; break;
            default:
                valA = a.date; valB = b.date;
        }
        if (statsSortOrder === 'asc') return valA > valB ? 1 : -1;
        else return valA < valB ? 1 : -1;
    });

    // ソートアイコンの更新
    ['Date', 'Type', 'Status'].forEach(k => {
        const icon = document.getElementById(`sortIconStats${k}`);
        if (!icon) return;
        if (statsSortKey === k.toLowerCase()) {
            icon.textContent = statsSortOrder === 'asc' ? '▲' : '▼';
            icon.style.color = 'var(--primary-blue)';
        } else {
            icon.textContent = '⇅';
            icon.style.color = '';
        }
    });

    // 集計表示の更新
    const totalLeaveHours = leaveTotalMinutes / 60;
    // フィルター後のループで集計済みの leaveFullDays と leaveHalfDays を使用
    let dayBasedCount = leaveFullDays + (leaveHalfDays * 0.5);
    // 4時間以上の「時間休」も0.5日分として加算する場合（元のロジックに合わせる）
    // 今回のループ内では leaveHalfDays は 4時間ちょうど のものだけをカウントしているため、
    // 必要に応じてループ内のカウントロジックを調整するか、ここを調整します。
    // 現状のループ内ロジックで 4時間以上の半日休/時間休が leaveHalfDays に入るように調整済み。


    const leaveSummaryStr = `${totalLeaveHours.toFixed(1)}時間 <br><small style="font-size:0.75rem; font-weight:normal;">(${dayBasedCount.toFixed(1)}日分相当)</small>`;
    const statL = document.getElementById('statLeaveTotal'); if (statL) statL.innerHTML = leaveSummaryStr;
    const statT = document.getElementById('statTripTotal'); if (statT) statT.textContent = `${tripCount}回 (${tripDays}日間)`;
    const statW = document.getElementById('statWfhTotal'); if (statW) statW.textContent = `${wfhCount}日`;
    const statS = document.getElementById('statShiftChangeTotal'); if (statS) statS.textContent = `${shiftChangeCount}回`;
    const statH = document.getElementById('statHolidayWorkTotal'); if (statH) statH.textContent = `${holidayWorkCount}回 (${(holidayWorkTotalMinutes / 60).toFixed(1)}h)`;

    // テーブル描画
    statsData.forEach(item => {
        const tr = document.createElement('tr');
        const appliedState = item.isApplied ?
            '<span style="color: var(--success-600); font-weight: bold;">📄 申請済み</span>' :
            '<span style="color: var(--neutral-400);">未申請</span>';

        tr.innerHTML = `
            <td>${item.date}</td>
            <td><span class="badge badge-${item.type_class}" style="background-color: ${getBadgeColor(item.type_class)}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem;">${item.type}</span></td>
            <td>${item.content}</td>
            <td>${item.condition}</td>
            <td>${appliedState}</td>
            <td>
                <div style="display: flex; gap: 4px;">
                    <button class="btn btn-outline-primary btn-sm" style="padding: 2px 6px; white-space: nowrap;" onclick="toggleApplicationAppliedStatus('${item.source}', '${item.id}', ${!item.isApplied})" title="申請状況を切り替え">
                        ${item.isApplied ? '未申請に' : '申請済に'}
                    </button>
                    <button class="btn btn-outline-danger btn-sm" style="padding: 2px 6px;" onclick="deleteApplicationItem('${item.source}', '${item.id}')">削除</button>
                </div>
            </td>
        `;
        body.appendChild(tr);
    });

    if (statsData.length === 0) {
        body.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px; color: var(--neutral-400);">対象の${filterType !== 'all' ? '種類または' : ''}期間の申請データはありません</td></tr>`;
    }
};

function getBadgeColor(type_class) {
    switch (type_class) {
        case 'leave': return '#ef4444';
        case 'trip': return '#3b82f6';
        case 'wfh': return '#10b981';
        case 'holiday-work': return '#f59e0b';
        case 'shift': return '#6366f1';
        default: return '#94a3b8';
    }
}

window.deleteApplicationItem = function (source, id) {
    if (!confirm('この申請データを削除しますか？')) return;

    if (source === 'custom') {
        const index = classOverrides.findIndex(ov => String(ov.id) === String(id));
        if (index !== -1) classOverrides.splice(index, 1);
    } else if (source === 'work') {
        delete workOverrides[id];
    }

    if (typeof saveAllToLocal === 'function') saveAllToLocal();
    if (typeof updateCalendar === 'function') updateCalendar();
    renderApplicationStats();
};

window.toggleApplicationAppliedStatus = function (source, id, newStatus) {
    if (source === 'custom') {
        const ov = classOverrides.find(ov => String(ov.id) === String(id));
        if (ov && ov.data) {
            ov.data.isApplied = newStatus;
        }
    } else if (source === 'work') {
        if (workOverrides[id]) {
            workOverrides[id].isApplied = newStatus;
        }
    }

    if (typeof saveAllToLocal === 'function') saveAllToLocal();
    if (typeof updateCalendar === 'function') updateCalendar();
    renderApplicationStats();
};

window.exportApplicationStatsCsv = function () {
    // データの収集（renderApplicationStats と同様）
    const statsData = [];
    if (typeof classOverrides !== 'undefined') {
        classOverrides.forEach(ov => {
            if (ov.type === 'custom' && ov.action === 'add' && ov.data) {
                const item = ov.data;
                if (item.isLeaveCard) statsData.push({ date: ov.date, type: '年休', content: item.event, condition: `${item.leaveHours}h${item.leaveExtra}m` });
                else if (item.isTripCard) statsData.push({ date: ov.date, type: '出張', content: item.tripDetails?.destination || item.location, condition: `${item.startTime}-${item.endTime}` });
                else if (item.isWfhCard) statsData.push({ date: ov.date, type: '在宅勤務', content: '在宅勤務', condition: '終日' });
            }
        });
    }
    if (typeof workOverrides !== 'undefined') {
        Object.entries(workOverrides).forEach(([dateStr, ov]) => {
            statsData.push({ date: dateStr, type: '勤務変更', content: ov.shift, condition: '-' });
        });
    }

    statsData.sort((a, b) => a.date.localeCompare(b.date));

    let csv = '日付,種別,内容/用務先,時間/条件\n';
    statsData.forEach(row => {
        csv += `"${row.date}","${row.type}","${row.content}","${row.condition}"\n`;
    });

    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `申請・統計リスト_${new Date().toLocaleDateString()}.csv`;
    link.click();
};

// ナビゲーションボタンのイベント設定（app.jsの初期化時に呼ばれることを期待するが、ここで保険で定義）
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('navStatsBtn');
    if (btn) {
        btn.onclick = () => {
            // 他のセクションを隠す必要があればここで（現状はモーダルなので開くだけ）
            openApplicationStatsModal();
        };
    }
});
