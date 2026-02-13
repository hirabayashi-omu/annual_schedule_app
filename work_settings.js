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

let workSettings = {
    spring_vac: {},
    first_semester: {},
    summer_vac: {},
    second_semester: {},
    winter_vac: {},
    end_year_vac: {}
};

let workOverrides = {}; // { '2026-04-01': { shift: 'B' }, ... }

/**
 * 勤務設定の初期化
 */
function initWorkSettings() {
    const saved = localStorage.getItem('workSettings');
    if (saved) {
        try {
            workSettings = JSON.parse(saved);
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

    // 各期間の初期値を設定
    WORK_PERIODS.forEach(period => {
        if (!workSettings[period.id]) workSettings[period.id] = {};

        // デフォルト値の決定：平日はB(8:45~)、休業期間はC(9:30~)
        let defaultShift = 'B';
        if (period.id.includes('vac')) {
            defaultShift = 'C';
        }

        WEEKDAYS_SHORT.forEach((day, idx) => {
            if (!workSettings[period.id][idx + 1]) {
                workSettings[period.id][idx + 1] = { shift: defaultShift };
            }
        });
    });

    renderWorkPeriodConfig();
    if (typeof updateCalendar === 'function') updateCalendar();
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

    const currentTargetYear = typeof currentYear !== 'undefined' ? currentYear : new Date().getFullYear();

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
    if (periodId === 'first_semester' || periodId === 'spring_vac') targetSemester = 'first';
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
            const current = workSettings[period.id][dayNum] || { shift: 'B' };

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
    if (!workSettings[periodId]) workSettings[periodId] = {};
    if (!workSettings[periodId][dayNum]) workSettings[periodId][dayNum] = {};

    workSettings[periodId][dayNum].shift = shift;

    // 「その他」の入力欄の表示切り替え
    const customDiv = document.getElementById(`custom-time-${periodId}-${dayNum}`);
    if (customDiv) {
        customDiv.style.display = shift === 'Other' ? 'block' : 'none';
    }

    // カレンダー表示に即座に同期（年休カードなどの計算に反映）
    if (typeof updateCalendar === 'function') updateCalendar();
};

/**
 * メモリ内の自由入力時間を更新
 */
window.updateWorkTimeInMemory = function (periodId, dayNum, field, value) {
    if (!workSettings[periodId]) workSettings[periodId] = {};
    if (!workSettings[periodId][dayNum]) workSettings[periodId][dayNum] = {};

    workSettings[periodId][dayNum][field] = value;

    // カレンダー表示に即座に同期
    if (typeof updateCalendar === 'function') updateCalendar();
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
 * 年休カードをカレンダーに追加
 */
window.addAnnualLeaveCard = function (dateStr, label, leaveType, hours, extra = 0) {
    const id = 'original-leave-' + Date.now();
    const newEvent = {
        type: 'custom',
        id: id,
        date: dateStr,
        startDate: dateStr,
        endDate: dateStr,
        action: 'add',
        data: {
            event: label,
            leaveType: leaveType, // 'early', 'late', 'full'
            leaveHours: hours,
            leaveExtra: extra,
            allDay: false,
            memo: 'オリジナルの年休カード（勤務時間と完全同期）',
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
 * 年休メニューの表示
 */
window.showAnnualLeaveMenu = function (e, dateStr) {
    e.preventDefault();
    e.stopPropagation();

    // 既存のメニューがあれば削除
    const existing = document.getElementById('annual-leave-menu');
    if (existing) existing.remove();

    const d = parseDateKey(dateStr);
    const workTime = getWorkTimeForDate(d);
    if (!workTime || !workTime.start || !workTime.end) {
        alert('この日の勤務時間が設定されていないため、年休カードを作成できません。');
        return;
    }

    const { start, end } = workTime;

    const menu = document.createElement('div');
    menu.id = 'annual-leave-menu';
    menu.style.cssText = `
        position: fixed;
        top: ${e.clientY}px;
        left: ${e.clientX}px;
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        padding: 5px;
        z-index: 6000;
        min-width: 200px;
        border: 1px solid var(--neutral-200);
        max-height: 80vh;
        overflow-y: auto;
    `;

    const title = document.createElement('div');
    title.innerHTML = `<div style="font-weight:700; color:var(--neutral-700)">${dateStr} 年休カード作成</div>
                       <div style="font-size:0.7rem; color:var(--neutral-400)">勤務: ${start} ～ ${end}</div>`;
    title.style.cssText = `padding: 10px 12px; font-size: 0.85rem; border-bottom: 1px solid var(--neutral-100);`;
    menu.appendChild(title);

    // オプション定義
    const options = [
        { label: '前半1時間休', type: 'early', hours: 1, base: start },
        { label: '前半2時間休', type: 'early', hours: 2, base: start },
        { label: '前半3時間休', type: 'early', hours: 3, base: start },
        { label: '前半4時間休（半日）', type: 'early', hours: 4, base: start },
        { label: '前半5時間休（45分休含）', type: 'early', hours: 5, extra: 45, base: start },
        { label: '前半6時間休（45分休含）', type: 'early', hours: 6, extra: 45, base: start },
        { divider: true },
        { label: '後半1時間休', type: 'late', hours: 1, base: end },
        { label: '後半2時間休', type: 'late', hours: 2, base: end },
        { label: '後半3時間休', type: 'late', hours: 3, base: end },
        { label: '後半4時間休（半日）', type: 'late', hours: 4, base: end },
        { label: '後半5時間休（45分休含）', type: 'late', hours: 5, extra: 45, base: end },
        { label: '後半6時間休（45分休含）', type: 'late', hours: 6, extra: 45, base: end },
        { divider: true },
        { label: '1日休', type: 'full', start: start, end: end }
    ];

    options.forEach(opt => {
        if (opt.divider) {
            const hr = document.createElement('div');
            hr.style.cssText = `height: 1px; background: var(--neutral-100); margin: 4px 0;`;
            menu.appendChild(hr);
            return;
        }

        const item = document.createElement('div');
        item.style.cssText = `padding: 8px 12px; cursor: pointer; border-radius: 4px; font-size: 0.85rem; transition: background 0.1s; display: flex; justify-content: space-between;`;

        let targetStart, targetEnd;
        if (opt.type === 'early') {
            targetStart = start;
            targetEnd = addMinutes(start, opt.hours * 60 + (opt.extra || 0));
        } else if (opt.type === 'late') {
            targetStart = addMinutes(end, -(opt.hours * 60 + (opt.extra || 0)));
            targetEnd = end;
        } else {
            targetStart = opt.start;
            targetEnd = opt.end;
        }

        item.innerHTML = `<span>${opt.label}</span><span style="color:var(--neutral-400); font-size:0.7rem;">${targetStart}-${targetEnd}</span>`;
        item.onmouseover = () => item.style.background = 'var(--neutral-50)';
        item.onmouseout = () => item.style.background = 'transparent';
        item.onclick = () => {
            // 時間を渡すのではなく、ルール（種類と時間数）を渡して保存
            addAnnualLeaveCard(dateStr, opt.label.split('（')[0], opt.type, opt.hours, opt.extra || 0);
            menu.remove();
        };
        menu.appendChild(item);
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
        return { ...res, isOverride: true };
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

    const config = workSettings[periodId] ? workSettings[periodId][dayNum] : null;
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
window.getWorkTimeForDate = getWorkTimeForDate;

// 初期化は app.js の loadSequence で明示的に呼び出すため、ここでは行わない
