/**
 * 年間行事予定表アプリ - メインスクリプト
 * Excelファイルから学校の行事予定を読み込み、JSON/ICAL/CSV形式でエクスポート
 */

// =============================
// グローバル変数
// =============================
var scheduleData = [];      // 全スケジュールデータ（キャッシュから生成される現在の統合ビュー）
var scheduleCache = {};     // 年度ごとのスケジュールキャッシュ { 2025: { data: [], timestamp: ... }, ... }
var currentYear = null;     // 現在表示中の年（初期値はデータの最新年度に自動設定）
var currentMonth = 4;       // 現在表示中の月（デフォルト4月：学年開始）
var availableYears = [];    // 利用可能な年度リスト
var availableMonths = [];   // 利用可能な月リスト
var myClasses = [];         // 登録済み授業データ
var classOverrides = [];    // カレンダー操作の記録
var currentCalendarView = 'month'; // 'year', 'month', 'week', 'list'
var yearlyViewMode = 'weekday';   // 'weekday' (曜日カウント) または 'work' (勤務パターン)
var mobileAction = null;          // モバイル用コピー・移動アクション ('copy', 'move', null)
var mobileSourceData = null;      // モバイルアクションの対象データ
var currentWeekBaseDate = null;   // 週表示の基準日（月曜日）

// 学校年度関連定数
const FISCAL_YEAR_START_MONTH = 4;  // 4月開始
const FISCAL_YEAR_END_MONTH = 3;    // 3月終了

/**
 * アプリの表示状態を保存
 */
function saveViewState() {
    const state = {
        view: currentCalendarView,
        year: currentYear,
        month: currentMonth,
        weekBaseDate: currentWeekBaseDate ? currentWeekBaseDate.toISOString() : null,
        yearlyMode: yearlyViewMode,
        targetSelect: document.getElementById('targetSelect')?.value || 'all',
        activeSection: document.querySelector('.drawer-item.active')?.dataset.view || 'calendarView'
    };
    localStorage.setItem('annualScheduleViewState', JSON.stringify(state));
}

/**
 * アプリの表示状態を復元
 */
function loadViewState() {
    try {
        const saved = localStorage.getItem('annualScheduleViewState');
        if (saved) {
            const state = JSON.parse(saved);
            if (state.view) currentCalendarView = state.view;
            if (state.year) currentYear = state.year;
            if (state.month) currentMonth = state.month;
            if (state.weekBaseDate) currentWeekBaseDate = new Date(state.weekBaseDate);
            if (state.yearlyMode) yearlyViewMode = state.yearlyMode;

            // UI反映（初期化後に行う必要があるものは initializeEventListeners 等に分散）
            if (state.targetSelect) {
                const ts = document.getElementById('targetSelect');
                if (ts) ts.value = state.targetSelect;
            }

            // activeSection は initNavigation で復元されるように返り値として扱うか、
            // 既にグローバルへ currentView 的なものがあればそちらへ入れるが、
            // 現状は loadViewState 内で完結させる
            window._initialActiveSection = state.activeSection;

            console.log('表示状態を復元しました:', state);
        }
    } catch (e) {
        console.error('表示状態の復元に失敗しました:', e);
    }
}

/**
 * 日付から年度を取得（4月～3月）
 * 例: 2026年3月 → 2025年度、2026年4月 → 2026年度
 */
function getFiscalYear(date) {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    return month >= FISCAL_YEAR_START_MONTH ? year : year - 1;
}
window.getFiscalYear = getFiscalYear;

/**
 * 年度の開始日を取得
 */
function getFiscalYearStart(fiscalYear) {
    return new Date(fiscalYear, FISCAL_YEAR_START_MONTH - 1, 1);
}

/**
 * 年度の終了日を取得
 */
function getFiscalYearEnd(fiscalYear) {
    return new Date(fiscalYear + 1, FISCAL_YEAR_END_MONTH, 0); // 3月末日
}

// =============================
// 定数定義
// =============================
const SPECIAL_MARKS = {
    '●': '教職員会議',
    '◆': '高専教授会',
    '■': '運営会議',
    '○': 'コース会議(R)',
    '△': '全日休講',
    '□': '一般科目系会議/コース会議(H)',
    '\uD83D\uDD32': '一般科目系会議/コース会議(H)',
    '⬜': '一般科目系会議/コース会議(H)'
};

const MARU_NUM_DICT = {
    '①': '1', '②': '2', '③': '3', '④': '4', '⑤': '5',
    '⑥': '6', '⑦': '7', '⑧': '8', '⑨': '9', '⑩': '10',
    '⑪': '11', '⑫': '12', '⑬': '13', '⑭': '14', '⑮': '15',
    '⑯': '16', '⑰': '17', '⑱': '18', '⑲': '19', '⑳': '20',
    '㉑': '21', '㉒': '22', '㉓': '23', '㉔': '24', '㉕': '25',
    '㉖': '26', '㉗': '27', '㉘': '28', '㉙': '29', '㉚': '30'
};

const TIME_SLOTS = {
    '1': { start: '09:00', end: '10:35', label: '1/2限（1限）' },
    '2': { start: '10:45', end: '12:20', label: '3/4限（2限）' },
    '3': { start: '13:05', end: '14:40', label: '5/6限（3限）' },
    '4': { start: '14:50', end: '16:25', label: '7/8限（4限）' }
};

const PERIOD_TIMES = {
    1: { start: '09:00', end: '10:35' },
    2: { start: '10:45', end: '12:20' },
    3: { start: '13:05', end: '14:40' },
    4: { start: '14:50', end: '16:25' },
    "HR": { start: '14:50', end: '15:35' },
    "after": { start: '16:30', end: '18:00' }
};
window.PERIOD_TIMES = PERIOD_TIMES;

const EXAM_PERIOD_TIMES = {
    1: { start: '09:45', end: '11:15' },
    2: { start: '11:30', end: '13:00' },
    3: { start: '13:50', end: '15:20' },
    4: { start: '15:30', end: '17:00' }
};




// 祝日名のリスト（イベントから除外するため）
const HOLIDAY_NAMES = [
    '元日', '元旦', '成人の日', '建国記念の日', '天皇誕生日', '春分の日', '昭和の日',
    '憲法記念日', 'みどりの日', 'こどもの日', '海の日', '山の日', '敬老の日',
    '秋分の日', 'スポーツの日', '体育の日', '文化の日', '勤労感謝の日',
    '振替休日', '国民の休日'
];

// デフォルトでピン留め（📌）されるキーワードのリスト
const DEFAULT_PINNED_KEYWORDS = [
    '教職員会議',
    'コース会議',
    '体験入学',
    '入試',
    '入学試験',
    '前期中間試験',
    '前期末試験',
    '後期中間試験',
    '学年末試験'
];

/**
 * テキストがデフォルトでピン留めされるキーワードを含むかチェック
 */
function containsPinnedKeyword(text) {
    if (!text) return false;

    // 「入試」が含まれていても、「説明」や「広報」が含まれる場合はデフォルトでピン留めしない
    // （例：入試説明会、入試広報など、準備や当日の試験本体ではない広報的なイベントを想定）
    if (text.includes('📌')) return true;

    return DEFAULT_PINNED_KEYWORDS.some(keyword => text.includes(keyword));
}
window.containsPinnedKeyword = containsPinnedKeyword;

/**
 * イベントに参加しているかどうか（＝ピン留めで表示するかどうか）を判定
 */
function isEventParticipating(ov, dateStr, exclusions) {
    if (!ov) return false;
    const item = ov.data || {};
    const label = item.event || item.name || (ov.original ? (ov.original.event || ov.original.name) : '');

    if (ov.type === 'myclass') {
        const dateExclusions = (exclusions && exclusions[ov.id]) || [];
        return !dateExclusions.includes(dateStr);
    }

    // カスタム予定や申請済み（年休等）はデフォルトで参加（ピン留め）
    if (ov.type === 'custom' || item.isApplied) {
        return item.isParticipating !== undefined ? item.isParticipating : true;
    }

    // Excel行事はキーワードに含まれる場合のみデフォルトで参加（ピン留め）
    return item.isParticipating !== undefined ? item.isParticipating : containsPinnedKeyword(label);
}
window.isEventParticipating = isEventParticipating;

/**
 * イベントテキストが祝日名のみかどうかをチェック
 */
function isHolidayOnlyEvent(eventText) {
    const trimmed = eventText.trim();
    return HOLIDAY_NAMES.some(holiday => trimmed === holiday || trimmed.includes(`(${holiday})`) || trimmed.startsWith(holiday));
}

/**
 * イベントテキストから祝日名を除去
 */
function removeHolidayNames(eventText) {
    let result = eventText;
    HOLIDAY_NAMES.forEach(holiday => {
        // 完全一致の場合
        if (result.trim() === holiday) {
            return '';
        }
        // 括弧付きの場合
        result = result.replace(new RegExp(`\\(${holiday}\\)`, 'g'), '');
        result = result.replace(new RegExp(`（${holiday}）`, 'g'), '');
        // 前方一致で祝日名のみの場合
        if (result.trim().startsWith(holiday) && result.trim().length <= holiday.length + 2) {
            return '';
        }
    });
    return result.trim();
}

// =============================
// 日本の祝日計算
// =============================

/**
 * 春分・秋分の日を計算（1980年～2099年対応）
 */
function calculateEquinox(year, isVernal) {
    // 春分・秋分の日の概算式
    let day;
    if (isVernal) {
        // 春分の日
        day = Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
    } else {
        // 秋分の日
        day = Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
    }
    return day;
}

/**
 * 特定の月の第n週の特定の曜日を取得（ハッピーマンデー用）
 * @param {number} year - 年
 * @param {number} month - 月（1-12）
 * @param {number} week - 第何週か（1-5）
 * @param {number} dayOfWeek - 曜日（0=日曜, 1=月曜, ...）
 */
function getNthWeekday(year, month, week, dayOfWeek) {
    const firstDay = new Date(year, month - 1, 1);
    const firstDayOfWeek = firstDay.getDay();

    // 月初から最初のその曜日までの日数
    let daysUntilFirst = (dayOfWeek - firstDayOfWeek + 7) % 7;
    if (daysUntilFirst === 0 && firstDayOfWeek !== dayOfWeek) {
        daysUntilFirst = 7;
    }

    // 第n週のその曜日の日付
    const targetDay = 1 + daysUntilFirst + (week - 1) * 7;

    return new Date(year, month - 1, targetDay);
}

/**
 * 日本の祝日を取得
 * @param {number} year - 年
 * @returns {Map} キー: 'YYYY-MM-DD', 値: 祝日名
 */
function getJapaneseHolidays(year) {
    const holidays = new Map();

    // 固定祝日
    const fixedHolidays = [
        { month: 1, day: 1, name: '元日' },
        { month: 2, day: 11, name: '建国記念の日' },
        { month: 2, day: 23, name: '天皇誕生日', startYear: 2020 },
        { month: 4, day: 29, name: '昭和の日' },
        { month: 5, day: 3, name: '憲法記念日' },
        { month: 5, day: 4, name: 'みどりの日' },
        { month: 5, day: 5, name: 'こどもの日' },
        { month: 8, day: 11, name: '山の日', startYear: 2016 },
        { month: 11, day: 3, name: '文化の日' },
        { month: 11, day: 23, name: '勤労感謝の日' }
    ];

    fixedHolidays.forEach(h => {
        if (!h.startYear || year >= h.startYear) {
            const date = new Date(year, h.month - 1, h.day);
            const key = formatDateKey(date);
            holidays.set(key, h.name);
        }
    });

    // ハッピーマンデー（第n月曜日）
    const happyMondays = [
        { month: 1, week: 2, name: '成人の日' },
        { month: 7, week: 3, name: '海の日' },
        { month: 9, week: 3, name: '敬老の日' },
        { month: 10, week: 2, name: 'スポーツの日' }
    ];

    happyMondays.forEach(h => {
        const date = getNthWeekday(year, h.month, h.week, 1); // 1 = 月曜日
        const key = formatDateKey(date);
        holidays.set(key, h.name);
    });

    // 春分の日・秋分の日
    const vernalDay = calculateEquinox(year, true);
    const autumnalDay = calculateEquinox(year, false);

    const vernalDate = new Date(year, 2, vernalDay); // 3月（月は0始まり）
    const autumnalDate = new Date(year, 8, autumnalDay); // 9月

    holidays.set(formatDateKey(vernalDate), '春分の日');
    holidays.set(formatDateKey(autumnalDate), '秋分の日');

    // 振替休日の計算
    const substituteHolidays = new Map();
    holidays.forEach((name, dateKey) => {
        const date = new Date(dateKey);
        // 日曜日の祝日の場合、翌日が振替休日
        if (date.getDay() === 0) {
            let nextDay = new Date(date);
            nextDay.setDate(nextDay.getDate() + 1);

            // 翌日も祝日の場合は、祝日でない日まで繰り越し
            while (holidays.has(formatDateKey(nextDay))) {
                nextDay.setDate(nextDay.getDate() + 1);
            }

            substituteHolidays.set(formatDateKey(nextDay), '振替休日');
        }
    });

    // 振替休日を追加
    substituteHolidays.forEach((name, dateKey) => {
        holidays.set(dateKey, name);
    });

    // 国民の休日（祝日に挟まれた平日）
    const sortedKeys = Array.from(holidays.keys()).sort();
    const citizenHolidays = new Map();

    for (let i = 0; i < sortedKeys.length - 1; i++) {
        const date1 = new Date(sortedKeys[i]);
        const date2 = new Date(sortedKeys[i + 1]);

        const diffDays = Math.floor((date2 - date1) / (1000 * 60 * 60 * 24));

        // 2日空いている場合（祝日の間が1日）
        if (diffDays === 2) {
            const middleDate = new Date(date1);
            middleDate.setDate(middleDate.getDate() + 1);

            // 日曜日でない場合のみ国民の休日
            if (middleDate.getDay() !== 0) {
                citizenHolidays.set(formatDateKey(middleDate), '国民の休日');
            }
        }
    }

    // 国民の休日を追加
    citizenHolidays.forEach((name, dateKey) => {
        holidays.set(dateKey, name);
    });

    return holidays;
}

/**
 * 日付をキー形式（YYYY-MM-DD）にフォーマット
 */
function formatDateKey(date) {
    if (!date) return "";
    const d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return "";
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
window.formatDateKey = formatDateKey;

/**
 * 日付キー形式（YYYY-MM-DD）をDateオブジェクトに変換
 */
function parseDateKey(dateStr) {
    if (!dateStr) return new Date();
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
}
window.parseDateKey = parseDateKey;

/**
 * 指定された日付が祝日かどうかをチェック
 */
function isHoliday(date, holidaysMap) {
    const key = formatDateKey(date);
    return holidaysMap.has(key);
}

/**
 * 祝日名を取得
 */
function getHolidayName(date, holidaysMap) {
    const key = formatDateKey(date);
    return holidaysMap.get(key) || null;
}
window.getHolidayName = getHolidayName;

// 祝日キャッシュ（年度ごとにキャッシュ）
const holidayCache = new Map();

/**
 * 祝日マップを取得（キャッシュ付き）
 */
function getHolidaysForYear(year) {
    if (!holidayCache.has(year)) {
        holidayCache.set(year, getJapaneseHolidays(year));
    }
    return holidayCache.get(year);
}
window.getHolidaysForYear = getHolidaysForYear;

/**
 * 祝日冗長チェック関数（グローバル）
 * イベント名が祝日名に関連する冗長なものか判定
 */
function isRedundantHoliday(eventText, date) {
    if (!eventText || !date) return false;
    const d = (date instanceof Date) ? date : new Date(date);
    if (isNaN(d.getTime())) return false;

    const holidaysMap = getHolidaysForYear(d.getFullYear());
    const hName = getHolidayName(d, holidaysMap);
    if (!hName) return false;

    const ev = eventText.trim();
    const hn = hName.trim();

    return ev === hn || ev === '祝日' || ev === '休日' ||
        ev.includes('(祝)') || ev.includes('（祝）') || ev.includes('【祝】') ||
        ev.includes(hn) ||
        (hn === '建国記念の日' && ev === '建国記念日') ||
        (hn === 'スポーツの日' && ev === '体育の日') ||
        (hn === '体育の日' && ev === 'スポーツの日') ||
        (hn === '元日' && (ev.includes('元旦') || ev === '元日')) ||
        (hn === '振替休日' && ev.includes('振替休日'));
}
window.isRedundantHoliday = isRedundantHoliday;

// =============================
// 初期化
// =============================
document.addEventListener('DOMContentLoaded', () => {
    // 授業データの読み込み（my_classes.jsにある場合は先に読み込む）
    // 授業データの読み込み（my_classes.jsで管理されるが、念のためここでも確認）
    // if (typeof loadMyClasses === 'function') {
    //     loadMyClasses();
    // }
    loadScheduleData(); // 保存されたデータを読み込み
    loadViewState();    // 表示状態の復元
    initNavigation();
    if (typeof initializeMyClasses === 'function') {
        initializeMyClasses();
    }
    initializeEventListeners();

    // バックアップ復元用のインプットを追加（動的）
    const backupFileInput = document.createElement('input');
    backupFileInput.type = 'file';
    backupFileInput.id = 'backupFileInput';
    backupFileInput.className = 'hidden';
    backupFileInput.accept = '.json';
    backupFileInput.onchange = restoreFromBackup;
    document.body.appendChild(backupFileInput);

    // 勤務設定の初期化（カレンダー描画前に確実にロード）
    if (typeof initWorkSettings === 'function') {
        initWorkSettings();
    }

    // 初回表示のために必ず一度年度リストを更新
    updateAvailableYearsAndMonths();
    updateBackupInfo(); // バックアップ情報の初期表示

    // 1分ごとに現在時刻の線を更新（週表示用）
    setInterval(() => {
        if (currentCalendarView === 'week') {
            const todayStr = formatDateKey(new Date());
            if (currentWeekBaseDate) {
                const startDay = new Date(currentWeekBaseDate);
                const endDay = new Date(startDay);
                endDay.setDate(startDay.getDate() + 6);
                const weekStartStr = formatDateKey(startDay);
                const weekEndStr = formatDateKey(endDay);
                if (todayStr >= weekStartStr && todayStr <= weekEndStr) {
                    updateCalendar();
                }
            }
        }
    }, 60000);
});


/**
 * バックアップ情報の表示更新
 */
function updateBackupInfo() {
    const lastBackupTime = localStorage.getItem('lastBackupTime') || '未保存';
    const lastTimeEl = document.getElementById('lastBackupTime');
    if (lastTimeEl) lastTimeEl.textContent = lastBackupTime;

    const scheduleCountEl = document.getElementById('scheduleCountInfo');
    if (scheduleCountEl) scheduleCountEl.textContent = `${scheduleData.length}件`;

    const classesCountEl = document.getElementById('classesCountInfo');
    if (classesCountEl) classesCountEl.textContent = `${myClasses.length}件`;
}

/**
 * 年休をカレンダーに登録
 */
function downloadSelectiveBackup() {
    const type = document.getElementById('backupTypeSelect').value;
    const backupData = {};

    if (type === 'all' || type === 'schedule') {
        backupData.scheduleCache = scheduleCache;
    }
    if (type === 'all' || type === 'classes') {
        backupData.myClasses = myClasses;
        backupData.classOverrides = classOverrides;
        // assignmentExclusionsも保存対象に含める
        try {
            backupData.assignmentExclusions = JSON.parse(localStorage.getItem('assignmentExclusions') || '{}');
        } catch (e) { backupData.assignmentExclusions = {}; }
    }
    if (type === 'all' || type === 'settings') {
        try {
            backupData.teacherMaster = JSON.parse(localStorage.getItem('teacherMaster') || '[]');
            backupData.courseMaster = JSON.parse(localStorage.getItem('courseMaster') || '[]');
            backupData.workSettings = JSON.parse(localStorage.getItem('workSettings') || '{}');
            backupData.workOverrides = JSON.parse(localStorage.getItem('workOverrides') || '{}');
        } catch (e) {
            backupData.teacherMaster = [];
            backupData.courseMaster = [];
            backupData.workSettings = {};
            backupData.workOverrides = {};
        }
    }

    backupData.timestamp = new Date().toISOString();
    backupData.backupType = type;

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_${type}_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);

    localStorage.setItem('lastBackupTime', new Date().toLocaleString());
    updateBackupInfo();
}
window.downloadSelectiveBackup = downloadSelectiveBackup;

/**
 * 旧形式のバックアップダウンロード（互換性用）
 */
function downloadBackup() {
    // 全データバックアップとして動作
    const typeSelect = document.getElementById('backupTypeSelect');
    if (typeSelect) typeSelect.value = 'all';
    downloadSelectiveBackup();
}
window.downloadBackup = downloadBackup;

/**
 * バックアップから復元
 */
/**
 * バックアップから復元
 */
async function restoreFromBackup(e) {
    const file = e.target.files[0];
    if (!file) return;

    const restoreType = document.getElementById('restoreTypeSelect') ? document.getElementById('restoreTypeSelect').value : 'all';

    try {
        const text = await file.text();
        const data = JSON.parse(text);

        if (!confirm('データを復元しますか？（現在のデータは上書き・変更されます）')) {
            e.target.value = '';
            return;
        }

        let restartNeeded = false;

        // スケジュールの復元（新形式: scheduleCache または 旧形式: scheduleData）
        if ((data.scheduleCache || data.scheduleData) && (restoreType === 'all' || restoreType === 'schedule' || restoreType === 'merge')) {
            if (data.scheduleCache) {
                if (restoreType === 'merge') {
                    scheduleCache = { ...scheduleCache, ...data.scheduleCache };
                } else {
                    scheduleCache = data.scheduleCache;
                }
            } else if (data.scheduleData) {
                // 旧形式からの移行: 単一の年度としてキャッシュに入れる
                const restoredData = data.scheduleData.map(item => ({
                    ...item,
                    date: new Date(item.date)
                }));
                if (restoredData.length > 0) {
                    const year = getFiscalYear(restoredData[0].date);
                    scheduleCache[year] = {
                        data: restoredData,
                        fileName: data.fileName || '復元データ',
                        timestamp: Date.now()
                    };
                }
            }

            saveScheduleToStorage();
            rebuildScheduleDataFromCache();
            restartNeeded = true;
        }

        // 授業・予定操作データの復元
        if ((data.myClasses || data.classOverrides) && (restoreType === 'all' || restoreType === 'classes' || restoreType === 'merge')) {
            if (restoreType === 'merge') {
                if (data.myClasses) {
                    data.myClasses.forEach(newCls => {
                        const idx = myClasses.findIndex(c => String(c.id) === String(newCls.id));
                        if (idx !== -1) myClasses[idx] = newCls;
                        else myClasses.push(newCls);
                    });
                }
                if (data.classOverrides) {
                    data.classOverrides.forEach(newOv => {
                        // type, id, date, action, period が一致するものを重複とみなす
                        const idx = classOverrides.findIndex(ov =>
                            String(ov.id) === String(newOv.id) &&
                            ov.date === newOv.date &&
                            ov.type === newOv.type &&
                            ov.action === newOv.action &&
                            ov.period === newOv.period
                        );
                        if (idx !== -1) classOverrides[idx] = newOv;
                        else classOverrides.push(newOv);
                    });
                }
            } else {
                if (data.myClasses) myClasses = data.myClasses;
                if (data.classOverrides) classOverrides = data.classOverrides;
            }

            // 除外リストの復元
            if (data.assignmentExclusions) {
                let currentExclusions = {};
                try {
                    currentExclusions = JSON.parse(localStorage.getItem('assignmentExclusions') || '{}');
                } catch (e) { }

                if (restoreType === 'merge') {
                    // マージ処理
                    Object.keys(data.assignmentExclusions).forEach(id => {
                        if (!currentExclusions[id]) currentExclusions[id] = [];
                        currentExclusions[id] = [...new Set([...currentExclusions[id], ...data.assignmentExclusions[id]])];
                    });
                } else {
                    currentExclusions = data.assignmentExclusions;
                }
                localStorage.setItem('assignmentExclusions', JSON.stringify(currentExclusions));
            }

            saveMyClasses();
            restartNeeded = true;
        }

        // 設定の復元
        if ((data.teacherMaster || data.courseMaster || data.workSettings) && (restoreType === 'all' || restoreType === 'settings' || restoreType === 'merge')) {
            if (data.teacherMaster) localStorage.setItem('teacherMaster', JSON.stringify(data.teacherMaster));
            if (data.courseMaster) localStorage.setItem('courseMaster', JSON.stringify(data.courseMaster));
            if (data.workSettings) localStorage.setItem('workSettings', JSON.stringify(data.workSettings));
            if (data.workOverrides) {
                if (restoreType === 'merge') {
                    let currentWorkOv = {};
                    try { currentWorkOv = JSON.parse(localStorage.getItem('workOverrides') || '{}'); } catch (e) { }
                    const mergedWorkOv = { ...currentWorkOv, ...data.workOverrides };
                    localStorage.setItem('workOverrides', JSON.stringify(mergedWorkOv));
                } else {
                    localStorage.setItem('workOverrides', JSON.stringify(data.workOverrides));
                }
            }
            restartNeeded = true;
        }

        if (restartNeeded) {
            alert('復元が完了しました。ページを再読み込みします。');
            location.reload();
        } else {
            alert('復元対象のデータが見つかりませんでした。');
        }
    } catch (err) {
        console.error('Restore error:', err);
        alert('ファイルの読み込みに失敗しました: ' + err.message);
    }
    e.target.value = ''; // リセット
}
window.restoreFromBackup = restoreFromBackup;

