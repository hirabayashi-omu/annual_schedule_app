// =============================
// 授業管理機能
// =============================

// グローバル変数は app.js で定義済み


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
    // イベントリスナー設定
    targetType.addEventListener('change', updateTargetClassVisibility);
    targetGrade.addEventListener('change', updateClassOptions);
    addBtn.addEventListener('click', addMyClass);

    const cancelBtn = document.getElementById('cancelEditBtn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', resetForm);
    }

    // 開講期間の選択変更イベントリスナー
    const semesterType = document.getElementById('semesterType');
    if (semesterType) {
        semesterType.addEventListener('change', updateSemesterVisibility);
    } else { // 既存のスクリプトでsemesterTypeがない場合のフォールバック（もし必要なら）
        // console.warn('semesterType element not found'); 
    }

    // 日程表イベントリスナー追加
    addScheduleEventListeners();

    console.log('イベントリスナーを設定しました');

    // 初期状態設定
    updateClassOptions();
    updateTargetClassVisibility();
    updateSemesterVisibility(); // 初期表示更新
    renderMyClassesList();

    console.log('授業管理機能の初期化完了');

    // データ読み込み後、カレンダーを再描画（オーバーライド適用のため）
    if (typeof updateCalendar === 'function') {
        updateCalendar();
    }
}

// 開講期間による表示切り替え
function updateSemesterVisibility() {
    const type = document.getElementById('semesterType').value;
    const firstGroup = document.getElementById('firstSemesterGroup');
    const secondGroup = document.getElementById('secondSemesterGroup');

    if (type === 'full') {
        firstGroup.style.display = 'block';
        secondGroup.style.display = 'block';
    } else if (type === 'first') {
        firstGroup.style.display = 'block';
        secondGroup.style.display = 'none';
    } else if (type === 'second') {
        firstGroup.style.display = 'none';
        secondGroup.style.display = 'block';
    }
}

// localStorageから読み込み
function loadMyClasses() {
    try {
        const saved = localStorage.getItem('myClasses');
        if (saved) {
            myClasses = JSON.parse(saved);
        }
        const savedOverrides = localStorage.getItem('classOverrides');
        if (savedOverrides) {
            classOverrides = JSON.parse(savedOverrides);
        } else {
            classOverrides = [];
        }
    } catch (error) {
        console.error('授業データの読み込みエラー:', error);
        myClasses = [];
        classOverrides = [];
    }
}

// localStorageに保存
function saveMyClasses() {
    try {
        localStorage.setItem('myClasses', JSON.stringify(myClasses));
        localStorage.setItem('classOverrides', JSON.stringify(classOverrides));
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
        // 必須マークを削除 - 学年の場合はクラス指定がないため
        if (targetClassLabel) {
            const required = targetClassLabel.querySelector('.required');
            if (required) required.remove();
        }
    } else {
        classGroup.style.display = 'flex';
        // 必須マークを追加（まだない場合）
        if (targetClassLabel && !targetClassLabel.querySelector('.required')) {
            const span = document.createElement('span');
            span.className = 'required';
            span.textContent = '*';
            // テキストノードが既にあるか確認してから追加
            if (!targetClassLabel.innerText.includes('*')) {
                // targetClassLabel.appendChild(document.createTextNode(' '));
                targetClassLabel.appendChild(span);
            }
        }
    }

    // 表示切り替え時にラベルの更新も行う（念のため）
    if (targetType === 'class') {
        updateClassOptions();
    }
}

// 学年に応じたクラス選択肢を更新
function updateClassOptions() {
    const gradeVal = document.getElementById('targetGrade').value;
    const grade = parseInt(gradeVal);
    const classSelect = document.getElementById('targetClass');
    const classGroup = document.getElementById('targetClassGroup');
    const classLabel = classGroup.querySelector('label');
    const options = CLASS_OPTIONS[grade] || [];

    // ラベルを変更
    // innerHTMLを書き換えるとspanも消えるので注意
    let labelText = '';
    if (grade === 1) {
        labelText = 'クラス';
    } else {
        labelText = 'コース';
    }

    // 必須マークの状態を保持または再設定
    const targetType = document.getElementById('targetType').value;
    const isRequired = (targetType === 'class');

    let html = labelText;
    if (isRequired) {
        html += ' <span class="required">*</span>';
    }

    classLabel.innerHTML = html;

    // 選択肢を更新
    classSelect.innerHTML = options.map(cls =>
        grade === 1
            ? `<option value="${cls}">${cls}組</option>`
            : `<option value="${cls}">${cls}コース</option>`
    ).join('');

    console.log(`学年${grade}の選択肢を更新しました`);
}


