// =============================
// 授業管理機能
// =============================

let myClasses = [];

// クラス定義
const CLASS_OPTIONS = {
    1: ['1', '2', '3', '4'], // 1年生: 1-1, 1-2, 1-3, 1-4
    2: ['M', 'D', 'E', 'I'], // 2年生以上: M, D, E, I
    3: ['M', 'D', 'E', 'I'],
    4: ['M', 'D', 'E', 'I'],
    5: ['M', 'D', 'E', 'I']
};

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

// 初期化
function initializeMyClasses() {
    console.log('授業管理機能を初期化中...');

    // localStorageから読み込み
    loadMyClasses();

    // DOM要素の存在確認
    const addBtn = document.getElementById('addClassBtn');
    const targetType = document.getElementById('targetType');
    const targetGrade = document.getElementById('targetGrade');

    if (!addBtn || !targetType || !targetGrade) {
        console.error('必要なDOM要素が見つかりません');
        // 少し待ってから再試行
        setTimeout(initializeMyClasses, 100);
        return;
    }

    console.log('DOM要素が見つかりました。イベントリスナーを設定中...');

    // イベントリスナー設定
    targetType.addEventListener('change', updateTargetClassVisibility);
    targetGrade.addEventListener('change', updateClassOptions);
    addBtn.addEventListener('click', addMyClass);

    // 日程表イベントリスナー追加
    addScheduleEventListeners();

    console.log('イベントリスナーを設定しました');

    // 初期状態設定
    updateClassOptions();
    updateTargetClassVisibility();
    renderMyClassesList();

    console.log('授業管理機能の初期化完了');
}

// localStorageから読み込み
function loadMyClasses() {
    try {
        const saved = localStorage.getItem('myClasses');
        if (saved) {
            myClasses = JSON.parse(saved);
        }
    } catch (error) {
        console.error('授業データの読み込みエラー:', error);
        myClasses = [];
    }
}

// localStorageに保存
function saveMyClasses() {
    try {
        localStorage.setItem('myClasses', JSON.stringify(myClasses));
    } catch (error) {
        console.error('授業データの保存エラー:', error);
    }
}

// 展開方法によるクラス選択の表示/非表示
function updateTargetClassVisibility() {
    const targetType = document.getElementById('targetType').value;
    const classGroup = document.getElementById('targetClassGroup');
    const targetClassLabel = classGroup.querySelector('label');

    if (targetType === 'grade') {
        classGroup.style.display = 'none';
        // 必須マークを削除
        const required = targetClassLabel.querySelector('.required');
        if (required) required.remove();
    } else {
        classGroup.style.display = 'flex';
        // 必須マークを追加（まだない場合）
        if (!targetClassLabel.querySelector('.required')) {
            const span = document.createElement('span');
            span.className = 'required';
            span.textContent = '*';
            targetClassLabel.appendChild(document.createTextNode(' '));
            targetClassLabel.appendChild(span);
        }
    }
}

// 学年に応じたクラス選択肢を更新
function updateClassOptions() {
    const grade = parseInt(document.getElementById('targetGrade').value);
    const classSelect = document.getElementById('targetClass');
    const classGroup = document.getElementById('targetClassGroup');
    const classLabel = classGroup.querySelector('label');
    const options = CLASS_OPTIONS[grade];

    // ラベルを変更
    if (grade === 1) {
        classLabel.innerHTML = 'クラス ';
    } else {
        classLabel.innerHTML = 'コース ';
    }

    // 必須マークを再追加（クラス別の場合）
    const targetType = document.getElementById('targetType').value;
    if (targetType === 'class') {
        const span = document.createElement('span');
        span.className = 'required';
        span.textContent = '*';
        classLabel.appendChild(span);
    }

    // 選択肢を更新
    classSelect.innerHTML = options.map(cls =>
        grade === 1
            ? `<option value="${cls}">${cls}組</option>`
            : `<option value="${cls}">${cls}コース</option>`
    ).join('');

    console.log(`学年${grade}の選択肢を更新しました`);
}