/**
 * scheduleDataをlocalStorageに保存
 */
function saveScheduleData(fileName = null) {
    try {
        const metadata = {
            fileName: fileName || document.getElementById('fileName').textContent,
            importDate: new Date().toISOString(),
            scheduleData: scheduleData
        };
        localStorage.setItem('cachedScheduleData', JSON.stringify(metadata));
        console.log('スケジュールデータを保存しました');
    } catch (e) {
        console.error('スケジュールデータの保存に失敗しました:', e);
    }
}

/**
 * localStorageからscheduleDataを読み込み
 */
/**
 * localStorageからscheduleData（キャッシュ）を読み込み
 */
function loadScheduleData() {
    try {
        const cached = localStorage.getItem('cachedScheduleData');
        if (cached) {
            const parsed = JSON.parse(cached);

            // 互換性チェック（古い形式なら配列、新しい形式ならオブジェクト）
            if (Array.isArray(parsed) || (parsed.scheduleData && Array.isArray(parsed.scheduleData))) {
                // 古い形式: 1つの年度データとして扱う（年度を推定）
                console.log('旧形式のキャッシュデータを検出しました。移行します。');
                const oldData = Array.isArray(parsed) ? parsed : parsed.scheduleData;
                const fileName = parsed.fileName || '以前インポートしたデータ';

                // データの日付文字列をDateに戻す
                const restoredData = oldData.map(item => {
                    item.date = new Date(item.date);
                    return item;
                });

                if (restoredData.length > 0) {
                    // 年度を推定（データの最初の要素から）
                    const year = getFiscalYear(restoredData[0].date);
                    scheduleCache = {
                        [year]: {
                            data: restoredData,
                            fileName: fileName,
                            timestamp: Date.now()
                        }
                    };
                }
            } else {
                // 新しい形式: { year: { data: [], ... } }
                scheduleCache = parsed;
                // 日付文字列をDateオブジェクトに戻す
                Object.keys(scheduleCache).forEach(year => {
                    if (scheduleCache[year] && scheduleCache[year].data) {
                        scheduleCache[year].data = scheduleCache[year].data.map(item => {
                            item.date = new Date(item.date);
                            return item;
                        });
                    }
                });
            }

            // キャッシュから統合データを生成
            rebuildScheduleDataFromCache();

            console.log(`${scheduleData.length}件のキャッシュデータを読み込みました`);

            if (scheduleData.length > 0) {
                updateAvailableYearsAndMonths();
                updateStats();
                updateCalendar();

                // UI復元
                const exportSection = document.getElementById('exportSection');
                if (exportSection) exportSection.classList.remove('hidden');

                // 最新のファイル名を表示 (直近の年度のもの)
                const years = Object.keys(scheduleCache).sort().reverse();
                if (years.length > 0) {
                    const latest = scheduleCache[years[0]];
                    document.getElementById('fileName').textContent = `${latest.fileName} (他 ${years.length - 1}件)`;
                    document.getElementById('fileSize').textContent = '(キャッシュ読み込み)';
                    document.getElementById('fileSelected').classList.remove('hidden');
                }
            }
            // 読み込み済み年度リストを表示
            renderCachedYearList();
        }
    } catch (e) {
        console.error('キャッシュデータの読み込みに失敗しました:', e);
        // エラー時は初期化
        scheduleCache = {};
        scheduleData = [];
    }
}

function rebuildScheduleDataFromCache() {
    let combined = [];
    Object.keys(scheduleCache).forEach(year => {
        if (scheduleCache[year] && scheduleCache[year].data) {
            combined = combined.concat(scheduleCache[year].data);
        }
    });

    scheduleData = combined;

    // 授業データを統合（my_classes.js の関数）
    if (typeof updateScheduleDataWithClasses === 'function') {
        updateScheduleDataWithClasses(currentYear);
    }

    updateAvailableYearsAndMonths();
    updateStats();
    saveScheduleToStorage();
}


/**
 * キャッシュをlocalStorageに保存
 */
function saveScheduleToStorage() {
    try {
        localStorage.setItem('cachedScheduleData', JSON.stringify(scheduleCache));
    } catch (e) {
        console.error('キャッシュの保存に失敗しました（容量オーバーの可能性があります）:', e);
    }
}

/**
 * 指定された年度のキャッシュデータを削除
 */
function deleteCachedYear(year) {
    if (!scheduleCache[year]) return;

    if (!confirm(`${year}年度のデータを削除しますか？`)) return;

    delete scheduleCache[year];
    saveScheduleToStorage();

    // データを再構築
    rebuildScheduleDataFromCache();
    updateAvailableYearsAndMonths();
    updateStats();
    updateCalendar();

    // リスト更新
    renderCachedYearList();

    // もし現在の年度を削除した場合は、利用可能な最新年度に切り替える
    if (currentYear === year) {
        if (availableYears.length > 0) {
            const fiscalYear = availableYears[0];
            currentYear = (currentMonth <= 3) ? fiscalYear + 1 : fiscalYear;
            const yearSelect = document.getElementById('globalYearSelect');
            if (yearSelect) yearSelect.value = fiscalYear;
            updateCalendar();
        } else {
            // データがなくなった場合
            scheduleData = [];
            updateCalendar();
        }
    }

    alert(`${year}年度のデータを削除しました。`);
}
window.deleteCachedYear = deleteCachedYear;

/**
 * 読み込み済み年度リストを表示（管理用）
 */
// 旧表示用関数は削除

/**
 * インポートした全てのデータを完全に削除（初期状態に戻す）
 */
function clearScheduleData() {
    if (!confirm('全てのデータ（インポートした行事、独自の授業登録、ピン留め設定など）を完全に削除しますか？\nこの操作は取り消せません。')) return;

    // 1. 各種データ構造をリセット
    scheduleCache = {};
    scheduleData = [];
    myClasses = [];
    classOverrides = [];

    // assignments / exclusions などの個別設定もリセット
    const assignmentExclusions = {};
    localStorage.setItem('assignmentExclusions', JSON.stringify(assignmentExclusions));

    // 2. localStorage から各キーを削除または空にする
    localStorage.removeItem('cachedScheduleData');
    localStorage.removeItem('myClasses');
    localStorage.removeItem('classOverrides');
    localStorage.removeItem('teacherMaster'); // 必要あればマスタもリセット
    localStorage.removeItem('courseMaster');

    // 3. UIの更新
    saveAllToLocal(); // 空になった myClasses, classOverrides を保存
    saveScheduleToStorage(); // 空になった scheduleCache を保存
    rebuildScheduleDataFromCache(); // scheduleData を空にする

    updateAvailableYearsAndMonths();
    updateStats();
    updateCalendar();

    if (typeof renderMyClassesList === 'function') renderMyClassesList();
    if (typeof renderCachedYearList === 'function') renderCachedYearList();

    // 画面表示制御のリセット
    // controlsSection (ファイルの読み込みエリア) は隠さない
    const sections = ['calendarSection', 'myClassesSection', 'exportSection', 'fileSelected', 'cachedYearsContainer'];
    sections.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
    });

    alert('全てのデータを消去しました。');
}
window.clearScheduleData = clearScheduleData;

// =============================
// ナビゲーション
// =============================
/**
 * サイドドロワー（ハンバーガーメニュー）の初期化
 */
function initSideDrawer() {
    const menuBtn = document.getElementById('menuToggleBtn');
    const closeBtn = document.getElementById('closeDrawerBtn');
    const drawer = document.getElementById('sideDrawer');
    const overlay = document.getElementById('drawerOverlay');

    if (!menuBtn || !drawer || !overlay) return;

    menuBtn.addEventListener('click', () => {
        drawer.classList.add('open');
        overlay.classList.add('visible');
    });

    const closeDrawer = () => {
        drawer.classList.remove('open');
        overlay.classList.remove('visible');
    };

    if (closeBtn) closeBtn.addEventListener('click', closeDrawer);
    if (overlay) overlay.addEventListener('click', closeDrawer);

    // ドロワー内のアイテムクリックで閉じる
    drawer.querySelectorAll('.drawer-item').forEach(item => {
        item.addEventListener('click', closeDrawer);
    });
}

/**
 * ナビゲーション（表示切り替え）の初期化
 */
function initNavigation() {
    const drawerItems = document.querySelectorAll('.drawer-item');
    const sections = {
        'calendarView': document.getElementById('calendarView'),
        'importContainer': document.getElementById('importContainer'),
        'exportSection': document.getElementById('exportSection'),
        'myClassesSection': document.getElementById('myClassesSection'),
        'settingsSection': document.getElementById('settingsSection'),
        'workSection': document.getElementById('workSection'),
        'statsView': document.getElementById('statsView'),
        'profileSection': document.getElementById('profileSection'),
        'helpSection': document.getElementById('helpSection')
    };

    function setActiveTab(targetId) {
        // 全てのアイテムのactiveを外す
        drawerItems.forEach(item => item.classList.remove('active'));

        // ターゲットをactiveにする
        const activeItem = Array.from(drawerItems).find(item => item.dataset.view === targetId);
        if (activeItem) activeItem.classList.add('active');

        // 全てのセクションを隠す
        Object.values(sections).forEach(section => {
            if (section) {
                section.classList.add('hidden');
                section.style.display = ''; // styleによる強制表示をリセット
            }
        });

        // ターゲットセクションを表示
        const targetSection = sections[targetId];
        if (targetSection) {
            targetSection.classList.remove('hidden');

            // 特殊処理
            if (targetId === 'settingsSection') {
                if (typeof renderManageTeachers === 'function') renderManageTeachers();
                if (typeof renderManageCourses === 'function') renderManageCourses();
            } else if (targetId === 'workSection') {
                if (typeof renderWorkPeriodConfig === 'function') renderWorkPeriodConfig();
            } else if (targetId === 'statsView') {
                if (typeof renderApplicationStats === 'function') renderApplicationStats();
            } else if (targetId === 'exportSection') {
                updateExportDatesByFiscalYear(currentYear);
            }
        }
        saveViewState();
    }

    /**
     * 年度に合わせてエクスポート期間のデフォルト値を設定
     */
    function updateExportDatesByFiscalYear(year) {
        if (!year) return;
        const start = `${year}-04-01`;
        const end = `${year + 1}-03-31`;
        const startInput = document.getElementById('exportStartDate');
        const endInput = document.getElementById('exportEndDate');
        if (startInput) startInput.value = start;
        if (endInput) endInput.value = end;
    }

    // イベントリスナー設定
    drawerItems.forEach(item => {
        item.addEventListener('click', () => {
            const targetId = item.dataset.view;
            setActiveTab(targetId);
        });
    });

    // ドロワーの開閉初期化
    initSideDrawer();

    // 初期表示
    const initialView = window._initialActiveSection || 'calendarView';
    setActiveTab(initialView);
}

function initializeEventListeners() {
    const fileInput = document.getElementById('fileInput');
    const uploadArea = document.getElementById('uploadArea');

    // ファイル選択
    uploadArea.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', handleFileSelect);

    // ドラッグ&ドロップ
    uploadArea.addEventListener('dragover', handleDragOver);
    uploadArea.addEventListener('dragleave', handleDragLeave);
    uploadArea.addEventListener('drop', handleDrop);

    // カレンダー操作
    document.getElementById('prevMonthBtn').addEventListener('click', () => changeMonth(-1));
    document.getElementById('nextMonthBtn').addEventListener('click', () => changeMonth(1));

    const todayBtn = document.getElementById('todayBtn');
    if (todayBtn) {
        todayBtn.addEventListener('click', () => {
            const today = new Date();
            const fiscalYear = getFiscalYear(today);
            currentYear = today.getFullYear();
            currentMonth = today.getMonth() + 1;

            const yearSelect = document.getElementById('globalYearSelect');
            if (yearSelect) yearSelect.value = fiscalYear;
            const monthSelect = document.getElementById('monthSelect');
            if (monthSelect) monthSelect.value = currentMonth;

            // 週表示の場合、今日を含む週の月曜日に移動
            if (currentCalendarView === 'week') {
                const day = today.getDay(); // 0:Sun, 1:Mon
                const diff = (day === 0) ? 6 : day - 1; // Mon=0, Sun=6
                currentWeekBaseDate = new Date(today);
                currentWeekBaseDate.setDate(today.getDate() - diff);
            }

            saveViewState();
            updateCalendar();
        });
    }

    // 表示切り替えボタン
    document.getElementById('viewYearBtn').addEventListener('click', () => changeCalendarView('year'));
    document.getElementById('viewMonthBtn').addEventListener('click', () => changeCalendarView('month'));
    document.getElementById('viewWeekBtn').addEventListener('click', () => changeCalendarView('week'));
    document.getElementById('viewListBtn').addEventListener('click', () => changeCalendarView('list'));

    // カレンダーショートカット
    const shortcutBtn = document.getElementById('viewCalendarShortcutBtn');
    if (shortcutBtn) {
        shortcutBtn.addEventListener('click', () => {
            const calendarItem = document.querySelector('.drawer-item[data-view="calendarView"]');
            if (calendarItem) calendarItem.click();
        });
    }
}

/**
 * カレンダー表示形式の切り替え
 */
function changeCalendarView(viewType) {
    if (viewType === 'week' && currentCalendarView !== 'week') {
        currentWeekBaseDate = null; // 週表示に切り替えたときは初期化（現在の月から計算）
    }
    currentCalendarView = viewType;

    // ボタンのactive状態を更新
    document.querySelectorAll('.view-btn').forEach(btn => btn.classList.remove('active'));
    if (viewType === 'year') document.getElementById('viewYearBtn').classList.add('active');
    if (viewType === 'month') document.getElementById('viewMonthBtn').classList.add('active');
    if (viewType === 'week') document.getElementById('viewWeekBtn').classList.add('active');
    if (viewType === 'list') document.getElementById('viewListBtn').classList.add('active');

    // グリッドのスタイルクラスを更新
    const calendarGrid = document.getElementById('calendarGrid');
    calendarGrid.className = 'calendar-grid view-' + viewType;

    // 凡例の表示・非表示制御（年間表示では情報の密度を下げるため凡例のみにする等のため）
    const legend = document.querySelector('.calendar-legend');
    if (legend) {
        // 必要に応じて凡例の表示を調整できる
    }

    saveViewState();
    updateCalendar();
}
window.changeCalendarView = changeCalendarView;

// コントロール変更
const targetSelect = document.getElementById('targetSelect');
if (targetSelect) {
    targetSelect.addEventListener('change', () => {
        saveViewState();
        updateCalendar();
    });
}

const globalYearSelect = document.getElementById('globalYearSelect');
if (globalYearSelect) {
    globalYearSelect.addEventListener('change', (e) => {
        const fiscalYear = parseInt(e.target.value);
        currentYear = (currentMonth <= 3) ? fiscalYear + 1 : fiscalYear;

        // エクスポート期間のデフォルト値を更新
        const startInput = document.getElementById('exportStartDate');
        const endInput = document.getElementById('exportEndDate');
        if (startInput) startInput.value = `${fiscalYear}-04-01`;
        if (endInput) endInput.value = `${fiscalYear + 1}-03-31`;

        // 授業データの再生成を予約
        if (typeof updateScheduleDataWithClasses === 'function') {
            updateScheduleDataWithClasses(fiscalYear);
        }

        saveViewState();
        updateCalendar();
        if (typeof renderMyClassesList === 'function') renderMyClassesList();
        if (typeof renderTimetable === 'function') renderTimetable();
        if (typeof updateClassYearOptions === 'function') updateClassYearOptions();
        if (typeof renderApplicationStats === 'function') renderApplicationStats();
        if (typeof renderWorkPeriodConfig === 'function') renderWorkPeriodConfig();
        if (typeof ensureWorkSettingsYear === 'function') ensureWorkSettingsYear(fiscalYear);
    });
}

document.getElementById('monthSelect').addEventListener('change', (e) => {
    currentMonth = parseInt(e.target.value);
    // 年度選択（Academic Year）との整合性を確保
    // 1-3月が選ばれた場合は、選択されている年度（4月開始）の翌年を表示年とする
    const ys = document.getElementById('globalYearSelect');
    if (ys && ys.value) {
        const fiscalYear = parseInt(ys.value);
        currentYear = (currentMonth <= 3) ? fiscalYear + 1 : fiscalYear;
    }

    // 週表示の場合、その月の第1週（1日を含む週）に移動
    if (currentCalendarView === 'week') {
        const firstOfMonth = new Date(currentYear, currentMonth - 1, 1);
        const day = firstOfMonth.getDay(); // 0:Sun, 1:Mon
        const diff = (day === 0) ? 6 : day - 1; // Monを起点(0)とするオフセット
        currentWeekBaseDate = new Date(firstOfMonth);
        currentWeekBaseDate.setDate(firstOfMonth.getDate() - diff);
    }

    saveViewState();
    updateCalendar();
});

// エクスポートボタン
document.getElementById('exportJsonBtn').addEventListener('click', exportToJson);
document.getElementById('exportIcalBtn').addEventListener('click', exportToIcal);
document.getElementById('exportCsvBtn').addEventListener('click', exportToCsv);

// 既存関数の修正 (app.jsの後半にある可能性があるが、一旦ここで changeMonth を上書き定義)
window.changeMonth = function (delta) {
    if (currentCalendarView === 'week') {
        // 週表示の場合は1週間スライド
        if (!currentWeekBaseDate) {
            // 未設定の場合は現在の月から計算
            const firstOfMonth = new Date(currentYear, currentMonth - 1, 1);
            const offset = (firstOfMonth.getDay() === 0) ? 6 : firstOfMonth.getDay() - 1;
            currentWeekBaseDate = new Date(firstOfMonth);
            currentWeekBaseDate.setDate(currentWeekBaseDate.getDate() - offset);
        }
        currentWeekBaseDate.setDate(currentWeekBaseDate.getDate() + (delta * 7));

        // 表示月を更新（週の真ん中の木曜日基準などで判定）
        const checkDate = new Date(currentWeekBaseDate);
        checkDate.setDate(checkDate.getDate() + 3);
        currentYear = checkDate.getFullYear();
        currentMonth = checkDate.getMonth() + 1;
    } else {
        // 通常の月移動
        currentMonth += delta;
        if (currentMonth > 12) {
            currentMonth = 1;
            currentYear++;
        } else if (currentMonth < 1) {
            currentMonth = 12;
            currentYear--;
        }
    }
    const ys = document.getElementById('globalYearSelect'); // 修正: idを globalYearSelect に
    const ms = document.getElementById('monthSelect');
    if (ys) {
        // カレンダー年と年度の乖離を考慮し、選択肢に含まれる場合はセット
        const fiscalYear = (currentMonth <= 3) ? currentYear - 1 : currentYear;
        // 存在する値かチェックしてから代入
        if (Array.from(ys.options).some(opt => opt.value == fiscalYear)) {
            ys.value = fiscalYear;
        }
    }
    if (ms) ms.value = currentMonth;
    saveViewState();
    updateCalendar();
};

// =============================
// ファイル処理
// =============================
function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.add('drag-over');
}

function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('drag-over');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
        processFile(files[0]);
    }
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
        processFile(file);
    }
}

async function processFile(file) {
    showLoading(true);

    try {
        // ファイル情報表示
        document.getElementById('fileName').textContent = file.name;
        document.getElementById('fileSize').textContent = `(${(file.size / 1024).toFixed(1)} KB)`;
        document.getElementById('fileSelected').classList.remove('hidden');

        // Excelファイル読み込み
        const workbook = await readExcelFile(file);

        // データを解析
        console.log('データを解析中...');
        const newScheduleData = parseScheduleData(workbook);

        if (newScheduleData.length === 0) {
            throw new Error('有効なデータが見つかりませんでした。前期・後期シートがあるか確認してください。');
        }

        // 年度ごとにキャッシュを更新
        // 解析されたデータの年度を確認して、年度ごとにグループ化
        const groupedData = {};
        newScheduleData.forEach(item => {
            const fy = getFiscalYear(item.date);
            if (!groupedData[fy]) groupedData[fy] = [];
            groupedData[fy].push(item);
        });

        let updatedYears = [];
        Object.keys(groupedData).forEach(year => {
            scheduleCache[year] = {
                data: groupedData[year],
                fileName: file.name,
                timestamp: Date.now()
            };
            updatedYears.push(year);
        });

        // 統合データを再構築
        rebuildScheduleDataFromCache();

        updateAvailableYearsAndMonths();
        updateStats();

        // 表示年度を読み込んだデータの最新年度に合わせる
        updatedYears.sort((a, b) => parseInt(a) - parseInt(b));
        if (updatedYears.length > 0) {
            const fiscalYear = parseInt(updatedYears[updatedYears.length - 1]);
            currentYear = (currentMonth <= 3) ? fiscalYear + 1 : fiscalYear;
        }

        updateCalendar();

        // 授業イベント再生成（年度が変わった場合に対応）
        if (typeof generateClassEvents === 'function') {
            generateClassEvents(currentYear);
        }

        document.getElementById('fileName').textContent = `${file.name} (他含め計${Object.keys(scheduleCache).length}年度分)`;

        // 保存（localStorageの容量制限に注意）
        saveScheduleToStorage();

        // デバッグ: 曜日別統計
        const weekdayStats = {};
        const weekdayNames = ['日', '月', '火', '水', '木', '金', '土'];
        scheduleData.forEach(item => {
            const dayOfWeek = item.date.getDay();
            const weekdayName = weekdayNames[dayOfWeek];
            if (!weekdayStats[weekdayName]) {
                weekdayStats[weekdayName] = { total: 0, withCount: 0 };
            }
            weekdayStats[weekdayName].total++;
            if (item.weekdayCount) {
                weekdayStats[weekdayName].withCount++;
            }
        });
        console.log('=== 曜日別統計 ===');
        console.table(weekdayStats);

        // セクション表示
        const exportSection = document.getElementById('exportSection');
        if (exportSection) exportSection.classList.remove('hidden');

        showLoading(false);
    } catch (error) {
        console.error('ファイル処理エラー:', error);
        alert('ファイルの読み込みに失敗しました: ' + error.message);
        showLoading(false);
    }
}

function readExcelFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                resolve(workbook);
            } catch (error) {
                reject(error);
            }
        };

        reader.onerror = () => reject(new Error('ファイル読み込みエラー'));
        reader.readAsArrayBuffer(file);
    });
}