// 授業を編集モードにする
function editMyClass(id) {
    const cls = myClasses.find(c => c.id === id);
    if (!cls) return;

    // フォームに値をセット
    document.getElementById('editingClassId').value = cls.id;
    document.getElementById('className').value = cls.name;
    document.getElementById('classLocation').value = cls.location || '';

    // Select boxes
    const targetTypeSelect = document.getElementById('targetType');
    const targetGradeSelect = document.getElementById('targetGrade');

    targetTypeSelect.value = cls.targetType;
    targetGradeSelect.value = cls.targetGrade;

    // 関連表示の更新
    updateTargetClassVisibility();
    updateClassOptions();

    // クラス設定（表示更新後にセット）
    if (cls.targetType === 'class' && cls.targetClass) {
        document.getElementById('targetClass').value = cls.targetClass;
    }

    // 開講期間設定
    const semesterTypeSelect = document.getElementById('semesterType');
    if (semesterTypeSelect) {
        semesterTypeSelect.value = cls.semesterType || 'full';
        updateSemesterVisibility();
    }

    // 時間割設定
    if (cls.firstSemester) {
        document.getElementById('firstWeekday').value = cls.firstSemester.weekday;
        document.getElementById('firstPeriod').value = cls.firstSemester.period;
    }
    if (cls.secondSemester) {
        document.getElementById('secondWeekday').value = cls.secondSemester.weekday;
        document.getElementById('secondPeriod').value = cls.secondSemester.period;
    }

    // ボタン表示変更
    const addBtn = document.getElementById('addClassBtn');
    const cancelBtn = document.getElementById('cancelEditBtn');

    addBtn.innerHTML = '<span>🔄 更新する</span>';
    addBtn.classList.remove('btn-primary');
    addBtn.classList.add('btn-success');

    cancelBtn.classList.remove('hidden');

    // フォームへスクロール
    document.querySelector('.class-input-form').scrollIntoView({ behavior: 'smooth' });
}

// 編集キャンセル / フォームリセット
function resetForm() {
    document.getElementById('editingClassId').value = '';
    document.getElementById('className').value = '';
    document.getElementById('classLocation').value = '';

    // デフォルトに戻す
    document.getElementById('targetType').value = 'class';
    document.getElementById('targetGrade').value = '1';

    updateTargetClassVisibility();
    updateClassOptions();

    if (document.getElementById('semesterType')) {
        document.getElementById('semesterType').value = 'full';
        updateSemesterVisibility();
    }

    // ボタン戻す
    const addBtn = document.getElementById('addClassBtn');
    const cancelBtn = document.getElementById('cancelEditBtn');

    addBtn.innerHTML = '<span>➕ 授業を追加</span>';
    addBtn.classList.remove('btn-success');
    addBtn.classList.add('btn-primary');

    cancelBtn.classList.add('hidden');
}

// 授業を追加・更新
function addMyClass() {
    // 入力値を取得
    const idInput = document.getElementById('editingClassId');
    const isEditMode = idInput.value !== '';

    const name = document.getElementById('className').value.trim();
    const location = document.getElementById('classLocation').value.trim();
    const targetType = document.getElementById('targetType').value;
    const targetGrade = parseInt(document.getElementById('targetGrade').value);
    const targetClass = targetType === 'class' ? document.getElementById('targetClass').value : null;

    const semesterType = document.getElementById('semesterType').value;

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
    const classData = {
        id: isEditMode ? parseInt(idInput.value) : Date.now(),
        name,
        location,
        targetType,
        targetGrade,
        targetClass: targetType === 'class' ? targetClass : null,
        semesterType: semesterType, // 'full', 'first', 'second'
        firstSemester: (semesterType === 'full' || semesterType === 'first') ? { weekday: firstWeekday, period: firstPeriod } : null,
        secondSemester: (semesterType === 'full' || semesterType === 'second') ? { weekday: secondWeekday, period: secondPeriod } : null
    };

    if (isEditMode) {
        // 更新
        const index = myClasses.findIndex(c => c.id === classData.id);
        if (index !== -1) {
            myClasses[index] = classData;
            alert('授業情報を更新しました！');
        }
    } else {
        // 新規追加
        myClasses.push(classData);
        alert('授業を追加しました！');
    }

    saveMyClasses();
    renderMyClassesList();
    resetForm(); // フォームリセット

    // カレンダーを更新（授業を反映）
    if (typeof updateCalendar === 'function') {
        updateCalendar();
    }
}