// 授業を追加
function addMyClass() {
    // 入力値を取得
    const name = document.getElementById('className').value.trim();
    const location = document.getElementById('classLocation').value.trim();
    const targetType = document.getElementById('targetType').value;
    const targetGrade = parseInt(document.getElementById('targetGrade').value);
    const targetClass = targetType === 'class' ? document.getElementById('targetClass').value : null;
    const firstWeekday = parseInt(document.getElementById('firstWeekday').value);
    const firstPeriod = parseInt(document.getElementById('firstPeriod').value);
    const secondWeekday = parseInt(document.getElementById('secondWeekday').value);
    const secondPeriod = parseInt(document.getElementById('secondPeriod').value);

    // バリデーション
    if (!name) {
        alert('授業名を入力してください');
        return;
    }

    // クラス別の場合のみクラスチェック
    if (targetType === 'class' && !targetClass) {
        alert('クラスを選択してください');
        return;
    }

    // 授業データ作成
    const newClass = {
        id: Date.now(), // 簡易的なID
        name,
        location,
        targetType,
        targetGrade,
        targetClass: targetType === 'class' ? targetClass : null,
        firstSemester: { weekday: firstWeekday, period: firstPeriod },
        secondSemester: { weekday: secondWeekday, period: secondPeriod }
    };

    // 追加
    myClasses.push(newClass);
    saveMyClasses();
    renderMyClassesList();

    // フォームをリセット
    document.getElementById('className').value = '';
    document.getElementById('classLocation').value = '';

    // カレンダーを更新（授業を反映）
    if (typeof updateCalendar === 'function') {
        updateCalendar();
    }

    alert('授業を追加しました！');
}

// 授業を削除
function deleteMyClass(id) {
    if (!confirm('この授業を削除しますか？')) return;

    myClasses = myClasses.filter(cls => cls.id !== id);
    saveMyClasses();
    renderMyClassesList();

    // カレンダーを更新
    if (typeof updateCalendar === 'function') {
        updateCalendar();
    }
}

// グローバルスコープに登録（HTMLのonclick属性から呼べるように）
window.deleteMyClass = deleteMyClass;

// 授業リストを表示
function renderMyClassesList() {
    const listContainer = document.getElementById('classList');
    const countElement = document.getElementById('classCount');

    // 件数更新
    countElement.textContent = myClasses.length;

    if (myClasses.length === 0) {
        listContainer.innerHTML = '<p class="empty-message">まだ授業が登録されていません</p>';
        return;
    }

    listContainer.innerHTML = myClasses.map(cls => {
        const targetLabel = cls.targetType === 'grade'
            ? `${cls.targetGrade}年全体`
            : cls.targetGrade === 1
                ? `${cls.targetGrade}-${cls.targetClass}`
                : `${cls.targetGrade}${cls.targetClass}`;

        const firstSchedule = `前期: ${WEEKDAY_NAMES[cls.firstSemester.weekday]}${cls.firstSemester.period}限`;
        const secondSchedule = `後期: ${WEEKDAY_NAMES[cls.secondSemester.weekday]}${cls.secondSemester.period}限`;

        return `
            <div class="class-item">
                <div class="class-info">
                    <div class="class-name">${cls.name}</div>
                    <div class="class-schedule">
                        <span class="class-badge">${targetLabel}</span>
                        <span class="class-badge class-badge-schedule">${firstSchedule}</span>
                        <span class="class-badge class-badge-schedule">${secondSchedule}</span>
                        ${cls.location ? `<span class="class-badge class-badge-location">📍 ${cls.location}</span>` : ''}
                    </div>
                </div>
                <div class="class-actions">
                    <button class="btn-icon" onclick="deleteMyClass(${cls.id})" title="削除">🗑️</button>
                </div>
            </div>
        `;
    }).join('');
}

// 特定の日に該当する授業を取得
function getClassesForDate(date, period) {
    const weekday = date.getDay();
    const fiscalYear = getFiscalYear(date);
    const month = date.getMonth() + 1;

    // 前期 or 後期判定
    let semester;
    if (month >= 4 && month <= 9) {
        semester = 'first';
    } else {
        semester = 'second';
    }

    return myClasses.filter(cls => {
        const schedule = semester === 'first' ? cls.firstSemester : cls.secondSemester;
        return schedule.weekday === weekday && schedule.period === period;
    });
}

