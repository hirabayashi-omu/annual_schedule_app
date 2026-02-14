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

// 学校年度関連定数
const FISCAL_YEAR_START_MONTH = 4;  // 4月開始
const FISCAL_YEAR_END_MONTH = 3;    // 3月終了

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
    if (text.includes('入試')) {
        if (text.includes('説明') || text.includes('広報')) {
            return false;
        }
    }

    return DEFAULT_PINNED_KEYWORDS.some(keyword => text.includes(keyword));
}
window.containsPinnedKeyword = containsPinnedKeyword;

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
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
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
    if (!eventText) return false;
    const holidaysMap = getHolidaysForYear(date.getFullYear());
    const hName = getHolidayName(date, holidaysMap);
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
        } catch (e) {
            backupData.teacherMaster = [];
            backupData.courseMaster = [];
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
                if (data.myClasses) myClasses = [...myClasses, ...data.myClasses];
                if (data.classOverrides) classOverrides = [...classOverrides, ...data.classOverrides];
            } else {
                if (data.myClasses) myClasses = data.myClasses;
                if (data.classOverrides) classOverrides = data.classOverrides;
            }

            // 除外リストの復元
            if (data.assignmentExclusions) {
                let currentExclusions = {};
                if (restoreType === 'merge') {
                    try {
                        currentExclusions = JSON.parse(localStorage.getItem('assignmentExclusions') || '{}');
                    } catch (e) { }
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
        if ((data.teacherMaster || data.courseMaster) && (restoreType === 'all' || restoreType === 'settings' || restoreType === 'merge')) {
            if (data.teacherMaster) localStorage.setItem('teacherMaster', JSON.stringify(data.teacherMaster));
            if (data.courseMaster) localStorage.setItem('courseMaster', JSON.stringify(data.courseMaster));
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
    scheduleData = [];
    Object.keys(scheduleCache).forEach(year => {
        if (scheduleCache[year] && scheduleCache[year].data) {
            // 元のデータに年度情報を付与しつつ結合
            const yearData = scheduleCache[year].data.map(item => ({
                ...item,
                fiscalYear: parseInt(year)
            }));
            scheduleData = scheduleData.concat(yearData);
        }
    });

    // 日付順にソートし、IDを一意に再割り当て（セッション内での安定性のため）
    scheduleData.sort((a, b) => a.date - b.date);
    scheduleData.forEach((item, index) => {
        item.id = `excel_${index}`;
    });

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
            currentYear = availableYears[0];
            const yearSelect = document.getElementById('globalYearSelect');
            if (yearSelect) yearSelect.value = currentYear;
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
function initNavigation() {
    const navCalendarBtn = document.getElementById('navCalendarBtn');
    const navImportBtn = document.getElementById('navImportBtn');
    const navClassBtn = document.getElementById('navClassBtn');
    const navSettingsBtn = document.getElementById('navSettingsBtn');
    const navWorkBtn = document.getElementById('navWorkBtn');
    const navHelpBtn = document.getElementById('navHelpBtn');

    const calendarView = document.getElementById('calendarView');
    const importContainer = document.getElementById('importContainer');
    const myClassesSection = document.getElementById('myClassesSection');
    const settingsSection = document.getElementById('settingsSection');
    const workSection = document.getElementById('workSection');
    const statsView = document.getElementById('statsView');
    const helpSection = document.getElementById('helpSection');

    function setActiveTab(tab) {
        // Reset all buttons
        navCalendarBtn.classList.remove('active');
        navImportBtn.classList.remove('active');
        navClassBtn.classList.remove('active');
        if (navSettingsBtn) navSettingsBtn.classList.remove('active');
        if (navWorkBtn) navWorkBtn.classList.remove('active');
        if (navStatsBtn) navStatsBtn.classList.remove('active');
        if (navHelpBtn) navHelpBtn.classList.remove('active');

        // Hide all views
        calendarView.classList.add('hidden');
        importContainer.classList.add('hidden');
        myClassesSection.classList.add('hidden');
        if (settingsSection) settingsSection.classList.add('hidden');
        if (workSection) workSection.classList.add('hidden');
        if (statsView) statsView.classList.add('hidden');
        if (helpSection) helpSection.classList.add('hidden');

        // Remove direct style display manipulations if any
        calendarView.style.display = '';
        importContainer.style.display = '';
        myClassesSection.style.display = '';
        if (settingsSection) settingsSection.style.display = '';
        if (workSection) workSection.style.display = '';
        if (statsView) statsView.style.display = '';
        if (helpSection) helpSection.style.display = '';

        switch (tab) {
            case 'calendar':
                navCalendarBtn.classList.add('active');
                calendarView.classList.remove('hidden');
                break;
            case 'import':
                navImportBtn.classList.add('active');
                importContainer.classList.remove('hidden');
                break;
            case 'class':
                navClassBtn.classList.add('active');
                myClassesSection.classList.remove('hidden');
                break;
            case 'settings':
                if (navSettingsBtn) navSettingsBtn.classList.add('active');
                if (settingsSection) settingsSection.classList.remove('hidden');
                // 初期表示時にリストを更新
                if (typeof renderManageTeachers === 'function') renderManageTeachers();
                if (typeof renderManageCourses === 'function') renderManageCourses();
                break;
            case 'work':
                if (navWorkBtn) navWorkBtn.classList.add('active');
                if (workSection) workSection.classList.remove('hidden');
                if (typeof renderWorkPeriodConfig === 'function') renderWorkPeriodConfig();
                break;
            case 'stats':
                if (navStatsBtn) navStatsBtn.classList.add('active');
                if (statsView) statsView.classList.remove('hidden');
                if (typeof renderApplicationStats === 'function') renderApplicationStats();
                break;
            case 'help':
                if (navHelpBtn) navHelpBtn.classList.add('active');
                if (helpSection) helpSection.classList.remove('hidden');
                break;
        }
    }

    navCalendarBtn.addEventListener('click', () => setActiveTab('calendar'));
    navImportBtn.addEventListener('click', () => setActiveTab('import'));
    navClassBtn.addEventListener('click', () => setActiveTab('class'));
    if (navSettingsBtn) {
        navSettingsBtn.addEventListener('click', () => setActiveTab('settings'));
    }
    if (navWorkBtn) {
        navWorkBtn.addEventListener('click', () => setActiveTab('work'));
    }
    if (navStatsBtn) {
        navStatsBtn.addEventListener('click', () => setActiveTab('stats'));
    }
    if (navHelpBtn) {
        navHelpBtn.addEventListener('click', () => setActiveTab('help'));
    }

    // Initialize with Calendar view
    setActiveTab('calendar');
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

    // コントロール変更
    document.getElementById('targetSelect').addEventListener('change', updateCalendar);
    const globalYearSelect = document.getElementById('globalYearSelect');
    if (globalYearSelect) {
        globalYearSelect.addEventListener('change', (e) => {
            currentYear = parseInt(e.target.value);
            updateCalendar();
            // 授業一覧・時間割も更新
            if (typeof renderMyClassesList === 'function') renderMyClassesList();
            if (typeof renderTimetable === 'function') renderTimetable();
            if (typeof updateClassYearOptions === 'function') updateClassYearOptions();
        });
    }

    document.getElementById('monthSelect').addEventListener('change', (e) => {
        currentMonth = parseInt(e.target.value);
        updateCalendar();
    });

    // エクスポートボタン
    document.getElementById('exportJsonBtn').addEventListener('click', exportToJson);
    document.getElementById('exportIcalBtn').addEventListener('click', exportToIcal);
    document.getElementById('exportCsvBtn').addEventListener('click', exportToCsv);
}

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
            currentYear = parseInt(updatedYears[updatedYears.length - 1]);
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
            yearSelect.value = availableYears[0];
            currentYear = parseInt(yearSelect.value);
            // 値が変わったのでカレンダー更新
            updateCalendar();
            if (typeof renderMyClassesList === 'function') renderMyClassesList();
        } else if (availableYears.length > 0 && !yearSelect.value) {
            // 初回ロード時などで値がセットされていない場合も最新を選ぶ
            yearSelect.value = availableYears[0];
            currentYear = parseInt(yearSelect.value);
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

window.updateCalendar = function updateCalendar() {
    const target = document.getElementById('targetSelect').value;
    const calendarGrid = document.getElementById('calendarGrid');
    const calendarTitle = document.getElementById('calendarTitle');

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
    const daysInMonth = lastDay.getDate();

    // 月曜日基準で最初の日の曜日を取得 (0=月, 6=日)
    const firstWeekday = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1;

    // 空白セル（前月の日付）
    for (let i = 0; i < firstWeekday; i++) {
        const emptyDay = document.createElement('div');
        emptyDay.className = 'calendar-day other-month';
        calendarGrid.appendChild(emptyDay);
    }

    // 全ての表示イベント（カスタム + Excel）を取得してレーン割り当てを行う
    const allDisplayEvents = [];

    // 1. カスタム予定 (この月の範囲内のみに絞り込む)
    const monthStart = new Date(currentYear, currentMonth - 1, 1);
    const monthEnd = new Date(currentYear, currentMonth, 0);
    const monthStartStr = formatDateKey(monthStart);
    const monthEndStr = formatDateKey(monthEnd);

    classOverrides.filter(ov => ov.type === 'custom' && ov.action === 'add' && ov.data).forEach(ov => {
        let start = ov.startDate || ov.date || '';
        let end = ov.endDate || ov.date || ov.startDate || '';

        // 判定用にハイフン形式に正規化
        start = start.replace(/\//g, '-');
        end = end.replace(/\//g, '-');

        if (!start || !end) return;

        // 月の範囲と重なっているかチェック
        if (end < monthStartStr || start > monthEndStr) return;

        allDisplayEvents.push({
            id: String(ov.id),
            startDate: start,
            endDate: end,
            date: ov.date ? ov.date.replace(/\//g, '-') : start,
            type: 'custom',
            data: ov.data,
            original: ov
        });
    });

    // 2. Excel予定（年間行事）
    // scheduleData からこの月の分を取得
    scheduleData.forEach(item => {
        if (!item.event || item.event.trim() === '') return;
        const d = item.date;
        if (d < monthStart || d > monthEnd) return;
        const dStr = formatDateKey(d);

        // オーバーライド（削除・移動）チェック
        const isDeleted = classOverrides.some(ov => String(ov.id) === String(item.id) && ov.type === 'excel' && ov.date === dStr && ov.action === 'delete');
        const isMoved = classOverrides.some(ov => String(ov.id) === String(item.id) && ov.type === 'excel' && ov.date === dStr && ov.action === 'move' && ov.data);
        if (isDeleted || isMoved) return;

        allDisplayEvents.push({
            id: String(item.id),
            startDate: dStr,
            endDate: dStr,
            date: dStr,
            type: 'excel',
            data: { event: item.event, type: item.type },
            original: item
        });
    });

    // 3. 移動済みExcel予定
    classOverrides.filter(ov => ov.type === 'excel' && ov.action === 'move' && ov.data).forEach(ov => {
        const d = parseDateKey(ov.date);
        if (d < monthStart || d > monthEnd) return;
        allDisplayEvents.push({
            id: String(ov.id),
            startDate: ov.date,
            endDate: ov.date,
            date: ov.date,
            type: 'excel-moved',
            data: ov.data,
            original: ov
        });
    });

    // 4. 授業（曜日ベース＋追加分）
    if (typeof getDisplayableClassesForDate === 'function') {
        const tempDate = new Date(monthStart);
        while (tempDate <= monthEnd) {
            const dateStr = formatDateKey(tempDate);
            const dayEvents = scheduleData.filter(item => item.date.toDateString() === tempDate.toDateString());
            const classesOnDay = getDisplayableClassesForDate(tempDate, dayEvents);
            classesOnDay.forEach(cls => {
                allDisplayEvents.push({
                    id: String(cls.id),
                    startDate: dateStr,
                    endDate: dateStr,
                    date: dateStr,
                    type: 'myclass',
                    data: cls,
                    period: cls.originalPeriod, // レーン割当のキーに使用
                    original: cls
                });
            });
            tempDate.setDate(tempDate.getDate() + 1);
        }
    }

    // ソート関数：期間予定 -> 時刻なし(終日) -> 開始時間順
    const getSortPriority = (ov) => {
        const isPeriod = ov.startDate !== ov.endDate;
        if (isPeriod) return 0;

        const item = ov.data;
        // 終日設定があるか、時間が全くないものを 1 (終日相当) とする
        const isClass = ov.type === 'myclass';
        const isLeave = item.isLeaveCard && item.leaveType;
        const hasTime = !!(item.startTime || isLeave || isClass);

        if (item.allDay === true || !hasTime) return 1;
        return 2;
    };

    const getEffectiveTime = (ov, targetDateStr = null) => {
        const item = ov.data;
        const dateStr = targetDateStr || ov.date || ov.startDate;
        const PERIOD_TIMES_LOCAL = window.PERIOD_TIMES || (typeof PERIOD_TIMES !== 'undefined' ? PERIOD_TIMES : {});

        // 出張の場合の特殊処理
        if (item.isTripCard) {
            const startDate = ov.startDate || ov.date;
            // 開始日以外は 00:00 から
            if (dateStr !== startDate) return '00:00';
            return item.startTime || '00:00';
        }

        if (item.isLeaveCard && typeof getWorkTimeForDate === 'function') {
            const d = parseDateKey(dateStr);
            const work = getWorkTimeForDate(d, true);
            if (work && work.start) {
                if (item.leaveType === 'early' || item.leaveType === 'full') return work.start;
                if (item.leaveType === 'late') return addMinutes(work.end, -(item.leaveHours * 60 + (item.leaveExtra || 0)));
            }
        }

        if (ov.type === 'myclass') {
            const pKey = item.displayPeriod || ov.period;
            let times = PERIOD_TIMES_LOCAL[pKey];
            if (!times && typeof pKey === 'string' && pKey.includes('-')) {
                const firstP = pKey.split('-')[0];
                times = PERIOD_TIMES_LOCAL[firstP];
            }
            if (times && times.start) return times.start;
        }

        return item.startTime || '00:00';
    };

    const getEndTime = (ov, targetDateStr = null) => {
        const item = ov.data;
        const dateStr = targetDateStr || ov.date || ov.startDate;
        const PERIOD_TIMES_LOCAL = window.PERIOD_TIMES || (typeof PERIOD_TIMES !== 'undefined' ? PERIOD_TIMES : {});

        // 出張の場合の特殊処理
        if (item.isTripCard) {
            const endDate = ov.endDate || ov.date || ov.startDate;
            // 最終日以外は 23:59 まで
            if (dateStr !== endDate) return '23:59';
            return item.endTime || '23:59';
        }

        if (item.isLeaveCard && typeof getWorkTimeForDate === 'function') {
            const d = parseDateKey(dateStr);
            const work = getWorkTimeForDate(d, true);
            if (work && work.end) {
                if (item.leaveType === 'early') return addMinutes(work.start, item.leaveHours * 60 + (item.leaveExtra || 0));
                if (item.leaveType === 'late' || item.leaveType === 'full') return work.end;
            }
        }

        if (ov.type === 'myclass') {
            const pKey = item.displayPeriod || ov.period;
            let times = PERIOD_TIMES_LOCAL[pKey];
            if (!times && typeof pKey === 'string' && pKey.includes('-')) {
                const parts = pKey.split('-');
                const lastP = parts[parts.length - 1];
                times = PERIOD_TIMES_LOCAL[lastP];
            }
            if (times && times.end) return times.end;
        }

        return item.endTime || '23:59';
    };

    allDisplayEvents.sort((a, b) => {
        const pA = getSortPriority(a);
        const pB = getSortPriority(b);
        if (pA !== pB) return pA - pB;

        // 期間の開始日
        const startA = a.startDate;
        const startB = b.startDate;
        if (startA !== startB) return startA.localeCompare(startB);

        // 有効開始時間
        const timeA = getEffectiveTime(a);
        const timeB = getEffectiveTime(b);
        if (timeA !== timeB) return timeA.localeCompare(timeB);

        // 有効終了時間（開始が同じなら終了が遅い方を先に＝長い方を上にする場合もあるが、ここでは終了時間順）
        const endA = getEndTime(a);
        const endB = getEndTime(b);
        if (endA !== endB) return endA.localeCompare(endB);

        // クラスの時限（さらに細かいタイブレーカー）
        const pNoA = a.data.displayPeriod || a.period || '';
        const pNoB = b.data.displayPeriod || b.period || '';
        if (pNoA !== pNoB) return String(pNoA).localeCompare(String(pNoB));

        // 最終的なタイブレーカー：IDまたはタイトル
        const titleA = a.data.event || a.data.name || '';
        const titleB = b.data.event || b.data.name || '';
        if (titleA !== titleB) return titleA.localeCompare(titleB);

        return String(a.id).localeCompare(String(b.id));
    });

    const getLaneKey = (ov) => {
        const id = ov.id;
        const date = ov.date || ov.startDate;
        const period = ov.period;
        return period ? `${id}-${period}-${date}` : `${id}-${date}`;
    };

    const laneMap = new Map();
    const lanes = [];

    // 1パス目: 期間予定（複数日にまたがるもの）を優先的に最上段に配置
    const periodEvents = allDisplayEvents.filter(ov => ov.startDate !== ov.endDate);
    periodEvents.forEach(ov => {
        const coveredDates = [];
        const curr = parseDateKey(ov.startDate);
        const last = parseDateKey(ov.endDate);
        while (curr <= last) {
            coveredDates.push(formatDateKey(curr));
            curr.setDate(curr.getDate() + 1);
        }

        let targetLane = -1;
        for (let i = 0; i < lanes.length; i++) {
            if (!coveredDates.some(d => lanes[i].has(d))) {
                targetLane = i;
                break;
            }
        }
        if (targetLane === -1) {
            targetLane = lanes.length;
            lanes.push(new Set());
        }

        coveredDates.forEach(d => {
            lanes[targetLane].add(d);
            const key = ov.period ? `${ov.id}-${ov.period}-${d}` : `${ov.id}-${d}`;
            laneMap.set(key, targetLane);
        });
    });

    // 2パス目: 単日予定（授業、Excel行事、出張以外の単発ログ）を隙間に配置
    const singleDayEvents = allDisplayEvents.filter(ov => ov.startDate === ov.endDate);
    singleDayEvents.forEach(ov => {
        const d = ov.startDate;
        let targetLane = -1;
        for (let i = 0; i < lanes.length; i++) {
            if (!lanes[i].has(d)) {
                targetLane = i;
                break;
            }
        }
        if (targetLane === -1) {
            targetLane = lanes.length;
            lanes.push(new Set());
        }
        lanes[targetLane].add(d);
        const key = ov.period ? `${ov.id}-${ov.period}-${d}` : `${ov.id}-${d}`;
        laneMap.set(key, targetLane);
    });

    // 各日付セルの生成の前に、日ごとの重複をチェックする
    const dayOverlaps = new Set(); // 重複がある日付文字列のセット
    const tempDate = new Date(monthStart);
    while (tempDate <= monthEnd) {
        const dStr = formatDateKey(tempDate);
        const timedEvents = allDisplayEvents.filter(ov => {
            const start = ov.startDate || ov.date;
            const end = ov.endDate || ov.date || ov.startDate;
            // この日付が期間に含まれているか確認
            if (dStr < start || dStr > end) return false;

            // 出張は常に時間帯を持つ（中間日は 00:00-23:59）
            if (ov.data && ov.data.isTripCard) return true;

            // その日の優先度2（時間指定あり）のもの
            if (getSortPriority(ov) === 2) return true;

            return false;
        });

        // 2つ以上の予定がある場合に重なりを判定
        for (let i = 0; i < timedEvents.length; i++) {
            for (let j = i + 1; j < timedEvents.length; j++) {
                const s1 = getEffectiveTime(timedEvents[i], dStr);
                const e1 = getEndTime(timedEvents[i], dStr);
                const s2 = getEffectiveTime(timedEvents[j], dStr);
                const e2 = getEndTime(timedEvents[j], dStr);

                if (s1 < e2 && s2 < e1) {
                    dayOverlaps.add(dStr);
                    break;
                }
            }
            if (dayOverlaps.has(dStr)) break;
        }
        tempDate.setDate(tempDate.getDate() + 1);
    }

    // 各日付セル
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(currentYear, currentMonth - 1, day);
        const dStr = formatDateKey(date);
        const dayCell = createDayCell(date, target, laneMap, lanes.length, allDisplayEvents);
        if (dayOverlaps.has(dStr)) {
            dayCell.classList.add('has-overlap');
            dayCell.title = '時間重複があります';
        }
        calendarGrid.appendChild(dayCell);
    }
}

function createDayCell(date, target, laneMap = new Map(), customLaneCount = 0, allDisplayEvents = []) {
    const dateStr = formatDateKey(date);
    const dayCell = document.createElement('div');
    dayCell.className = 'calendar-day';
    dayCell.dataset.date = dateStr;

    // ドラッグ＆ドロップ用イベント
    dayCell.addEventListener('dragover', handleDayDragOver);
    dayCell.addEventListener('dragleave', handleDayDragLeave);
    dayCell.addEventListener('drop', handleDayDrop);

    // 年休の登録用メニュー（右クリック）
    dayCell.oncontextmenu = (e) => {
        // イベントアイテムや勤務バッジ上なら通常のメニューが出るので、背景クリック時のみ
        if (e.target.closest('.day-event-item') || e.target.closest('.day-work-badge')) return;

        if (typeof showAnnualLeaveMenu === 'function') {
            showAnnualLeaveMenu(e, dateStr);
        }
    };

    // 祝日チェック
    const holidaysMap = getHolidaysForYear(date.getFullYear());
    const holidayName = getHolidayName(date, holidaysMap);
    const isHolidayDay = holidayName !== null;

    // 曜日クラス
    const weekday = date.getDay();
    if (weekday === 6) dayCell.classList.add('saturday');
    if (weekday === 0 || isHolidayDay) dayCell.classList.add('sunday');

    // 日付番号
    const dayNumber = document.createElement('div');
    dayNumber.className = 'day-number';
    dayNumber.textContent = date.getDate();
    dayCell.appendChild(dayNumber);

    // 祝日名表示（下の badgesContainer 内で一括表示するため、ここでは不要）
    /*
    if (isHolidayDay) {
        ...
    }
    */

    // 担当日ラベル表示（非表示に変更 - ユーザー要望により）
    /*
    let assignmentDates = JSON.parse(localStorage.getItem('assignmentDates') || '{}');
    const assignedClasses = Object.entries(assignmentDates)
        .filter(([classId, dates]) => dates.includes(dateStr))
        .map(([classId]) => {
            const cls = myClasses.find(c => c.id == classId);
            return cls ? cls.name : classId;
        });

    if (assignedClasses.length > 0) {
        const assignmentLabel = document.createElement('div');
        assignmentLabel.className = 'day-assignment';
        assignmentLabel.textContent = `✓ (担当日)`;
        assignmentLabel.title = `担当授業: ${assignedClasses.join(', ')}`;
        dayCell.appendChild(assignmentLabel);
    }
    */

    // バッジ用コンテナ（右上に配置）
    const badgesContainer = document.createElement('div');
    badgesContainer.className = 'day-badges';

    // 祝日名表示
    if (isHolidayDay) {
        const holidayLabel = document.createElement('div');
        holidayLabel.className = 'day-holiday';
        holidayLabel.textContent = holidayName; // 絵文字は一旦抜くかCSSで調整
        badgesContainer.appendChild(holidayLabel);
    }

    // 勤務時間バッジの表示 (平日のみ)
    if (typeof getWorkTimeForDate === 'function' && weekday !== 0 && weekday !== 6) {
        const workTime = getWorkTimeForDate(date);
        if (workTime) {
            const workBadge = document.createElement('div');
            workBadge.className = 'day-work-badge';

            // シフト名が A勤務, B勤務 のような形式なら A, B だけ抽出して表示
            let shortName = workTime.name || '勤';
            if (shortName.includes('勤務')) {
                shortName = shortName.replace('勤務', '');
            }
            // 申請済みアイコンの追加
            const appliedIcon = workTime.isApplied ? '📄' : '';
            workBadge.textContent = appliedIcon + shortName;
            workBadge.title = `勤務時間: ${workTime.start} ～ ${workTime.end}${workTime.isApplied ? ' (申請済み)' : ''}`;

            // A〜E勤務などの色を分ける
            const shiftChar = shortName.charAt(0);
            if (['A', 'B', 'C', 'D', 'E'].includes(shiftChar)) {
                workBadge.classList.add(`shift-${shiftChar}`);
            }

            // 個別オーバーライド時のスタイル（申請済みの場合は通常色に戻す＝クラスを付与しない）
            if (workTime.isOverride && !workTime.isApplied) {
                workBadge.classList.add('is-override');
            }

            // クリック/右クリックで勤務変更メニューを表示
            const openMenu = (e) => {
                if (typeof showWorkShiftMenu === 'function') {
                    showWorkShiftMenu(e, dateStr);
                }
            };
            workBadge.onclick = openMenu;
            workBadge.oncontextmenu = openMenu;
            workBadge.style.cursor = 'pointer';

            badgesContainer.appendChild(workBadge);
        }
    }

    // その日のイベントを取得（表示は全件、ピン付けのみ選択対象に絞る）
    const dayEvents = scheduleData.filter(item => {
        return item.date.toDateString() === date.toDateString();
    });

    // 曜日カウント表示
    const weekdayCountItems = dayEvents.filter(item => item.weekdayCount);
    if (weekdayCountItems.length > 0) {
        const weekdayCount = document.createElement('div');
        weekdayCount.className = 'day-weekday-count';
        weekdayCount.textContent = weekdayCountItems[0].weekdayCount;
        badgesContainer.appendChild(weekdayCount);
    }

    // 補講日バッジ表示
    const isMakeupDay = dayEvents.some(item =>
        (item.event && item.event.includes('補講日')) ||
        (item.weekdayCount && item.weekdayCount.includes('補講日'))
    );
    if (isMakeupDay) {
        const makeupBadge = document.createElement('div');
        makeupBadge.className = 'day-makeup-count';
        makeupBadge.textContent = '補講日';
        badgesContainer.appendChild(makeupBadge);
    }

    if (badgesContainer.hasChildNodes()) {
        dayCell.appendChild(badgesContainer);
    }


    // イベントリスト
    const eventsContainer = document.createElement('div');
    eventsContainer.className = 'day-events';
    // グリッドレイアウトを構成
    eventsContainer.style.display = 'grid';
    // すべての日付で同一のレーン数を確保し、空行でも高さを維持する（表示ズレ防止）
    const rowHeight = '1.75rem'; // 約28px
    eventsContainer.style.gridTemplateRows = `repeat(${customLaneCount}, minmax(${rowHeight}, auto))`;
    eventsContainer.style.gridAutoRows = `minmax(${rowHeight}, auto)`;
    eventsContainer.style.rowGap = '2px';

    // 1. カスタム（期間予定）イベントを最優先で配置
    let customEvents = allDisplayEvents.filter(ov =>
        ov.type === 'custom' &&
        ov.startDate <= dateStr &&
        ov.endDate >= dateStr
    );

    // laneMapに基づいて並び替え
    customEvents.sort((a, b) => {
        const laneA = laneMap.get(`${a.id}-${dateStr}`) ?? 999;
        const laneB = laneMap.get(`${b.id}-${dateStr}`) ?? 999;
        return laneA - laneB;
    });

    customEvents.forEach(ov => {
        const item = ov.data;
        let timeDisplay = '';
        let displayEventName = item.event;

        // 年休カードの場合：その日の最新の勤務時間に基づいて時間を動的に算出
        if (item.isLeaveCard && typeof getWorkTimeForDate === 'function') {
            const currentWork = getWorkTimeForDate(new Date(date.getFullYear(), date.getMonth(), date.getDate()));
            if (currentWork && currentWork.start && currentWork.end) {
                let calcStart, calcEnd;
                if (item.leaveType === 'early') {
                    calcStart = currentWork.start;
                    calcEnd = addMinutes(currentWork.start, item.leaveHours * 60 + (item.leaveExtra || 0));
                } else if (item.leaveType === 'late') {
                    calcStart = addMinutes(currentWork.end, -(item.leaveHours * 60 + (item.leaveExtra || 0)));
                    calcEnd = currentWork.end;
                } else if (item.leaveType === 'full') {
                    calcStart = currentWork.start;
                    calcEnd = currentWork.end;
                }

                if (calcStart && calcEnd) {
                    timeDisplay = `${calcStart}-${calcEnd}`;
                }
            }
            displayEventName = item.event; // ラベル名（例: 前半1時間休）
        } else if (item.allDay === false && (item.startTime || item.endTime)) {
            const startDate = ov.startDate || ov.date;
            const endDate = ov.endDate || ov.date || ov.startDate;

            if (startDate === endDate) {
                // 単日
                timeDisplay = item.startTime + (item.endTime ? `-${item.endTime}` : '') + ' ';
            } else {
                // 期間予定
                if (dateStr === startDate) {
                    timeDisplay = (item.startTime || '') + '～ ';
                } else if (dateStr === endDate) {
                    timeDisplay = '～' + (item.endTime || '') + ' ';
                } else {
                    timeDisplay = ''; // 間の日は時間表示なし
                }
            }
        }

        const eventItem = document.createElement('div');
        eventItem.className = 'event-item';
        if (item.isLeaveCard) {
            eventItem.classList.add('leave-card');
        } else if (item.isTripCard) {
            eventItem.classList.add('trip-card');
        } else if (item.isWfhCard) {
            eventItem.classList.add('wfh-card');
        } else {
            eventItem.classList.add('custom');
        }

        // 表示順（レーン）の固定：grid-rowを使用
        const laneIndex = laneMap.get(`${ov.id}-${dateStr}`);
        if (laneIndex !== undefined) {
            eventItem.style.gridRow = laneIndex + 1;
        }

        eventItem.draggable = true;
        eventItem.dataset.classId = ov.id;
        eventItem.dataset.type = 'custom';
        eventItem.dataset.date = dateStr;

        let isParticipating = item.isParticipating;
        if (isParticipating === undefined) {
            const exclusions = JSON.parse(localStorage.getItem('assignmentExclusions') || '{}');
            const itemExclusions = exclusions[ov.id] || [];
            isParticipating = !itemExclusions.includes(dateStr);
        }
        if (isParticipating) eventItem.classList.add('is-participating');

        // デザインの構築
        if (item.isLeaveCard) {
            const appliedIcon = item.isApplied ? '<span class="applied-icon" title="申請済み">📄</span> ' : '';
            eventItem.innerHTML = `
                <div class="leave-card-label">${appliedIcon}${displayEventName}</div>
                <div class="leave-card-time-badge">${timeDisplay}</div>
                <button class="event-delete-btn" onclick="deleteCalendarEvent(event, 'custom', '${ov.id}', '${dateStr}')" title="削除">×</button>
            `;
        } else if (item.isTripCard) {
            const startDate = ov.startDate || ov.date;
            const endDate = ov.endDate || ov.date || ov.startDate;
            const dest = item.tripDetails?.destination || item.location || '';

            let tripContent = '';
            if (startDate === endDate) {
                // 単日
                tripContent = `<span class="trip-time">${item.startTime}-${item.endTime}</span> <span class="trip-dest">${dest}</span>`;
            } else if (dateStr === startDate) {
                // 出発日：出発時刻 + 用務先
                tripContent = `<span class="trip-time">${item.startTime}～</span> <span class="trip-dest">${dest}</span>`;
            } else if (dateStr === endDate) {
                // 到着日：到着時刻のみ
                tripContent = `<span class="trip-time">～${item.endTime}</span>`;
            } else {
                // 中日：用務先のみ（任意）
                tripContent = `<span class="trip-dest">${dest}</span>`;
            }

            const appliedIcon = item.isApplied ? '<span class="applied-icon" title="申請済み">📄</span> ' : '';
            eventItem.innerHTML = `
                <span class="event-text">${appliedIcon}${tripContent}</span>
                <button class="event-delete-btn" onclick="deleteCalendarEvent(event, 'custom', '${ov.id}', '${dateStr}')" title="削除">×</button>
            `;
        } else {
            const textContent = typeof replaceSpecialMarks === 'function' ? replaceSpecialMarks(displayEventName) : displayEventName;
            const appliedIcon = item.isApplied ? '<span class="applied-icon" title="申請済み">📄</span> ' : '';
            eventItem.innerHTML = `
                <span class="event-text">${appliedIcon}${timeDisplay ? timeDisplay + ' ' : ''}${textContent}</span>
                <button class="event-delete-btn" onclick="deleteCalendarEvent(event, 'custom', '${ov.id}', '${dateStr}')" title="削除">×</button>
            `;

            // 連続表示のためのクラス判定（年休カード・在宅勤務以外）
            const startDate = ov.startDate || ov.date;
            const endDate = ov.endDate || ov.date || ov.startDate;
            if (startDate !== endDate && !item.isWfhCard) {
                if (dateStr === startDate) eventItem.classList.add('range-start');
                else if (dateStr === endDate) eventItem.classList.add('range-end');
                else eventItem.classList.add('range-middle');
            }
        }

        // ダブルクリックで編集（出張、年休、在宅、オリジナル期間予定すべて）
        eventItem.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            editCalendarEvent('custom', ov.id, dateStr);
        });

        // 右クリックメニュー対応
        eventItem.addEventListener('contextmenu', (e) => showEventContextMenu(e, 'custom', ov.id, dateStr));

        // 期間の最終日にリサイズハンドルを表示（年休カード・在宅勤務以外）
        const isLastDay = dateStr === (ov.endDate || ov.startDate || ov.date);
        if (isLastDay && !item.isLeaveCard && !item.isWfhCard) {
            const handle = document.createElement('div');
            handle.className = 'resize-handle-right';
            handle.title = 'ドラッグして期間を変更';
            handle.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                if (typeof startResizing === 'function') startResizing(e, ov);
            });
            eventItem.appendChild(handle);
            eventItem.classList.add('resizable');
        }

        let tooltip = `[カスタム] ${item.event}`;
        if (item.location) tooltip += `\n場所: ${item.location}`;
        if (item.memo) tooltip += `\nメモ: ${item.memo}`;
        eventItem.title = tooltip;

        eventsContainer.appendChild(eventItem);
    });

    // 2. Excelイベント（年間行事）をその下に配置
    dayEvents.forEach(item => {
        if (!item.event || item.event.trim() === '') return;

        // 祝日はバッジ（右上）で表示するため、イベントリストからは除外
        if (isHolidayDay && typeof isRedundantHoliday === 'function' && isRedundantHoliday(item.event, date)) {
            return;
        }

        // オーバライドチェック：削除されているか、移動済みなのかを確認
        const isDeleted = classOverrides.some(ov =>
            String(ov.id) === String(item.id) &&
            ov.type === 'excel' &&
            ov.date === dateStr &&
            ov.action === 'delete'
        );

        const isMoved = classOverrides.some(ov =>
            String(ov.id) === String(item.id) &&
            ov.type === 'excel' &&
            ov.date === dateStr &&
            ov.action === 'move' &&
            ov.data  // 「移動済み（データあり）」の記録が存在する
        );

        if (isDeleted || isMoved) return;

        const eventItem = document.createElement('div');
        eventItem.className = 'event-item';
        eventItem.classList.add(item.type);
        eventItem.draggable = true;
        eventItem.dataset.classId = item.id;
        eventItem.dataset.type = 'excel';
        eventItem.dataset.date = dateStr;

        // 参加状況チェック
        const participateOv = classOverrides.find(ov =>
            String(ov.id) === String(item.id) && ov.date === dateStr && ov.type === 'excel' && ov.action === 'move' && ov.data
        );

        let isParticipating = false;
        if (participateOv && participateOv.data.isParticipating !== undefined) {
            isParticipating = !!participateOv.data.isParticipating;
        } else {
            // 対象外（例：教員モードでの学生用行事）は、キーワードに一致してもデフォルトではピン付けしない
            if (target !== 'both' && item.type !== target) {
                isParticipating = false;
            } else {
                // 除外リストをチェック
                const exclusions = JSON.parse(localStorage.getItem('assignmentExclusions') || '{}');
                const itemExclusions = exclusions[item.id] || [];
                if (itemExclusions.includes(dateStr)) {
                    isParticipating = false;
                } else {
                    // デフォルトでピン付けするキーワード
                    const name = item.event || "";
                    if (containsPinnedKeyword(name)) {
                        isParticipating = true;
                    }
                }
            }
        }
        if (isParticipating) eventItem.classList.add('is-participating');

        // 表示順（レーン）の固定
        const laneIndex = laneMap.get(`${item.id}-${dateStr}`);
        if (laneIndex !== undefined) {
            eventItem.style.gridRow = laneIndex + 1;
        }

        eventItem.innerHTML = `
            <span class="event-text">${typeof replaceSpecialMarks === 'function' ? replaceSpecialMarks(item.event) : item.event}</span>
            <button class="event-delete-btn" onclick="deleteCalendarEvent(event, 'excel', '${item.id}', '${dateStr}')" title="この日だけ削除">×</button>
        `;

        eventItem.addEventListener('dblclick', () => editCalendarEvent('excel', item.id, dateStr));

        // 右クリックメニュー対応
        eventItem.addEventListener('contextmenu', (e) => showEventContextMenu(e, 'excel', item.id, dateStr));

        eventItem.addEventListener('dragstart', handleEventDragStart);
        eventItem.title = item.event;
        eventsContainer.appendChild(eventItem);
    });

    // この日に追加（移動）されたExcelイベントを表示
    const addedExcelOverrides = allDisplayEvents.filter(ov =>
        ov.type === 'excel-moved' &&
        ov.date === dateStr
    );

    addedExcelOverrides.forEach(ov => {
        const item = ov.data;
        if (!item) return;

        // 祝日は除外
        if (isHolidayDay && typeof isRedundantHoliday === 'function' && isRedundantHoliday(item.event, date)) {
            return;
        }
        let timeDisplay = '';
        let fullTimeRange = '';
        if (item.allDay === false && item.startTime) {
            timeDisplay = item.startTime + ' ';
            fullTimeRange = `時間: ${item.startTime}～${item.endTime}`;
        }

        const eventItem = document.createElement('div');
        eventItem.className = 'event-item';
        eventItem.classList.add(item.type || 'teacher');
        eventItem.draggable = true;
        eventItem.dataset.classId = ov.id;
        eventItem.dataset.type = 'excel';
        eventItem.dataset.date = dateStr;

        let isParticipating = item.isParticipating;
        if (isParticipating === undefined) {
            // 対象外（例：教員モードでの学生用行事）
            if (target !== 'both' && item.type !== target) {
                isParticipating = false;
            } else {
                // 除外リストをチェック
                const exclusions = JSON.parse(localStorage.getItem('assignmentExclusions') || '{}');
                const itemExclusions = exclusions[ov.id] || [];
                if (itemExclusions.includes(dateStr)) {
                    isParticipating = false;
                } else {
                    const name = item.event || "";
                    isParticipating = containsPinnedKeyword(name);
                }
            }
        }
        if (isParticipating) eventItem.classList.add('is-participating');

        // 表示順（レーン）の固定
        const laneIndex = laneMap.get(`${ov.id}-${dateStr}`);
        if (laneIndex !== undefined) {
            eventItem.style.gridRow = laneIndex + 1;
        }

        eventItem.innerHTML = `
            <span class="event-text">${timeDisplay}${item.event}</span>
            <button class="event-delete-btn" onclick="deleteCalendarEvent(event, 'excel', '${ov.id}', '${dateStr}')" title="この日だけ削除">×</button>
        `;

        eventItem.addEventListener('dblclick', () => editCalendarEvent('excel', ov.id, dateStr));

        // 右クリックメニュー対応
        eventItem.addEventListener('contextmenu', (e) => showEventContextMenu(e, 'excel', ov.id, dateStr));

        eventItem.addEventListener('dragstart', handleEventDragStart);

        let tooltip = `[移動/編集済み] ${item.event}`;
        if (fullTimeRange) tooltip += `\n${fullTimeRange}`;
        if (item.location) tooltip += `\n場所: ${item.location}`;
        if (item.memo) tooltip += `\nメモ: ${item.memo}`;
        eventItem.title = tooltip;

        eventsContainer.appendChild(eventItem);
    });

    dayCell.appendChild(eventsContainer);

    // 自分の授業を追加（my_classes.jsから）
    // laneMapを渡すことで、授業も正しいレーンに配置される
    if (typeof addMyClassesToDayCell === 'function') {
        addMyClassesToDayCell(dayCell, date, dayEvents, laneMap);
    }

    // セルクリックで新規追加
    dayCell.addEventListener('click', (e) => {
        // イベントアイテムやその中のボタンをクリックした時は反応しない
        if (e.target.closest('.event-item') || e.target.closest('button')) return;

        const newId = 'custom-' + Date.now();
        editCalendarEvent('custom', newId, dateStr);
    });

    // イベントの並び替え：参加予定（ピン付き）を優先して上に、期間予定はレーンを維持
    const finalContainer = dayCell.querySelector('.day-events');
    if (finalContainer) {
        const items = Array.from(finalContainer.children);
        // gridRowがあるもの（期間予定）とないもの（通常）を分ける
        const laneItems = items.filter(el => el.style.gridRow);
        const autoItems = items.filter(el => !el.style.gridRow);

        // 通常予定の中で参加（ピン付き）を優先
        autoItems.sort((a, b) => {
            const pinA = a.classList.contains('is-participating') ? 1 : 0;
            const pinB = b.classList.contains('is-participating') ? 1 : 0;
            return pinB - pinA;
        });

        // 再配置（laneItemsはそのまま、autoItemsはソート順に再追加）
        // laneItemsは再追加する必要はないが、DOM順序も整えておくと安全
        laneItems.forEach(el => finalContainer.appendChild(el));
        autoItems.forEach(el => finalContainer.appendChild(el));
    }

    // 年休候補日（フリーな平日）の判定とスタイル適用
    if (weekday !== 0 && weekday !== 6 && !isHolidayDay) {
        // dayCell 内の全てのイベント（授業含む）をチェック
        const pinnedItems = dayCell.querySelectorAll('.event-item.is-participating');
        if (pinnedItems.length === 0) {
            dayCell.classList.add('vacation-candidate');
            dayCell.title = (dayCell.title ? dayCell.title + '\n' : '') + '年休候補日（予定なし）';
        }
    }

    return dayCell;
}

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

    // 'application/json' ではなく 'text/plain' を使用（一部のブラウザでの互換性のため）
    e.dataTransfer.setData('text/plain', JSON.stringify(data));
    // Ctrlキー/Cmdキーでコピー、そうでなければ移動
    e.dataTransfer.effectAllowed = (e.ctrlKey || e.metaKey) ? 'copy' : 'move';
    el.classList.add('dragging');

    // ドラッグ中のゴーストイメージを少し透明に
    setTimeout(() => {
        if (el) el.style.opacity = '0.5';
    }, 0);
}
window.handleEventDragStart = handleEventDragStart;

function handleDayDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drag-over');
}

function handleDayDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

function handleDayDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove('drag-over');

    const targetDate = e.currentTarget.dataset.date;
    const json = e.dataTransfer.getData('text/plain'); // 'text/plain' から取得
    if (!json) return;

    try {
        const data = JSON.parse(json);
        if (data.sourceDate === targetDate) return;

        // Ctrlキーが押されている場合はコピー、そうでない場合は移動
        const isCopy = e.ctrlKey || e.metaKey;

        // 移動/コピー処理


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
            const item = scheduleData.find(i => String(i.id) === String(id));
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
    if (!isCopy) {
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
            document.getElementById('quickEditStartTime').value = existingOv.data.startTime;
            document.getElementById('quickEditEndTime').value = existingOv.data.endTime;
        } else {
            updateQuickTimeFromPeriod();
        }

    } else if (type === 'excel') {
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

        const override = classOverrides.find(ov => String(ov.id) === String(id) && ov.date === date && ov.type === 'excel' && ov.action === 'move');
        if (override && override.data) {
            currentText = override.data.event;
            currentLocation = override.data.location || '';
            currentStartTime = override.data.startTime || '';
            currentEndTime = override.data.endTime || '';
            currentMemo = override.data.memo || '';
            isAllDay = override.data.allDay !== undefined ? override.data.allDay : true;
            isParticipating = override.data.isParticipating !== undefined ? override.data.isParticipating : false;
        } else {
            const item = scheduleData.find(i => String(i.id) === String(id));
            currentText = item ? item.event : '';
            // デフォルトでピン付けするキーワード
            if (containsPinnedKeyword(currentText)) {
                isParticipating = true;
            }
        }

        allDayCheckbox.checked = isAllDay;
        participateCheckbox.checked = isParticipating;
        document.getElementById('quickEditName').value = currentText;
        document.getElementById('quickEditLocation').value = currentLocation;
        document.getElementById('quickEditStartTime').value = currentStartTime;
        document.getElementById('quickEditEndTime').value = currentEndTime;
        document.getElementById('quickEditMemo').value = currentMemo;
        document.getElementById('quickEditDateRangeFields').classList.add('hidden');
    } else if (type === 'custom') {
        classFields.classList.add('hidden');
        participateFields.classList.remove('hidden');

        const override = classOverrides.find(ov => String(ov.id) === String(id) && ov.type === 'custom');
        const item = override ? override.data : null;

        let title = `${date} の新規予定追加`;
        let showDateRange = true;

        if (item) {
            if (item.isLeaveCard) {
                title = '年休の編集';
                showDateRange = false;
            } else if (item.isWfhCard) {
                title = '在宅勤務の編集';
                showDateRange = false;
            } else if (item.isTripCard) {
                title = '出張の編集';
                // 複数日出張なら期間を表示、単日なら非表示
                showDateRange = (override.startDate || override.date) !== (override.endDate || override.date);
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

            document.getElementById('quickEditStartTime').value = startTime;
            document.getElementById('quickEditEndTime').value = endTime;
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
            document.getElementById('quickEditStartTime').value = '';
            document.getElementById('quickEditEndTime').value = '';
            document.getElementById('quickEditMemo').value = '';
            document.getElementById('quickEditApplied').checked = false; // 新規は未申請
            document.getElementById('quickEditStartDate').value = date.replace(/\//g, '-');
            document.getElementById('quickEditEndDate').value = date.replace(/\//g, '-');
            allDayCheckbox.checked = true;
            participateCheckbox.checked = false;
        }

        const rangeFields = document.getElementById('quickEditDateRangeFields');
        if (showDateRange) rangeFields.classList.remove('hidden');
        else rangeFields.classList.add('hidden');

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
    if (isAllDay) {
        timeFields.classList.add('hidden');
    } else {
        timeFields.classList.remove('hidden');
    }
}
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
        document.getElementById('quickEditStartTime').value = times.start;
        document.getElementById('quickEditEndTime').value = times.end;
    }
}

window.updateQuickTimeFromPeriod = updateQuickTimeFromPeriod;

/**
 * 個別編集モーダルの保存処理
 */
function handleQuickEditSubmit(e) {
    e.preventDefault();

    const type = document.getElementById('quickEditType').value;
    const id = document.getElementById('quickEditId').value;
    const date = document.getElementById('quickEditDate').value;
    const sourcePeriod = document.getElementById('quickEditSourcePeriod').value;
    const newName = document.getElementById('quickEditName').value.trim();
    const isAllDay = document.getElementById('quickEditAllDay').checked;
    const startTime = (isAllDay) ? '' : document.getElementById('quickEditStartTime').value;
    const endTime = (isAllDay) ? '' : document.getElementById('quickEditEndTime').value;
    const location = document.getElementById('quickEditLocation').value.trim();
    const memo = document.getElementById('quickEditMemo').value.trim();

    const isParticipating = document.getElementById('quickEditParticipate').checked;

    if (type === 'myclass') {
        const cls = myClasses.find(c => String(c.id) === String(id));
        const newPeriod = document.getElementById('quickEditPeriod').value; // 元のコードに合わせて文字列またはパース後の型を確認

        // 授業の参加切り替え：assignmentExclusionsで管理（コンテキストメニューと同期）
        let assignmentExclusions = JSON.parse(localStorage.getItem('assignmentExclusions') || '{}');
        const dateKey = date;
        if (!assignmentExclusions[id]) {
            assignmentExclusions[id] = [];
        }

        if (isParticipating) {
            // 参加する場合：除外リストから削除
            assignmentExclusions[id] = assignmentExclusions[id].filter(d => d !== dateKey);
        } else {
            // 非参加にする場合：除外リストに追加
            if (!assignmentExclusions[id].includes(dateKey)) {
                assignmentExclusions[id].push(dateKey);
            }
        }
        localStorage.setItem('assignmentExclusions', JSON.stringify(assignmentExclusions));


        // 既存オーバライドのクリア
        classOverrides = classOverrides.filter(ov =>
            !(String(ov.id) === String(id) && ov.date === date && ov.type === 'myclass')
        );

        // 1. 移動元を消去
        classOverrides.push({
            type: 'myclass',
            id: id,
            date: date,
            action: 'move',
            period: sourcePeriod // そのまま使用
        });

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
        // 既存オーバライドのクリア
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
        const startDateVal = document.getElementById('quickEditStartDate').value || date;
        const endDateVal = document.getElementById('quickEditEndDate').value || startDateVal;
        const isApplied = document.getElementById('quickEditApplied').checked;

        // 既存同一IDの抽出（データ継承のため）
        const existingOverride = classOverrides.find(ov => String(ov.id) === String(id) && ov.type === 'custom');
        const existingData = existingOverride ? existingOverride.data : {};

        let data = {
            ...existingData,
            event: newName,
            location: location,
            memo: memo,
            allDay: isAllDay,
            isApplied: isApplied
        };

        // 既存同一IDのクリア
        classOverrides = classOverrides.filter(ov =>
            !(String(ov.id) === String(id) && ov.type === 'custom')
        );

        const updatedData = {
            ...existingData,
            event: newName,
            allDay: isAllDay,
            startTime: startTime,
            endTime: endTime,
            location: location,
            memo: memo,
            isParticipating: isParticipating
        };

        // 出張詳細への反映（もしあれば）
        if (updatedData.isTripCard && updatedData.tripDetails) {
            updatedData.tripDetails.depTime = startTime;
            updatedData.tripDetails.arrTime = endTime;
            updatedData.tripDetails.destination = location;
        }

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

/**
 * フルバックアップの作成（JSON形式でダウンロード）
 */
function downloadBackup() {
    const backupData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        scheduleData: scheduleData,
        myClasses: myClasses,
        classOverrides: classOverrides,
        fileName: document.getElementById('fileName').textContent
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schedule_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
window.downloadBackup = downloadBackup;

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
function changeMonth(delta) {
    currentMonth += delta;
    if (currentMonth > 12) {
        currentMonth = 1;
        currentYear++;
    } else if (currentMonth < 1) {
        currentMonth = 12;
        currentYear--;
    }
    const ys = document.getElementById('yearSelect');
    const ms = document.getElementById('monthSelect');
    if (ys) ys.value = currentYear;
    if (ms) ms.value = currentMonth;
    updateCalendar();
}
window.changeMonth = changeMonth;

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
                    memo: ov.data.memo || ''
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
    const target = document.getElementById('targetSelect').value;
    const contentSelect = document.getElementById('exportContentSelect').value;
    const startStr = document.getElementById('exportStartDate').value;
    const endStr = document.getElementById('exportEndDate').value;

    if (!startStr || !endStr) {
        alert('出力期間を指定してください。');
        return;
    }

    const startDate = new Date(startStr);
    const endDate = new Date(endStr);
    endDate.setHours(23, 59, 59, 999);

    const appliedData = getAppliedScheduleData(target);
    let filteredData = appliedData.filter(item => item.date >= startDate && item.date <= endDate);

    // 行事予定をスキップする場合
    if (contentSelect === 'undergrad_only' || contentSelect === 'advanced_only') {
        filteredData = [];
    }

    // 祝日データの準備
    const allHolidays = new Map();
    availableYears.forEach(year => {
        const yearHolidays = getHolidaysForYear(year);
        yearHolidays.forEach((name, dateKey) => {
            allHolidays.set(dateKey, name);
        });
    });

    const jsonData = filteredData.map(item => {
        const dateKey = formatDateKey(item.date);
        const holidayName = allHolidays.get(dateKey);
        return {
            date: formatDateKey(item.date),
            weekdayCount: item.weekdayCount,
            event: item.event,
            type: item.type,
            period: item.period,
            location: item.location || '',
            memo: item.memo || '',
            holiday: holidayName || null
        };
    });

    let classData = [];
    if (typeof generateClassEvents === 'function' && contentSelect !== 'schedule_only') {
        const startYear = getFiscalYear(startDate);
        const endYear = getFiscalYear(endDate);
        let allClassEvents = [];
        for (let y = startYear; y <= endYear; y++) {
            allClassEvents = allClassEvents.concat(generateClassEvents(y, { includeExclusions: false }));
        }


        let filteredClassEvents = allClassEvents.filter(cls => cls.date >= startDate && cls.date <= endDate);

        // 授業データのフィルタリング
        if (contentSelect === 'undergrad_only') {
            filteredClassEvents = filteredClassEvents.filter(cls => cls.departmentType === 'teacher');
        } else if (contentSelect === 'advanced_only') {
            filteredClassEvents = filteredClassEvents.filter(cls => cls.departmentType === 'student');
        }

        classData = filteredClassEvents.map(cls => {
            const targetLabel = cls.targetType === 'grade'
                ? `${cls.targetGrade}年全体`
                : cls.targetGrade === 1
                    ? `${cls.targetGrade}-${cls.targetClass}`
                    : `${cls.targetGrade}${cls.targetClass}`;
            return {
                date: formatDateKey(cls.date),
                event: cls.name,
                type: 'my-class',
                target: targetLabel,
                location: cls.location || '',
                period: `${cls.period}限`,
                semester: cls.semester,
                memo: cls.memo || '',
                allDay: !!cls.allDay,
                startTime: cls.startTime instanceof Date ? cls.startTime.toTimeString().substring(0, 5) : '',
                endTime: cls.endTime instanceof Date ? cls.endTime.toTimeString().substring(0, 5) : ''
            };
        });
    }

    const exportBundle = {
        meta: {
            exportDate: new Date().toISOString(),
            rangeStart: startStr,
            rangeEnd: endStr,
            target: target,
            contentType: contentSelect
        },
        schedule: jsonData,
        myClasses: classData
    };

    const blob = new Blob([JSON.stringify(exportBundle, null, 2)], { type: 'application/json' });
    downloadFile(blob, `schedule_${startStr}_to_${endStr}.json`);
}

function exportToIcal() {
    const target = document.getElementById('targetSelect').value;
    const contentSelect = document.getElementById('exportContentSelect').value;
    const startStr = document.getElementById('exportStartDate').value;
    const endStr = document.getElementById('exportEndDate').value;

    if (!startStr || !endStr) {
        alert('出力期間を指定してください。');
        return;
    }

    const startDate = new Date(startStr);
    const endDate = new Date(endStr);
    endDate.setHours(23, 59, 59, 999);

    const appliedData = getAppliedScheduleData(target);
    let filteredData = appliedData.filter(item => item.date >= startDate && item.date <= endDate);

    // 行事予定をスキップする場合
    if (contentSelect === 'undergrad_only' || contentSelect === 'advanced_only') {
        filteredData = [];
    }

    // ICAL形式生成
    let icalContent = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//年間行事予定表アプリ//JP',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:学校行事予定',
        'X-WR-TIMEZONE:Asia/Tokyo'
    ];

    filteredData.forEach(item => {
        if (!item.event || item.event.trim() === '') return;

        const dateStrOnly = formatDateKey(item.date).replace(/-/g, '');
        const uid = generateUID(item);

        icalContent.push('BEGIN:VEVENT');
        icalContent.push(`UID:${uid}`);
        icalContent.push(`DTSTAMP:${formatDateForIcal(new Date())}`);

        if (item.allDay === false && item.startTime && item.endTime) {
            const startDt = new Date(item.date);
            const [sh, sm] = item.startTime.split(':');
            startDt.setHours(parseInt(sh), parseInt(sm), 0);
            const endDt = new Date(item.date);
            const [eh, em] = item.endTime.split(':');
            endDt.setHours(parseInt(eh), parseInt(em), 0);

            // 予定あり(OPAQUE)か空き時間(TRANSPARENT)か。
            // 時間指定のある行事は通常予定(OPAQUE)とする
            icalContent.push(`DTSTART;TZID=Asia/Tokyo:${formatDateForIcal(startDt)}`);
            icalContent.push(`DTEND;TZID=Asia/Tokyo:${formatDateForIcal(endDt)}`);
            icalContent.push('TRANSP:OPAQUE');
        } else {
            // 終日予定
            const endDt = new Date(item.date);
            endDt.setDate(endDt.getDate() + 1);
            const nextDayStr = formatDateKey(endDt).replace(/-/g, '');

            icalContent.push(`DTSTART;VALUE=DATE:${dateStrOnly}`);
            icalContent.push(`DTEND;VALUE=DATE:${nextDayStr}`);
            icalContent.push('TRANSP:TRANSPARENT');
        }

        icalContent.push(`SUMMARY:${escapeIcalText(item.event)}`);

        if (item.location) {
            icalContent.push(`LOCATION:${escapeIcalText(item.location)}`);
        }

        let desc = (item.weekdayCount ? `${item.weekdayCount} - ` : '') + item.event;
        if (item.memo) desc += `\n\n${item.memo}`;
        icalContent.push(`DESCRIPTION:${escapeIcalText(desc)}`);

        let category = '行事';
        if (item.type === 'teacher') category = '本科';
        else if (item.type === 'student') category = '専攻科';

        icalContent.push(`CATEGORIES:${category}`);
        icalContent.push('STATUS:CONFIRMED');
        icalContent.push('END:VEVENT');
    });

    // 授業データを追加
    if (typeof generateClassEvents === 'function' && contentSelect !== 'schedule_only') {
        const startYear = getFiscalYear(startDate);
        const endYear = getFiscalYear(endDate);
        let allClassEvents = [];
        for (let y = startYear; y <= endYear; y++) {
            allClassEvents = allClassEvents.concat(generateClassEvents(y, { includeExclusions: false }));
        }


        let filteredClassEvents = allClassEvents.filter(cls => cls.date >= startDate && cls.date <= endDate);

        // 授業データのフィルタリング
        if (contentSelect === 'undergrad_only') {
            filteredClassEvents = filteredClassEvents.filter(cls => cls.departmentType === 'teacher');
        } else if (contentSelect === 'advanced_only') {
            filteredClassEvents = filteredClassEvents.filter(cls => cls.departmentType === 'student');
        }

        filteredClassEvents.forEach(cls => {
            const targetLabel = cls.targetType === 'grade'
                ? `${cls.targetGrade}年全体`
                : cls.targetGrade === 1
                    ? `${cls.targetGrade}-${cls.targetClass}`
                    : `${cls.targetGrade}${cls.targetClass}`;

            const dateStrOnly = formatDateKey(cls.date).replace(/-/g, '');
            const uid = `my-class-${cls.id}-${dateStrOnly}@schedule-app`;

            // 担当者マーク(★)の判定
            const assignmentExclusions = JSON.parse(localStorage.getItem('assignmentExclusions') || '{}');
            const classExclusions = assignmentExclusions[cls.id] || [];
            const isAssigned = !classExclusions.includes(formatDateKey(cls.date));
            const assignedMark = isAssigned ? ' ★' : '';

            // Summary: 授業名(学年クラス/コース) ★
            const summary = `${cls.name}(${targetLabel})${assignedMark}`;

            icalContent.push('BEGIN:VEVENT');
            icalContent.push(`UID:${uid}`);
            icalContent.push(`DTSTAMP:${formatDateForIcal(new Date())}`);

            if (!cls.allDay && cls.startTime && cls.endTime) {
                icalContent.push(`DTSTART;TZID=Asia/Tokyo:${formatDateForIcal(cls.startTime)}`);
                icalContent.push(`DTEND;TZID=Asia/Tokyo:${formatDateForIcal(cls.endTime)}`);
            } else {
                const nextDay = new Date(cls.date);
                nextDay.setDate(nextDay.getDate() + 1);
                const nextDayStr = formatDateKey(nextDay).replace(/-/g, '');
                icalContent.push(`DTSTART;VALUE=DATE:${dateStrOnly}`);
                icalContent.push(`DTEND;VALUE=DATE:${nextDayStr}`);
            }

            icalContent.push(`SUMMARY:${escapeIcalText(summary)}`);

            if (cls.location) {
                icalContent.push(`LOCATION:${escapeIcalText(cls.location)}`);
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

            icalContent.push(`DESCRIPTION:${escapeIcalText(descParts.join('\n'))}`);

            icalContent.push('CATEGORIES:授業');
            icalContent.push('STATUS:CONFIRMED');
            icalContent.push('TRANSP:OPAQUE');
            icalContent.push('END:VEVENT');
        });
    }

    icalContent.push('END:VCALENDAR');

    // ファイルダウンロード
    const blob = new Blob([icalContent.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    downloadFile(blob, `schedule_${startStr}_to_${endStr}.ics`);
}

function exportToCsv() {
    const target = document.getElementById('targetSelect').value;
    const contentSelect = document.getElementById('exportContentSelect').value;
    const startStr = document.getElementById('exportStartDate').value;
    const endStr = document.getElementById('exportEndDate').value;

    if (!startStr || !endStr) {
        alert('出力期間を指定してください。');
        return;
    }

    const startDate = new Date(startStr);
    const endDate = new Date(endStr);
    endDate.setHours(23, 59, 59, 999);

    const appliedData = getAppliedScheduleData(target);
    let filteredData = appliedData.filter(item => item.date >= startDate && item.date <= endDate);

    // 行事予定をスキップする場合
    if (contentSelect === 'undergrad_only' || contentSelect === 'advanced_only') {
        filteredData = [];
    }

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
    if (typeof generateClassEvents === 'function' && contentSelect !== 'schedule_only') {
        const startYear = getFiscalYear(startDate);
        const endYear = getFiscalYear(endDate);
        let allClassEvents = [];
        for (let y = startYear; y <= endYear; y++) {
            allClassEvents = allClassEvents.concat(generateClassEvents(y, { includeExclusions: false }));
        }


        let filteredClassEvents = allClassEvents.filter(cls => cls.date >= startDate && cls.date <= endDate);

        // 授業データのフィルタリング
        if (contentSelect === 'undergrad_only') {
            filteredClassEvents = filteredClassEvents.filter(cls => cls.departmentType === 'teacher');
        } else if (contentSelect === 'advanced_only') {
            filteredClassEvents = filteredClassEvents.filter(cls => cls.departmentType === 'student');
        }

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
// 以前は'Z'を付けていましたが、JST(日本標準時)としてOutlook等で正しく認識させるため、
// タイムゾーン指定なしのローカル形式で返します。呼び出し側で TZID を指定します。
function formatDateForIcal(date) {
    if (!date || !(date instanceof Date)) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}T${hours}${minutes}${seconds}`;
}

function generateUID(item) {
    const dateStr = formatDateKey(item.date);
    const eventHash = simpleHash(item.event);
    return `${dateStr}-${eventHash}@schedule-app.local`;
}

function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
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
    if (typeof generateClassEvents === 'function') {
        generateClassEvents(currentYear);
    }

    alert(`${year}年度のデータを削除しました。`);
}

window.renderCachedYearList = renderCachedYearList;
window.deleteCachedYear = deleteCachedYear;

/**
 * 右クリックメニュー（参加/非参加）
 */
let contextEventData = null;

function showEventContextMenu(e, type, id, date, period = null) {
    e.preventDefault();
    e.stopPropagation();

    contextEventData = { type, id, date, period };

    const menu = document.getElementById('calendarContextMenu');
    menu.classList.remove('hidden');

    // 参加状況に合わせてメニューテキストを調整
    const participateItem = document.getElementById('ctxParticipate');
    const notParticipateItem = document.getElementById('ctxNotParticipate');

    // 現在の参加状況を確認
    let isParticipating = false;
    if (type === 'myclass') {
        // 授業タイプ：assignmentExclusionsで管理
        // dateはISO形式の文字列（YYYY-MM-DD）として渡される
        const dateKey = date;
        const assignmentExclusions = JSON.parse(localStorage.getItem('assignmentExclusions') || '{}');
        const classExclusions = assignmentExclusions[id] || [];
        // 除外リストに含まれていなければ参加中（担当中）
        isParticipating = !classExclusions.includes(dateKey);
    } else if (type === 'custom') {
        const ov = classOverrides.find(ov => ov.type === 'custom' && String(ov.id) === String(id));
        isParticipating = ov && ov.data && (ov.data.isParticipating !== undefined ? ov.data.isParticipating : containsPinnedKeyword(ov.data.event));
    } else if (type === 'excel') {
        const ov = classOverrides.find(ov => ov.type === 'excel' && String(ov.id) === String(id) && ov.date === date && ov.action === 'move' && ov.data);
        if (ov) {
            isParticipating = ov.data.isParticipating !== undefined ? ov.data.isParticipating : containsPinnedKeyword(ov.data.event);
        } else {
            const item = scheduleData.find(i => String(i.id) === String(id));
            const name = item ? (item.event || item.name || "") : "";
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
        } else if (type === 'excel') {
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
                const item = scheduleData.find(i => String(i.id) === String(id));
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
    }

    document.getElementById('calendarContextMenu').classList.add('hidden');
    contextEventData = null;
}

window.showEventContextMenu = showEventContextMenu;
window.handleContextAction = handleContextAction;
