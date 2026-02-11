/**
 * 年間行事予定表アプリ - メインスクリプト
 * Excelファイルから学校の行事予定を読み込み、JSON/ICAL/CSV形式でエクスポート
 */

// =============================
// グローバル変数
// =============================
let scheduleData = [];      // 全スケジュールデータ
let currentYear = 2026;     // 現在表示中の年
let currentMonth = 4;       // 現在表示中の月（デフォルト4月：学年開始）
let availableYears = [];    // 利用可能な年度リスト
let availableMonths = [];   // 利用可能な月リスト

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
    '□': '一般科目系会議/コース会議(H)'
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

// 祝日名のリスト（イベントから除外するため）
const HOLIDAY_NAMES = [
    '元日', '成人の日', '建国記念の日', '天皇誕生日', '春分の日', '昭和の日',
    '憲法記念日', 'みどりの日', 'こどもの日', '海の日', '山の日', '敬老の日',
    '秋分の日', 'スポーツの日', '体育の日', '文化の日', '勤労感謝の日',
    '振替休日', '国民の休日'
];

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

// =============================
// 初期化
// =============================
document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
});

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
    document.getElementById('yearSelect').addEventListener('change', (e) => {
        currentYear = parseInt(e.target.value);
        updateCalendar();
    });
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
        const data = await readExcelFile(file);
        scheduleData = parseScheduleData(data);

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

        // データ処理完了後、UIを更新
        updateAvailableYearsAndMonths();
        updateStats();
        updateCalendar();

        // セクション表示
        document.getElementById('statsSection').classList.remove('hidden');
        document.getElementById('controlsSection').classList.remove('hidden');
        document.getElementById('calendarSection').classList.remove('hidden');
        document.getElementById('myClassesSection').classList.remove('hidden');
        document.getElementById('exportSection').classList.remove('hidden');

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

                            // イベントから祝日名を除去
                            const cleanedEvent = removeHolidayNames(replaceSpecialMarks(event));

                            // 空になったイベントはスキップ
                            if (!cleanedEvent || cleanedEvent.trim() === '') {
                                return;
                            }

                            allData.push({
                                date: dateObj,
                                event: cleanedEvent,
                                type: 'teacher',
                                weekdayCount: weekdayCount,
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
                        period: period
                    });
                }
            }
        });
    });

    // 日付順にソート
    return allData.sort((a, b) => a.date - b.date);
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

        // 丸数字を通常の数字に変換
        for (const [mark, num] of Object.entries(MARU_NUM_DICT)) {
            valueStr = valueStr.replace(new RegExp(mark, 'g'), num);
        }

        // すでに「月1」「火2」などの形式になっている場合
        const weekdayPattern = /^([月火水木金土日])(\d+)$/;
        const match = valueStr.match(weekdayPattern);
        if (match) {
            return valueStr; // そのまま返す
        }

        // 数値のみの場合、曜日を付与
        const num = parseInt(valueStr);
        if (isNaN(num)) {
            // 数値でない場合、そのまま返す（特殊なケース）
            return valueStr;
        }

        const weekdays = ['月', '火', '水', '木', '金', '土', '日'];
        const weekday = weekdays[dateObj.getDay() === 0 ? 6 : dateObj.getDay() - 1];
        return `${weekday}${num}`;
    } catch (error) {
        console.warn('曜日カウント処理エラー:', value, error);
        return '';
    }
}

function replaceSpecialMarks(text) {
    let result = text;
    for (const [mark, label] of Object.entries(SPECIAL_MARKS)) {
        result = result.replace(new RegExp(mark, 'g'), label);
    }
    // 丸数字も変換
    for (const [mark, num] of Object.entries(MARU_NUM_DICT)) {
        result = result.replace(new RegExp(mark, 'g'), num);
    }
    return result;
}