// 授業を削除
function deleteMyClass(id) {
    if (!confirm('この授業を削除しますか？')) return;

    // 編集中の場合、フォームをリセット
    const editingId = document.getElementById('editingClassId').value;
    if (editingId && parseInt(editingId) === id) {
        resetForm();
    }

    myClasses = myClasses.filter(cls => cls.id !== id);
    saveMyClasses();
    renderMyClassesList();

    // カレンダーを更新
    if (typeof updateCalendar === 'function') {
        updateCalendar();
    }
}

// 授業リストを表示
function renderMyClassesList() {
    const listContainer = document.getElementById('classList');
    const countElement = document.getElementById('classCount');

    if (!listContainer || !countElement) return;

    // 件数更新
    countElement.textContent = myClasses.length;

    if (myClasses.length === 0) {
        listContainer.innerHTML = '<p class="empty-message">まだ授業が登録されていません</p>';
        return;
    }

    listContainer.innerHTML = myClasses.map(cls => {
        const hasOverride = classOverrides.some(ov => ov.id == cls.id && ov.type === 'myclass');

        const targetLabel = cls.targetType === 'grade'
            ? `${cls.targetGrade} 年全体`
            : cls.targetGrade === 1
                ? `${cls.targetGrade}-${cls.targetClass}`
                : `${cls.targetGrade}${cls.targetClass}`;

        let scheduleInfo = '';
        if (cls.semesterType === 'full' || !cls.semesterType) {
            const firstSchedule = `前期: ${WEEKDAY_NAMES[cls.firstSemester.weekday]}${cls.firstSemester.period}限`;
            const secondSchedule = `後期: ${WEEKDAY_NAMES[cls.secondSemester.weekday]}${cls.secondSemester.period}限`;
            scheduleInfo = `<span class="class-badge class-badge-schedule">${firstSchedule}</span>
                            <span class="class-badge class-badge-schedule">${secondSchedule}</span>`;
        } else if (cls.semesterType === 'first') {
            const firstSchedule = `前期: ${WEEKDAY_NAMES[cls.firstSemester.weekday]}${cls.firstSemester.period}限`;
            scheduleInfo = `<span class="class-badge class-badge-schedule">${firstSchedule}</span>
                            <span class="class-badge" style="background-color: #f0f0f0; color: #999;">後期: なし</span>`;
        } else if (cls.semesterType === 'second') {
            const secondSchedule = `後期: ${WEEKDAY_NAMES[cls.secondSemester.weekday]}${cls.secondSemester.period}限`;
            scheduleInfo = `<span class="class-badge" style="background-color: #f0f0f0; color: #999;">前期: なし</span>
                            <span class="class-badge class-badge-schedule">${secondSchedule}</span>`;
        }

        return `
            <div class="class-item">
                <div class="class-info">
                    <div class="class-name">
                        ${cls.name}
                        ${hasOverride ? '<span class="override-badge" title="一部変更あり">⚠️ 一部変更</span>' : ''}
                    </div>
                    <div class="class-schedule">
                        <span class="class-badge">${targetLabel}</span>
                        ${scheduleInfo}
                        ${cls.location ? `<span class="class-badge class-badge-location">📍 ${cls.location}</span>` : ''}
                    </div>
                </div>
                <div class="class-actions">
                    ${hasOverride ? `<button class="btn-icon" onclick="restoreClassDefault(${cls.id})" title="デフォルトに復元">🔄</button>` : ''}
                    <button class="btn-icon" onclick="showClassSchedule(${cls.id})" title="この授業の日程表を表示">📅</button>
                    <button class="btn-icon" onclick="editMyClass(${cls.id})" title="編集">✏️</button>
                    <button class="btn-icon" onclick="deleteMyClass(${cls.id})" title="削除">🗑️</button>
                </div>
            </div>
        `;
    }).join('');
}
// グローバルスコープに登録
window.editMyClass = editMyClass;
window.deleteMyClass = deleteMyClass;

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
        // 学期ごとの設定チェック
        if (semester === 'first' && !cls.firstSemester) return false;
        if (semester === 'second' && !cls.secondSemester) return false;

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
        // 学期ごとの設定チェック
        if (semester === 'first' && !cls.firstSemester) return false;
        if (semester === 'second' && !cls.secondSemester) return false;

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
    // カレンダー表示と一致させるため、オーバーライド適用済みのデータを取得
    let sourceData = [];
    if (typeof window.getAppliedScheduleData === 'function') {
        sourceData = window.getAppliedScheduleData('both');
    } else if (typeof scheduleData !== 'undefined' && scheduleData) {
        sourceData = scheduleData;
    }

    if (sourceData.length === 0) {
        // console.warn('scheduleDataが見つかりません。授業イベントを生成できません。');
        return events;
    }

    // 授業日（weekdayCountがある日）のみを抽出
    const classDays = sourceData.filter(item => item.weekdayCount);

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

    console.log(`${uniqueClassDays.length} 日のユニークな授業日が見つかりました`);

    // 各授業日に対して授業をチェック
    uniqueClassDays.forEach(dayData => {
        const date = dayData.date;
        const weekday = date.getDay();
        const month = date.getMonth() + 1;
        const fiscalYear = getFiscalYear(date);
        const dateStrKey = formatDateKey(date);

        // 指定された年度の授業日のみ
        if (fiscalYear !== year) return;

        // 前期 or 後期判定
        const semester = (month >= 4 && month <= 9) ? 'first' : 'second';

        // この日に該当する授業を検索
        myClasses.forEach(cls => {
            // 学期チェック
            if (semester === 'first' && !cls.firstSemester) return;
            if (semester === 'second' && !cls.secondSemester) return;

            const schedule = semester === 'first' ? cls.firstSemester : cls.secondSemester;

            // 曜日が一致する場合のみ追加
            if (schedule.weekday === weekday) {
                // オーバライドチェック（削除または移動済みか）
                const isOverridden = classOverrides.some(ov =>
                    ov.id == cls.id &&
                    ov.type === 'myclass' &&
                    ov.date === dateStrKey &&
                    (ov.action === 'delete' || ov.action === 'move') &&
                    (ov.period === undefined || parseInt(ov.period) === schedule.period)
                );
                if (isOverridden) return;

                // 曜日カウントによる時間帯制限（午前のみ・午後のみ）をチェック
                const countStr = dayData.weekdayCount || "";
                const isMorningOnly = countStr.includes("午前") && !countStr.includes("午後");
                const isAfternoonOnly = countStr.includes("午後") && !countStr.includes("午前");

                if (isMorningOnly && (schedule.period === 3 || schedule.period === 4)) return;
                if (isAfternoonOnly && (schedule.period === 1 || schedule.period === 2)) return;

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
                    weekdayCount: dayData.weekdayCount
                });
            }
        });
    });

    // オーバライドによる追加分（移動先）を処理
    classOverrides.forEach(ov => {
        if (ov.type === 'myclass' && ov.action === 'move' && ov.data) {
            const date = parseDateKey(ov.date);
            const fiscalYear = getFiscalYear(date);
            if (fiscalYear !== year) return;

            const cls = ov.data;
            let startTime, endTime;
            if (cls.allDay) {
                // 終日の場合は 00:00 - 00:00 (iCal export handles this as DATE type)
                startTime = createDateTime(date, '00:00');
                endTime = createDateTime(date, '00:00');
            } else if (cls.startTime && cls.endTime) {
                startTime = createDateTime(date, cls.startTime);
                endTime = createDateTime(date, cls.endTime);
            } else {
                const times = PERIOD_TIMES[ov.period] || { start: '09:00', end: '10:35' };
                startTime = createDateTime(date, times.start);
                endTime = createDateTime(date, times.end);
            }

            // 曜日カウントを取得
            const dayData = scheduleData.find(d => d.date.toDateString() === date.toDateString());

            events.push({
                date: new Date(date),
                startTime: startTime,
                endTime: endTime,
                name: cls.name,
                location: cls.location || '',
                targetType: cls.targetType,
                targetGrade: cls.targetGrade,
                targetClass: cls.targetClass,
                period: ov.period,
                semester: (date.getMonth() + 1 >= 4 && date.getMonth() + 1 <= 9) ? '前期' : '後期',
                weekdayCount: dayData ? dayData.weekdayCount : '[移動]',
                allDay: !!cls.allDay,
                memo: cls.memo || ''
            });
        }
    });

    console.log(`${events.length} 件の授業イベントを生成しました`);
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
    // 自動生成される授業（曜日ベース）の表示判定
    let showStandardClasses = true;
    let isMorningOnly = false;
    let isAfternoonOnly = false;

    if (dayEvents && dayEvents.length > 0) {
        const weekdayCountItem = dayEvents.find(item => item.weekdayCount);

        if (!weekdayCountItem) {
            showStandardClasses = false;
        } else {
            const countStr = weekdayCountItem.weekdayCount || "";
            isMorningOnly = countStr.includes("午前") && !countStr.includes("午後");
            isAfternoonOnly = countStr.includes("午後") && !countStr.includes("午前");
        }
    } else if (typeof scheduleData !== 'undefined' && scheduleData.length > 0) {
        // フォールバック（通常ここは通らないはず）
        const dateStr = date.toDateString();
        const dailyItems = scheduleData.filter(item => item.date.toDateString() === dateStr);
        const weekdayCountItem = dailyItems.find(item => item.weekdayCount);

        if (!weekdayCountItem) {
            showStandardClasses = false;
        } else {
            const countStr = weekdayCountItem.weekdayCount || "";
            isMorningOnly = countStr.includes("午前") && !countStr.includes("午後");
            isAfternoonOnly = countStr.includes("午後") && !countStr.includes("午前");
        }
    } else {
        // データがない場合は表示しない（デフォルト）
        showStandardClasses = false;
    }

    if (showStandardClasses) {
        const classes = getClassesForDay(date);
        classes.forEach(cls => {
            const semester = (date.getMonth() + 1) >= 4 && (date.getMonth() + 1) <= 9 ? 'first' : 'second';
            if (semester === 'first' && !cls.firstSemester) return;
            if (semester === 'second' && !cls.secondSemester) return;

            const schedule = semester === 'first' ? cls.firstSemester : cls.secondSemester;

            if (isMorningOnly && (schedule.period === 3 || schedule.period === 4)) return;
            if (isAfternoonOnly && (schedule.period === 1 || schedule.period === 2)) return;

            const times = PERIOD_TIMES[schedule.period];
            const targetLabel = cls.targetType === 'grade'
                ? `${cls.targetGrade}年`
                : cls.targetGrade === 1
                    ? `${cls.targetGrade}-${cls.targetClass}`
                    : `${cls.targetGrade}${cls.targetClass}`;

            const dateStr_key = formatDateKey(date);
            const isOverridden = classOverrides.some(ov =>
                ov.id == cls.id &&
                ov.type === 'myclass' &&
                ov.date === dateStr_key &&
                (ov.action === 'delete' || ov.action === 'move') &&
                parseInt(ov.period) === schedule.period
            );

            if (isOverridden) return;

            const eventItem = document.createElement('div');
            eventItem.className = 'event-item my-class';
            eventItem.draggable = true;
            eventItem.dataset.classId = cls.id;
            eventItem.dataset.type = 'myclass';
            eventItem.dataset.date = dateStr_key;
            eventItem.dataset.period = schedule.period;

            eventItem.innerHTML = `
                <span class="event-text">${times.start} ${cls.name} (${targetLabel})</span>
                <button class="event-delete-btn" onclick="deleteCalendarEvent(event, 'myclass', '${cls.id}', '${dateStr_key}', ${schedule.period})" title="この日だけ削除">×</button>
            `;

            eventItem.addEventListener('dblclick', () => editCalendarEvent('myclass', cls.id, dateStr_key, schedule.period));

            eventItem.addEventListener('dragstart', handleEventDragStart);
            eventItem.title = `${cls.name} \n時間: ${times.start}～${times.end} \n場所: ${cls.location || '未定'} \n対象: ${targetLabel} `;

            const eventsContainer = dayCell.querySelector('.day-events');
            if (eventsContainer) {
                eventsContainer.appendChild(eventItem);
            }
        });
    }

    // この日に追加（移動）された授業を表示
    const dateStr_iso = formatDateKey(date);
    const addedOverrides = classOverrides.filter(ov =>
        ov.date === dateStr_iso &&
        ov.action === 'move' &&
        ov.type === 'myclass' &&
        ov.data &&
        !classOverrides.some(dov =>
            dov.date === dateStr_iso &&
            String(dov.id) === String(ov.id) &&
            dov.type === 'myclass' &&
            (dov.action === 'delete' || (dov.action === 'move' && !dov.data)) &&
            parseInt(dov.period) === parseInt(ov.period)
        )
    );

    addedOverrides.forEach(ov => {
        const cls = ov.data;

        let timeDisplay = '';
        let fullTimeRange = '';
        if (cls.allDay) {
            timeDisplay = '[終日] ';
            fullTimeRange = '終日';
        } else if (cls.startTime) {
            timeDisplay = cls.startTime + ' ';
            fullTimeRange = `${cls.startTime}～${cls.endTime}`;
        } else {
            const times = PERIOD_TIMES[ov.period] || { start: '--:--', end: '--:--' };
            timeDisplay = times.start + ' ';
            fullTimeRange = `${times.start}～${times.end}`;
        }

        const targetLabel = cls.targetType === 'grade'
            ? `${cls.targetGrade}年`
            : cls.targetGrade === 1
                ? `${cls.targetGrade}-${cls.targetClass}`
                : `${cls.targetGrade}${cls.targetClass}`;

        const eventItem = document.createElement('div');
        eventItem.className = 'event-item my-class moved';
        eventItem.draggable = true;
        eventItem.dataset.classId = cls.id;
        eventItem.dataset.type = 'myclass';
        eventItem.dataset.date = dateStr_iso;
        eventItem.dataset.period = ov.period;

        eventItem.innerHTML = `
            <span class="event-text">${timeDisplay}${cls.name} (${targetLabel})</span>
            <button class="event-delete-btn" onclick="deleteCalendarEvent(event, 'myclass', '${cls.id}', '${dateStr_iso}', ${ov.period})" title="この日だけ削除">×</button>
        `;

        eventItem.addEventListener('dblclick', () => editCalendarEvent('myclass', cls.id, dateStr_iso, ov.period));

        eventItem.addEventListener('dragstart', handleEventDragStart);

        let tooltip = `[移動/編集済み] ${cls.name}\n時間: ${fullTimeRange}\n場所: ${cls.location || '未定'}\n対象: ${targetLabel}`;
        if (cls.memo) tooltip += `\nメモ: ${cls.memo}`;
        eventItem.title = tooltip;

        const eventsContainer = dayCell.querySelector('.day-events');
        if (eventsContainer) {
            eventsContainer.appendChild(eventItem);
        }
    });
}