// =============================
// データ解析
// =============================
function parseScheduleData(workbook) {
    const allData = [];

    workbook.SheetNames.forEach(sheetName => {
        // 前期・後期シートのみ処理
        if (!sheetName.includes('前期') && !sheetName.includes('後期')) {
            return;
        }

        const sheet = workbook.Sheets[sheetName];
        const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        if (rawData.length === 0) return;

        // 年度を取得 (H列の1行目)
        const year = parseInt(rawData[0][7]) || new Date().getFullYear();
        const period = sheetName.includes('前期') ? '前期' : '後期';

        // 月リスト
        const months = period === '前期'
            ? [4, 5, 6, 7, 8, 9]
            : [10, 11, 12, 1, 2, 3];

        // 各月のデータを解析
        months.forEach((month, monthIndex) => {
            // 列の配置（要件より）:
            // B, F, J, N, R, V列: 曜日 → インデックス 1, 5, 9, 13, 17, 21
            // C, G, K, O, S, W列: 曜日カウント → インデックス 2, 6, 10, 14, 18, 22
            // D, H, L, P, T, X列: 本科 → インデックス 3, 7, 11, 15, 19, 23
            // E, I, M, Q, U, Y列: 専攻科 → インデックス 4, 8, 12, 16, 20, 24

            const baseCol = 2 + monthIndex * 4;  // C列から開始（インデックス2）
            const colWeekday = baseCol - 1;      // B列: 曜日表示（参考用、現在未使用）
            const colWeekdayCount = baseCol;     // C列: 曜日カウント
            const colTeacher = baseCol + 1;      // D列: 本科
            const colStudent = baseCol + 2;      // E列: 専攻科

            // 8行目以降がデータ行（インデックス7）
            for (let rowIdx = 7; rowIdx < rawData.length; rowIdx++) {
                const row = rawData[rowIdx];
                const dayValue = row[0];  // A列: 日付

                if (!dayValue || dayValue === '') continue;

                // 年度調整（後期の1-3月は翌年）
                let actualYear = year;
                if (period === '後期' && month <= 3) {
                    actualYear = year + 1;
                }

                const dateObj = new Date(actualYear, month - 1, parseInt(dayValue));
                if (isNaN(dateObj.getTime())) continue;

                // 曜日カウント（C, G, K, O, S, W列から読み取り）
                const weekdayVal = row[colWeekdayCount];
                const weekdayCount = processWeekdayCount(weekdayVal, dateObj);

                // デバッグ用ログ（月曜日のみ）
                if (dateObj.getDay() === 1) {
                    console.log(`[月曜日] ${dateObj.toDateString()} - セル値:`, weekdayVal, ' → 処理結果:', weekdayCount);
                }

                // 本科イベント処理
                let teacherEventAdded = false;
                if (colTeacher < row.length) {
                    const eventCell = row[colTeacher];
                    if (eventCell && String(eventCell).trim() !== '') {
                        const events = parseEventCell(String(eventCell));
                        events.forEach(event => {
                            // 祝日名のみのイベントはスキップ
                            if (isHolidayOnlyEvent(event)) {
                                return;
                            }

                            const { text, weekday } = extractWeekdayFromEvent(event);

                            // イベントから祝日名を除去
                            const cleanedEvent = removeHolidayNames(replaceSpecialMarks(text));

                            // 空になったイベントはスキップ
                            if (!cleanedEvent || cleanedEvent.trim() === '') {
                                return;
                            }

                            allData.push({
                                date: dateObj,
                                event: cleanedEvent,
                                type: 'teacher',
                                weekdayCount: weekday || weekdayCount,
                                isSpecificWeekday: !!weekday,
                                period: period
                            });
                            teacherEventAdded = true;
                        });
                    }
                }

                // イベントがなくても曜日カウントがあれば、授業日として記録
                if (!teacherEventAdded && weekdayCount) {
                    allData.push({
                        date: dateObj,
                        event: '',  // イベントなし
                        type: 'teacher',
                        weekdayCount: weekdayCount,
                        isSpecificWeekday: true,
                        period: period
                    });
                }

                // 専攻科イベント処理
                let studentEventAdded = false;
                if (colStudent < row.length) {
                    const eventCell = row[colStudent];
                    if (eventCell && String(eventCell).trim() !== '') {
                        const events = parseEventCell(String(eventCell));
                        events.forEach(event => {
                            // 祝日名のみのイベントはスキップ
                            if (isHolidayOnlyEvent(event)) {
                                return;
                            }

                            const { text, weekday } = extractWeekdayFromEvent(event);

                            // イベントから祝日名を除去
                            const cleanedEvent = removeHolidayNames(replaceSpecialMarks(text));

                            // 空になったイベントはスキップ
                            if (!cleanedEvent || cleanedEvent.trim() === '') {
                                return;
                            }

                            allData.push({
                                date: dateObj,
                                event: cleanedEvent,
                                type: 'student',
                                weekdayCount: weekday || weekdayCount,
                                isSpecificWeekday: !!weekday,
                                period: period
                            });
                            studentEventAdded = true;
                        });
                    }
                }

                // イベントがなくても曜日カウントがあれば、授業日として記録
                if (!studentEventAdded && weekdayCount) {
                    allData.push({
                        date: dateObj,
                        event: '',  // イベントなし
                        type: 'student',
                        weekdayCount: weekdayCount,
                        isSpecificWeekday: true,
                        period: period
                    });
                }
            }
        });
    });

    // 重複チェック（同じ日付、同じ内容、同じ曜日カウントの予定を排除）
    const seen = new Set();
    const uniqueData = [];
    allData.forEach(item => {
        // キーにタイプを含めないことで、本科と専攻科で内容が同じ場合は1つにまとめる
        const key = `${item.date.getTime()}-${item.event}-${item.weekdayCount}`;
        if (!seen.has(key)) {
            uniqueData.push(item);
            seen.add(key);
        }
    });

    // 日付順にソートし、IDを付与
    return uniqueData.sort((a, b) => a.date - b.date).map((item, index) => {
        item.id = `excel_${index}`;
        return item;
    });
}

function parseEventCell(cellValue) {
    const lines = cellValue.split('\n').map(l => l.trim()).filter(l => l !== '');
    const events = [];
    let currentEvent = '';

    for (const line of lines) {
        // 補足情報（括弧や記号で始まる行）
        if (line.startsWith('（') || line.startsWith('※') || line.startsWith('・')) {
            currentEvent += line;
        } else {
            if (currentEvent) {
                events.push(currentEvent);
            }
            currentEvent = line;
        }
    }

    if (currentEvent) {
        events.push(currentEvent);
    }

    return events;
}

function processWeekdayCount(value, dateObj) {
    if (!value || String(value).trim() === '') return '';

    try {
        let valueStr = String(value).trim();

        // 全角英数字を半角に変換、丸数字も変換
        valueStr = valueStr.replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
        for (const [mark, num] of Object.entries(MARU_NUM_DICT)) {
            valueStr = valueStr.replace(new RegExp(mark, 'g'), num);
        }

        // --- 特殊パターンの処理 (午前木曜授業など) ---
        // パターン: "(午前) 火曜授業" または "火曜授業 (午前)" など
        const complexPattern = /[【〔[（(]?\s*(午前|午後)\s*[】〕\]）)]?/;
        const weekdayPattern = /([月火水木金土日])(曜?授業|(\d+))/;

        const complexMatch = valueStr.match(complexPattern);
        const weekdayMatch = valueStr.match(weekdayPattern);

        if (weekdayMatch) {
            const weekdayChar = weekdayMatch[1];
            const num = weekdayMatch[3] || ""; // 数字があれば取得
            const periodType = complexMatch ? complexMatch[1] : "";

            if (periodType === "午前") {
                return `${weekdayChar}${num}(午前のみ)`;
            } else if (periodType === "午後") {
                return `${weekdayChar}${num}(午後のみ)`;
            } else {
                return `${weekdayChar}${num}`;
            }
        }

        // 数値のみ（曜日なし）の場合、当日曜日を付与
        const numOnlyMatch = valueStr.match(/^(\d+)(.*)$/);
        if (numOnlyMatch) {
            const num = numOnlyMatch[1];
            const suffix = numOnlyMatch[2] || '';
            const weekdays = ['月', '火', '水', '木', '金', '土', '日'];
            const weekday = weekdays[dateObj.getDay() === 0 ? 6 : dateObj.getDay() - 1];
            return `${weekday}${num}${suffix}`;
        }

        // 数値でも曜日付きでもない場合（特殊な文字列など）
        return valueStr;
    } catch (error) {
        console.warn('曜日カウント処理エラー:', value, error);
        return '';
    }
}

function replaceSpecialMarks(text) {
    let result = text;
    for (const mark in SPECIAL_MARKS) {
        result = result.split(mark).join(SPECIAL_MARKS[mark]);
    }
    // 丸数字も変換
    for (const [mark, num] of Object.entries(MARU_NUM_DICT)) {
        result = result.replace(new RegExp(mark, 'g'), num);
    }
    return result;
}

function extractWeekdayFromEvent(event) {
    if (!event) return { text: '', weekday: null };

    // 全角英数字を半角に変換、丸数字も変換
    let processed = String(event).replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));
    for (const [mark, num] of Object.entries(MARU_NUM_DICT)) {
        processed = processed.replace(new RegExp(mark, 'g'), num);
    }

    // パターン1: "火6", "月1", "【火1】" など (場所は先頭に限らない)
    const match1 = processed.match(/([月火水木金土日])(\d+)/);
    if (match1) {
        const weekday = `${match1[1]}${match1[2]}`;
        // マッチした部分（とその前後の括弧など）を取り除き、前後の空白を調整
        // 括弧類も含めて除去を試みる
        const removalPattern = new RegExp(`[【〔\\[（\\(]?\\s*${match1[1]}\\s*${match1[2]}\\s*[】〕\\]）\\)]?`, 'g');
        const rest = processed.replace(removalPattern, '').replace(/\s+/g, ' ').trim();
        return { text: rest, weekday: weekday };
    }

    // パターン2: "火曜授業", "月曜授業" など
    const match2 = processed.match(/([月火水木金土日])曜?授業/);
    if (match2) {
        const weekday = match2[1];
        const removalPattern = new RegExp(`[【〔\\[（\\(]?\\s*${match2[1]}\\s*曜?授業\\s*[】〕\\]）\\)]?`, 'g');
        const rest = processed.replace(removalPattern, '').replace(/\s+/g, ' ').trim();
        return { text: rest, weekday: weekday };
    }

    return { text: event, weekday: null };
}

// =============================
// UI更新
// =============================
function updateAvailableYearsAndMonths() {
    // 利用可能な年度を抽出（日付から年度を計算）
    const fiscalYears = new Set();
    const months = new Set();

    // キャッシュされたスケジュールデータのキー（年度）を使用
    if (scheduleCache) {
        Object.keys(scheduleCache).forEach(year => {
            const y = parseInt(year);
            if (!isNaN(y)) fiscalYears.add(y);
        });
    }
    // scheduleData自体は現在の表示用なので、そこからも念のため（キャッシュ漏れ防止）
    if (scheduleData.length > 0) {
        const sampleYear = getFiscalYear(scheduleData[0].date);
        fiscalYears.add(sampleYear);
    }

    // 授業データからも年度を収集
    if (Array.isArray(myClasses)) {
        myClasses.forEach(cls => {
            if (cls.classYear) {
                fiscalYears.add(parseInt(cls.classYear));
            }
        });
    }

    // 現在の年度（リアルタイム）も含める（データがなくてもカレンダーは見れるように）
    const thisYear = new Date().getFullYear();
    const realTimeFiscalYear = getFiscalYear(new Date());
    fiscalYears.add(realTimeFiscalYear);

    // バリデーション: 2000年〜2050年の範囲に限定
    let validYears = Array.from(fiscalYears)
        .filter(y => !isNaN(y) && y >= 2000 && y <= 2050)
        .sort((a, b) => b - a); // 降順（新しい年度が上）

    console.log('Detected Fiscal Years:', validYears);

    // もし有効な年度が一つもない場合は暫定的に今年を入れる
    if (validYears.length === 0) {
        validYears = [realTimeFiscalYear];
    }

    availableYears = validYears;
    availableMonths = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]; // 全月固定でOKとする

    // 年度選択肢の更新 (グローバル)
    const yearSelect = document.getElementById('globalYearSelect');
    if (yearSelect) {
        yearSelect.disabled = false;
        // 現在の選択値を保持
        let currentVal = yearSelect.value ? parseInt(yearSelect.value) : currentYear;

        // もし currentYear がまだ決まっていない（null）場合は null のままにして最新選択ロジックへ

        yearSelect.innerHTML = availableYears.map(year =>
            `<option value="${year}" ${year === currentVal ? 'selected' : ''}>${year}年度</option>`
        ).join('');

        if (!availableYears.includes(currentVal) && availableYears.length > 0) {
            // デフォルト選択ロジック：最新の年度を選ぶ（降順ソートなので先頭）
            const fiscalYear = availableYears[0];
            yearSelect.value = fiscalYear;
            currentYear = (currentMonth <= 3) ? fiscalYear + 1 : fiscalYear;
            // 値が変わったのでカレンダー更新
            updateCalendar();
            if (typeof renderMyClassesList === 'function') renderMyClassesList();
        } else if (availableYears.length > 0 && !yearSelect.value) {
            // 初回ロード時などで値がセットされていない場合も最新を選ぶ
            const fiscalYear = availableYears[0];
            yearSelect.value = fiscalYear;
            currentYear = (currentMonth <= 3) ? fiscalYear + 1 : fiscalYear;
        } else {
            yearSelect.value = currentVal; // 値を保持
        }
    }

    // 月選択肢の更新
    const monthSelect = document.getElementById('monthSelect');
    monthSelect.innerHTML = availableMonths.map(m =>
        `<option value="${m}" ${m === currentMonth ? 'selected' : ''}>${m}月</option>`
    ).join('');

    if (monthSelect.querySelector(`option[value="${currentMonth}"]`)) {
        monthSelect.value = currentMonth;
    }

    // 授業管理側の年度選択肢も同期
    if (typeof updateTimetableYearOptions === 'function') updateTimetableYearOptions();
    if (typeof updateClassYearOptions === 'function') updateClassYearOptions();

    // 読み込み済み年度の管理リストを更新
    renderCachedYearList();
}

function updateStats() {
    const uniqueDates = new Set(scheduleData.map(item => item.date.toDateString()));
    const teacherEvents = scheduleData.filter(item => item.type === 'teacher' && item.event);
    const studentEvents = scheduleData.filter(item => item.type === 'student' && item.event);
    const classDays = scheduleData.filter(item => item.weekdayCount);

    const elTotal = document.getElementById('statTotalDays');
    const elTeacher = document.getElementById('statTeacherEvents');
    const elStudent = document.getElementById('statStudentEvents');
    const elClass = document.getElementById('statClassDays');

    if (elTotal) elTotal.textContent = uniqueDates.size;
    if (elTeacher) elTeacher.textContent = teacherEvents.length;
    if (elStudent) elStudent.textContent = studentEvents.length;
    if (elClass) elClass.textContent = new Set(classDays.map(d => d.date.toDateString())).size;

    // エクスポート期間の初期値を設定（デフォルトは選択中の年度）
    const startDate = new Date(currentYear, 3, 1); // 4月1日
    const endDate = new Date(currentYear + 1, 2, 31); // 3月31日

    // 日付入力欄が存在すれば値を設定（ユーザーが未編集の場合のみ更新などの制御が必要だが、ここではシンプルに年度切り替えでリセット）
    const exportStart = document.getElementById('exportStartDate');
    const exportEnd = document.getElementById('exportEndDate');
    if (exportStart && exportEnd) {
        // 現在の値が空、または年度が変わった場合に更新
        // ここではシンプルに常に更新する（ユーザーが年度を変えたら期間もその年度に合わせるのが自然）
        exportStart.value = formatDateKey(startDate);
        exportEnd.value = formatDateKey(endDate);
    }
}

/**
 * カレンダーを更新（表示形式に応じて振り分け）
 */
function updateCalendar() {
    const isYearly = (currentCalendarView === 'year');

    // 表示中の年度（4月基準の年度）を特定
    const viewingDate = new Date(currentYear, currentMonth - 1, 1);
    const fiscalYear = getFiscalYear(viewingDate);

    // カレンダー操作時に授業データを最新の状態にする（年度跨ぎ対応）
    if (typeof updateScheduleDataWithClasses === 'function') {
        updateScheduleDataWithClasses(fiscalYear);
    }

    // 年間表示の場合は月操作UI（◀今日▶）と表示設定UI（表示月/曜日カウント）を隠す
    const monthNav = document.getElementById('monthNavControls');
    const viewControls = document.getElementById('calendarViewControls');

    if (monthNav) monthNav.style.display = isYearly ? 'none' : 'flex';
    if (viewControls) viewControls.style.display = isYearly ? 'none' : 'flex';

    switch (currentCalendarView) {
        case 'year':
            renderYearlyView();
            break;
        case 'month':
            renderMonthlyView();
            break;
        case 'week':
            renderWeeklyView();
            break;
        case 'list':
            renderListView();
            break;
        default:
            renderMonthlyView();
    }
}
window.updateCalendar = updateCalendar;