function extractWeekdayFromEvent(event) {
    // 丸数字を数字に変換
    let processed = event;
    for (const [mark, num] of Object.entries(MARU_NUM_DICT)) {
        processed = processed.replace(new RegExp(mark, 'g'), num);
    }

    const match = processed.match(/^([月火水木金土日])(\d+)/);
    if (match) {
        const weekday = `${match[1]}${match[2]}`;
        const rest = processed.substring(match[0].length).trim();
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

    scheduleData.forEach(item => {
        const fiscalYear = getFiscalYear(item.date);
        fiscalYears.add(fiscalYear);
        months.add(item.date.getMonth() + 1);
    });

    availableYears = Array.from(fiscalYears).sort();
    availableMonths = Array.from(months).sort((a, b) => {
        // 4月始まりでソート（4,5,6,...,12,1,2,3）
        const orderA = a >= FISCAL_YEAR_START_MONTH ? a : a + 12;
        const orderB = b >= FISCAL_YEAR_START_MONTH ? b : b + 12;
        return orderA - orderB;
    });

    // セレクトボックス更新
    const yearSelect = document.getElementById('yearSelect');
    const monthSelect = document.getElementById('monthSelect');

    yearSelect.innerHTML = availableYears.map(y =>
        `<option value="${y}">${y}年度 (${y}年4月～${y + 1}年3月)</option>`
    ).join('');

    monthSelect.innerHTML = availableMonths.map(m =>
        `<option value="${m}">${m}月</option>`
    ).join('');

    // 初期値設定（最初の年度の4月）
    if (availableYears.length > 0) {
        currentYear = availableYears[0];
        yearSelect.value = currentYear;
    }

    // 4月が利用可能ならデフォルト、なければ最初の月
    if (availableMonths.includes(4)) {
        currentMonth = 4;
    } else if (availableMonths.length > 0) {
        currentMonth = availableMonths[0];
    }

    if (monthSelect.querySelector(`option[value="${currentMonth}"]`)) {
        monthSelect.value = currentMonth;
    }
}

function updateStats() {
    const uniqueDates = new Set(scheduleData.map(item => item.date.toDateString()));
    const teacherEvents = scheduleData.filter(item => item.type === 'teacher' && item.event);
    const studentEvents = scheduleData.filter(item => item.type === 'student' && item.event);
    const classDays = scheduleData.filter(item => item.weekdayCount);

    document.getElementById('statTotalDays').textContent = uniqueDates.size;
    document.getElementById('statTeacherEvents').textContent = teacherEvents.length;
    document.getElementById('statStudentEvents').textContent = studentEvents.length;
    document.getElementById('statClassDays').textContent = new Set(classDays.map(d => d.date.toDateString())).size;
}

function updateCalendar() {
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

    // 各日付セル
    for (let day = 1; day <= daysInMonth; day++) {
        const date = new Date(currentYear, currentMonth - 1, day);
        const dayCell = createDayCell(date, target);
        calendarGrid.appendChild(dayCell);
    }
}

function createDayCell(date, target) {
    const dayCell = document.createElement('div');
    dayCell.className = 'calendar-day';

    // 祝日チェック
    const holidaysMap = getHolidaysForYear(date.getFullYear());
    const holidayName = getHolidayName(date, holidaysMap);
    const isHolidayDay = holidayName !== null;

    // 曜日クラス
    const weekday = date.getDay();
    if (weekday === 6) dayCell.classList.add('saturday');
    if (weekday === 0 || isHolidayDay) dayCell.classList.add('sunday'); // 祝日も日曜日と同じスタイル

    // 日付番号
    const dayNumber = document.createElement('div');
    dayNumber.className = 'day-number';
    dayNumber.textContent = date.getDate();
    dayCell.appendChild(dayNumber);

    // 祝日名表示
    if (isHolidayDay) {
        const holidayLabel = document.createElement('div');
        holidayLabel.className = 'day-holiday';
        holidayLabel.textContent = `🎌 ${holidayName}`;
        dayCell.appendChild(holidayLabel);
    }

    // その日のイベントを取得
    const dayEvents = scheduleData.filter(item => {
        if (item.date.toDateString() !== date.toDateString()) return false;
        if (target === 'teacher' && item.type !== 'teacher') return false;
        if (target === 'student' && item.type !== 'student') return false;
        return true;
    });

    // 曜日カウント表示
    const weekdayCountItems = dayEvents.filter(item => item.weekdayCount);
    if (weekdayCountItems.length > 0) {
        const weekdayCount = document.createElement('div');
        weekdayCount.className = 'day-weekday-count';
        weekdayCount.textContent = weekdayCountItems[0].weekdayCount;
        dayCell.appendChild(weekdayCount);
    }

    // イベントリスト
    const eventsContainer = document.createElement('div');
    eventsContainer.className = 'day-events';

    dayEvents.forEach(item => {
        if (!item.event || item.event.trim() === '') return;

        const eventItem = document.createElement('div');
        eventItem.className = 'event-item';
        eventItem.classList.add(item.type);

        // 特殊イベントのクラス追加
        if (item.event.includes('会議')) eventItem.classList.add('meeting');
        if (item.event.includes('休講')) eventItem.classList.add('holiday');

        eventItem.textContent = item.event;
        eventItem.title = item.event;  // ツールチップ
        eventsContainer.appendChild(eventItem);
    });

    dayCell.appendChild(eventsContainer);

    // 自分の授業を追加（my_classes.jsから）
    if (typeof addMyClassesToDayCell === 'function') {
        addMyClassesToDayCell(dayCell, date, dayEvents);
    }

    return dayCell;
}

function changeMonth(delta) {
    currentMonth += delta;

    if (currentMonth > 12) {
        currentMonth = 1;
        currentYear++;
    } else if (currentMonth < 1) {
        currentMonth = 12;
        currentYear--;
    }

    // セレクトボックス更新
    document.getElementById('yearSelect').value = currentYear;
    document.getElementById('monthSelect').value = currentMonth;

    updateCalendar();
}

// =============================
// エクスポート機能
// =============================
function exportToJson() {
    const target = document.getElementById('targetSelect').value;

    // フィルタリング
    let filteredData = scheduleData;
    if (target === 'teacher') {
        filteredData = scheduleData.filter(item => item.type === 'teacher');
    } else if (target === 'student') {
        filteredData = scheduleData.filter(item => item.type === 'student');
    }

    // 全ての年度の祝日を取得
    const allYears = new Set(filteredData.map(item => item.date.getFullYear()));
    const allHolidays = new Map();
    allYears.forEach(year => {
        const yearHolidays = getHolidaysForYear(year);
        yearHolidays.forEach((name, dateKey) => {
            allHolidays.set(dateKey, name);
        });
    });

    // JSON形式に変換
    const jsonData = filteredData.map(item => {
        const dateKey = formatDateKey(item.date);
        const holidayName = allHolidays.get(dateKey);

        return {
            date: item.date.toISOString().split('T')[0],
            weekdayCount: item.weekdayCount,
            event: item.event,
            type: item.type,
            period: item.period,
            holiday: holidayName || null
        };
    });

    // 授業データを追加（my_classes.jsから）
    let classData = [];
    if (typeof generateClassEvents === 'function') {
        const classEvents = generateClassEvents(currentYear);
        classData = classEvents.map(cls => {
            const targetLabel = cls.targetType === 'grade'
                ? `${cls.targetGrade}年全体`
                : cls.targetGrade === 1
                    ? `${cls.targetGrade}-${cls.targetClass}`
                    : `${cls.targetGrade}${cls.targetClass}`;

            return {
                date: cls.date.toISOString().split('T')[0],
                event: cls.name,
                type: 'my-class',
                target: targetLabel,
                location: cls.location,
                period: `${cls.period}限`,
                semester: cls.semester
            };
        });
    }

    const exportData = {
        schedule: jsonData,
        myClasses: classData,
        exportDate: new Date().toISOString(),
        year: currentYear
    };

    // ダウンロード
    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    downloadFile(blob, `schedule_${currentYear}.json`);
}

function exportToIcal() {
    const target = document.getElementById('targetSelect').value;

    // フィルタリング
    let filteredData = scheduleData;
    if (target === 'teacher') {
        filteredData = scheduleData.filter(item => item.type === 'teacher');
    } else if (target === 'student') {
        filteredData = scheduleData.filter(item => item.type === 'student');
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

        const dateStr = formatDateForIcal(item.date);
        const uid = generateUID(item);

        icalContent.push('BEGIN:VEVENT');
        icalContent.push(`UID:${uid}`);
        icalContent.push(`DTSTAMP:${formatDateForIcal(new Date())}`);
        icalContent.push(`DTSTART;VALUE=DATE:${dateStr}`);
        icalContent.push(`DTEND;VALUE=DATE:${dateStr}`);
        icalContent.push(`SUMMARY:${escapeIcalText(item.event)}`);

        if (item.weekdayCount) {
            icalContent.push(`DESCRIPTION:${escapeIcalText(`${item.weekdayCount} - ${item.event}`)}`);
        }

        icalContent.push(`CATEGORIES:${item.type === 'teacher' ? '本科' : '専攻科'}`);
        icalContent.push('STATUS:CONFIRMED');
        icalContent.push('TRANSP:TRANSPARENT');
        icalContent.push('END:VEVENT');
    });

    // 授業データを追加（my_classes.jsから）
    if (typeof generateClassEvents === 'function') {
        const classEvents = generateClassEvents(currentYear);

        classEvents.forEach(cls => {
            const targetLabel = cls.targetType === 'grade'
                ? `${cls.targetGrade}年全体`
                : cls.targetGrade === 1
                    ? `${cls.targetGrade}-${cls.targetClass}`
                    : `${cls.targetGrade}${cls.targetClass}`;

            const dateStr = formatDateForIcal(cls.date);
            const uid = `my-class-${cls.name}-${dateStr}@schedule-app`;
            const summary = `${cls.name} (${cls.period}限 - ${targetLabel})`;

            icalContent.push('BEGIN:VEVENT');
            icalContent.push(`UID:${uid}`);
            icalContent.push(`DTSTAMP:${formatDateForIcal(new Date())}`);
            icalContent.push(`DTSTART;VALUE=DATE:${dateStr}`);
            icalContent.push(`DTEND;VALUE=DATE:${dateStr}`);
            icalContent.push(`SUMMARY:${escapeIcalText(summary)}`);

            if (cls.location) {
                icalContent.push(`LOCATION:${escapeIcalText(cls.location)}`);
            }

            icalContent.push(`DESCRIPTION:${escapeIcalText(`${cls.semester} - ${targetLabel}`)}`);
            icalContent.push('CATEGORIES:授業');
            icalContent.push('STATUS:CONFIRMED');
            icalContent.push('TRANSP:OPAQUE');
            icalContent.push('END:VEVENT');
        });
    }

    icalContent.push('END:VCALENDAR');

    // ファイルダウンロード
    const blob = new Blob([icalContent.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    downloadFile(blob, `schedule_${currentYear}.ics`);
}

function exportToCsv() {
    const target = document.getElementById('targetSelect').value;

    // フィルタリング
    let filteredData = scheduleData;
    if (target === 'teacher') {
        filteredData = scheduleData.filter(item => item.type === 'teacher');
    } else if (target === 'student') {
        filteredData = scheduleData.filter(item => item.type === 'student');
    }

    // 全ての年度の祝日を取得
    const allYears = new Set(filteredData.map(item => item.date.getFullYear()));
    const allHolidays = new Map();
    allYears.forEach(year => {
        const yearHolidays = getHolidaysForYear(year);
        yearHolidays.forEach((name, dateKey) => {
            allHolidays.set(dateKey, name);
        });
    });

    // CSV形式生成
    const headers = ['日付', '曜日', '祝日', '曜日カウント', 'イベント', '対象', '学期'];
    const rows = [headers];

    filteredData.forEach(item => {
        if (!item.event || item.event.trim() === '') return;

        const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
        const weekday = weekdays[item.date.getDay()];
        const dateKey = formatDateKey(item.date);
        const holidayName = allHolidays.get(dateKey) || '';

        rows.push([
            item.date.toISOString().split('T')[0],
            weekday,
            holidayName,
            item.weekdayCount || '',
            item.event,
            item.type === 'teacher' ? '本科' : '専攻科',
            item.period
        ]);
    });

    // 授業データを追加（my_classes.jsから）
    if (typeof generateClassEvents === 'function') {
        const classEvents = generateClassEvents(currentYear);
        const weekdays = ['日', '月', '火', '水', '木', '金', '土'];

        // セパレーター行
        if (classEvents.length > 0) {
            rows.push(['', '', '', '', '', '', '', '', '']);
            rows.push(['===授業データ===', '', '', '', '', '', '', '', '']);
            rows.push(['日付', '曜日', '授業名', '対象', '場所', '時限', '開始時刻', '終了時刻', '備考']);
        }

        classEvents.forEach(cls => {
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
                cls.date.toISOString().split('T')[0],
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
    downloadFile(blob, `schedule_${currentYear}.csv`);
}

// =============================
// ユーティリティ関数
// =============================
function formatDateForIcal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function generateUID(item) {
    const dateStr = item.date.toISOString().split('T')[0];
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