// デフォルトに復元
function restoreClassDefault(id) {
    if (!confirm('この授業の変更をすべて元に戻しますか？')) return;
    classOverrides = classOverrides.filter(ov => ov.id != id || ov.type !== 'myclass');
    saveMyClasses();
    renderMyClassesList();
    if (typeof updateCalendar === 'function') updateCalendar();
}
window.restoreClassDefault = restoreClassDefault;

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
function showClassSchedule(classId = null) {
    console.log('日程表表示処理を開始します...');
    const modal = document.getElementById('classScheduleModal');
    const tbody = document.getElementById('classScheduleBody');
    if (!modal) {
        console.error('classScheduleModal が見つかりません');
        return;
    }
    if (!tbody) {
        console.error('classScheduleBody が見つかりません');
        return;
    }

    const modalTitle = modal.querySelector('.modal-header h2');

    // 対象年度を決定（app.jsのcurrentYear優先、なければ現在日時より算出）
    let targetYear;
    try {
        targetYear = typeof currentYear !== 'undefined' ? currentYear : getFiscalYear(new Date());
    } catch (e) {
        console.warn('currentYear または getFiscalYear の取得に失敗しました', e);
        targetYear = new Date().getFullYear();
    }

    // タイトルを更新
    if (modalTitle) {
        if (classId) {
            const cls = myClasses.find(c => c.id === classId);
            const className = cls ? cls.name : '指定授業';
            modalTitle.textContent = `授業日程表: ${className} (${targetYear}年度)`;
            // CSVボタンにもIDを紐付ける（データ属性などで保持）
            const csvBtn = document.getElementById('csvExportScheduleBtn');
            if (csvBtn) csvBtn.dataset.classId = classId;
        } else {
            modalTitle.textContent = `授業日程表(${targetYear}年度)`;
            const csvBtn = document.getElementById('csvExportScheduleBtn');
            if (csvBtn) delete csvBtn.dataset.classId;
        }
    }

    let scheduleData = typeof generateClassEvents === 'function' ? generateClassEvents(targetYear) : [];

    // 特定の授業のみにフィルタリング
    if (classId) {
        // classIdは数値か文字列か確認が必要だが、通常ID比較
        scheduleData = scheduleData.filter(item => {
            // item.name で判定するのは不確実なので、generateClassEventsでIDを含めるのがベストだが
            // 現状の item 構造には classId が含まれていない可能性が高い。
            // generateClassEvents を修正するか、名前でマッチングする。
            // ここでは名前マッチングを試みる（同名授業がある場合注意）
            const cls = myClasses.find(c => c.id === classId);
            return cls && item.name === cls.name;
        });
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
                if (!(date instanceof Date)) return String(date);
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

            let remark = item.weekdayCount || '';
            if (item.memo) {
                remark = remark ? `${remark} / ${item.memo}` : item.memo;
            }

            tr.innerHTML = `
                <td>${dateStr}</td>
                <td style="${colorStyle}">${weekdayStr}</td>
                <td class="center">${item.period}</td>
                <td class="center">${timeRange}</td>
                <td>${item.name}</td>
                <td>${targetLabel}</td>
                <td>${item.location || ''}</td>
                <td>${remark}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    // モーダルを表示
    modal.classList.remove('hidden');
}

// モーダルを閉じる
function closeClassScheduleModal() {
    const modal = document.getElementById('classScheduleModal');
    if (modal) {
        modal.classList.add('hidden');
    }
}

// 印刷機能
window.printClassSchedule = function () {
    window.print();
};

// 日程表をCSV出力
function exportClassScheduleCsv() {
    // ボタンからclassIdを取得
    const csvBtn = document.getElementById('csvExportScheduleBtn');
    const classId = csvBtn && csvBtn.dataset.classId ? parseInt(csvBtn.dataset.classId) : null;

    const targetYear = typeof currentYear !== 'undefined' ? currentYear : getFiscalYear(new Date());
    let scheduleData = typeof generateClassEvents === 'function' ? generateClassEvents(targetYear) : [];

    // 特定の授業のみにフィルタリング
    if (classId) {
        scheduleData = scheduleData.filter(item => {
            const cls = myClasses.find(c => c.id === classId);
            return cls && item.name === cls.name;
        });
    }

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
        if (!(date instanceof Date)) return String(date); // 安全策
        return date.toTimeString().substring(0, 5);
    };

    // データ行
    scheduleData.forEach(item => {
        const dateStr = formatDateKey(item.date);
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
        const fileName = classId ? `授業日程表_${scheduleData[0].name}_${targetYear}年度.csv` : `授業日程表_${targetYear}年度.csv`;
        link.setAttribute('download', fileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}
window.exportClassScheduleCsv = exportClassScheduleCsv;

// イベントリスナー追加（初期化関数に追加）
function addScheduleEventListeners() {
    console.log('日程表イベントリスナーを設定中...');
    const showBtn = document.getElementById('showClassScheduleBtn');
    const modal = document.getElementById('classScheduleModal');
    const closeBtns = document.querySelectorAll('.close-modal-btn');
    const printBtn = document.getElementById('printScheduleBtn');
    const csvBtn = document.getElementById('csvExportScheduleBtn');

    if (showBtn) {
        showBtn.addEventListener('click', showClassSchedule);
        console.log('「日程表を表示」ボタンにイベントを設定しました');
    } else {
        console.warn('「日程表を表示」ボタンが見つかりません');
    }

    closeBtns.forEach(btn => {
        btn.addEventListener('click', closeClassScheduleModal);
    });

    // 印刷
    if (printBtn) {
        printBtn.addEventListener('click', printClassSchedule);
    }

    // CSV出力
    if (csvBtn) {
        csvBtn.addEventListener('click', exportClassScheduleCsv);
    }

    // モーダル外クリックで閉じる
    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeClassScheduleModal();
        }
    });

    console.log('日程表イベントリスナーを設定完了');
}

// 印刷機能
function printClassSchedule() {
    window.print();
}

// 外部公開用
window.showClassSchedule = showClassSchedule;
window.closeClassScheduleModal = closeClassScheduleModal;
window.printClassSchedule = printClassSchedule;
window.exportClassScheduleCsv = exportClassScheduleCsv;