// 特定の日の全授業を取得（期間用）
function getClassesForDay(date) {
    const weekday = date.getDay();
    const month = date.getMonth() + 1;

    // 前期 or 後期判定
    let semester;
    if (month >= 4 && month <= 9) {
        semester = 'first';
    } else {
        semester = 'second';
    }

    return myClasses.filter(cls => {
        const schedule = semester === 'first' ? cls.firstSemester : cls.secondSemester;
        return schedule.weekday === weekday;
    });
}

// エクスポート用：全授業データを取得
function getAllMyClasses() {
    return myClasses;
}

// 授業時間帯定義
const PERIOD_TIMES = {
    1: { start: '09:00', end: '10:35' },
    2: { start: '10:45', end: '12:20' },
    3: { start: '13:05', end: '14:40' },
    4: { start: '14:50', end: '16:25' }
};

// 日付と時刻文字列からDateオブジェクトを生成
function createDateTime(date, timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const newDate = new Date(date);
    newDate.setHours(hours, minutes, 0, 0);
    return newDate;
}

// エクスポート用：特定年度の全授業イベントを生成
function generateClassEvents(year) {
    const events = [];

    // scheduleDataにアクセス（app.jsから）
    if (typeof scheduleData === 'undefined' || !scheduleData || scheduleData.length === 0) {
        console.warn('scheduleDataが見つかりません。授業イベントを生成できません。');
        return events;
    }

    // 授業日（weekdayCountがある日）のみを抽出
    const classDays = scheduleData.filter(item => item.weekdayCount);

    // 日付の重複を排除（Setを使用）
    const processedDates = new Set();
    const uniqueClassDays = [];

    classDays.forEach(item => {
        const dateStr = item.date.toDateString();
        if (!processedDates.has(dateStr)) {
            processedDates.add(dateStr);
            uniqueClassDays.push(item);
        }
    });

    console.log(`${uniqueClassDays.length}日のユニークな授業日が見つかりました`);

    // 各授業日に対して授業をチェック
    uniqueClassDays.forEach(dayData => {
        const date = dayData.date;
        const weekday = date.getDay();
        const month = date.getMonth() + 1;
        const fiscalYear = getFiscalYear(date);

        // 指定された年度の授業日のみ
        if (fiscalYear !== year) return;

        // 前期 or 後期判定
        const semester = (month >= 4 && month <= 9) ? 'first' : 'second';

        // この日に該当する授業を検索
        myClasses.forEach(cls => {
            const schedule = semester === 'first' ? cls.firstSemester : cls.secondSemester;

            // 曜日が一致する場合のみ追加
            if (schedule.weekday === weekday) {
                const times = PERIOD_TIMES[schedule.period];
                const startTime = createDateTime(date, times.start);
                const endTime = createDateTime(date, times.end);

                events.push({
                    date: new Date(date),
                    startTime: startTime,
                    endTime: endTime,
                    name: cls.name,
                    location: cls.location || '',
                    targetType: cls.targetType,
                    targetGrade: cls.targetGrade,
                    targetClass: cls.targetClass,
                    period: schedule.period,
                    semester: semester === 'first' ? '前期' : '後期',
                    weekdayCount: dayData.weekdayCount // 曜日カウントも保持
                });
            }
        });
    });

    console.log(`${events.length}件の授業イベントを生成しました`);
    return events;
}

// グローバルスコープに登録
window.getAllMyClasses = getAllMyClasses;
window.generateClassEvents = generateClassEvents;

// =============================
// カレンダーへの統合用関数
// =============================