function renderYearlyView() {
    const calendarGrid = document.getElementById('calendarGrid');
    const calendarTitle = document.getElementById('calendarTitle');

    // 表示中の年度を特定
    const fiscalYear = getFiscalYear(new Date(currentYear, currentMonth - 1, 1));

    // タイトルと切替ラジオボタン
    calendarTitle.style.display = 'flex';
    calendarTitle.style.alignItems = 'center';
    calendarTitle.style.justifyContent = 'center';
    calendarTitle.style.gap = '20px';
    calendarTitle.innerHTML = `
        <span style="font-size: 1.1rem; font-weight: 800; color: var(--neutral-800);">${fiscalYear}年度 年間表示</span>
        <div class="yearly-view-toggle" style="display: flex; gap: 4px; background: var(--neutral-200); padding: 3px; border-radius: 20px; font-size: 0.8rem; font-weight: 700;">
            <label style="cursor: pointer; padding: 4px 12px; border-radius: 17px; display: flex; align-items: center; transition: all 0.2s; ${yearlyViewMode === 'weekday' ? 'background: #fff; color: var(--primary-600); box-shadow: 0 2px 4px rgba(0,0,0,0.1);' : 'color: var(--neutral-600);'}">
                <input type="radio" name="yearlyMode" value="weekday" ${yearlyViewMode === 'weekday' ? 'checked' : ''} style="display: none;"> 曜日
            </label>
            <label style="cursor: pointer; padding: 4px 12px; border-radius: 17px; display: flex; align-items: center; transition: all 0.2s; ${yearlyViewMode === 'work' ? 'background: #fff; color: var(--primary-600); box-shadow: 0 2px 4px rgba(0,0,0,0.1);' : 'color: var(--neutral-600);'}">
                <input type="radio" name="yearlyMode" value="work" ${yearlyViewMode === 'work' ? 'checked' : ''} style="display: none;"> 勤務
            </label>
        </div>
    `;

    // ラジオボタンのイベント設定
    const radios = calendarTitle.querySelectorAll('input[type="radio"]');
    radios.forEach(r => {
        r.addEventListener('change', (e) => {
            yearlyViewMode = e.target.value;
            saveViewState();
            renderYearlyView(); // 再描画
        });
    });

    calendarGrid.innerHTML = '';

    // 4月から翌年3月までを描画
    for (let m = 0; m < 12; m++) {
        const monthNum = (FISCAL_YEAR_START_MONTH + m - 1) % 12 + 1;
        const yearNum = (monthNum < FISCAL_YEAR_START_MONTH) ? fiscalYear + 1 : fiscalYear;
        const monthContainer = document.createElement('div');
        monthContainer.className = 'mini-month';
        monthContainer.style.cursor = 'pointer';
        monthContainer.onclick = () => {
            currentMonth = monthNum;
            currentYear = yearNum;
            changeCalendarView('month');
        };

        const title = document.createElement('div');
        title.className = 'mini-month-title';
        title.textContent = `${yearNum}年 ${monthNum}月`;
        monthContainer.appendChild(title);

        const grid = document.createElement('div');
        grid.className = 'mini-month-grid';

        // 曜日見出し (月-日)
        ['月', '火', '水', '木', '金', '土', '日'].forEach(d => {
            const h = document.createElement('div');
            h.className = 'mini-day header';
            h.textContent = d;
            h.style.fontWeight = 'bold';
            grid.appendChild(h);
        });

        const firstDay = new Date(yearNum, monthNum - 1, 1);
        const lastDay = new Date(yearNum, monthNum, 0);
        const startOffset = (firstDay.getDay() === 0) ? 6 : firstDay.getDay() - 1;

        // 埋め
        for (let i = 0; i < startOffset; i++) {
            grid.appendChild(document.createElement('div'));
        }

        for (let d = 1; d <= lastDay.getDate(); d++) {
            const date = new Date(yearNum, monthNum - 1, d);
            const dStr = formatDateKey(date);
            const el = document.createElement('div');
            el.className = 'mini-day';
            const weekday = date.getDay();
            if (weekday === 6) el.classList.add('saturday');
            if (weekday === 0) el.classList.add('sunday');


            // 全ての表示候補イベントを取得 (マイクラス由来を除外したソースデータ)
            const dayEvents = scheduleData.filter(item => formatDateKey(item.date) === dStr && !item.fromMyClass);
            const dayOverrides = classOverrides.filter(ov => (ov.startDate === dStr || ov.date === dStr || (dStr >= ov.startDate && dStr <= ov.endDate)));

            // 参加しているイベントのみを抽出
            const participatingEvents = [...dayEvents, ...dayOverrides.map(o => ({ ...o.data, type: o.type, id: o.id }))].filter(ev => {
                return isEventParticipating(ev, dStr, {});
            });

            // 1. 背景の判定 (「予定あり/なし」の共通背景を維持)
            const holidayMaps = typeof getHolidaysForYear === 'function' ? getHolidaysForYear(date.getFullYear()) : {};
            const isHol = typeof getHolidayName === 'function' ? !!getHolidayName(date, holidayMaps) : false;
            if (isHol) el.classList.add('holiday');
            const isBusDay = weekday !== 0 && weekday !== 6 && !isHol;

            // --- イベントの集約 (マンスリーと同様の基準) ---
            const dayAllEvents = [];
            // Excel予定
            dayEvents.forEach(e => {
                if (e.event && !classOverrides.some(ov => String(ov.id) === String(e.id) && ov.type === 'excel' && (ov.date === dStr || ov.startDate === dStr) && (ov.action === 'delete' || ov.action === 'move'))) {
                    dayAllEvents.push({ type: 'excel', data: e, id: e.id, startDate: dStr, endDate: dStr });
                }
            });
            // 移動/追加/カスタム済
            classOverrides.forEach(ov => {
                const start = (ov.startDate || ov.date || '').replace(/\//g, '-');
                const end = (ov.endDate || ov.date || ov.startDate || '').replace(/\//g, '-');
                if (dStr >= start && dStr <= end) {
                    if (ov.action !== 'delete') {
                        dayAllEvents.push({ type: ov.type, data: ov.data, id: ov.id, startDate: start, endDate: end, original: ov });
                    }
                }
            });
            // 授業 (マイクラス)
            if (typeof getDisplayableClassesForDate === 'function') {
                getDisplayableClassesForDate(date, dayEvents).forEach(cls => {
                    dayAllEvents.push({ type: 'myclass', data: cls, id: cls.id, startDate: dStr, endDate: dStr });
                });
            }

            // 参加している（ピン留め等）イベント
            const participating = dayAllEvents.filter(ev => isEventParticipating(ev, dStr, {}));
            const hasAnySchedule = dayAllEvents.length > 0;

            if (isBusDay && !participating.length) {
                el.style.backgroundColor = 'hsl(145, 65%, 96%)';
                el.style.backgroundImage = 'radial-gradient(#10b981 0.5px, transparent 0.5px)';
                el.style.backgroundSize = '4px 4px';
            } else if (hasAnySchedule) {
                el.style.backgroundColor = '#fff';
                el.style.backgroundImage = 'radial-gradient(var(--neutral-200) 1px, transparent 1px)';
                el.style.backgroundSize = '4px 4px';
            }

            if (dStr === formatDateKey(new Date())) el.classList.add('today');

            // --- バッジ・日付コンテナ (日付は左、バッジは右) ---
            const badgeContainer = document.createElement('div');
            badgeContainer.className = 'mini-day-badges';

            // 1. 日付 (左側)
            const numSpan = document.createElement('span');
            numSpan.className = 'mini-day-num';
            numSpan.textContent = d;
            badgeContainer.appendChild(numSpan);

            // 2. 右側のバッジ群ラッパー
            const rightBadges = document.createElement('div');
            rightBadges.style.position = 'absolute';
            rightBadges.style.right = '0';
            rightBadges.style.top = '0';
            rightBadges.style.display = 'flex';
            rightBadges.style.justifyContent = 'flex-end';
            rightBadges.style.alignItems = 'flex-start';
            rightBadges.style.gap = '2px';

            const work = typeof getWorkTimeForDate === 'function' ? getWorkTimeForDate(date) : null;

            if (yearlyViewMode === 'work') {
                // --- 勤務パターンモード ---
                if (work) {
                    const b = document.createElement('div');
                    b.className = 'day-work-badge' + (work.isOverride && !work.isApplied ? ' is-override' : '');

                    // 表示テキストを短縮 (A勤務 -> A, その他 -> 他)
                    let label = (work.name || '').replace('勤務', '');
                    if (label === 'その他') label = '他';

                    b.textContent = label;
                    b.style.transform = 'scale(0.55)';
                    b.style.transformOrigin = 'top right';
                    b.style.margin = '0';
                    rightBadges.appendChild(b);
                }
            } else {
                // --- 曜日カウントモード (デフォルト) ---
                const badsContainer = document.createElement('div');
                badsContainer.className = 'day-badges';
                badsContainer.style.display = 'flex';
                badsContainer.style.justifyContent = 'flex-end';
                badsContainer.style.gap = '1px';
                badsContainer.style.transform = 'scale(0.6)';
                badsContainer.style.transformOrigin = 'top right';

                // 祝日名
                const holidayName = typeof getHolidayName === 'function' ? getHolidayName(date, holidayMaps) : null;
                if (holidayName) {
                    const hb = document.createElement('div');
                    hb.className = 'day-holiday';
                    hb.textContent = '祝日';
                    badsContainer.appendChild(hb);
                }

                // 曜日カウント
                const weekdayEv = dayEvents.find(e => e.weekdayCount);
                if (weekdayEv) {
                    const wb = document.createElement('div');
                    wb.className = 'day-weekday-count';
                    wb.textContent = weekdayEv.weekdayCount.replace('曜授業', '');
                    badsContainer.appendChild(wb);
                }
                // 試験/補講
                dayEvents.forEach(e => {
                    if (e.event) {
                        if (e.event.includes('試験')) {
                            const eb = document.createElement('div');
                            eb.className = 'day-exam-badge';
                            eb.textContent = '試験';
                            badsContainer.appendChild(eb);
                        } else if (e.event.includes('補講')) {
                            const mb = document.createElement('div');
                            mb.className = 'day-makeup-count';
                            mb.textContent = '補講';
                            badsContainer.appendChild(mb);
                        }
                    }
                });

                rightBadges.appendChild(badsContainer);
            }

            badgeContainer.appendChild(rightBadges);
            el.appendChild(badgeContainer);

            // --- イベントカテゴリの判定 ---
            const hasLeave = participating.some(ev => ev.data?.isLeaveCard);
            const hasTrip = participating.some(ev => ev.data?.isTripCard);
            const hasWfh = participating.some(ev => ev.data?.isWfhCard);
            const hasHolidayWork = participating.some(ev => ev.data?.isHolidayWorkCard);
            const hasClass = participating.some(ev => ev.type === 'myclass');
            const hasOther = participating.some(ev => {
                const text = ev.data?.event || ev.data?.name || '';
                return ev.data?.event && !ev.data?.weekdayCount && ev.type !== 'myclass' &&
                    !ev.data?.isLeaveCard && !ev.data?.isTripCard && !ev.data?.isWfhCard && !ev.data?.isHolidayWorkCard;
            });

            // --- 凡例デザインのカード (カテゴリごとに最大1つ表示) ---
            const cardContainer = document.createElement('div');
            cardContainer.className = 'day-events';
            cardContainer.style.width = '100%';
            cardContainer.style.marginTop = 'auto';
            cardContainer.style.padding = '0';
            cardContainer.style.gap = '0';

            const categories = [
                { active: hasLeave, typeClass: 'process-card leave-card', label: '年休' },
                { active: hasTrip, typeClass: 'process-card trip-card', label: '出張' },
                { active: hasWfh, typeClass: 'process-card wfh-card', label: '在宅' },
                { active: hasHolidayWork, typeClass: 'process-card holiday-work-card', label: 'Holiday' },
                { active: hasClass, typeClass: 'myclass', label: '授業' },
                { active: hasOther, typeClass: 'custom', label: '行事' }
            ];

            categories.forEach(cat => {
                if (cat.active) {
                    const card = document.createElement('div');
                    card.className = `event-item ${cat.typeClass}`;
                    card.textContent = cat.label;

                    card.style.setProperty('font-size', '6.5px', 'important');
                    card.style.setProperty('padding', '0', 'important');
                    card.style.setProperty('height', '8px', 'important');
                    card.style.setProperty('min-height', '8px', 'important');
                    card.style.setProperty('width', '96%', 'important');
                    card.style.setProperty('text-align', 'center', 'important');
                    card.style.setProperty('line-height', '8px', 'important');
                    card.style.setProperty('margin', '0 auto', 'important');
                    card.style.setProperty('border-left-width', '2px', 'important');
                    card.style.setProperty('border-radius', '1px', 'important');
                    card.style.setProperty('box-shadow', 'none', 'important');
                    card.style.setProperty('white-space', 'nowrap', 'important');
                    card.style.setProperty('overflow', 'hidden', 'important');
                    card.style.setProperty('display', 'block', 'important');

                    cardContainer.appendChild(card);
                }
            });
            el.appendChild(cardContainer);

            // --- ステータスアイコン (📌参加 / 📄申請) ---
            const statusIcons = document.createElement('div');
            statusIcons.className = 'mini-status-icons';
            statusIcons.style.bottom = '1px';
            statusIcons.style.right = '1px';
            statusIcons.style.top = 'auto'; // 下寄せに変更

            if (participating.some(ev => {
                const text = ev.data?.event || ev.data?.name || '';
                const isPinned = typeof containsPinnedKeyword === 'function' && containsPinnedKeyword(text);
                return isPinned || (ev.original && (ev.original.action === 'participate' || ev.original.action === 'move' || ev.original.action === 'add'));
            })) {
                const s = document.createElement('span'); s.textContent = '📌';
                statusIcons.appendChild(s);
            }
            if (hasLeave || hasTrip || hasWfh || hasHolidayWork || (work && work.isApplied)) {
                const s = document.createElement('span'); s.textContent = '📄';
                statusIcons.appendChild(s);
            }
            el.appendChild(statusIcons);

            grid.appendChild(el);
        }

        monthContainer.appendChild(grid);
        calendarGrid.appendChild(monthContainer);
    }
}

function renderWeeklyView() {
    const calendarGrid = document.getElementById('calendarGrid');
    const calendarTitle = document.getElementById('calendarTitle');
    const target = document.getElementById('targetSelect')?.value || 'both';
    const assignmentExclusions = JSON.parse(localStorage.getItem('assignmentExclusions') || '{}');

    // 現在の表示月の第1週の開始日（月曜日）を基準にする
    if (!currentWeekBaseDate) {
        const firstOfMonth = new Date(currentYear, currentMonth - 1, 1);
        const offset = (firstOfMonth.getDay() === 0) ? 6 : firstOfMonth.getDay() - 1;
        currentWeekBaseDate = new Date(firstOfMonth);
        currentWeekBaseDate.setDate(currentWeekBaseDate.getDate() - offset);
    }
    const startDay = new Date(currentWeekBaseDate);
    const endDay = new Date(startDay);
    endDay.setDate(startDay.getDate() + 6);

    const weekStartStr = formatDateKey(startDay);
    const weekEndStr = formatDateKey(endDay);

    calendarTitle.textContent = `${startDay.getFullYear()}年${startDay.getMonth() + 1}月${startDay.getDate()}日 〜 ${endDay.getFullYear()}年${endDay.getMonth() + 1}月${endDay.getDate()}日`;

    calendarGrid.innerHTML = '';
    calendarGrid.className = 'calendar-grid view-week';

    // 1. 曜日ヘッダー
    const weekdays = ['月', '火', '水', '木', '金', '土', '日'];
    weekdays.forEach((day, index) => {
        const header = document.createElement('div');
        header.className = 'calendar-day-header';
        if (index === 5) header.classList.add('saturday');
        if (index === 6) header.classList.add('sunday');
        header.textContent = day;
        header.style.gridRow = '1';
        header.style.gridColumn = (index + 1);
        calendarGrid.appendChild(header);
    });

    // 2. データ収集 (全7日分を一括処理)
    const weekDates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(startDay);
        d.setDate(startDay.getDate() + i);
        weekDates.push(d);
    }

    const allDisplayEvents = [];

    // Excel予定
    scheduleData.forEach(item => {
        if (!item.event || item.event.trim() === '') return;
        const dStr = formatDateKey(item.date);
        if (dStr < weekStartStr || dStr > weekEndStr) return;
        if (classOverrides.some(ov => String(ov.id) === String(item.id) && ov.type === 'excel' && ov.date === dStr && (ov.action === 'delete' || ov.action === 'move'))) return;
        allDisplayEvents.push({ id: String(item.id), startDate: dStr, endDate: dStr, type: 'excel', data: item, original: item });
    });

    // Overrides
    classOverrides.forEach(ov => {
        let start = (ov.startDate || ov.date || '').replace(/\//g, '-');
        let end = (ov.endDate || ov.date || ov.startDate || '').replace(/\//g, '-');
        if (!start || !end) return;
        if (end < weekStartStr || start > weekEndStr) return; // 期間外
        if (ov.action === 'delete') return;
        allDisplayEvents.push({ id: String(ov.id), startDate: start, endDate: end, type: ov.type, data: ov.data, original: ov });
    });

    // MyClass
    if (typeof getDisplayableClassesForDate === 'function') {
        weekDates.forEach(d => {
            const dStr = formatDateKey(d);
            const dayEvents = scheduleData.filter(item => formatDateKey(item.date) === dStr && !item.fromMyClass);
            getDisplayableClassesForDate(d, dayEvents).forEach(cls => {
                allDisplayEvents.push({ id: String(cls.id), startDate: dStr, endDate: dStr, type: 'myclass', data: cls, original: cls });
            });
        });
    }

    // --- セグメント化 (リボン表示用) ---
    const weekSegments = [];
    allDisplayEvents.forEach(ov => {
        const p = getSortPriority(ov);
        if (p < 2) { // 終日予定のみ
            const start = ov.startDate > weekStartStr ? ov.startDate : weekStartStr;
            const end = ov.endDate < weekEndStr ? ov.endDate : weekEndStr;
            const sIdx = weekDates.findIndex(d => formatDateKey(d) === start);
            const eIdx = weekDates.findIndex(d => formatDateKey(d) === end);
            weekSegments.push({ ...ov, sIdx, eIdx, segStart: start, segEnd: end });
        }
    });

    // レーン計算
    weekSegments.sort((a, b) => {
        const pA = getSortPriority(a);
        const pB = getSortPriority(b);
        if (pA !== pB) return pA - pB;
        if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
        return (b.eIdx - b.sIdx) - (a.eIdx - a.sIdx);
    });

    const weekLanes = [];
    weekSegments.forEach(seg => {
        let targetL = 0;
        while (true) {
            if (!weekLanes[targetL]) weekLanes[targetL] = new Array(7).fill(false);
            let possible = true;
            for (let x = seg.sIdx; x <= seg.eIdx; x++) {
                if (weekLanes[targetL][x]) { possible = false; break; }
            }
            if (possible) {
                for (let x = seg.sIdx; x <= seg.eIdx; x++) weekLanes[targetL][x] = true;
                seg.laneIdx = targetL;
                break;
            }
            targetL++;
        }
    });

    const laneCount = weekLanes.length;
    const TOTAL_ALDAY_ROWS = Math.max(laneCount, 4);

    // グリッド配置の安定化
    calendarGrid.style.gridTemplateRows = `auto auto repeat(${TOTAL_ALDAY_ROWS}, 32px) 1fr`;

    // --- 各日の背景・日付・タイムグリッド描画 ---
    const START_HOUR = 8;
    const END_HOUR = 20;
    const PIXELS_PER_MINUTE = 0.8;
    const TIME_GRID_HEIGHT = (END_HOUR - START_HOUR) * 60 * PIXELS_PER_MINUTE;

    weekDates.forEach((date, i) => {
        const dStr = formatDateKey(date);
        const weekday = date.getDay();
        const holidayMaps = typeof getHolidaysForYear === 'function' ? getHolidaysForYear(date.getFullYear()) : {};
        const isHol = typeof getHolidayName === 'function' ? !!getHolidayName(date, holidayMaps) : false;

        // 背景
        const bg = document.createElement('div');
        bg.className = 'calendar-day-bg';
        bg.style.gridColumn = i + 1;
        bg.style.gridRow = `1 / span ${3 + TOTAL_ALDAY_ROWS}`; // Header(1) + Date(1) + Lanes(N) + TimeGrid(1)
        if (weekday === 6) bg.classList.add('saturday');
        if (weekday === 0) bg.classList.add('sunday');
        if (isHol) bg.classList.add('holiday');
        if (dStr === formatDateKey(new Date())) bg.classList.add('today');
        calendarGrid.appendChild(bg);

        // 背景クリックアクション
        bg.onclick = (e) => {
            if (e.target !== bg) return;
            if (mobileAction) { executeMobileAction(dStr); return; }
            editCalendarEvent('custom', 'custom-' + Date.now(), dStr);
        };
        bg.oncontextmenu = (e) => {
            if (e.target !== bg) return;
            if (typeof showAnnualLeaveMenu === 'function') showAnnualLeaveMenu(e, dStr);
        };

        // 日付・バッジコンテナ (Row 2)
        const dateHeader = document.createElement('div');
        dateHeader.className = 'weekly-day-date-header';
        dateHeader.style.gridColumn = i + 1;
        dateHeader.style.gridRow = '2';
        dateHeader.style.padding = '4px';
        dateHeader.style.display = 'flex';
        dateHeader.style.justifyContent = 'space-between';
        dateHeader.style.alignItems = 'flex-start';
        dateHeader.style.zIndex = '5';
        dateHeader.innerHTML = `<div class="day-number">${date.getMonth() + 1}/${date.getDate()}</div><div class="day-badges" style="display:flex; justify-content:flex-end; gap:1px; flex-wrap:wrap;"></div>`;
        const bads = dateHeader.querySelector('.day-badges');

        // バッジ追加ロジック (既存より移植)
        const dayEvents = scheduleData.filter(item => formatDateKey(item.date) === dStr && !item.fromMyClass);
        const dayParticipating = allDisplayEvents.filter(ev => {
            const start = ev.startDate;
            const end = ev.endDate;
            return dStr >= start && dStr <= end;
        });

        // 重複チェック
        const localConflicts = [];
        for (let j = 0; j < dayParticipating.length; j++) {
            for (let k = j + 1; k < dayParticipating.length; k++) {
                const ov1 = dayParticipating[j];
                const ov2 = dayParticipating[k];
                const p1 = getSortPriority(ov1);
                const p2 = getSortPriority(ov2);

                const getName = (o) => {
                    const d = o.data || {};
                    const n = d.event || d.name || (o.original ? (o.original.event || o.original.name) : '') || '無題';
                    return n.split('\n')[0].replace(/[📌📍]/g, '').trim();
                };
                const name1 = getName(ov1);
                const name2 = getName(ov2);

                const isTrip1 = !!ov1.data?.isTripCard || name1.includes('出張');
                const isTrip2 = !!ov2.data?.isTripCard || name2.includes('出張');
                const isWfh1 = !!ov1.data?.isWfhCard || name1.includes('在宅');
                const isWfh2 = !!ov2.data?.isWfhCard || name2.includes('在宅');
                const isSpecial1 = isTrip1 || isWfh1;
                const isSpecial2 = isTrip2 || isWfh2;

                // 終日予定の📌（行事）と時間指定予定の重複は除外
                const isAllDayPinned1 = (p1 < 2 && !isSpecial1);
                const isAllDayPinned2 = (p2 < 2 && !isSpecial2);
                const isTimedOrClass1 = (ov1.type === 'myclass' || p1 === 2);
                const isTimedOrClass2 = (ov2.type === 'myclass' || p2 === 2);
                if ((isAllDayPinned1 && isTimedOrClass2) || (isTimedOrClass1 && isAllDayPinned2)) continue;

                if (p1 < 2 && p2 < 2) {
                    if (!isSpecial1 && !isSpecial2) continue;
                    if (isTrip1 && isTrip2 && name1 === name2) continue;
                    if (isWfh1 && isWfh2 && name1 === name2) continue;
                }

                const s1 = getEffectiveTime(ov1, dStr);
                const e1 = getEndTime(ov1, dStr);
                const s2 = getEffectiveTime(ov2, dStr);
                const e2 = getEndTime(ov2, dStr);

                if (s1 < e2 && s2 < e1) {
                    const t1 = p1 === 2 ? `(${s1}-${e1})` : '(終日)';
                    const t2 = p2 === 2 ? `(${s2}-${e2})` : '(終日)';
                    const pair = [name1 + t1, name2 + t2].sort();
                    localConflicts.push(`・${pair[0]} と ${pair[1]}`);
                }
            }
        }
        if (localConflicts.length > 0) {
            bg.classList.add('has-overlap');
            bg.title = "【重複警告】\n" + [...new Set(localConflicts)].join("\n");
        }

        const holN = typeof getHolidayName === 'function' ? getHolidayName(date, holidayMaps) : null;
        if (holN) { const hb = document.createElement('div'); hb.className = 'day-holiday'; hb.textContent = holN; bads.appendChild(hb); }

        if (localConflicts.length > 0) {
            const ovIcon = document.createElement('div');
            ovIcon.className = 'day-overlap-icon';
            ovIcon.innerHTML = '⚠️';
            ovIcon.title = bg.title;
            bads.appendChild(ovIcon);
        }

        const work = typeof getWorkTimeForDate === 'function' ? getWorkTimeForDate(date) : null;
        if (work) {
            const wb = document.createElement('div');
            wb.className = 'day-work-badge' + (work.isOverride && !work.isApplied ? ' is-override' : '');
            let label = (work.name || '').replace('勤務', '');
            if (label === 'その他') label = '他';
            wb.textContent = (work.isApplied ? '📄' : '') + label;
            wb.onclick = (e) => { e.stopPropagation(); showWorkShiftMenu(e, dStr); };
            bads.appendChild(wb);
        }

        const weekdayEv = dayEvents.find(e => e.weekdayCount);
        if (target !== 'teacher' && weekdayEv) {
            const wb = document.createElement('div');
            wb.className = 'day-weekday-count';
            wb.textContent = weekdayEv.weekdayCount.replace('曜授業', '');
            bads.appendChild(wb);
        }

        // 試験・補講
        const badgeMap = new Map();
        dayEvents.forEach(e => {
            if (!e.event) return;
            if (e.event.includes('補講')) badgeMap.set('補講', { text: '補講', cls: 'day-makeup-count' });
            if (e.event.includes('試験') && !e.event.includes('入試')) badgeMap.set('試験', { text: '試験', cls: 'day-exam-badge' });
            if (e.event.includes('入試')) badgeMap.set('入試', { text: '入試', cls: 'day-exam-badge', style: 'background:#f472b6; color:white;' });
        });
        badgeMap.forEach(b => {
            const d = document.createElement('div'); d.className = b.cls; d.textContent = b.text;
            if (b.style) d.style = b.style;
            bads.appendChild(d);
        });

        calendarGrid.appendChild(dateHeader);

        // タイムグリッド (Row 3 + TOTAL_ALDAY_ROWS)
        const timeGridContainer = document.createElement('div');
        timeGridContainer.className = 'weekly-timegrid-container';
        timeGridContainer.style.gridColumn = i + 1;
        timeGridContainer.style.gridRow = (3 + TOTAL_ALDAY_ROWS);
        timeGridContainer.style.position = 'relative';
        timeGridContainer.style.height = TIME_GRID_HEIGHT + 'px';
        timeGridContainer.style.borderTop = '1px solid var(--neutral-200)';
        timeGridContainer.style.zIndex = '5';

        // 背景のグリッド線
        for (let h = START_HOUR; h <= END_HOUR; h++) {
            const line = document.createElement('div');
            line.style.position = 'absolute';
            line.style.left = '0'; line.style.right = '0'; line.style.height = '1px';
            line.style.backgroundColor = 'var(--neutral-100)';
            const top = (h - START_HOUR) * 60 * PIXELS_PER_MINUTE;
            line.style.top = top + 'px';
            timeGridContainer.appendChild(line);

            if (i === 0) {
                const label = document.createElement('span');
                label.textContent = `${h}:00`; label.style.position = 'absolute'; label.style.left = '2px';
                label.style.top = top + 'px'; label.style.fontSize = '0.6rem'; label.style.color = 'var(--neutral-400)';
                timeGridContainer.appendChild(label);
            }
        }

        // 勤務時間のハイライト (既存ロジック)
        if (work && work.start && work.end) {
            const parseTime = (t) => { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
            const wStartMin = parseTime(work.start); const wEndMin = parseTime(work.end);
            const startLimit = START_HOUR * 60; const endLimit = END_HOUR * 60;
            const dispStart = Math.max(wStartMin, startLimit); const dispEnd = Math.min(wEndMin, endLimit);
            if (dispEnd > dispStart) {
                const hTop = (dispStart - startLimit) * PIXELS_PER_MINUTE;
                const hHeight = (dispEnd - dispStart) * PIXELS_PER_MINUTE;
                const high = document.createElement('div');
                high.style.position = 'absolute'; high.style.left = '0'; high.style.right = '0';
                high.style.top = hTop + 'px'; high.style.height = hHeight + 'px';
                high.style.backgroundColor = 'rgba(255, 247, 237, 0.6)'; high.style.zIndex = '0';
                timeGridContainer.appendChild(high);
            }
        }

        // 授業日・試験期間区切り
        const isRegularExamDay = dayEvents.some(e => {
            const ev = e.event || '';
            return ev.includes('前期中間試験') || ev.includes('前期末試験') || ev.includes('後期中間試験') || ev.includes('学年末試験');
        });
        const isMakeupDay = dayEvents.some(e => (e.event || '').includes('補講'));
        if (weekdayEv || isRegularExamDay || isMakeupDay) {
            const matrixSource = isRegularExamDay ? EXAM_PERIOD_TIMES : PERIOD_TIMES;
            [1, 2, 3, 4].forEach(p => {
                const matrix = matrixSource[p]; if (!matrix) return;
                const parseTime = (t) => { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
                const pS = parseTime(matrix.start); const pE = parseTime(matrix.end);
                const sL = START_HOUR * 60; const eL = END_HOUR * 60;
                if (pE <= sL || pS >= eL) return;
                const top = (Math.max(pS, sL) - sL) * PIXELS_PER_MINUTE;
                const h = (Math.min(pE, eL) - Math.max(pS, sL)) * PIXELS_PER_MINUTE;
                const pDiv = document.createElement('div');
                pDiv.style.position = 'absolute'; pDiv.style.left = '0'; pDiv.style.right = '0';
                pDiv.style.top = top + 'px'; pDiv.style.height = h + 'px';
                pDiv.style.borderTop = isRegularExamDay ? '1px solid var(--secondary-purple)' : '1px dotted var(--neutral-300)';
                pDiv.style.borderBottom = isRegularExamDay ? '1px solid var(--secondary-purple)' : '1px dotted var(--neutral-300)';
                pDiv.style.backgroundColor = isRegularExamDay ? 'rgba(232, 121, 249, 0.05)' : 'transparent';
                pDiv.style.zIndex = '1'; pDiv.style.pointerEvents = 'none';
                const pL = document.createElement('span');
                pL.textContent = `${p}限` + (isRegularExamDay ? '(試)' : '');
                pL.style.position = 'absolute'; pL.style.right = '5px'; pL.style.top = '2px';
                pL.style.fontSize = '0.6rem'; pL.style.color = isRegularExamDay ? 'var(--secondary-purple)' : 'var(--neutral-400)';
                pDiv.appendChild(pL);
                timeGridContainer.appendChild(pDiv);
            });
        }

        // 時間指定イベント (Priority 2)
        const timedOnDay = allDisplayEvents.filter(ev => {
            if (getSortPriority(ev) !== 2 || ev.startDate !== dStr) return false;
            return true;
        });

        // 重なり計算 (既存ロジック)
        timedOnDay.sort((a, b) => {
            const sA = getEffectiveTime(a, dStr);
            const sB = getEffectiveTime(b, dStr);
            return sA.localeCompare(sB);
        });

        const columns = [];
        const parseTime = (t) => { if (!t) return 0; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
        timedOnDay.forEach(ev => {
            const sMin = parseTime(getEffectiveTime(ev, dStr));
            const eMin = parseTime(getEndTime(ev, dStr));
            let placed = false;
            for (let c = 0; c < columns.length; c++) {
                const col = columns[c];
                const last = col[col.length - 1];
                const lastEMin = parseTime(getEndTime(last, dStr));
                if (lastEMin <= sMin) { col.push(ev); ev.colIdx = c; placed = true; break; }
            }
            if (!placed) { columns.push([ev]); ev.colIdx = columns.length - 1; }
        });

        const maxC = columns.length;
        const cw = 100 / (maxC || 1);
        timedOnDay.forEach(ev => {
            const el = document.createElement('div');
            el.className = 'event-item';
            const item = ev.data;
            const isProc = item.isLeaveCard || item.isTripCard || item.isWfhCard || item.isHolidayWorkCard;
            if (isProc) {
                el.classList.add('process-card');
                if (item.isLeaveCard) el.classList.add('leave-card');
                if (item.isTripCard) el.classList.add('trip-card');
                if (item.isWfhCard) el.classList.add('wfh-card');
                if (item.isHolidayWorkCard) el.classList.add('holiday-work-card');
            } else { el.classList.add(ev.type === 'myclass' ? 'myclass' : 'custom'); }

            const sMin = parseTime(getEffectiveTime(ev, dStr));
            const eMin = parseTime(getEndTime(ev, dStr));
            const top = (sMin - (START_HOUR * 60)) * PIXELS_PER_MINUTE;
            const h = (eMin - sMin) * PIXELS_PER_MINUTE;

            el.style.position = 'absolute';
            el.style.top = top + 'px';
            el.style.setProperty('height', h + 'px', 'important');
            el.style.setProperty('min-height', h + 'px', 'important');
            el.style.left = (ev.colIdx * cw) + '%'; el.style.width = (cw - 1) + '%';
            el.style.zIndex = '10'; el.style.fontSize = '0.7rem'; el.style.overflow = 'hidden';
            el.style.borderRadius = '4px'; el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';

            if (ev.type === 'myclass') {
                const name = item.name || '授業';
                const loc = item.location || '';
                const teacher = item.teacher || (Array.isArray(item.teachers) ? item.teachers.join(', ') : '');
                el.innerHTML = `<div class="class-name">${name}</div>${loc ? `<div class="class-detail">📍 ${loc}</div>` : ''}${teacher ? `<div class="class-detail">👤 ${teacher}</div>` : ''}`;
            } else {
                el.textContent = (item.event || item.name || '').split('\n')[0];
                el.style.padding = '2px';
            }

            if (!isEventParticipating(ev, dStr, assignmentExclusions)) {
                el.style.opacity = '0.5'; el.style.filter = 'grayscale(1)';
            }
            addEventInteractions(el, ev, dStr);
            timeGridContainer.appendChild(el);
        });

        // 今日の現在時刻を示す赤線
        if (dStr === formatDateKey(new Date())) {
            const now = new Date();
            const nowMin = now.getHours() * 60 + now.getMinutes();
            const startLimit = START_HOUR * 60;
            const endLimit = END_HOUR * 60;
            if (nowMin >= startLimit && nowMin <= endLimit) {
                const nowTop = (nowMin - startLimit) * PIXELS_PER_MINUTE;
                const redLine = document.createElement('div');
                redLine.className = 'current-time-line';
                redLine.style.top = nowTop + 'px';
                timeGridContainer.appendChild(redLine);
            }
        }

        calendarGrid.appendChild(timeGridContainer);
    });


    // --- 終日・期間バーの描画 (Lane N at grid rows) ---
    weekSegments.forEach(seg => {
        const item = seg.data;
        const el = document.createElement('div');
        el.className = 'event-item';
        const isProc = item.isLeaveCard || item.isTripCard || item.isWfhCard || item.isHolidayWorkCard;
        if (isProc) {
            el.classList.add('process-card');
            if (item.isLeaveCard) el.classList.add('leave-card');
            if (item.isTripCard) el.classList.add('trip-card');
            if (item.isWfhCard) el.classList.add('wfh-card');
            if (item.isHolidayWorkCard) el.classList.add('holiday-work-card');
            el.style.height = '28px'; // Weekly Bar height
            el.style.minHeight = '28px';
        } else {
            el.classList.add(seg.type === 'myclass' ? 'myclass' : 'custom');
        }

        // 期間中バーの端丸め (Monthly互換)
        if (seg.startDate !== seg.endDate) {
            const startsBefore = seg.startDate < seg.segStart;
            const endsAfter = seg.endDate > seg.segEnd;
            if (startsBefore && endsAfter) el.classList.add('range-middle');
            else if (startsBefore) el.classList.add('range-end');
            else if (endsAfter) el.classList.add('range-start');
        }

        el.style.gridColumn = `${seg.sIdx + 1} / span ${seg.eIdx - seg.sIdx + 1}`;
        el.style.gridRow = (3 + seg.laneIdx);
        el.style.zIndex = '15';
        el.style.margin = '1px 2px';
        el.style.fontSize = '0.75rem';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.padding = '0 6px';
        el.style.overflow = 'hidden';
        el.style.whiteSpace = 'nowrap';

        const label = item.event || item.name || (seg.original ? (seg.original.event || seg.original.name) : '無題');
        const icon = (item.isApplied ? '📄' : '') + (isEventParticipating(seg, seg.segStart, assignmentExclusions) ? '📌' : '');
        el.textContent = `${icon} ${label}`;

        if (!isEventParticipating(seg, seg.segStart, assignmentExclusions)) {
            el.style.opacity = '0.5'; el.style.filter = 'grayscale(1)';
        }

        addEventInteractions(el, seg, seg.segStart);
        calendarGrid.appendChild(el);
    });
}

// ヘルパー：イベントへのインタラクション追加
function addEventInteractions(el, ev, dStr) {
    el.draggable = true;
    el.dataset.type = ev.type;
    el.dataset.classId = ev.id;
    el.dataset.date = dStr;
    const item = ev.data || {};
    el.dataset.period = item.period || '';

    el.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        editCalendarEvent(ev.type, ev.id, dStr, item.period);
    });
    el.addEventListener('contextmenu', (e) => showEventContextMenu(e, ev.type, ev.id, dStr, item.period));
    el.addEventListener('dragstart', handleEventDragStart);
    el.addEventListener('dragend', handleEventDragEnd);

    let touchTimer;
    el.addEventListener('touchstart', (e) => {
        touchTimer = setTimeout(() => {
            showEventContextMenu(e, ev.type, ev.id, dStr, ev.data.period);
        }, 600);
    }, { passive: true });
    el.addEventListener('touchend', () => clearTimeout(touchTimer));
    el.addEventListener('touchmove', () => clearTimeout(touchTimer));
}

function renderListView() {
    const calendarGrid = document.getElementById('calendarGrid');
    const calendarTitle = document.getElementById('calendarTitle');
    calendarTitle.textContent = `${currentYear}年 ${currentMonth}月 行事リスト`;

    const startOfMonth = new Date(currentYear, currentMonth - 1, 1);
    const endOfMonth = new Date(currentYear, currentMonth, 0);
    const startStr = formatDateKey(startOfMonth);
    const endStr = formatDateKey(endOfMonth);

    // イベント抽出 (簡易)
    const events = scheduleData.filter(item => {
        const dStr = formatDateKey(item.date);
        return dStr >= startStr && dStr <= endStr && item.event;
    }).sort((a, b) => a.date - b.date);

    if (events.length === 0) {
        calendarGrid.innerHTML = '<div style="padding: 40px; text-align: center; color: var(--neutral-500);">この月の予定はありません</div>';
        return;
    }

    calendarGrid.innerHTML = '';
    events.forEach(ev => {
        const row = document.createElement('div');
        row.className = 'list-event-row';

        const datePart = document.createElement('div');
        datePart.className = 'list-date';
        const d = ev.date;
        datePart.textContent = `${d.getMonth() + 1}/${d.getDate()} (${['日', '月', '火', '水', '木', '金', '土'][d.getDay()]})`;

        const timePart = document.createElement('div');
        timePart.className = 'list-time';
        timePart.textContent = ev.startTime || '終日';

        const contentPart = document.createElement('div');
        contentPart.className = 'list-content';
        contentPart.textContent = ev.event;

        row.appendChild(datePart);
        row.appendChild(timePart);
        row.appendChild(contentPart);
        calendarGrid.appendChild(row);
    });
}

function renderMonthlyView() {
    const target = document.getElementById('targetSelect').value;
    const calendarGrid = document.getElementById('calendarGrid');
    const calendarTitle = document.getElementById('calendarTitle');
    const assignmentExclusions = JSON.parse(localStorage.getItem('assignmentExclusions') || '{}');

    // タイトル更新
    calendarTitle.textContent = `${currentYear}年 ${currentMonth}月`;

    // カレンダーグリッドをクリア
    calendarGrid.innerHTML = '';

    // 曜日ヘッダー
    const weekdays = ['月', '火', '水', '木', '金', '土', '日'];
    weekdays.forEach((day, index) => {
        const header = document.createElement('div');
        header.className = 'calendar-day-header';
        if (index === 5) header.classList.add('saturday');
        if (index === 6) header.classList.add('sunday');
        header.textContent = day;
        calendarGrid.appendChild(header);
    });

    // カレンダー日付生成
    const firstDay = new Date(currentYear, currentMonth - 1, 1);
    const lastDay = new Date(currentYear, currentMonth, 0);
    const firstWeekday = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;

    // 前月・当月・翌月を含めた42日分のリストを作成
    const allDates = [];
    const tempDate = new Date(firstDay);
    tempDate.setDate(tempDate.getDate() - firstWeekday);
    for (let i = 0; i < 42; i++) {
        allDates.push(new Date(tempDate));
        tempDate.setDate(tempDate.getDate() + 1);
    }

    const monthStartStr = formatDateKey(firstDay);
    const monthEndStr = formatDateKey(lastDay);

    // 全ての表示候補イベントを取得
    const allDisplayEvents = [];

    // 1. カスタム予定
    classOverrides.filter(ov => ov.type === 'custom' && ov.action === 'add' && ov.data).forEach(ov => {
        let start = (ov.startDate || ov.date || '').replace(/\//g, '-');
        let end = (ov.endDate || ov.date || ov.startDate || '').replace(/\//g, '-');
        if (!start || !end) return;
        if (end < formatDateKey(allDates[0]) || start > formatDateKey(allDates[41])) return;
        allDisplayEvents.push({ id: String(ov.id), startDate: start, endDate: end, type: 'custom', data: ov.data, original: ov });
    });

    // 2. Excel予定
    scheduleData.forEach(item => {
        if (!item.event || item.event.trim() === '') return;
        const dStr = formatDateKey(item.date);
        if (item.date < allDates[0] || item.date > allDates[41]) return;
        if (classOverrides.some(ov => String(ov.id) === String(item.id) && ov.type === 'excel' && ov.date === dStr && (ov.action === 'delete' || ov.action === 'move'))) return;
        allDisplayEvents.push({ id: String(item.id), startDate: dStr, endDate: dStr, type: 'excel', data: item, original: item });
    });

    // 3. 移動済みExcel
    classOverrides.filter(ov => ov.type === 'excel' && ov.action === 'move' && ov.data).forEach(ov => {
        if (ov.date < formatDateKey(allDates[0]) || ov.date > formatDateKey(allDates[41])) return;
        allDisplayEvents.push({ id: String(ov.id), startDate: ov.date, endDate: ov.date, type: 'excel', data: ov.data, original: ov });
    });

    // 4. マイクラス（授業）
    if (typeof getDisplayableClassesForDate === 'function') {
        allDates.forEach(d => {
            const currentDStr = formatDateKey(d);
            const dayEvents = scheduleData.filter(item => item.date.toDateString() === d.toDateString() && !item.fromMyClass);
            getDisplayableClassesForDate(d, dayEvents).forEach(cls => {
                allDisplayEvents.push({
                    id: String(cls.id),
                    startDate: currentDStr,
                    endDate: currentDStr,
                    type: 'myclass',
                    data: cls,
                    period: cls.displayPeriod,
                    original: cls
                });
            });
        });
    }

    // --- 重複イベントの統合 (表示用) ---
    // 同じ日付・時間・イベント名のものは1つにまとめる
    // これにより「大掃除」などが複数登録されていても1つだけ表示し、重複警告も出さないようにする
    const uniqueDisplayEventsMap = new Map();
    allDisplayEvents.forEach(ev => {
        const d = ev.data || {};
        const name = (d.event || d.name || (ev.original ? (ev.original.event || ev.original.name) : '') || '').trim();
        const sTime = getEffectiveTime(ev, ev.startDate);
        const eTime = getEndTime(ev, ev.endDate);

        // ユニークキー: 期間 + 名前 + 時間
        // IDは含めない（別IDでも中身が同じなら統合するため）
        const key = `${ev.startDate}_${ev.endDate}_${name}_${sTime}_${eTime}`;

        if (!uniqueDisplayEventsMap.has(key)) {
            uniqueDisplayEventsMap.set(key, ev);
        } else {
            // 既にある場合、優先度が高い方（参加している方）を残す
            const existing = uniqueDisplayEventsMap.get(key);
            const isPartExisting = isEventParticipating(existing, ev.startDate, assignmentExclusions);
            const isPartNew = isEventParticipating(ev, ev.startDate, assignmentExclusions);

            // 新しい方が参加状態で、既存が不参加なら入れ替える
            if (isPartNew && !isPartExisting) {
                uniqueDisplayEventsMap.set(key, ev);
            }
        }
    });
    // allDisplayEventsを更新
    allDisplayEvents.length = 0;
    allDisplayEvents.push(...Array.from(uniqueDisplayEventsMap.values()));

    // 重複チェック
    const dayOverlapInfo = new Map();
    allDates.forEach(d => {
        const dStr = formatDateKey(d);
        // 重複チェック対象: 「時間指定予定」「出張」または「📌止めのある予定」を抽出
        const relevant = allDisplayEvents.filter(ov => {
            if (!(dStr >= ov.startDate && dStr <= ov.endDate)) return false;

            const isPart = isEventParticipating(ov, dStr, assignmentExclusions);
            if (!isPart) return false;

            const item = ov.data || {};
            const p = getSortPriority(ov);
            const isTimed = (p === 2);
            const eventName = item.event || item.name || (ov.original ? (ov.original.event || ov.original.name) : '');

            // 出張判定: カード属性または名称に「出張」を含む
            const isTrip = !!item.isTripCard || (typeof eventName === 'string' && eventName.includes('出張'));
            // 在宅判定: カード属性または名称に「在宅」を含む
            const isWfh = !!item.isWfhCard || (typeof eventName === 'string' && eventName.includes('在宅'));
            const isPinned = typeof containsPinnedKeyword === 'function' && containsPinnedKeyword(eventName);

            return true;
        });

        const localConflicts = [];
        for (let i = 0; i < relevant.length; i++) {
            for (let j = i + 1; j < relevant.length; j++) {
                const ov1 = relevant[i];
                const ov2 = relevant[j];
                const p1 = getSortPriority(ov1);
                const p2 = getSortPriority(ov2);

                const getName = (o) => {
                    const d = o.data || {};
                    const n = d.event || d.name || (o.original ? (o.original.event || o.original.name) : '') || '無題';
                    return n.split('\n')[0].replace(/[📌📍]/g, '').trim();
                };
                const name1 = getName(ov1);
                const name2 = getName(ov2);

                const isTrip1 = !!ov1.data?.isTripCard || name1.includes('出張');
                const isTrip2 = !!ov2.data?.isTripCard || name2.includes('出張');
                const isWfh1 = !!ov1.data?.isWfhCard || name1.includes('在宅');
                const isWfh2 = !!ov2.data?.isWfhCard || name2.includes('在宅');
                const isTimed1 = (p1 === 2);
                const isTimed2 = (p2 === 2);
                const isPinned1 = typeof containsPinnedKeyword === 'function' && containsPinnedKeyword(name1);
                const isPinned2 = typeof containsPinnedKeyword === 'function' && containsPinnedKeyword(name2);

                // 重複判定を行う:
                // relevant リストに入っている時点で「時間指定」「出張/在宅」「📌」のいずれか
                // 1784行目以降の例外ケースに該当しなければ時間帯の重なりをチェックする
                let needsCheck = true;
                if (!needsCheck) continue; // (実際には常に true ですが、構造を維持)

                // 警告(⚠️)を出さない例外ケース (終日予定同士の重なり etc):
                const isSpecial1 = isTrip1 || isWfh1;
                const isSpecial2 = isTrip2 || isWfh2;

                // 終日予定の📌（行事）と時間指定予定（授業・予定）の重複は除外 (ユーザー要望)
                // relevantリストに入っている時点ですべて「参加(📌)」扱いなので、isPinnedによるキーワード判定は不要とする
                const isAllDayPinned1 = (p1 < 2 && !isSpecial1);
                const isAllDayPinned2 = (p2 < 2 && !isSpecial2);
                const isTimedOrClass1 = (ov1.type === 'myclass' || p1 === 2);
                const isTimedOrClass2 = (ov2.type === 'myclass' || p2 === 2);

                if ((isAllDayPinned1 && isTimedOrClass2) || (isTimedOrClass1 && isAllDayPinned2)) {
                    continue;
                }

                if (p1 < 2 && p2 < 2) {
                    // 両方が通常の行事（出張・在宅でない）なら除外
                    if (!isSpecial1 && !isSpecial2) continue;
                    // 同じ種類の特殊予定（出張同士、在宅同士で名前が同じ）なら除外
                    if (isTrip1 && isTrip2 && name1 === name2) continue;
                    if (isWfh1 && isWfh2 && name1 === name2) continue;
                }

                const s1 = getEffectiveTime(ov1, dStr);
                const e1 = getEndTime(ov1, dStr);
                const s2 = getEffectiveTime(ov2, dStr);
                const e2 = getEndTime(ov2, dStr);

                // 時間帯の重なり判定: (s1 < e2 && s2 < e1)
                if (s1 < e2 && s2 < e1) {
                    const t1 = p1 === 2 ? `(${s1}-${e1})` : '(終日)';
                    const t2 = p2 === 2 ? `(${s2}-${e2})` : '(終日)';
                    const pair = [name1 + t1, name2 + t2].sort();
                    localConflicts.push(`・${pair[0]} と ${pair[1]}`);
                }
            }
        }
        if (localConflicts.length > 0) {
            const uniqueConflicts = [...new Set(localConflicts)];
            dayOverlapInfo.set(dStr, "【重複警告】\n" + uniqueConflicts.join("\n"));
        }
    });

    let currentGlobalRow = 2; // Header is row 1
    const holidayMaps = new Map(); // 年をキーとした祝日マップのキャッシュ

    for (let w = 0; w < 6; w++) {
        const weekDates = allDates.slice(w * 7, (w + 1) * 7);
        const weekStartStr = formatDateKey(weekDates[0]);
        const weekEndStr = formatDateKey(weekDates[6]);

        const weekSegments = [];
        allDisplayEvents.forEach(ov => {
            const start = ov.startDate > weekStartStr ? ov.startDate : weekStartStr;
            const end = ov.endDate < weekEndStr ? ov.endDate : weekEndStr;
            if (start <= end) {
                const sIdx = weekDates.findIndex(d => formatDateKey(d) === start);
                const eIdx = weekDates.findIndex(d => formatDateKey(d) === end);
                weekSegments.push({ ...ov, sIdx, eIdx, segStart: start, segEnd: end });
            }
        });

        weekSegments.sort((a, b) => {
            const pA = getSortPriority(a);
            const pB = getSortPriority(b);
            if (pA !== pB) return pA - pB;
            if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
            return getEffectiveTime(a, a.segStart).localeCompare(getEffectiveTime(b, b.segStart));
        });

        const weekLanes = [];
        weekSegments.forEach(seg => {
            const span = (seg.data.isLeaveCard || seg.data.isTripCard || seg.data.isWfhCard || seg.data.isHolidayWorkCard) ? 2 : 1;
            let targetL = 0;
            while (true) {
                let possible = true;
                for (let s = 0; s < span; s++) {
                    const lIdx = targetL + s;
                    if (!weekLanes[lIdx]) weekLanes[lIdx] = new Array(7).fill(false);
                    for (let x = seg.sIdx; x <= seg.eIdx; x++) if (weekLanes[lIdx][x]) { possible = false; break; }
                }
                if (possible) {
                    for (let s = 0; s < span; s++) for (let x = seg.sIdx; x <= seg.eIdx; x++) weekLanes[targetL + s][x] = true;
                    seg.laneIdx = targetL;
                    seg.laneSpan = span;
                    break;
                }
                targetL++;
            }
        });

        const totalRows = 1 + weekLanes.length;

        weekDates.forEach((date, i) => {
            const dStr = formatDateKey(date);
            const weekday = date.getDay();
            const isOther = date.getMonth() !== currentMonth - 1;

            const bg = document.createElement('div');
            bg.className = 'calendar-day-bg';
            if (weekday === 6) bg.classList.add('saturday');
            if (weekday === 0) bg.classList.add('sunday');
            if (isOther) bg.classList.add('other-month');
            if (dStr === formatDateKey(new Date())) bg.classList.add('today');
            if (dayOverlapInfo.has(dStr)) bg.classList.add('has-overlap');

            const dateYear = date.getFullYear();
            if (!holidayMaps.has(dateYear)) {
                holidayMaps.set(dateYear, typeof getHolidaysForYear === 'function' ? getHolidaysForYear(dateYear) : {});
            }
            const holN = typeof getHolidayName === 'function' ? getHolidayName(date, holidayMaps.get(dateYear)) : null;

            // 年休候補日（授業がなく、かつ祝日でもない平日）
            // 年休候補日（担当授業や重要行事がなく、かつ祝日でもない平日）
            const isBusDay = weekday !== 0 && weekday !== 6 && !holN;
            const hasImportantEvents = allDisplayEvents.some(ov => {
                if (!(dStr >= ov.startDate && dStr <= ov.endDate)) return false;
                const label = ov.data?.event || ov.data?.name || '';
                return isEventParticipating(ov, dStr, assignmentExclusions);
            });
            if (isBusDay && !hasImportantEvents) bg.classList.add('vacation-candidate');
            bg.style.gridColumn = i + 1;
            bg.style.gridRow = `${currentGlobalRow} / span ${totalRows}`;

            bg.onclick = (e) => {
                if (e.target !== bg) return;

                // モバイル用コピー・移動アクションの実行
                if (mobileAction) {
                    executeMobileAction(dStr);
                    return;
                }

                editCalendarEvent('custom', 'custom-' + Date.now(), dStr);
            };
            bg.oncontextmenu = (e) => {
                if (e.target !== bg) return;
                if (typeof showAnnualLeaveMenu === 'function') showAnnualLeaveMenu(e, dStr);
            };

            // モバイル用：長押しでメニュー
            let bgTouchTimer;
            bg.addEventListener('touchstart', (e) => {
                if (e.target !== bg) return;
                bgTouchTimer = setTimeout(() => {
                    if (typeof showAnnualLeaveMenu === 'function') showAnnualLeaveMenu(e, dStr);
                }, 600);
            }, { passive: true });
            bg.addEventListener('touchend', () => clearTimeout(bgTouchTimer));
            bg.addEventListener('touchmove', () => clearTimeout(bgTouchTimer));

            bg.dataset.date = dStr;
            bg.addEventListener('dragover', handleDayDragOver);
            bg.addEventListener('dragleave', handleDayDragLeave);
            bg.addEventListener('drop', (e) => handleDayDrop(e, dStr));
            calendarGrid.appendChild(bg);

            const hr = document.createElement('div');
            hr.className = 'day-header';
            hr.style.gridColumn = i + 1;
            hr.style.gridRow = currentGlobalRow;
            hr.innerHTML = `<div class="day-number">${date.getDate()}</div><div class="day-badges"></div>`;
            const bads = hr.querySelector('.day-badges');

            if (holN) { const hl = document.createElement('div'); hl.className = 'day-holiday'; hl.textContent = holN; bads.appendChild(hl); }
            const work = typeof getWorkTimeForDate === 'function' ? getWorkTimeForDate(date) : null;
            if (work && weekday !== 0 && weekday !== 6) {
                const wb = document.createElement('div');
                wb.className = 'day-work-badge';
                wb.textContent = (work.isApplied ? '📄' : '') + (work.name || '').replace('勤務', '');
                if (work.isOverride && !work.isApplied) wb.classList.add('is-override');
                wb.onclick = (e) => { e.stopPropagation(); showWorkShiftMenu(e, dStr); };

                // モバイル用：長押し/タップでメニュー (タップでも呼び出し可能にする)
                wb.addEventListener('touchstart', (e) => {
                    e.stopPropagation();
                    // バッジは小さいのでタップで即座にメニューを出しても良い
                    showWorkShiftMenu(e, dStr);
                }, { passive: true });

                bads.appendChild(wb);
            }

            // 重複アイコン
            if (dayOverlapInfo.has(dStr)) {
                const ovIcon = document.createElement('div');
                ovIcon.className = 'day-overlap-icon';
                ovIcon.innerHTML = '⚠️';
                ovIcon.title = dayOverlapInfo.get(dStr);
                bads.appendChild(ovIcon);
            }

            const dayEvs = scheduleData.filter(item => item.date.toDateString() === date.toDateString());

            // 曜日カウント（学生・共通モード時）
            if (target === 'both' || target === 'student') {
                const wc = dayEvs.find(it => it.weekdayCount)?.weekdayCount;
                if (wc) { const wcd = document.createElement('div'); wcd.className = 'day-weekday-count'; wcd.textContent = wc; bads.appendChild(wcd); }
            }

            // 補講日バッジ
            if (dayEvs.some(it => (it.event && it.event.includes('補講日')) || (it.weekdayCount && it.weekdayCount.includes('補講日')))) {
                const mk = document.createElement('div'); mk.className = 'day-makeup-count'; mk.textContent = '補講日'; bads.appendChild(mk);
            }

            // 試験バッジ
            ['前期中間試験', '前期末試験', '後期中間試験', '学年末試験'].forEach(examType => {
                if (dayEvs.some(it => it.event && it.event.includes(examType))) {
                    const eb = document.createElement('div');
                    eb.className = 'day-exam-badge';
                    eb.textContent = examType;
                    bads.appendChild(eb);
                }
            });
            calendarGrid.appendChild(hr);
        });

        weekSegments.forEach(seg => {
            const item = seg.data;
            const el = document.createElement('div');
            el.className = 'event-item';
            const isProc = item.isLeaveCard || item.isTripCard || item.isWfhCard || item.isHolidayWorkCard;
            if (isProc) {
                el.classList.add('process-card');
                if (item.isLeaveCard) el.classList.add('leave-card');
                if (item.isTripCard) el.classList.add('trip-card');
                if (item.isWfhCard) el.classList.add('wfh-card');
                if (item.isHolidayWorkCard) el.classList.add('holiday-work-card');
            } else { el.classList.add(seg.type === 'myclass' ? 'myclass' : 'custom'); }

            if (seg.startDate !== seg.endDate) {
                if (seg.segStart === seg.startDate) el.classList.add('range-start');
                else if (seg.segEnd === seg.endDate) el.classList.add('range-end');
                else el.classList.add('range-middle');
            }
            el.style.gridColumn = `${seg.sIdx + 1} / span ${seg.eIdx - seg.sIdx + 1}`;
            el.style.gridRow = `${currentGlobalRow + 1 + seg.laneIdx} / span ${seg.laneSpan || 1}`;

            let label = item.event || item.name || '';
            let td = '';

            const isPart = isEventParticipating(seg, seg.segStart, assignmentExclusions);

            if (item.isTripCard) {
                label = `出張: ${item.tripDetails?.destination || item.location || ''}`;
                const fmt = (dStr, tStr) => {
                    const d = parseDateKey(dStr);
                    return `<span>${d.getMonth() + 1}/${d.getDate()} </span><span class="time-start">${tStr || '00:00'}</span>`;
                };
                td = `${fmt(seg.startDate, item.startTime)}<span class="time-separator"> ～ </span>${fmt(seg.endDate, item.endTime)}`;
            } else {
                if (item.isWfhCard) label = `🏠 在宅勤務`;
                const sT = getEffectiveTime(seg, seg.segStart);
                const eT = getEndTime(seg, seg.segEnd);
                if (sT !== '00:00' || eT !== '23:59') {
                    td = `<span class="time-start">${sT}</span><span class="time-separator">-</span><span class="time-end">${eT}</span>`;
                } else {
                    td = '';
                }
            }

            // アイコン設定: 申請済み(📄) + 重要/参加(📌)
            // 参加中の場合のみ📌を表示（申請済みor授業or特定キーワードのあるExcel）
            const pinnedIcon = isPart ? '📌' : '';
            const icon = (item.isApplied ? '📄' : '') + pinnedIcon;

            // 非参加の場合はグレーアウト
            if (!isPart) {
                el.style.opacity = '0.4';
                el.style.filter = 'grayscale(1)';
                el.classList.add('not-participating');
            }
            if (isProc) {
                el.innerHTML = `<div class="process-card-label">${icon}${label}</div>${td ? `<div class="process-card-time mobile-time-only">${td}</div>` : ''}<button class="event-delete-btn" onclick="deleteCalendarEvent(event, '${seg.type}', '${seg.id}', '${seg.segStart}')">×</button>`;
            } else {
                const mark = typeof replaceSpecialMarks === 'function' ? replaceSpecialMarks(label) : label;
                el.innerHTML = `<span class="event-text">${icon} ${td ? `<span class="calendar-event-time mobile-time-only">${td}</span> ` : ''}${mark}</span><button class="event-delete-btn" onclick="deleteCalendarEvent(event, '${seg.type}', '${seg.id}', '${seg.segStart}')">×</button>`;
            }
            el.draggable = true;
            el.dataset.type = seg.type;
            el.dataset.classId = seg.id;
            el.dataset.date = seg.segStart;
            el.dataset.period = seg.period || (item.period !== undefined ? item.period : '');
            el.title = label + (td ? ` (${td})` : '');
            el.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                editCalendarEvent(seg.type, seg.id, seg.segStart, el.dataset.period);
            });
            el.addEventListener('contextmenu', (e) => showEventContextMenu(e, seg.type, seg.id, seg.segStart, el.dataset.period));
            el.addEventListener('dragstart', handleEventDragStart);
            el.addEventListener('dragend', handleEventDragEnd);

            // モバイル用：長押しでコンテキストメニュー
            let touchTimer;
            el.addEventListener('touchstart', (e) => {
                touchTimer = setTimeout(() => {
                    showEventContextMenu(e, seg.type, seg.id, seg.segStart, el.dataset.period);
                }, 600);
            }, { passive: true });
            el.addEventListener('touchend', () => clearTimeout(touchTimer));
            el.addEventListener('touchmove', () => clearTimeout(touchTimer));

            calendarGrid.appendChild(el);
        });

        currentGlobalRow += totalRows;
    }
};

// =============================
// カレンダー補助関数
// =============================

/**
 * イベントの表示順位（プライオリティ）を取得
 * 0: 期間予定(リボン), 1: 終日予定, 2: 時間指定予定(タイト)
 */
// 補助関数: 時刻文字列(H:m)を比較可能な形式(HH:mm)に正規化
const normalizeTimeStr = (t) => {
    if (!t || typeof t !== 'string') return '00:00';
    const parts = t.split(':');
    if (parts.length >= 2) {
        return parts[0].padStart(2, '0') + ':' + parts[1].padStart(2, '0');
    }
    return t.length === 4 && !t.includes(':') ? t.substring(0, 2) + ':' + t.substring(2) : t;
};

function getSortPriority(ov) {
    const item = ov.data || {};
    // 期間予定（複数日にまたがるもの）はリボン表示として最優先（レーン確保用）
    if (ov.startDate !== ov.endDate) return 0;

    // 終日予定か時間指定予定かを判定
    const isTimed = (item.startTime && item.startTime !== '00:00' && item.startTime !== '0:00') ||
        (item.endTime && item.endTime !== '23:59') ||
        (ov.type === 'myclass') ||
        (item.isLeaveCard && item.leaveType !== 'full');

    return isTimed ? 2 : 1;
}

/**
 * イベントの有効な開始時刻を取得
 */
function getEffectiveTime(ov, dateStr) {
    const item = ov.data || {};

    // 既に開始時刻がプロパティとして存在する場合はそれを優先（マイクラス等）
    if (item.startTime) return item.startTime;

    // 授業の場合：時限マスタから取得
    if (ov.type === 'myclass') {
        const p = ov.period || item.displayPeriod || item.originalPeriod;
        if (PERIOD_TIMES[p]) return PERIOD_TIMES[p].start;
        if (typeof p === 'string' && p.includes('-')) {
            const first = p.split('-')[0];
            if (PERIOD_TIMES[first]) return PERIOD_TIMES[first].start;
        }
        return '09:00';
    }

    // 年休カードの場合：勤務時間に合わせて動的に計算
    if (item.isLeaveCard) {
        const d = parseDateKey(dateStr);
        const work = typeof getWorkTimeForDate === 'function' ? getWorkTimeForDate(d, true) : { start: '08:30', end: '17:00' };
        if (!work) return '08:30';
        if (item.leaveType === 'morning') return work.start;
        if (item.leaveType === 'afternoon') return '13:00'; // 一般的な午後開始
        return work.start;
    }

    // 出張の場合：初日のみ開始時刻を適用、それ以外は終日扱い(00:00)
    if (item.isTripCard) {
        if (dateStr === ov.startDate) return normalizeTimeStr(item.startTime || '00:00');
        return '00:00';
    }

    return normalizeTimeStr(item.startTime || '00:00');
}

/**
 * イベントの有効な終了時刻を取得
 */
function getEndTime(ov, dateStr) {
    const item = ov.data || {};

    // 既に終了時刻がプロパティとして存在する場合はそれを優先（マイクラス等）
    if (item.endTime) return item.endTime;

    // 授業の場合：時限マスタから取得
    if (ov.type === 'myclass') {
        const p = ov.period || item.displayPeriod || item.originalPeriod;
        if (PERIOD_TIMES[p]) return PERIOD_TIMES[p].end;
        if (typeof p === 'string' && p.includes('-')) {
            const parts = p.split('-');
            const last = parts[parts.length - 1];
            if (PERIOD_TIMES[last]) return PERIOD_TIMES[last].end;
        }
        return '16:25';
    }

    // 年休の場合
    if (item.isLeaveCard) {
        const d = parseDateKey(dateStr);
        const work = typeof getWorkTimeForDate === 'function' ? getWorkTimeForDate(d, true) : { start: '08:30', end: '17:00' };
        if (!work) return '17:00';
        if (item.leaveType === 'morning') return '13:00'; // 一般的な午前終了
        if (item.leaveType === 'afternoon') return work.end;
        if (item.leaveType === 'late' || item.leaveType === 'full') return work.end;
        if (item.leaveType === 'early') {
            const mins = (item.leaveHours || 0) * 60 + (item.leaveExtra || 0);
            return typeof addMinutes === 'function' ? addMinutes(work.start, mins) : work.end;
        }
    }

    // 出張の場合：最終日のみ終了時刻を適用、それ以外は終日扱い(23:59)
    if (item.isTripCard) {
        if (dateStr === ov.endDate) return normalizeTimeStr(item.endTime || '23:59');
        return '23:59';
    }

    return normalizeTimeStr(item.endTime || '23:59');
}

function createDayCell() { return document.createElement('div'); }


// =============================
// カレンダー操作・ドラッグ＆ドロップ
// =============================

function handleEventDragStart(e) {
    const el = e.target.closest('.event-item, .timetable-class-card');
    if (!el) return;

    const data = {
        type: el.dataset.type,
        id: el.dataset.classId,
        sourceDate: el.dataset.date,
        period: el.dataset.period,
        text: el.querySelector('.event-text')?.textContent || el.textContent
    };

    // 'text/plain' を使用
    e.dataTransfer.setData('text/plain', JSON.stringify(data));

    // Ctrlキーが押されている場合は copy/複製、そうでなければ move/移動
    if (e.ctrlKey || e.metaKey) {
        e.dataTransfer.effectAllowed = 'copy';
    } else {
        e.dataTransfer.effectAllowed = 'move';
    }

    el.classList.add('dragging');

    // ドラッグ中のゴーストイメージを少し透明に
    setTimeout(() => {
        if (el) el.style.opacity = '0.5';
    }, 0);
}
window.handleEventDragStart = handleEventDragStart;

function handleEventDragEnd(e) {
    const el = e.target.closest('.event-item, .timetable-class-card');
    if (el) {
        el.classList.remove('dragging');
        el.style.opacity = '';
    }
}
window.handleEventDragEnd = handleEventDragEnd;

function handleDayDragOver(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
        e.dataTransfer.dropEffect = 'copy';
    } else {
        e.dataTransfer.dropEffect = 'move';
    }
    e.currentTarget.classList.add('drag-over');
}

function handleDayDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

function handleDayDrop(e, dateStrFromArg) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');

    const targetDate = dateStrFromArg || e.currentTarget.dataset.date;
    const json = e.dataTransfer.getData('text/plain');
    if (!json) return;

    try {
        const data = JSON.parse(json);
        if (data.sourceDate === targetDate) return;

        // ドロップ時のキー状態、またはカレンダー外（時間割リストなど）からの追加であればコピー（新規インスタンス）扱いとする
        const isCopy = !data.sourceDate || (e.ctrlKey || e.metaKey) || (e.dataTransfer.dropEffect === 'copy');

        // 移動/コピー処理
        moveCalendarEvent(data, targetDate, isCopy);
    } catch (err) {
        console.error('Drop data error:', err);
    }
}

function moveCalendarEvent(eventData, targetDate, isCopy = false) {
    if (!eventData || !targetDate) return;

    const id = eventData.id;
    const type = eventData.type;
    const sourceDate = eventData.sourceDate;
    const period = eventData.period;

    let movingData = null;

    // A. まず移動元にある「データ付きオーバライド（既に移動済みのもの）」を探して退避する
    const existingSourceOv = classOverrides.find(ov =>
        String(ov.id) === String(id) &&
        ov.date === sourceDate &&
        ov.type === type &&
        ov.action === 'move' &&
        ov.data &&
        (type !== 'myclass' || String(ov.period) === String(period))
    );

    if (existingSourceOv && existingSourceOv.data) {
        movingData = JSON.parse(JSON.stringify(existingSourceOv.data));
    } else {
        // 新規移動の場合、マスタからデータを取得
        if (type === 'myclass') {
            const baseCls = myClasses.find(c => String(c.id) === String(id));
            if (baseCls) movingData = JSON.parse(JSON.stringify(baseCls));
        } else if (type === 'excel') {
            const item = scheduleData.find(i => String(i.id) === String(id) && formatDateKey(i.date) === sourceDate);
            if (item) {
                movingData = {
                    event: item.event,
                    type: item.type,
                    location: item.location || '',
                    memo: item.memo || '',
                    originalId: id
                };
            } else {
                movingData = { event: eventData.text, type: 'teacher' };
            }
        }
    }

    // B. 移動元（元の日）の処理：コピーでない場合は非表示にする
    // カスタム予定以外かつ、カレンダー内からの移動（sourceDateあり）の場合のみ実行
    if (!isCopy && type !== 'custom' && sourceDate) {
        // 移動元のこのアイテムに対する既存オーバライドを消去（データ無し版と置換するため）
        classOverrides = classOverrides.filter(ov =>
            !(String(ov.id) === String(id) && ov.date === sourceDate && ov.type === type && (type !== 'myclass' || String(ov.period) === String(period)))
        );

        // 非表示レコード（action: 'move', data: なし）を追加
        classOverrides.push({
            type: type,
            id: id,
            date: sourceDate,
            action: 'move',
            period: period
        });
    }

    // C. 移動先に追加
    if (type === 'custom') {
        const existingOv = classOverrides.find(ov => ov.type === 'custom' && String(ov.id) === String(id));
        if (existingOv && existingOv.data) {
            const movingData = JSON.parse(JSON.stringify(existingOv.data));

            // 日付の移動量を計算
            const oldStart = parseDateKey(existingOv.startDate || existingOv.date);
            const oldEnd = parseDateKey(existingOv.endDate || existingOv.date || existingOv.startDate);
            const sourceDateObj = parseDateKey(sourceDate);
            const targetDateObj = parseDateKey(targetDate);

            const diffTime = targetDateObj.getTime() - sourceDateObj.getTime();
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

            const newStart = new Date(oldStart);
            newStart.setDate(newStart.getDate() + diffDays);
            const newEnd = new Date(oldEnd);
            newEnd.setDate(newEnd.getDate() + diffDays);

            if (isCopy) {
                const newId = 'custom-' + Date.now();
                classOverrides.push({
                    type: 'custom',
                    id: newId,
                    date: formatDateKey(newStart),
                    startDate: formatDateKey(newStart),
                    endDate: formatDateKey(newEnd),
                    action: 'add',
                    data: movingData
                });
            } else {
                existingOv.date = formatDateKey(newStart);
                existingOv.startDate = formatDateKey(newStart);
                existingOv.endDate = formatDateKey(newEnd);
            }
        }
    } else {
        // 移動先にある同一アイテムのオーバライドをすべて消去
        classOverrides = classOverrides.filter(ov =>
            !(String(ov.id) === String(id) && ov.date === targetDate && ov.type === type && (type !== 'myclass' || String(ov.period) === String(period)))
        );

        // コピーの場合：新規IDを生成、移動の場合：元のIDを使用
        if (isCopy) {
            if (type === 'myclass') {
                // 授業のコピー：新規IDを生成
                const newId = 'copy-' + type + '-' + Date.now();
                if (movingData) {
                    classOverrides.push({
                        type: type,
                        id: newId,
                        date: targetDate,
                        action: 'move',
                        period: period,
                        data: JSON.parse(JSON.stringify(movingData))
                    });
                }
            } else if (type === 'excel') {
                // Excelイベントのコピー：新しく追加されたイベントとして記録
                const newId = 'copy-' + id + '-' + Date.now();
                if (movingData) {
                    classOverrides.push({
                        type: type,
                        id: newId,
                        date: targetDate,
                        action: 'move',
                        period: period,
                        data: JSON.parse(JSON.stringify(movingData))
                    });
                }
            }
        } else {
            // 移動の場合：元のIDで移動先に記録を追加
            if (movingData) {
                classOverrides.push({
                    type: type,
                    id: id,
                    date: targetDate,
                    action: 'move',
                    period: period,
                    data: movingData
                });
            }
        }
    }

    saveAllToLocal();
    if (typeof renderMyClassesList === 'function') renderMyClassesList();
    updateCalendar();
}


/**
 * データの永続化
 */
function saveAllToLocal() {
    if (typeof saveMyClasses === 'function') {
        saveMyClasses(); // 既存の保存関数（my_classes.js）
    } else {
        localStorage.setItem('myClasses', JSON.stringify(myClasses));
        localStorage.setItem('classOverrides', JSON.stringify(classOverrides));
    }
    // 勤務設定も含める
    if (typeof workSettings !== 'undefined') localStorage.setItem('workSettings', JSON.stringify(workSettings));
    if (typeof workOverrides !== 'undefined') localStorage.setItem('workOverrides', JSON.stringify(workOverrides));

    // assignmentExclusionsも同期的に保存を試みる
    try {
        if (typeof assignmentExclusions !== 'undefined') {
            localStorage.setItem('assignmentExclusions', JSON.stringify(assignmentExclusions));
        }
    } catch (e) { }
}

/**
 * カレンダー項目の削除（その日だけ）
 */
function deleteCalendarEvent(e, type, id, date, period = null) {
    if (e) e.stopPropagation();
    if (!confirm('この日だけこの項目を削除しますか？')) return;

    if (type === 'custom') {
        // カスタム予定の場合はオーバライドから物理削除（IDのみで判定）
        classOverrides = classOverrides.filter(ov =>
            !(ov.type === 'custom' && String(ov.id) === String(id))
        );
    } else {
        // 削除する前に、同じ日付のmoveオーバライドをすべてクリア
        // （移動記録が残っていると、削除レコードと競合する可能性があるため）
        classOverrides = classOverrides.filter(ov =>
            !(String(ov.id) === String(id) &&
                ov.date === date &&
                ov.type === type &&
                ov.action === 'move' &&
                (type !== 'myclass' || String(ov.period) === String(period)))
        );

        // 削除レコードを追加
        classOverrides.push({
            type: type,
            id: id,
            date: date,
            action: 'delete',
            period: period !== null ? String(period) : null // 1-2などのためStringで保持
        });
    }


    saveAllToLocal();
    if (typeof renderMyClassesList === 'function') renderMyClassesList();
    updateCalendar();
}
window.deleteCalendarEvent = deleteCalendarEvent;
window.deleteCachedYear = deleteCachedYear;

/**
 * 期間予定のリサイズ（マウス操作）
 */
function startResizing(e, override) {
    document.body.style.cursor = 'ew-resize';

    // スケジュール全体のコンテナを取得してその上でマウス移動を監視
    const calendarContainer = document.getElementById('calendarGrid');

    const onMouseMove = (moveEvent) => {
        // マウス位置にあるセルを探す
        const target = moveEvent.target.closest('.calendar-day');
        if (target && target.dataset.date) {
            const newEndDateStr = target.dataset.date;
            const startDateStr = override.startDate || override.date;

            if (newEndDateStr >= startDateStr) {
                if (override.endDate !== newEndDateStr) {
                    override.endDate = newEndDateStr;
                    // カレンダーを更新（表示を反映）
                    updateCalendar();
                }
            }
        }
    };

    const onMouseUp = () => {
        document.body.style.cursor = '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
        saveAllToLocal();
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
}
window.startResizing = startResizing;

/**
 * カレンダー項目の編集（モーダル表示）
 */
/**
 * カレンダー項目の編集（モーダル表示）
 */
function editCalendarEvent(type, id, date, period) {
    const modal = document.getElementById('quickEditModal');
    const classFields = document.getElementById('quickEditClassOnlyFields');
    const allDayCheckbox = document.getElementById('quickEditAllDay');

    const participateCheckbox = document.getElementById('quickEditParticipate');
    const participateFields = document.getElementById('quickEditParticipateFields');

    // 値のリセット
    document.getElementById('quickEditType').value = type;
    document.getElementById('quickEditId').value = id;
    document.getElementById('quickEditDate').value = date;
    document.getElementById('quickEditSourcePeriod').value = period || '';
    participateCheckbox.checked = false;

    const setTimeValues = (start, end) => {
        const format = (t) => {
            if (!t) return '';
            const parts = t.split(':');
            if (parts.length >= 2) {
                return parts[0].padStart(2, '0') + ':' + parts[1].padStart(2, '0');
            }
            return t;
        };
        const sVal = format(start);
        const eVal = format(end);

        const s1 = document.getElementById('quickEditStartTime');
        const e1 = document.getElementById('quickEditEndTime');
        const s2 = document.getElementById('quickEditStartTime_Single');
        const e2 = document.getElementById('quickEditEndTime_Single');
        if (s1) s1.value = sVal;
        if (e1) e1.value = eVal;
        if (s2) s2.value = sVal;
        if (e2) e2.value = eVal;
    };

    if (type === 'myclass') {
        const cls = myClasses.find(c => String(c.id) === String(id));
        if (!cls) return;

        classFields.classList.remove('hidden');
        participateFields.classList.remove('hidden'); // 授業でもピン管理を同期
        document.getElementById('quickEditModalTitle').textContent = `${date} の授業編集`;

        const existingOv = classOverrides.find(ov =>
            String(ov.id) === String(id) &&
            ov.date === date &&
            ov.type === 'myclass' &&
            ov.action === 'move' &&
            ov.data
        );

        // 授業のピン状態（デフォルトは担当＝ピンあり。Exclusionsにあればなし）
        let isParticipating = true;
        const exclusions = JSON.parse(localStorage.getItem('assignmentExclusions') || '{}');
        const classExclusions = exclusions[id] || [];
        if (classExclusions.includes(date)) {
            isParticipating = false;
        }
        // 個別データに記録があれば優先
        if (existingOv && existingOv.data && existingOv.data.isParticipating !== undefined) {
            isParticipating = !!existingOv.data.isParticipating;
        }
        participateCheckbox.checked = isParticipating;

        // 授業はデフォルト「終日=False」
        allDayCheckbox.checked = (existingOv && existingOv.data) ? !!existingOv.data.allDay : false;
        document.getElementById('quickEditName').value = existingOv && existingOv.data ? existingOv.data.name : cls.name;
        document.getElementById('quickEditPeriod').value = existingOv ? existingOv.period : period;
        document.getElementById('quickEditLocation').value = existingOv && existingOv.data ? existingOv.data.location : (cls.location || '');
        document.getElementById('quickEditMemo').value = (existingOv && existingOv.data) ? (existingOv.data.memo || '') : '';

        // 時刻セット
        if (existingOv && existingOv.data && existingOv.data.startTime) {
            setTimeValues(existingOv.data.startTime, existingOv.data.endTime);
        } else {
            // updateQuickTimeFromPeriod も内部で setTimeValues を使うように修正
            updateQuickTimeFromPeriod();
        }
        toggleQuickEditTimeFields();

    } else if (type.startsWith('excel')) {
        classFields.classList.add('hidden');
        participateFields.classList.remove('hidden');
        document.getElementById('quickEditModalTitle').textContent = `${date} の予定編集`;

        let currentText = '';
        let currentLocation = '';
        let currentStartTime = '';
        let currentEndTime = '';
        let currentMemo = '';
        let isAllDay = true; // 行事はデフォルト「終日=True」
        let isParticipating = false;
        const item = scheduleData.find(i => String(i.id) === String(id) && formatDateKey(i.date) === date);
        const override = classOverrides.find(ov => String(ov.id) === String(id) && ov.date === date && ov.type === 'excel' && ov.action === 'move');

        if (override && override.data) {
            currentText = override.data.event;
            currentLocation = override.data.location || '';
            currentStartTime = override.data.startTime || '';
            currentEndTime = override.data.endTime || '';
            currentMemo = override.data.memo || '';
            isAllDay = override.data.allDay !== undefined ? override.data.allDay : (currentStartTime ? false : true);
            isParticipating = override.data.isParticipating !== undefined ? override.data.isParticipating : false;
        } else if (item) {
            currentText = item.event || '';
            currentLocation = item.location || '';
            currentStartTime = item.startTime || '';
            currentEndTime = item.endTime || '';
            isAllDay = (item.allDay !== undefined) ? item.allDay : (currentStartTime ? false : true);

            if (containsPinnedKeyword(currentText)) {
                isParticipating = true;
            }
        }

        allDayCheckbox.checked = isAllDay;
        participateCheckbox.checked = isParticipating;
        document.getElementById('quickEditName').value = currentText;
        document.getElementById('quickEditLocation').value = currentLocation;
        setTimeValues(currentStartTime, currentEndTime);
        document.getElementById('quickEditMemo').value = currentMemo;
        document.getElementById('quickEditDateRangeFields').classList.add('hidden');
    } else if (type === 'custom') {
        const override = classOverrides.find(ov => String(ov.id) === String(id) && ov.type === 'custom');
        const item = override ? override.data : null;

        if (item) {
            if (item.isTripCard) {
                // 出張専用モーダルで編集
                if (typeof openBusinessTripModal === 'function') {
                    openBusinessTripModal(override.startDate || override.date, override.id);
                    return;
                }
            } else if (item.isHolidayWorkCard) {
                // 休日出勤専用モーダルで編集
                if (typeof openHolidayWorkModal === 'function') {
                    openHolidayWorkModal(override.date, override.id);
                    return;
                }
            } else if (item.isWfhCard) {
                // 在宅勤務専用モーダルで編集
                if (typeof openWfhModal === 'function') {
                    openWfhModal(override.date, override.id);
                    return;
                }
            }
        }

        classFields.classList.add('hidden');
        participateFields.classList.remove('hidden');

        let title = `${date} の新規予定追加`;
        let showDateRange = true;

        if (item) {
            if (item.isLeaveCard) {
                title = '年休の編集';
                showDateRange = false;
            } else if (item.isTripCard) {
                title = '出張の編集';
                // 複数日出張なら期間を表示
                showDateRange = true;
            } else if (item.isWfhCard) {
                title = '在宅勤務の編集';
                showDateRange = false;
            } else if (item.isHolidayWorkCard) {
                title = '休日出勤の編集';
                showDateRange = false;
            } else {
                const isPeriod = (override.startDate || override.date) !== (override.endDate || override.date);
                title = isPeriod ? '期間予定の編集' : '予定の編集';
                showDateRange = true;
            }

            document.getElementById('quickEditModalTitle').textContent = title;
            document.getElementById('quickEditName').value = item.event || '';
            document.getElementById('quickEditLocation').value = item.location || '';

            let startTime = item.startTime || '';
            let endTime = item.endTime || '';

            // 年休カードの場合は表示用に時刻を算出
            if (item.isLeaveCard && typeof getWorkTimeForDate === 'function') {
                const d = parseDateKey(override.date || date);
                const work = getWorkTimeForDate(d, true);
                if (work && work.start && work.end) {
                    if (item.leaveType === 'early' || item.leaveType === 'full') startTime = work.start;
                    if (item.leaveType === 'late') startTime = addMinutes(work.end, -(item.leaveHours * 60 + (item.leaveExtra || 0)));

                    if (item.leaveType === 'late' || item.leaveType === 'full') endTime = work.end;
                    if (item.leaveType === 'early') endTime = addMinutes(work.start, item.leaveHours * 60 + (item.leaveExtra || 0));
                }
            }

            setTimeValues(startTime, endTime);
            document.getElementById('quickEditMemo').value = item.memo || '';
            document.getElementById('quickEditApplied').checked = !!item.isApplied; // 申請状況
            document.getElementById('quickEditStartDate').value = (override.startDate || override.date || date).replace(/\//g, '-');
            document.getElementById('quickEditEndDate').value = (override.endDate || override.date || date).replace(/\//g, '-');
            allDayCheckbox.checked = item.allDay !== undefined ? item.allDay : true;
            participateCheckbox.checked = item.isParticipating || false;


        } else {
            // 新規
            document.getElementById('quickEditModalTitle').textContent = title;
            document.getElementById('quickEditName').value = '';
            document.getElementById('quickEditLocation').value = '';
            setTimeValues('', '');
            document.getElementById('quickEditMemo').value = '';
            document.getElementById('quickEditApplied').checked = false; // 新規は未申請
            document.getElementById('quickEditStartDate').value = date.replace(/\//g, '-');
            document.getElementById('quickEditEndDate').value = date.replace(/\//g, '-');
            allDayCheckbox.checked = true;
            participateCheckbox.checked = false;
        }

        const rangeFields = document.getElementById('quickEditDateRangeFields');
        const singleTimeFields = document.getElementById('quickEditSingleTimeFields');
        if (showDateRange) {
            rangeFields.classList.remove('hidden');
            if (singleTimeFields) singleTimeFields.classList.add('hidden');
        } else {
            rangeFields.classList.add('hidden');
            if (singleTimeFields) singleTimeFields.classList.remove('hidden');
        }

    }

    toggleQuickEditTimeFields();
    modal.classList.remove('hidden');
    modal.classList.add('visible');
}
window.editCalendarEvent = editCalendarEvent;

/**
 * 終日フラグによる時刻入力の表示/非表示
 */
function toggleQuickEditTimeFields() {
    const isAllDay = document.getElementById('quickEditAllDay').checked;
    const timeFields = document.getElementById('quickEditTimeFields');
    const startWrapper = document.getElementById('quickEditStartTimeWrapper');
    const endWrapper = document.getElementById('quickEditEndTimeWrapper');

    if (isAllDay) {
        if (timeFields) timeFields.classList.add('hidden');
        if (startWrapper) startWrapper.classList.add('hidden');
        if (endWrapper) endWrapper.classList.add('hidden');
    } else {
        if (timeFields) timeFields.classList.remove('hidden');
        if (startWrapper) startWrapper.classList.remove('hidden');
        if (endWrapper) endWrapper.classList.remove('hidden');
    }
}

function syncQuickTime(el, type) {
    const mainId = type === 'start' ? 'quickEditStartTime' : 'quickEditEndTime';
    const singleId = type === 'start' ? 'quickEditStartTime_Single' : 'quickEditEndTime_Single';

    const main = document.getElementById(mainId);
    const single = document.getElementById(singleId);

    if (el.id === mainId) {
        if (single) single.value = el.value;
    } else {
        if (main) main.value = el.value;
    }
}
window.syncQuickTime = syncQuickTime;
window.toggleQuickEditTimeFields = toggleQuickEditTimeFields;

/**
 * 時限から時刻を自動セット（授業用）
 */
function updateQuickTimeFromPeriod() {
    const period = document.getElementById('quickEditPeriod').value;
    const PERIOD_TIMES = window.PERIOD_TIMES || {
        1: { start: '09:00', end: '10:35' },
        2: { start: '10:45', end: '12:20' },
        3: { start: '13:05', end: '14:40' },
        4: { start: '14:50', end: '16:25' }
    };

    let times = PERIOD_TIMES[period];

    // 複数時限(1-2など)への対応
    if (!times && typeof period === 'string' && period.includes('-')) {
        const parts = period.split('-');
        const first = PERIOD_TIMES[parts[0]];
        const last = PERIOD_TIMES[parts[parts.length - 1]];
        if (first && last) {
            times = { start: first.start, end: last.end };
        }
    }

    if (times) {
        // ここでも setTimeValues を使いたいが、editCalendarEventの外なので
        // 直接代入するか、共通の同期関数を呼ぶ
        const s1 = document.getElementById('quickEditStartTime');
        const e1 = document.getElementById('quickEditEndTime');
        const s2 = document.getElementById('quickEditStartTime_Single');
        const e2 = document.getElementById('quickEditEndTime_Single');
        if (s1) s1.value = times.start;
        if (e1) e1.value = times.end;
        if (s2) s2.value = times.start;
        if (e2) e2.value = times.end;
    }
}

window.updateQuickTimeFromPeriod = updateQuickTimeFromPeriod;

/**
 * 個別編集モーダルの保存処理
 */
function handleQuickEditSubmit(e) {
    e.preventDefault();
    console.log('handleQuickEditSubmit: 保存処理を開始します');

    try {
        const type = document.getElementById('quickEditType').value;
        const id = document.getElementById('quickEditId').value;
        const date = document.getElementById('quickEditDate').value;
        const sourcePeriod = document.getElementById('quickEditSourcePeriod').value;
        const isAllDay = document.getElementById('quickEditAllDay').checked;

        // 単一日モードと範囲モードのどちらからも値を読み取る
        const startTimeFromId = document.getElementById('quickEditStartTime');
        const endTimeFromId = document.getElementById('quickEditEndTime');
        const startTimeFromSingleId = document.getElementById('quickEditStartTime_Single');
        const endTimeFromSingleId = document.getElementById('quickEditEndTime_Single');

        const startTimeRaw = (startTimeFromId ? startTimeFromId.value : '') || (startTimeFromSingleId ? startTimeFromSingleId.value : '');
        const endTimeRaw = (endTimeFromId ? endTimeFromId.value : '') || (endTimeFromSingleId ? endTimeFromSingleId.value : '');

        const startTime = (isAllDay) ? '' : startTimeRaw;
        const endTime = (isAllDay) ? '' : endTimeRaw;
        const location = document.getElementById('quickEditLocation').value.trim();
        const memo = document.getElementById('quickEditMemo').value.trim();

        const participateCheck = document.getElementById('quickEditParticipate');
        const isParticipating = participateCheck ? participateCheck.checked : true;
        const newName = document.getElementById('quickEditName').value;

        if (type === 'myclass') {
            const cls = myClasses.find(c => String(c.id) === String(id));
            if (!cls) {
                console.warn(`授業データが見つかりません: ID=${id}`);
                alert('対象の授業データが見つかりません。');
                return;
            }
            const newPeriodEl = document.getElementById('quickEditPeriod');
            const newPeriod = newPeriodEl ? newPeriodEl.value : sourcePeriod;

            // 授業の参加切り替え：assignmentExclusionsで管理
            let assignmentExclusions = JSON.parse(localStorage.getItem('assignmentExclusions') || '{}');
            const dateKey = date;
            if (!assignmentExclusions[id]) {
                assignmentExclusions[id] = [];
            }

            if (isParticipating) {
                assignmentExclusions[id] = assignmentExclusions[id].filter(d => d !== dateKey);
            } else {
                if (!assignmentExclusions[id].includes(dateKey)) {
                    assignmentExclusions[id].push(dateKey);
                }
            }
            localStorage.setItem('assignmentExclusions', JSON.stringify(assignmentExclusions));

            // 既存オーバライドのクリア
            classOverrides = classOverrides.filter(ov =>
                !(String(ov.id) === String(id) && ov.date === date && ov.type === 'myclass')
            );

            // 1. 移動元を消去 (時限が変わる場合のみ)
            if (newPeriod !== sourcePeriod) {
                classOverrides.push({
                    type: 'myclass',
                    id: id,
                    date: date,
                    action: 'move',
                    period: sourcePeriod
                });
            }

            // 2. 新しいデータ
            const updatedCls = JSON.parse(JSON.stringify(cls));
            updatedCls.name = newName;
            updatedCls.location = location;
            updatedCls.allDay = isAllDay;
            updatedCls.startTime = startTime;
            updatedCls.endTime = endTime;
            updatedCls.memo = memo;
            updatedCls.isParticipating = isParticipating;

            classOverrides.push({
                type: 'myclass',
                id: id,
                date: date,
                action: 'move',
                period: newPeriod,
                data: updatedCls
            });

        } else if (type === 'excel') {
            classOverrides = classOverrides.filter(ov =>
                !(String(ov.id) === String(id) && ov.date === date && ov.type === 'excel')
            );

            classOverrides.push({
                type: 'excel',
                id: id,
                date: date,
                action: 'move',
                data: {
                    event: newName,
                    type: 'teacher',
                    allDay: isAllDay,
                    startTime: startTime,
                    endTime: endTime,
                    location: location,
                    memo: memo,
                    isParticipating: isParticipating
                }
            });
        } else if (type === 'custom') {
            const startDateEl = document.getElementById('quickEditStartDate');
            const endDateEl = document.getElementById('quickEditEndDate');
            const startDateVal = (startDateEl ? startDateEl.value : '') || date;
            const endDateVal = (endDateEl ? endDateEl.value : '') || startDateVal;
            const appliedEl = document.getElementById('quickEditApplied');
            const isApplied = appliedEl ? appliedEl.checked : false;

            const existingOverride = classOverrides.find(ov => String(ov.id) === String(id) && ov.type === 'custom');
            const existingData = existingOverride ? existingOverride.data : {};

            const updatedData = {
                ...existingData,
                event: newName,
                allDay: isAllDay,
                startTime: startTime,
                endTime: endTime,
                location: location,
                memo: memo,
                isParticipating: isParticipating,
                isApplied: isApplied
            };

            // 出張詳細への反映
            if (updatedData.isTripCard && updatedData.tripDetails) {
                updatedData.tripDetails.depTime = startTime;
                updatedData.tripDetails.arrTime = endTime;
                updatedData.tripDetails.destination = location;
            }

            // 休日出勤詳細への反映
            if (updatedData.isHolidayWorkCard && updatedData.holidayWorkDetails && startTime && endTime) {
                updatedData.holidayWorkDetails.startTime = startTime;
                updatedData.holidayWorkDetails.endTime = endTime;
                updatedData.holidayWorkDetails.content = newName.replace('休日出勤: ', '');

                const [sH, sM] = startTime.split(':').map(Number);
                const [eH, eM] = endTime.split(':').map(Number);
                if (!isNaN(sH) && !isNaN(eH)) {
                    const diffMinutes = (eH * 60 + (eM || 0)) - (sH * 60 + (sM || 0));
                    let breakMinutes = 0;
                    if (diffMinutes >= 4 * 60) breakMinutes = 45;
                    updatedData.holidayWorkDetails.breakMinutes = breakMinutes;
                    updatedData.holidayWorkDetails.workMinutes = diffMinutes - breakMinutes;
                }
            }

            // 既存同一IDのクリア
            classOverrides = classOverrides.filter(ov =>
                !(String(ov.id) === String(id) && ov.type === 'custom')
            );

            classOverrides.push({
                type: 'custom',
                id: id,
                date: startDateVal,
                startDate: startDateVal,
                endDate: endDateVal,
                action: 'add',
                data: updatedData
            });
        }

        saveAllToLocal();
        updateCalendar();
        closeQuickEditModal();
        console.log('handleQuickEditSubmit: 保存完了');
    } catch (err) {
        console.error('handleQuickEditSubmitでエラーが発生しました:', err);
        alert('保存中にエラーが発生しました: ' + err.message);
        // エラーが発生しても最低限モーダルは閉じる、あるいは状態を戻す等の考慮が必要だが
        // ここではエラー内容の通知に留める
    }
}
window.handleQuickEditSubmit = handleQuickEditSubmit;

/**
 * 手動での「すべて保存」実行
 */
function saveAllToLocalExplicit() {
    saveAllToLocal();
    localStorage.setItem('lastBackupTime', new Date().toLocaleString());
    updateBackupInfo();
    alert('すべてのデータを現在のブラウザ（LocalStorage）に保存しました。');
}
window.saveAllToLocalExplicit = saveAllToLocalExplicit;

// 復元処理はファイルの最初の方で定義されています

// 復元処理はファイルの最初の方で定義されています

/**
 * モーダルを閉じる
 */
function closeQuickEditModal() {
    const modal = document.getElementById('quickEditModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('visible');
    }
}
window.closeQuickEditModal = closeQuickEditModal;

/**
 * 月の切り替え
 */
/**
 * オーバライド（移動・削除・編集）を適用したスケジュールデータを取得
 */
function getAppliedScheduleData(target) {
    // 1. フィルタリング
    let filtered = scheduleData;
    if (target === 'teacher') {
        filtered = scheduleData.filter(item => item.type === 'teacher');
    } else if (target === 'student') {
        filtered = scheduleData.filter(item => item.type === 'student');
    }

    // 2. 削除・移動元の除外 & 祝日除外
    const result = filtered.filter(item => {
        const dateStr = formatDateKey(item.date);

        // 祝日チェック
        if (isRedundantHoliday(item.event, item.date)) return false;

        const isOverridden = classOverrides.some(ov =>
            String(ov.id) === String(item.id) &&
            ov.type === 'excel' &&
            ov.date === dateStr &&
            (ov.action === 'delete' || ov.action === 'move')
        );

        return !isOverridden;
    }).map(item => ({ ...item })); // ディープコピー

    // 3. 移動先、または編集内容の追加
    classOverrides.forEach(ov => {
        if (ov.type === 'excel' && ov.action === 'move' && ov.data) {
            // 対象チェック
            if (target !== 'both' && ov.data.type !== target) return;

            const dateObj = parseDateKey(ov.date);
            // 移動先でも祝日なら除外
            if (isRedundantHoliday(ov.data.event, dateObj)) return;

            result.push({
                id: ov.id,
                date: dateObj,
                event: ov.data.event,
                type: ov.data.type || 'teacher',
                period: ov.period || '',
                isMoved: true,
                allDay: ov.data.allDay !== undefined ? ov.data.allDay : true,
                startTime: ov.data.startTime || '',
                endTime: ov.data.endTime || '',
                location: ov.data.location || '',
                memo: ov.data.memo || ''
            });
        } else if (ov.type === 'custom' && ov.action === 'add' && ov.data) {
            // カスタム予定（期間対応）をエクスポートに展開
            const sDate = parseDateKey(ov.startDate || ov.date);
            const eDate = parseDateKey(ov.endDate || ov.date || ov.startDate);

            for (let d = new Date(sDate); d <= eDate; d.setDate(d.getDate() + 1)) {
                // ターゲット期間外はスキップ
                if (target !== 'both') {
                    // カスタム予定はひとまず共通行事扱い
                }

                result.push({
                    id: ov.id,
                    date: new Date(d),
                    event: ov.data.event,
                    type: 'custom',
                    period: '',
                    isCustom: true,
                    allDay: ov.data.allDay !== undefined ? ov.data.allDay : true,
                    startTime: ov.data.startTime || '',
                    endTime: ov.data.endTime || '',
                    location: ov.data.location || '',
                    memo: ov.data.memo || '',
                    customData: ov.data // メタデータを保持
                });
            }
        }
    });

    return result.sort((a, b) => a.date - b.date);
}


window.getAppliedScheduleData = getAppliedScheduleData;

/**
 * JSONエクスポート
 */
function exportToJson() {
    const showAnnual = document.getElementById('exportAnnual').checked;
    const showClass = document.getElementById('exportClass').checked;
    const showApplied = document.getElementById('exportApplied').checked;
    const startInput = document.getElementById('exportStartDate');
    const endInput = document.getElementById('exportEndDate');

    if (!startInput.value || !endInput.value) {
        const fiscalYear = typeof currentYear !== 'undefined' ? currentYear : new Date().getFullYear();
        if (!startInput.value) startInput.value = `${fiscalYear}-04-01`;
        if (!endInput.value) endInput.value = `${fiscalYear + 1}-03-31`;
    }

    const startStr = startInput.value;
    const endStr = endInput.value;
    const startDate = new Date(startStr);
    const endDate = new Date(endStr);
    endDate.setHours(23, 59, 59, 999);

    // 1. 基本となる行事とカスタム予定を取得（授業データは別途集計するため除外）
    const appliedData = getAppliedScheduleData('both').filter(item => !item.fromMyClass);
    let allEvents = [...appliedData];

    // 2. 授業データの展開（カレンダー表示と完全に一致させる）
    if (showClass && typeof getDisplayableClassesForDate === 'function') {
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const date = new Date(d);
            const dayEvents = appliedData.filter(item => formatDateKey(item.date) === formatDateKey(date));
            getDisplayableClassesForDate(date, dayEvents).forEach(cls => {
                const periodKey = cls.displayPeriod || cls.originalPeriod;
                const PERIOD_TIMES_LOCAL = window.PERIOD_TIMES || PERIOD_TIMES;
                let times = PERIOD_TIMES_LOCAL[periodKey];

                if (!times && typeof periodKey === 'string' && periodKey.includes('-')) {
                    const parts = periodKey.split('-');
                    const first = PERIOD_TIMES_LOCAL[parts[0]];
                    const last = PERIOD_TIMES_LOCAL[parts[parts.length - 1]];
                    if (first && last) times = { start: first.start, end: last.end };
                }
                if (!times) times = { start: '09:00', end: '10:35' }; // デフォルト

                allEvents.push({
                    id: cls.id,
                    date: date,
                    event: cls.name,
                    type: 'myclass',
                    startTime: times.start,
                    endTime: times.end,
                    location: cls.location || '',
                    allDay: false,
                    isClass: true,
                    period: periodKey,
                    target: cls.targetGrade + (cls.targetType === 'grade' ? '年全体' : cls.targetClass)
                });
            });
        }
    }

    // フィルタリング
    const filteredData = allEvents.filter(item => {
        const itemDate = new Date(item.date);
        if (itemDate < startDate || itemDate > endDate) return false;

        if (item.type === 'custom') return showApplied;
        if (item.type === 'myclass' || item.isClass) return showClass;
        return showAnnual;
    });

    // 祝日名の取得・付与
    const allHolidays = new Map();
    availableYears.forEach(year => {
        const yearHolidays = getHolidaysForYear(year);
        if (yearHolidays) {
            yearHolidays.forEach((name, dateKey) => allHolidays.set(dateKey, name));
        }
    });

    const exportData = filteredData.map(item => {
        const dateKey = formatDateKey(item.date);

        let sTime = item.startTime || '';
        let eTime = item.endTime || '';

        // 時限情報があり、時刻が空の場合は解決を試みる（主に年間行事用）
        if (!sTime && item.period) {
            const pNumMatch = String(item.period).match(/\d+/);
            if (pNumMatch) {
                const pNum = pNumMatch[0];
                const PERIOD_TIMES_LOCAL = window.PERIOD_TIMES || PERIOD_TIMES;
                const times = PERIOD_TIMES_LOCAL[pNum];
                if (times) {
                    sTime = times.start;
                    eTime = times.end;
                }
            }
        }

        return {
            date: dateKey,
            event: item.event,
            type: item.type,
            startTime: sTime,
            endTime: eTime,
            location: item.location || '',
            memo: item.memo || '',
            holiday: allHolidays.get(dateKey) || null,
            isClass: !!item.isClass,
            target: item.target || ''
        };
    });

    const exportBundle = {
        meta: {
            exportDate: new Date().toISOString(),
            range: { start: startStr, end: endStr },
            totalCount: exportData.length
        },
        events: exportData
    };

    const blob = new Blob([JSON.stringify(exportBundle, null, 2)], { type: 'application/json' });
    downloadFile(blob, `schedule_export_${startStr}_to_${endStr}.json`);
}

function exportToIcal() {
    const showAnnual = document.getElementById('exportAnnual').checked;
    const showClass = document.getElementById('exportClass').checked;
    const showApplied = document.getElementById('exportApplied').checked;
    const startInput = document.getElementById('exportStartDate');
    const endInput = document.getElementById('exportEndDate');

    // 未入力の場合は現在の年度で補完
    if (!startInput.value || !endInput.value) {
        const fiscalYear = typeof currentYear !== 'undefined' ? currentYear : new Date().getFullYear();
        if (!startInput.value) startInput.value = `${fiscalYear}-04-01`;
        if (!endInput.value) endInput.value = `${fiscalYear + 1}-03-31`;
    }

    const startStr = startInput.value;
    const endStr = endInput.value;

    if (!startStr || !endStr) {
        alert('出力期間を指定してください。');
        return;
    }

    const startDate = new Date(startStr);
    const endDate = new Date(endStr);
    endDate.setHours(23, 59, 59, 999);

    // 1. 基本となる行事とカスタム予定を取得
    const appliedData = getAppliedScheduleData('both');

    // 2. 予定（Excel行事/カスタム行事）の抽出
    const filteredData = appliedData.filter(item => {
        const itemDate = new Date(item.date);
        if (itemDate < startDate || itemDate > endDate) return false;

        // 授業統合による重複を避けるため、fromMyClass属性を持つものはここでは除外（別途3で集計するため）
        if (item.fromMyClass) return false;

        if (item.type === 'custom') return showApplied;
        return showAnnual;
    });

    // 3. 授業データの取得（カレンダー表示と完全に一致させる）
    let filteredClassEvents = [];
    if (typeof getDisplayableClassesForDate === 'function' && showClass) {
        // インデックス化して高速化
        const eventsByDate = new Map();
        appliedData.forEach(item => {
            const key = formatDateKey(item.date);
            if (!eventsByDate.has(key)) eventsByDate.set(key, []);
            eventsByDate.get(key).push(item);
        });

        // 表示時と同じロジックで日ごとに取得
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
            const date = new Date(d);
            const dStr = formatDateKey(date);
            // その日の行事取得
            const dayEvents = eventsByDate.get(dStr) || [];
            const classesOnDay = getDisplayableClassesForDate(date, dayEvents);

            classesOnDay.forEach(cls => {
                const periodKey = cls.displayPeriod || cls.originalPeriod;
                const PERIOD_TIMES_LOCAL = window.PERIOD_TIMES || PERIOD_TIMES;
                let times = PERIOD_TIMES_LOCAL[periodKey];

                if (!times && typeof periodKey === 'string' && periodKey.includes('-')) {
                    const parts = periodKey.split('-');
                    const first = PERIOD_TIMES_LOCAL[parts[0]];
                    const last = PERIOD_TIMES_LOCAL[parts[parts.length - 1]];
                    if (first && last) times = { start: first.start, end: last.end };
                }
                if (!times) times = { start: '09:00', end: '10:35' }; // デフォルト

                filteredClassEvents.push({
                    ...cls,
                    date: date,
                    startTime: createDateTime(date, times.start),
                    endTime: createDateTime(date, times.end),
                    allDay: false,
                    period: periodKey
                });
            });
        }
    }

    // エクスポート確認プロセス
    const annualCount = filteredData.length;
    const classCount = filteredClassEvents.length;
    const totalCount = annualCount + classCount;

    if (totalCount === 0) {
        alert('指定された期間内にエクスポート対象の予定が見つかりませんでした。');
        return;
    }

    const confirmMsg = `以下の内容でICALエクスポートを開始しますか？\n\n` +
        `期間: ${startStr} ～ ${endStr}\n` +
        `年間行事・予定: ${annualCount} 件\n` +
        `授業予定: ${classCount} 件\n` +
        `合計: ${totalCount} 件\n\n` +
        `※カレンダーアプリ（Google/Outlook等）で読み込み可能な形式です。`;

    if (!confirm(confirmMsg)) {
        return;
    }

    // ICAL形式生成用の補助関数（行折り返し対応）
    const icalLines = [];
    const addIcalLine = (key, value) => {
        const line = `${key}:${value}`;
        // iCal標準: 75オクテット（マルチバイトを考慮し安全に70文字で折り返し）
        if (line.length <= 70) {
            icalLines.push(line);
        } else {
            let current = line;
            let first = true;
            while (current.length > 0) {
                let segment;
                if (first) {
                    segment = current.substring(0, 70);
                    current = current.substring(70);
                    first = false;
                } else {
                    segment = ' ' + current.substring(0, 69);
                    current = current.substring(69);
                }
                if (segment.length > 0) icalLines.push(segment);
            }
        }
    };

    icalLines.push('BEGIN:VCALENDAR');
    icalLines.push('VERSION:2.0');
    icalLines.push('PRODID:-//年間行事予定表アプリ//JP');
    icalLines.push('CALSCALE:GREGORIAN');
    icalLines.push('METHOD:PUBLISH');
    icalLines.push('X-WR-CALNAME:学校カレンダー');
    icalLines.push('X-WR-TIMEZONE:Asia/Tokyo');
    icalLines.push('BEGIN:VTIMEZONE');
    icalLines.push('TZID:Asia/Tokyo');
    icalLines.push('BEGIN:STANDARD');
    icalLines.push('DTSTART:19700101T000000');
    icalLines.push('TZOFFSETFROM:+0900');
    icalLines.push('TZOFFSETTO:+0900');
    icalLines.push('TZNAME:JST');
    icalLines.push('END:STANDARD');
    icalLines.push('END:VTIMEZONE');

    filteredData.forEach(item => {
        const eventTitle = item.event || item.name || '';
        if (!eventTitle.trim()) return;

        const dateStrOnly = formatDateKey(item.date).replace(/-/g, '');
        const uid = generateUID(item);

        icalLines.push('BEGIN:VEVENT');
        addIcalLine('UID', uid);
        addIcalLine('DTSTAMP', formatDateForIcal(new Date(), true));

        if (item.allDay === false && item.startTime && item.endTime) {
            const startDt = new Date(item.date);
            const [sh, sm] = String(item.startTime).split(':');
            startDt.setHours(parseInt(sh) || 0, parseInt(sm) || 0, 0);
            const endDt = new Date(item.date);
            const [eh, em] = String(item.endTime).split(':');
            endDt.setHours(parseInt(eh) || 0, parseInt(em) || 0, 0);

            // 日本時間(Asia/Tokyo)で出力
            addIcalLine('DTSTART;TZID=Asia/Tokyo', formatDateForIcal(startDt));
            addIcalLine('DTEND;TZID=Asia/Tokyo', formatDateForIcal(endDt));
            icalLines.push('TRANSP:OPAQUE');
        } else {
            // 終日予定
            const endDt = new Date(item.date);
            endDt.setDate(endDt.getDate() + 1);
            const nextDayStr = formatDateKey(endDt).replace(/-/g, '');

            addIcalLine('DTSTART;VALUE=DATE', dateStrOnly);
            addIcalLine('DTEND;VALUE=DATE', nextDayStr);
            icalLines.push('TRANSP:OPAQUE'); // 終日でも予定ありとして扱う
        }

        addIcalLine('SUMMARY', escapeIcalText(eventTitle));

        if (item.location) {
            addIcalLine('LOCATION', escapeIcalText(item.location));
        }

        let desc = (item.weekdayCount ? `${item.weekdayCount} - ` : '') + eventTitle;

        // メタ情報の追加
        if (item.customData) {
            const cd = item.customData;
            if (cd.isLeaveCard) {
                desc += `\n【年休】${cd.leaveHours}時間${cd.leaveExtra ? cd.leaveExtra + '分' : ''}休 (${cd.leaveType === 'early' ? '前半' : cd.leaveType === 'late' ? '後半' : '全日'})`;
            } else if (cd.isTripCard) {
                desc += `\n【出張】用務先: ${cd.tripDetails?.destination || cd.location || '不明'}`;
                desc += `\n期間: ${cd.startTime || ''}～${cd.endTime || ''}`;
                desc += `\n行程: ${cd.tripDetails?.depPoint === 'school' ? '学校発' : '自宅発'} / ${cd.tripDetails?.arrPoint === 'school' ? '学校着' : '自宅着'}`;
            } else if (cd.isWfhCard) {
                desc += `\n【在宅勤務】場所: ${cd.location || '自宅'}`;
                if (cd.allDay) desc += `\n時間: 終日`;
                else desc += `\n時間: ${cd.startTime || ''}～${cd.endTime || ''}`;
            } else if (cd.isHolidayWorkCard) {
                desc += `\n【休日出勤】内容: ${cd.holidayWorkDetails?.content || '不明'}`;
                desc += `\n従事時間: ${cd.startTime || ''}～${cd.endTime || ''}`;
                if (cd.holidayWorkDetails?.subDate) {
                    desc += `\n振替希望: ${cd.holidayWorkDetails.subDate} (${cd.holidayWorkDetails.subType === 'full' ? '全日' : cd.holidayWorkDetails.subType === 'early' ? '前半' : '後半'})`;
                }
            }
        }

        if (item.memo) desc += `\n\n${item.memo}`;
        addIcalLine('DESCRIPTION', escapeIcalText(desc));

        let category = '行事';
        if (item.type === 'teacher') category = '本科';
        else if (item.type === 'student') category = '専攻科';

        addIcalLine('CATEGORIES', category);
        icalLines.push('STATUS:CONFIRMED');
        icalLines.push('END:VEVENT');
    });

    // 4. 授業データを追加
    filteredClassEvents.forEach(cls => {
        const targetLabel = cls.targetType === 'grade'
            ? `${cls.targetGrade}年全体`
            : cls.targetGrade === 1
                ? `${cls.targetGrade}-${cls.targetClass}`
                : `${cls.targetGrade}${cls.targetClass}`;

        const dateStrOnly = formatDateKey(cls.date).replace(/-/g, '');
        // UIDを時限情報を含めてよりユニークにする
        const periodId = String(cls.period || '').replace(/[^0-9a-zA-Z]/g, '');
        const uid = `my-class-${cls.id}-${dateStrOnly}-${periodId}@schedule-app`;

        // 担当者マーク(★)の判定
        const assignmentExclusions = JSON.parse(localStorage.getItem('assignmentExclusions') || '{}');
        const classExclusions = assignmentExclusions[cls.id] || [];
        const isAssigned = !classExclusions.includes(formatDateKey(cls.date));
        const assignedMark = isAssigned ? ' ★' : '';

        // Summary: 授業名(学年クラス/コース) ★
        const summary = `${cls.name}(${targetLabel})${assignedMark}`;

        icalLines.push('BEGIN:VEVENT');
        addIcalLine('UID', uid);
        addIcalLine('DTSTAMP', formatDateForIcal(new Date(), true));

        if (!cls.allDay && cls.startTime && cls.endTime) {
            // 日本時間(Asia/Tokyo)で出力
            addIcalLine('DTSTART;TZID=Asia/Tokyo', formatDateForIcal(cls.startTime));
            addIcalLine('DTEND;TZID=Asia/Tokyo', formatDateForIcal(cls.endTime));
            icalLines.push('TRANSP:OPAQUE');
        } else {
            const nextDay = new Date(cls.date);
            nextDay.setDate(nextDay.getDate() + 1);
            const nextDayStr = formatDateKey(nextDay).replace(/-/g, '');
            addIcalLine('DTSTART;VALUE=DATE', dateStrOnly);
            addIcalLine('DTEND;VALUE=DATE', nextDayStr);
            icalLines.push('TRANSP:OPAQUE'); // 授業は終日でも予定ありとして扱う
        }

        addIcalLine('SUMMARY', escapeIcalText(summary));

        if (cls.location) {
            addIcalLine('LOCATION', escapeIcalText(cls.location));
        }

        // Description: 教員リスト、学年、メモなどを統合
        let descParts = [];
        if (cls.teachers && cls.teachers.length > 0) {
            descParts.push(`担当教員: ${cls.teachers.join('、')}`);
        }
        descParts.push(`対象: ${targetLabel} (${cls.departmentType === 'student' ? '専攻科' : '本科'})`);
        descParts.push(`期間: ${cls.semester}`);
        if (cls.period) descParts.push(`時限: ${cls.period}限`);
        if (cls.memo) descParts.push(`\nメモ: ${cls.memo}`);

        addIcalLine('DESCRIPTION', escapeIcalText(descParts.join('\n')));

        addIcalLine('CATEGORIES', '授業');
        icalLines.push('STATUS:CONFIRMED');
        icalLines.push('END:VEVENT');
    });

    icalLines.push('END:VCALENDAR');

    // ファイルダウンロード
    const blob = new Blob([icalLines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    downloadFile(blob, `schedule_${startStr}_to_${endStr}.ics`);
}

function exportToCsv() {
    const showAnnual = document.getElementById('exportAnnual').checked;
    const showClass = document.getElementById('exportClass').checked;
    const showApplied = document.getElementById('exportApplied').checked;
    const startInput = document.getElementById('exportStartDate');
    const endInput = document.getElementById('exportEndDate');

    // 未入力の場合は現在の年度で補完
    if (!startInput.value || !endInput.value) {
        const fiscalYear = typeof currentYear !== 'undefined' ? currentYear : new Date().getFullYear();
        if (!startInput.value) startInput.value = `${fiscalYear}-04-01`;
        if (!endInput.value) endInput.value = `${fiscalYear + 1}-03-31`;
    }

    const startStr = startInput.value;
    const endStr = endInput.value;

    if (!startStr || !endStr) {
        alert('出力期間を指定してください。');
        return;
    }

    const startDate = new Date(startStr);
    const endDate = new Date(endStr);
    endDate.setHours(23, 59, 59, 999);

    const appliedData = getAppliedScheduleData('both');
    let filteredData = appliedData.filter(item => item.date >= startDate && item.date <= endDate);

    // フィルタリング
    filteredData = filteredData.filter(item => {
        if (item.type === 'custom') return showApplied;
        return showAnnual;
    });

    // 全ての年度の祝日を取得
    const allHolidays = new Map();
    availableYears.forEach(year => {
        const yearHolidays = getHolidaysForYear(year);
        yearHolidays.forEach((name, dateKey) => {
            allHolidays.set(dateKey, name);
        });
    });

    // CSV形式生成
    const isExportNewFormat = parseInt(getFiscalYear(startDate)) >= 2026;
    const studentHeader = isExportNewFormat ? '専攻科/備考' : '専攻科';
    const headers = ['日付', '曜日', '祝日', '曜日カウント', 'イベント', '対象', '学期', '場所', 'メモ'];
    // 実際には表示対象(type)によってラベルを変える
    const rows = [headers];

    filteredData.forEach(item => {
        if (!item.event || item.event.trim() === '') return;

        const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
        const weekday = weekdays[item.date.getDay()];
        const dateKey = formatDateKey(item.date);
        const holidayName = allHolidays.get(dateKey) || '';

        const isNewFormat = getFiscalYear(item.date) >= 2026;
        const typeLabel = item.type === 'teacher' ? '本科' : (isNewFormat ? '専攻科/備考' : '専攻科');

        rows.push([
            formatDateKey(item.date),
            weekday,
            holidayName,
            item.weekdayCount || '',
            item.event,
            typeLabel,
            item.period,
            item.location || '',
            item.memo || ''
        ]);
    });

    // 授業データを追加
    if (typeof generateClassEvents === 'function' && showClass) {
        const startYear = getFiscalYear(startDate);
        const endYear = getFiscalYear(endDate);
        let allClassEvents = [];
        for (let y = startYear; y <= endYear; y++) {
            allClassEvents = allClassEvents.concat(generateClassEvents(y, { includeExclusions: false }));
        }


        let filteredClassEvents = allClassEvents.filter(cls => cls.date >= startDate && cls.date <= endDate);

        const weekdays = ['日', '月', '火', '水', '木', '金', '土'];

        // セパレーター行
        if (filteredClassEvents.length > 0) {
            rows.push(['', '', '', '', '', '', '', '', '']);
            rows.push(['===授業データ===', '', '', '', '', '', '', '', '']);
            rows.push(['日付', '曜日', '授業名', '対象', '場所', '時限', '開始時刻', '終了時刻', '備考']);
        }

        filteredClassEvents.forEach(cls => {
            const weekday = weekdays[cls.date.getDay()];
            const targetLabel = cls.targetType === 'grade'
                ? `${cls.targetGrade}年全体`
                : cls.targetGrade === 1
                    ? `${cls.targetGrade}-${cls.targetClass}`
                    : `${cls.targetGrade}${cls.targetClass}`;

            // 時間の整形
            const formatTime = (date) => {
                if (!date) return '';
                return date.toTimeString().substring(0, 5);
            };

            rows.push([
                formatDateKey(cls.date),
                weekday,
                cls.name,
                targetLabel,
                cls.location,
                `${cls.period}限`,
                formatTime(cls.startTime),
                formatTime(cls.endTime),
                cls.semester + (cls.weekdayCount ? ` (${cls.weekdayCount})` : '')
            ]);
        });
    }

    // CSV生成
    const csvContent = rows.map(row =>
        row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    // BOM付きUTF-8でエンコード
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8' });
    downloadFile(blob, `schedule_${startStr}_to_${endStr}.csv`);
}

// =============================
// ユーティリティ関数
// =============================
function formatDateForIcal(date, isUtc = false) {
    if (!date || !(date instanceof Date)) return '';

    if (isUtc) {
        // DTSTAMP等はUTC(Z付き)が必須
        return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

function generateUID(item) {
    const dateStr = formatDateKey(item.date).replace(/-/g, '');
    const uniquePart = item.id || simpleHash(item.event || item.name || 'noevent');
    return `${dateStr}-${uniquePart}@schedule-app.local`;
}

function simpleHash(str) {
    if (!str) return '0';
    const s = String(str);
    let hash = 0;
    for (let i = 0; i < s.length; i++) {
        const char = s.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

function escapeIcalText(text) {
    return text
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
}

function downloadFile(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function showLoading(show) {
    const overlay = document.getElementById('loadingOverlay');
    if (show) {
        overlay.classList.remove('hidden');
    } else {
        overlay.classList.add('hidden');
    }
}

/**
 * 読み込み済み年度の管理リストを更新
 */
function renderCachedYearList() {
    const tbody = document.getElementById('cachedYearsBody');
    const container = document.getElementById('cachedYearsContainer');
    if (!tbody || !container) return;

    const years = Object.keys(scheduleCache).sort((a, b) => b - a);

    if (years.length === 0) {
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');

    tbody.innerHTML = years.map(year => {
        const info = scheduleCache[year];
        const data = info.data || [];

        // 統計計算
        const uniqueDates = new Set(data.map(item => item.date.toDateString())).size;
        const teacherEvents = data.filter(item => item.type === 'teacher' && item.event).length;
        const studentEvents = data.filter(item => item.type === 'student' && item.event).length;
        const classDays = new Set(data.filter(item => item.weekdayCount).map(d => d.date.toDateString())).size;

        const dateStr = info.timestamp ? new Date(info.timestamp).toLocaleDateString() : '---';
        return `
            <tr>
                <td style="font-weight: 600;">${year}年度</td>
                <td>${info.fileName || '不明'}</td>
                <td>${dateStr}</td>
                <td class="text-center">${uniqueDates}</td>
                <td class="text-center">${teacherEvents}</td>
                <td class="text-center">${studentEvents}</td>
                <td class="text-center">${classDays}</td>
                <td>
                    <button class="btn btn-outline-danger btn-sm" onclick="deleteCachedYear('${year}')" style="padding: 2px 6px;">
                        \uD83D\uDDD1️ 削除
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

/**
 * 特定の年度データをキャッシュから削除
 */
function deleteCachedYear(year) {
    if (!confirm(`${year}年度の年間行事データを削除しますか？\n(授業登録データやオーバーライドは削除されません)`)) {
        return;
    }

    delete scheduleCache[year];

    // データを再構築
    rebuildScheduleDataFromCache();
    saveScheduleToStorage();
    updateAvailableYearsAndMonths();
    updateStats();
    updateCalendar();

    // 授業イベント再生成（表示中の年度を削除した場合のため）
    if (typeof updateScheduleDataWithClasses === 'function') {
        updateScheduleDataWithClasses(currentYear);
    }

    alert(`${year}年度のデータを削除しました。`);
}

window.renderCachedYearList = renderCachedYearList;
window.deleteCachedYear = deleteCachedYear;

/**
 * 右クリックメニュー（参加/非参加）
 */
let contextEventData = null;

window.showEventContextMenu = function (e, type, id, date, period = null) {
    e.preventDefault();
    e.stopPropagation();

    // 座標取得 (マウス/タッチ両対応)
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    contextEventData = { type, id, date, period };
    const menu = document.getElementById('calendarContextMenu');
    menu.classList.remove('hidden');
    menu.style.left = clientX + 'px';
    menu.style.top = clientY + 'px';

    // モバイルの場合は vibration (もし対応していれば)
    if (navigator.vibrate) navigator.vibrate(20);

    // 参加状況に合わせてメニューテキストを調整
    const participateItem = document.getElementById('ctxParticipate');
    const notParticipateItem = document.getElementById('ctxNotParticipate');

    // 現在の参加状況を確認 (updateCalendarの判定ロジックと同期)
    let isParticipating = true;
    if (type === 'myclass') {
        const assignmentExclusions = JSON.parse(localStorage.getItem('assignmentExclusions') || '{}');
        const classExclusions = assignmentExclusions[id] || [];
        isParticipating = !classExclusions.includes(date);
    } else {
        const ov = classOverrides.find(ov => String(ov.id) === String(id) && (ov.type === type || (type.startsWith('excel') && ov.type === 'excel')));
        const item = scheduleData.find(i => String(i.id) === String(id) && formatDateKey(i.date) === date);
        const name = item ? (item.event || item.name || "") : (ov && ov.data ? ov.data.event : "");
        const isApplied = (ov && ov.data && ov.data.isApplied) || (item && item.isApplied);

        if (ov && ov.data && ov.data.isParticipating !== undefined) {
            isParticipating = ov.data.isParticipating;
        } else if (type === 'custom' || isApplied) {
            isParticipating = true;
        } else {
            isParticipating = containsPinnedKeyword(name);
        }
    }

    participateItem.style.display = isParticipating ? 'none' : 'flex';
    notParticipateItem.style.display = isParticipating ? 'flex' : 'none';

    // 位置調整
    const menuWidth = 160;
    const menuHeight = 180;
    let x = e.clientX;
    let y = e.clientY;

    if (x + menuWidth > window.innerWidth) x -= menuWidth;
    if (y + menuHeight > window.innerHeight) y -= menuHeight;

    menu.style.left = x + 'px';
    menu.style.top = y + 'px';

    // メニュー以外をクリックしたら閉じる
    const closeMenu = () => {
        menu.classList.add('hidden');
        document.removeEventListener('click', closeMenu);
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 10);
}

function handleContextAction(action) {
    if (!contextEventData) return;
    const { type, id, date, period } = contextEventData;

    if (action === 'participate' || action === 'not_participate') {
        const isEnable = action === 'participate';

        if (type === 'myclass') {
            // 授業の参加切り替え：assignmentExclusionsで管理
            let assignmentExclusions = JSON.parse(localStorage.getItem('assignmentExclusions') || '{}');
            // dateはISO形式の文字列（YYYY-MM-DD）として渡される
            const dateKey = date;

            if (!assignmentExclusions[id]) {
                assignmentExclusions[id] = [];
            }

            if (isEnable) {
                // 参加する場合：除外リストから削除
                assignmentExclusions[id] = assignmentExclusions[id].filter(d => d !== dateKey);
            } else {
                // 非参加にする場合：除外リストに追加
                if (!assignmentExclusions[id].includes(dateKey)) {
                    assignmentExclusions[id].push(dateKey);
                }
            }

            localStorage.setItem('assignmentExclusions', JSON.stringify(assignmentExclusions));
        } else if (type.startsWith('excel')) {
            // Excel行事の参加切り替え
            // 既存のオーバーライド（特に移動後のデータ）を保存してから処理
            let existingOverride = classOverrides.find(ov =>
                String(ov.id) === String(id) && ov.date === date && ov.type === 'excel' && ov.action === 'move' && ov.data
            );

            // 移動後の予定の場合、既存データを保持して isParticipating だけ更新
            if (existingOverride) {
                existingOverride.data.isParticipating = isEnable;
            } else {
                // 移動後でない場合：新規でオーバーライドを作成
                classOverrides = classOverrides.filter(ov =>
                    !(String(ov.id) === String(id) && ov.date === date && ov.type === 'excel' && ov.action === 'delete')
                );

                let baseData = null;
                const item = scheduleData.find(i => String(i.id) === String(id) && formatDateKey(i.date) === date);
                if (item) {
                    baseData = {
                        event: item.event,
                        type: item.type,
                        location: item.location || '',
                        memo: item.memo || '',
                        isParticipating: isEnable
                    };
                } else {
                    baseData = { event: 'Unknown', isParticipating: isEnable };
                }

                classOverrides.push({
                    type: 'excel',
                    id: id,
                    date: date,
                    action: 'move',
                    data: baseData
                });
            }

            saveAllToLocal();
        } else if (type === 'custom') {
            const ov = classOverrides.find(o => o.type === 'custom' && String(o.id) === String(id));
            if (ov && ov.data) {
                ov.data.isParticipating = isEnable;
            }

            saveAllToLocal();
        }

        // カレンダーを更新
        updateCalendar();

        // 日程表が開いている場合は再描画
        const classScheduleModal = document.getElementById('classScheduleModal');
        if (classScheduleModal && !classScheduleModal.classList.contains('hidden')) {
            if (typeof showClassSchedule === 'function') {
                showClassSchedule();
            }
        }
    } else if (action === 'edit') {
        editCalendarEvent(type, id, date, period);
    } else if (action === 'delete') {
        deleteCalendarEvent(null, type, id, date, period);
    } else if (action === 'copy' || action === 'move_start') {
        const isMove = action === 'move_start';
        mobileAction = isMove ? 'move' : 'copy';

        // ソースデータを構成 (drag-dropと同じ形式)
        const el = document.querySelector(`.event-item[data-class-id="${id}"][data-date="${date}"]`);
        mobileSourceData = {
            type: type,
            id: id,
            sourceDate: date,
            period: period || (el ? el.dataset.period : ''),
            text: el ? (el.querySelector('.event-text')?.textContent || el.textContent) : '予定'
        };

        const msg = (isMove ? '移動中: ' : 'コピー中: ') + (mobileSourceData.text || '予定');
        const banner = document.getElementById('mobileActionContainer');
        const bannerMsg = document.getElementById('mobileActionMessage');
        if (banner && bannerMsg) {
            bannerMsg.textContent = msg;
            banner.classList.remove('hidden');
        }

        // キャッシュクリアなどで背景を強調したい場合はここでCSSクラスをbody等に付与できる
        document.body.classList.add('mobile-action-pending');
    }

    document.getElementById('calendarContextMenu').classList.add('hidden');
    contextEventData = null;
}

/**
 * モバイル用アクション（コピー・移動）の実行
 */
function executeMobileAction(targetDate) {
    if (!mobileAction || !mobileSourceData) return;

    const isCopy = (mobileAction === 'copy');

    // 既存の移動用関数を利用
    if (typeof moveCalendarEvent === 'function') {
        moveCalendarEvent(mobileSourceData, targetDate, isCopy);
    }

    // クリーンアップ
    cancelMobileAction();
}

/**
 * モバイルアクションのキャンセル
 */
function cancelMobileAction() {
    mobileAction = null;
    mobileSourceData = null;
    document.body.classList.remove('mobile-action-pending');

    const banner = document.getElementById('mobileActionContainer');
    if (banner) {
        banner.classList.add('hidden');
    }
}

window.showEventContextMenu = showEventContextMenu;
window.handleContextAction = handleContextAction;
window.cancelMobileAction = cancelMobileAction;