// カレンダーのセル作成時に授業を追加
function addMyClassesToDayCell(dayCell, date, dayEvents) {
    // scheduleDataが利用可能な場合、授業日判定を行う
    if (typeof scheduleData !== 'undefined' && scheduleData.length > 0) {
        // その日のデータを取得
        const dateStr = date.toDateString();
        const dailyItems = scheduleData.filter(item => item.date.toDateString() === dateStr);

        // weekdayCount（月1、火2など）があるかチェック
        const isClassDay = dailyItems.some(item => item.weekdayCount);

        // 授業日でない場合は表示しない
        if (!isClassDay) return;
    }

    const classes = getClassesForDay(date);

    if (classes.length === 0) return;

    classes.forEach(cls => {
        const semester = (date.getMonth() + 1) >= 4 && (date.getMonth() + 1) <= 9 ? 'first' : 'second';
        const schedule = semester === 'first' ? cls.firstSemester : cls.secondSemester;

        // 時刻を取得
        const times = PERIOD_TIMES[schedule.period];
        const targetLabel = cls.targetType === 'grade'
            ? `${cls.targetGrade}年`
            : cls.targetGrade === 1
                ? `${cls.targetGrade}-${cls.targetClass}`
                : `${cls.targetGrade}${cls.targetClass}`; // 2M, 3Dなど

        const eventItem = document.createElement('div');
        eventItem.className = 'event-item my-class';

        // 表示形式: 開始時刻 授業名 (対象)
        // 例: 09:00 データ構造とアルゴリズム (2M)
        eventItem.textContent = `${times.start} ${cls.name} (${targetLabel})`;

        // ツールチップには詳細情報を表示
        eventItem.title = `${cls.name}\n時間: ${times.start}～${times.end}\n場所: ${cls.location || '未定'}\n対象: ${targetLabel}`;

        const eventsContainer = dayCell.querySelector('.day-events');
        if (eventsContainer) {
            eventsContainer.appendChild(eventItem);
        }
    });
}

// 初期化を起動
document.addEventListener('DOMContentLoaded', function () {
    console.log('DOMContentLoaded: 授業管理の初期化を開始します');
    initializeMyClasses();
});

// すでに読み込まれている場合も対応
if (document.readyState === 'complete' || document.readyState === 'interactive') {
    console.log('ドキュメント既読み込み済み: 授業管理の初期化を開始します');
    setTimeout(initializeMyClasses, 1);
}

// =============================
// 授業日程表・モーダル機能
// =============================

// 日程表を表示
window.showClassSchedule = function () {
    const modal = document.getElementById('classScheduleModal');
    const tbody = document.getElementById('classScheduleBody');
    const modalTitle = modal.querySelector('.modal-header h2'); // タイトル要素取得

    // 対象年度を決定（app.jsのcurrentYear優先、なければ現在日時の年度）
    let targetYear = typeof currentYear !== 'undefined' ? currentYear : getFiscalYear(new Date());

    // タイトルを更新
    if (modalTitle) {
        modalTitle.textContent = `授業日程表 (${targetYear}年度)`;
    }

    const scheduleData = typeof generateClassEvents === 'function' ? generateClassEvents(targetYear) : [];

    if (!modal || !tbody) {
        console.error('日程表モーダルの要素が見つかりません');
        return;
    }

    // テーブルをクリア
    tbody.innerHTML = '';

    if (scheduleData.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="center">授業予定が見つかりません。授業を登録するか、Excelファイルを読み込んでください。</td></tr>';
    } else {
        // 日付順にソート (generateClassEventsですでにソートされているはずだが念のため)
        scheduleData.sort((a, b) => a.date - b.date);

        const weekdays = ['日', '月', '火', '水', '木', '金', '土'];

        scheduleData.forEach(item => {
            const tr = document.createElement('tr');
            const dateStr = `${item.date.getMonth() + 1}/${item.date.getDate()}`;
            const weekday = item.date.getDay();
            const weekdayStr = weekdays[weekday];

            // 時間の整形
            const formatTime = (date) => {
                if (!date) return '';
                return date.toTimeString().substring(0, 5);
            };

            const timeRange = `${formatTime(item.startTime)} - ${formatTime(item.endTime)}`;

            const targetLabel = item.targetType === 'grade'
                ? `${item.targetGrade}年全体`
                : item.targetGrade === 1
                    ? `${item.targetGrade}-${item.targetClass}`
                    : `${item.targetGrade}${item.targetClass}`;

            let colorStyle = '';
            if (weekday === 0) colorStyle = 'color: red; font-weight: bold;';
            else if (weekday === 6) colorStyle = 'color: blue; font-weight: bold;';

            tr.innerHTML = `
                <td>${dateStr}</td>
                <td style="${colorStyle}">${weekdayStr}</td>
                <td class="center">${item.period}</td>
                <td class="center">${timeRange}</td>
                <td>${item.name}</td>
                <td>${targetLabel}</td>
                <td>${item.location || ''}</td>
                <td>${item.weekdayCount || ''}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    // モーダルを表示
    modal.classList.remove('hidden');
    modal.classList.add('visible'); // display: flexのために
};

// モーダルを閉じる
window.closeClassScheduleModal = function () {
    const modal = document.getElementById('classScheduleModal');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('visible');
    }
};

// 印刷機能
window.printClassSchedule = function () {
    window.print();
};

// 日程表をCSV出力
window.exportClassScheduleCsv = function () {
    const targetYear = typeof currentYear !== 'undefined' ? currentYear : getFiscalYear(new Date());
    const scheduleData = typeof generateClassEvents === 'function' ? generateClassEvents(targetYear) : [];

    if (scheduleData.length === 0) {
        alert('出力する授業データがありません。');
        return;
    }

    // 日付順にソート
    scheduleData.sort((a, b) => a.date - b.date);

    const rows = [];
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];

    // ヘッダー行
    rows.push(['日付', '曜日', '時限', '開始時刻', '終了時刻', '授業名', '対象', '場所', '備考']);

    // 時間整形ヘルパー
    const formatTime = (date) => {
        if (!date) return '';
        return date.toTimeString().substring(0, 5);
    };

    // データ行
    scheduleData.forEach(item => {
        const dateStr = item.date.toISOString().split('T')[0];
        const weekdayStr = weekdays[item.date.getDay()];

        const targetLabel = item.targetType === 'grade'
            ? `${item.targetGrade}年全体`
            : item.targetGrade === 1
                ? `${item.targetGrade}-${item.targetClass}`
                : `${item.targetGrade}${item.targetClass}`;

        rows.push([
            dateStr,
            weekdayStr,
            item.period,
            formatTime(item.startTime),
            formatTime(item.endTime),
            item.name,
            targetLabel,
            item.location || '',
            item.weekdayCount || ''
        ]);
    });

    // CSV生成
    const csvContent = rows.map(row =>
        row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')
    ).join('\n');

    // BOM付きUTF-8でエンコードしてダウンロード
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8' });

    // ダウンロードリンク生成
    const link = document.createElement('a');
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `授業日程表_${targetYear}年度.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
};

// イベントリスナー追加（初期化関数に追加）
function addScheduleEventListeners() {
    console.log('日程表イベントリスナーを設定中...');
    const showBtn = document.getElementById('showClassScheduleBtn');
    const modal = document.getElementById('classScheduleModal');
    const closeBtns = document.querySelectorAll('.close-modal-btn');
    const printBtn = document.getElementById('printScheduleBtn');
    const csvBtn = document.getElementById('csvExportScheduleBtn');

    if (showBtn) {
        showBtn.addEventListener('click', window.showClassSchedule);
        console.log('「日程表を表示」ボタンにイベントを設定しました');
    } else {
        console.warn('「日程表を表示」ボタンが見つかりません');
    }

    closeBtns.forEach(btn => {
        btn.addEventListener('click', window.closeClassScheduleModal);
    });

    // 印刷
    if (printBtn) {
        printBtn.addEventListener('click', window.printClassSchedule);
    }

    // CSV出力
    if (csvBtn) {
        csvBtn.addEventListener('click', window.exportClassScheduleCsv);
    }

    // モーダル外クリックで閉じる
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            window.closeClassScheduleModal();
        }
    });

    console.log('日程表イベントリスナーを設定完了');
}

