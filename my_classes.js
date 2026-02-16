// =============================
// 授業管理機能
// =============================

// グローバル変数は app.js で定義済み


// クラス定義
// クラス定義
const CLASS_OPTIONS = {
    // 本科
    teacher: {
        1: ['1', '2', '3', '4'],
        2: ['M', 'D', 'E', 'I'],
        3: ['M', 'D', 'E', 'I'],
        4: ['M', 'D', 'E', 'I'],
        5: ['M', 'D', 'E', 'I']
    },
    // 専攻科
    student: {
        1: ['M', 'D', 'E', 'I'],
        2: ['M', 'D', 'E', 'I']
    }
};

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

// 初期化フラグ
let isMyClassesInitialized = false;

// 日程表関連のステート
let scheduleEventListenersInitialized = false;
let currentScheduleClassId = null;

// 時間割関連のステート
let currentTimetableSemester = 'first';

// 初期化
function initializeMyClasses() {
    if (isMyClassesInitialized) {
        console.log('授業管理機能は既に初期化されています');
        return;
    }
    console.log('授業管理機能を初期化中...');

    // localStorageから読み込み
    loadMyClasses();
    console.log(`初期化後: myClasses.length=${myClasses.length}, classOverrides.length=${classOverrides.length}`);

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
    const departmentType = document.getElementById('departmentType');
    if (departmentType) {
        departmentType.addEventListener('change', updateGradeOptions);
    }
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
    console.log('初期状態を設定中...');
    updateClassYearOptions();
    updateGradeOptions(); // これが updateClassOptions も呼ぶ
    updateTargetClassVisibility();
    updateSemesterVisibility(); // 初期表示更新
    // updateTimetableYearOptions(); // グローバル化により不要
    if (typeof updateAvailableYearsAndMonths === 'function') updateAvailableYearsAndMonths(); // App.jsの関数を呼び出し、年度リスト更新
    loadTeachers(); // 教員リストをロード
    loadCourses(); // 候補授業リストをロード

    console.log(`renderMyClassesList呼び出し前: myClasses.length=${myClasses.length}`);
    renderMyClassesList();
    console.log('renderMyClassesList呼び出し完了');

    renderManageTeachers(); // 教員リストの表示
    renderManageCourses(); // 候補授業リストの表示

    // データ読み込み後、カレンダーを再描画（オーバーライド適用のため）
    if (typeof updateCalendar === 'function') {
        updateCalendar();
    }

    // 教員入力フィールドのEnterキーリスナー
    const classTeacherInput = document.getElementById('classTeacher');
    if (classTeacherInput) {
        classTeacherInput.addEventListener('keypress', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                addTeacherToList();
            }
        });
    }

    // ボタンのイベントリスナー設定
    const toggleTeacherListBtn = document.getElementById('toggleTeacherListBtn');
    if (toggleTeacherListBtn) {
        console.log('Setting up toggleTeacherListBtn event listener in initializeMyClasses');
        toggleTeacherListBtn.addEventListener('click', (e) => {
            console.log('toggleTeacherListBtn clicked');
            e.preventDefault();
            const container = document.getElementById('teacherListContainer');
            if (!container) {
                console.error('teacherListContainer not found');
                return;
            }
            container.classList.toggle('hidden');
            if (!container.classList.contains('hidden')) {
                renderTeacherList();
            }
        });
    } else {
        console.error('toggleTeacherListBtn not found during initialization');
    }

    const addTeacherBtn = document.getElementById('addTeacherBtn');
    if (addTeacherBtn) {
        console.log('Setting up addTeacherBtn event listener in initializeMyClasses');
        // onclickを削除してリスナーを設定
        addTeacherBtn.removeAttribute('onclick');
        addTeacherBtn.addEventListener('click', (e) => {
            console.log('addTeacherBtn clicked');
            e.preventDefault();
            addTeacherToList();
        });
    } else {
        console.error('addTeacherBtn not found during initialization');
    }

    // 検索・教員リスト機能の初期化
    if (typeof initCourseSearch === 'function') initCourseSearch();
    if (typeof initTeacherDragAndDrop === 'function') initTeacherDragAndDrop();

    // 年度変更リスナーは app.js で一括管理されるためここでは追加しない

    // デフォルトタブを「授業候補の修正」に設定
    switchSettingsTab('courses');

    isMyClassesInitialized = true;
    console.log('授業管理機能の初期化完了');
}

/* =============================
   複数教員管理機能
   ============================= */

// グローバル変数：編集中の教員リスト
let selectedTeachers = [];

/**
 * HTML特殊文字をエスケープ
 */
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

/**
 * 教員を追加リストに追加
 */
function addTeacherToList() {
    const input = document.getElementById('classTeacher');

    if (!input) {
        console.error('Error: #classTeacher element not found');
        return;
    }

    const value = input.value.trim();
    if (!value) {
        alert('教員名を入力してください');
        return;
    }

    // カンマ、読点、スペースで分割して各名前をトリム
    const names = value.split(/[,、\s]+/).map(n => n.trim()).filter(n => n !== '');

    // フィルタリング後に名前がない場合
    if (names.length === 0) {
        alert('有効な教員名が入力されていません');
        return;
    }

    let added = 0;
    let skipped = 0;

    names.forEach(name => {
        if (selectedTeachers.length >= 10) {
            return;
        }
        if (selectedTeachers.includes(name)) {
            skipped++;
            return;
        }
        selectedTeachers.push(name);
        added++;
    });

    if (added > 0) {
        input.value = '';
        updateTeachersDisplay();
        // サジェストが出ていれば閉じる
        const suggestions = document.getElementById('teacherSuggestions');
        if (suggestions) suggestions.classList.add('hidden');
    }

    if (added === 0 && skipped > 0) {
        alert('既に追加されています');
    } else if (selectedTeachers.length >= 10 && names.length > added) {
        alert('最大10人までしか登録できません');
    }
}

/**
 * 教員をリストから削除
 */
function removeTeacherFromList(teacher) {
    selectedTeachers = selectedTeachers.filter(t => t !== teacher);
    updateTeachersDisplay();
}

/**
 * 教員リスト表示を更新
 */
function updateTeachersDisplay() {
    const container = document.getElementById('teachersDisplay');
    const badge = document.getElementById('teacherCountBadge');

    if (selectedTeachers.length === 0) {
        container.innerHTML = '<div class="empty-teacher-message" style="width: 100%; color: var(--neutral-500); font-size: 0.85rem;">教員を追加してください</div>';
        badge.style.display = 'none';
    } else {
        container.innerHTML = selectedTeachers.map(teacher => `
            <div style="
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 6px 12px;
                background: linear-gradient(135deg, var(--primary-blue), var(--primary-blue-dark));
                color: white;
                border-radius: 20px;
                font-size: 0.85rem;
                font-weight: 500;
                box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
            ">
                <span>${escapeHtml(teacher)}</span>
                <button type="button" onclick="removeTeacherFromList('${teacher.replace(/'/g, "\\'")}')" 
                    style="
                        background: none;
                        border: none;
                        color: white;
                        cursor: pointer;
                        font-size: 1.2rem;
                        padding: 0;
                        margin: -2px;
                        opacity: 0.8;
                    " title="削除">✕</button>
            </div>
        `).join('');

        badge.textContent = `${selectedTeachers.length}人`;
        badge.style.display = 'inline-block';
    }
}

/**
 * フォーム値をクリア＆教員リストをリセット
 */
function resetTeachersForm() {
    selectedTeachers = [];
    updateTeachersDisplay();
    document.getElementById('classTeacher').value = '';
}

// ===========================
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
            console.log(`loadMyClasses: ${myClasses.length}件の授業を読み込みました`);
        } else {
            console.log('loadMyClasses: localStorageに授業データがありません');
            myClasses = [];
        }
        const savedOverrides = localStorage.getItem('classOverrides');
        if (savedOverrides) {
            classOverrides = JSON.parse(savedOverrides);
            // 日付形式の正規化 (スラッシュをハイフンに統一)
            classOverrides = classOverrides.map(ov => {
                if (ov.date) ov.date = ov.date.replace(/\//g, '-');
                if (ov.startDate) ov.startDate = ov.startDate.replace(/\//g, '-');
                if (ov.endDate) ov.endDate = ov.endDate.replace(/\//g, '-');
                return ov;
            });
            console.log(`loadMyClasses: ${classOverrides.length}件のオーバーライドを読み込みました`);
        } else {
            classOverrides = [];
        }
        window.classOverrides = classOverrides;
    } catch (error) {
        console.error('授業データの読み込みエラー:', error);
        myClasses = [];
        classOverrides = [];
        window.classOverrides = classOverrides;
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

// 開講年度の選択肢更新
function updateClassYearOptions() {
    const yearSelect = document.getElementById('classYear');
    if (!yearSelect) return;

    // 現在のトップメニューの年度を基準にする
    const globalYearSelect = document.getElementById('globalYearSelect');
    const baseYear = globalYearSelect ? parseInt(globalYearSelect.value) : (new Date().getFullYear());

    // アプリ全体の利用可能年度
    const appAvailableYears = typeof availableYears !== 'undefined' ? availableYears : [];

    // 現在の年度、前後1年、および登録済み年度、年間行事予定の年度をすべて含める
    const years = [baseYear - 1, baseYear, baseYear + 1, ...appAvailableYears];

    // ユニークにしてソート
    const uniqueYears = [...new Set(years)].sort((a, b) => a - b);

    // デフォルトでトップメニューの年度を選択。既に有効な値が選択されている場合は維持。
    let selected = yearSelect.value;
    if (!selected || !uniqueYears.includes(parseInt(selected))) {
        selected = baseYear;
    }

    yearSelect.innerHTML = uniqueYears.map(y =>
        `<option value="${y}" ${y == selected ? 'selected' : ''}>${y}年度</option>`
    ).join('');
}

// 課程に応じた学年選択肢を更新
function updateGradeOptions() {
    const dept = document.getElementById('departmentType').value;
    const gradeSelect = document.getElementById('targetGrade');
    const currentGrade = gradeSelect.value;

    let maxGrade = 5; // default teacher
    if (dept === 'student') maxGrade = 2;

    let html = '';
    for (let i = 1; i <= maxGrade; i++) {
        html += `<option value="${i}">${i}年</option>`;
    }
    gradeSelect.innerHTML = html;

    // 学年が範囲外になった場合は1年にリセット
    if (parseInt(currentGrade) > maxGrade) {
        gradeSelect.value = '1';
    } else {
        gradeSelect.value = currentGrade;
    }

    // クラス選択肢も更新
    updateClassOptions();
}

// 学年に応じたクラス選択肢を更新
function updateClassOptions() {
    const dept = document.getElementById('departmentType').value;
    const gradeVal = document.getElementById('targetGrade').value;
    const grade = parseInt(gradeVal);
    const classSelect = document.getElementById('targetClass');
    const classGroup = document.getElementById('targetClassGroup');
    const classLabel = classGroup.querySelector('label');

    const options = (CLASS_OPTIONS[dept] && CLASS_OPTIONS[dept][grade]) || [];

    // ラベルを変更
    let labelText = '';
    if (dept === 'teacher' && grade === 1) {
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
        (dept === 'teacher' && grade === 1)
            ? `<option value="${cls}">${cls}組</option>`
            : `<option value="${cls}">${cls}コース</option>`
    ).join('');

    console.log(`課程:${dept} 学年:${grade} の選択肢を更新しました`);
}


// 授業を編集モードにする
function editMyClass(id) {
    const cls = myClasses.find(c => c.id === id);
    if (!cls) return;

    // モーダルを開く前に値をセットする必要があるため、ここでモーダル表示
    openClassInputModal();

    // フォームに値をセット
    document.getElementById('editingClassId').value = cls.id;
    document.getElementById('className').value = cls.name;
    document.getElementById('classLocation').value = cls.location || '';
    if (document.getElementById('classTeacher')) {
        document.getElementById('classTeacher').value = cls.teacher || '';
    }

    // 開講年度・課程の設定
    if (cls.classYear && document.getElementById('classYear')) {
        document.getElementById('classYear').value = cls.classYear;
    }
    if (cls.departmentType && document.getElementById('departmentType')) {
        document.getElementById('departmentType').value = cls.departmentType;
        updateGradeOptions(); // 課程変更に伴い学年選択肢更新
    }

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

    addBtn.innerHTML = '<span>\uD83D\uDD04 更新する</span>';
    addBtn.classList.remove('btn-primary');
    addBtn.classList.add('btn-success');

    cancelBtn.classList.remove('hidden');

    // 教員リストを復元（複数教員対応）
    if (cls.teachers && Array.isArray(cls.teachers)) {
        selectedTeachers = cls.teachers.slice().filter(t => typeof t === 'string' && t.trim() !== '');
    } else if (cls.teacher) {
        // 互換性：古いバージョンでは単一の teacher フィールド
        selectedTeachers = cls.teacher.split(/[,、]+/).map(t => t.trim()).filter(t => t !== '');
    } else {
        selectedTeachers = [];
    }
    updateTeachersDisplay();

    // フォームへスクロールは不要（モーダルなので）
}

// 編集キャンセル / フォームリセット
function resetForm() {
    document.getElementById('editingClassId').value = '';
    document.getElementById('className').value = '';
    document.getElementById('classLocation').value = '';
    if (document.getElementById('classTeacher')) {
        document.getElementById('classTeacher').value = '';
    }

    // デフォルトに戻す
    const globalYear = document.getElementById('globalYearSelect')?.value;
    if (document.getElementById('classYear')) {
        document.getElementById('classYear').value = globalYear || (typeof currentYear !== 'undefined' ? currentYear : new Date().getFullYear());
    }
    updateClassYearOptions(); // オプションを更新
    if (document.getElementById('departmentType')) {
        document.getElementById('departmentType').value = 'teacher';
        updateGradeOptions(); // これで1年に戻るはず
    }

    document.getElementById('targetType').value = 'class';
    // document.getElementById('targetGrade').value = '1'; // updateGradeOptionsでセットされる

    updateTargetClassVisibility();
    updateClassOptions();

    if (document.getElementById('semesterType')) {
        document.getElementById('semesterType').value = 'full';
        updateSemesterVisibility();
    }

    // 時間割の選択解除
    const selects = ['firstWeekday', 'firstPeriod', 'secondWeekday', 'secondPeriod'];
    selects.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.selectedIndex = 0;
    });

    // ボタン戻す
    const addBtn = document.getElementById('addClassBtn');
    const cancelBtn = document.getElementById('cancelEditBtn');

    addBtn.innerHTML = '<span>➕ 授業を保存</span>';
    addBtn.classList.remove('btn-success');
    addBtn.classList.add('btn-primary');

    cancelBtn.classList.add('hidden');

    // 教員リストをリセット
    resetTeachersForm();
}

// 授業を追加・更新
function addMyClass() {
    // 入力値を取得
    const idInput = document.getElementById('editingClassId');
    const isEditMode = idInput.value !== '';

    const name = document.getElementById('className').value.trim();
    const location = document.getElementById('classLocation').value.trim();
    const teachers = selectedTeachers.slice(); // 複数教員対応
    const classYear = parseInt(document.getElementById('classYear').value);
    const departmentType = document.getElementById('departmentType').value;
    const targetType = document.getElementById('targetType').value;
    const targetGrade = parseInt(document.getElementById('targetGrade').value);
    const targetClass = targetType === 'class' ? document.getElementById('targetClass').value : null;

    const semesterType = document.getElementById('semesterType').value;

    const firstWeekday = parseInt(document.getElementById('firstWeekday').value);
    const firstPeriod = document.getElementById('firstPeriod').value;
    const secondWeekday = parseInt(document.getElementById('secondWeekday').value);
    const secondPeriod = document.getElementById('secondPeriod').value;

    // バリデーション
    if (!name) {
        alert('授業名を入力してください');
        return;
    }

    if (teachers.length === 0) {
        alert('担当教員を最少1人追加してください');
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
        teachers,  // 複数教員対応
        teacher: teachers.join('、'),  // 互換性のため単一フィールドも保持
        classYear,
        departmentType,
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
    closeClassInputModal(); // こちらがresetFormも呼ぶ

    // カレンダーを更新（授業を反映）
    // scheduleDataに自分の授業イベントを追加
    if (typeof generateClassEvents === 'function') {
        try {
            const myClassEvents = generateClassEvents(currentYear);
            console.log(`生成された自分の授業イベント数: ${myClassEvents.length}`);
            // scheduleDataに既存のExcelイベントは残して、myClassEvents を追加
            // scheduleDataを再構築（既に含まれている可能性があるので一度クリア）
            if (window.scheduleData) {
                // Excelデータのみを取得（typeが'teacher'または'student'のもの）
                const excelEvents = window.scheduleData.filter(item =>
                    !item.fromMyClass // fromMyClassフラグがないもの（Excelデータ）
                );
                window.scheduleData = excelEvents.concat(myClassEvents);
                console.log(`更新後のscheduleData数: ${window.scheduleData.length}`);
            }
        } catch (e) {
            console.error('generateClassEvents呼び出しエラー:', e);
        }
    }

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
        closeClassInputModal();
    }

    myClasses = myClasses.filter(cls => cls.id !== id);
    saveMyClasses();
    renderMyClassesList();

    // カレンダーを更新（削除を反映）
    // scheduleDataに自分の授業イベントを追加
    if (typeof generateClassEvents === 'function') {
        try {
            const myClassEvents = generateClassEvents(currentYear);
            console.log(`生成された自分の授業イベント数: ${myClassEvents.length}`);
            // scheduleDataを再構築
            if (window.scheduleData) {
                const excelEvents = window.scheduleData.filter(item =>
                    !item.fromMyClass // fromMyClassフラグがないもの（Excelデータ）
                );
                window.scheduleData = excelEvents.concat(myClassEvents);
                console.log(`更新後のscheduleData数: ${window.scheduleData.length}`);
            }
        } catch (e) {
            console.error('generateClassEvents呼び出しエラー:', e);
        }
    }

    if (typeof updateCalendar === 'function') {
        updateCalendar();
    }
}

// 授業リストを表示
function renderMyClassesList() {
    const listContainer = document.getElementById('classList');
    const countElement = document.getElementById('classCount');

    if (!listContainer || !countElement) {
        console.warn('renderMyClassesList: DOM要素が見つかりません');
        return;
    }

    // classOverridesの初期化（未定義の場合）
    if (typeof classOverrides === 'undefined') {
        window.classOverrides = [];
    }

    console.log(`renderMyClassesList: myClasses.length=${myClasses.length}, classOverrides.length=${classOverrides.length}`);

    // 件数更新
    countElement.textContent = myClasses.length;

    // 選択された年度を取得 (グローバル)
    const yearSelect = document.getElementById('globalYearSelect');
    const selectedYear = yearSelect ? parseInt(yearSelect.value) : (typeof currentYear !== 'undefined' ? currentYear : new Date().getFullYear());

    // 年度でフィルタリング
    const filteredClasses = myClasses.filter(cls => {
        const classYear = cls.classYear || (typeof currentYear !== 'undefined' ? currentYear : new Date().getFullYear());
        return classYear === selectedYear;
    });

    if (filteredClasses.length === 0) {
        console.log('renderMyClassesList: 該当年度の授業が登録されていません');
        listContainer.innerHTML = '<p class="empty-message">この年度の授業は登録されていません</p>';
        countElement.textContent = 0;
        // 時間割も更新（空になるはず）
        if (typeof renderTimetable === 'function') renderTimetable();
        return;
    }

    // 件数更新
    countElement.textContent = filteredClasses.length;

    listContainer.innerHTML = filteredClasses.map(cls => {
        const hasOverride = classOverrides.some(ov => String(ov.id) === String(cls.id) && ov.type === 'myclass');

        const deptLabel = cls.departmentType === 'student' ? '専攻科' : '本科';
        const yearLabel = cls.classYear ? `[${cls.classYear}]` : '';

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
                        <span class="class-badge" style="background-color: #e3f2fd; color: #0d47a1;">${yearLabel} ${deptLabel}</span>
                        <span class="class-badge">${targetLabel}</span>
                        ${scheduleInfo}
                        ${cls.location ? `<span class="class-badge class-badge-location">\uD83D\uDCCD ${cls.location}</span>` : ''}
                        ${cls.teacher ? cls.teacher.split(/[,、]+/).map(t => `<span class="class-badge" style="background: linear-gradient(135deg, #6366f1, #4338ca); color: white;">\uD83D\uDC64 ${t.trim()}</span>`).join('') : ''}
                    </div>
                </div>
                <div class="class-actions">
                    ${hasOverride ? `<button class="btn-icon" onclick="restoreClassDefault(${cls.id})" title="デフォルトに復元">\uD83D\uDD04</button>` : ''}
                    <button class="btn-icon" onclick="showClassSchedule(${cls.id})" title="この授業の日程表を表示">\uD83D\uDCC5</button>
                    <button class="btn-icon" onclick="editMyClass(${cls.id})" title="編集">✏️</button>
                    <button class="btn-icon" onclick="deleteMyClass(${cls.id})" title="削除">\uD83D\uDDD1️</button>
                </div>
            </div>
        `;
    }).join('');

    console.log('renderMyClassesList: リスト描画完了、時間割を更新');
    if (typeof renderTimetable === 'function') {
        renderTimetable();
    } else {
        console.warn('renderTimetable関数が見つかりません');
    }
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
        // 年度チェック (classYearがない場合は全年度で有効とするか、あるいは currentYear に合わせるか)
        // ここでは classYear が設定されていれば、その年度のみ有効とする
        if (cls.classYear && cls.classYear !== fiscalYear) return false;

        // 学期ごとの設定チェック
        if (semester === 'first' && !cls.firstSemester) return false;
        if (semester === 'second' && !cls.secondSemester) return false;

        const schedule = semester === 'first' ? cls.firstSemester : cls.secondSemester;
        return schedule.weekday === weekday && schedule.period === period;
    });
}

// 曜日名から数値（0:日, 6:土）を取得するヘルパー
function getWeekdayFromCount(countStr) {
    if (!countStr) return null;
    // 曜日判定を邪魔するキーワードを除去
    const cleanStr = countStr.replace(/補講日/g, '').replace(/午前/g, '').replace(/午後/g, '');
    const match = cleanStr.match(/(月|火|水|木|金|土|日)/);
    if (!match) return null;
    const dayName = match[1];
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    return days.indexOf(dayName);
}

// 午前・午後のみの授業日に、時限範囲を切り詰める
// 午前・午後のみの授業日に、時限範囲を切り詰める
// 午前・午後のみの授業日に、時限範囲を切り詰める
function getEffectivePeriods(periodStr, isMorningOnly, isAfternoonOnly) {
    if (!periodStr) return null;
    let periods = [];

    // 全角数字を半角に変換
    const str = String(periodStr).replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)).trim();

    // 区切り文字（ハイフン、全角ハイフン、波ダッシュ、全角コロンなど）で分割
    const parts = str.split(/[-－―〜~:：]/);

    if (parts.length > 1) {
        const start = parseInt(parts[0]);
        const end = parseInt(parts[parts.length - 1]);
        if (!isNaN(start) && !isNaN(end)) {
            for (let p = Math.min(start, end); p <= Math.max(start, end); p++) {
                periods.push(p);
            }
        } else {
            // 数値でないものが混ざっている場合（例: 3-HR）はそのまま扱う
            periods = [str];
        }
    } else {
        if (str === 'HR' || str === 'after') {
            periods.push(str);
        } else {
            const p = parseInt(str);
            if (isNaN(p)) {
                // 数値でなくても、HR等の文字列なら許可
                periods.push(str);
            } else {
                periods.push(p);
            }
        }
    }

    const originalCount = periods.length;
    if (isMorningOnly) {
        // 午前のみの場合、3限以降（およびHR, after）を除去
        periods = periods.filter(p => {
            if (p === 'HR' || p === 'after') return false;
            if (typeof p === 'number') return p <= 2;
            return false; // 不明な文字列は除去
        });
    } else if (isAfternoonOnly) {
        // 午後のみの場合、2限以前を除去
        periods = periods.filter(p => {
            if (p === 'HR' || p === 'after') return true;
            if (typeof p === 'number') return p >= 3;
            return true; // 不明な文字列も午後に含めておく（安全策）
        });
    }

    if (periods.length === 0) return null;

    return {
        periods: periods,
        label: periods.length === 1 ? String(periods[0]) : `${periods[0]}-${periods[periods.length - 1]}`,
        isTruncated: periods.length < originalCount
    };
}




// 特定の日の全授業を取得（期間用）
function getClassesForDay(date, overrideWeekday = null, semesterOverride = null) {
    const actualWeekday = date.getDay();
    const weekday = overrideWeekday !== null ? overrideWeekday : actualWeekday;
    const month = date.getMonth() + 1;

    // 前期 or 後期判定
    let semester;
    if (semesterOverride) {
        semester = semesterOverride;
    } else {
        if (month >= 4 && month <= 9) {
            semester = 'first';
        } else {
            semester = 'second';
        }
    }

    return myClasses.filter(cls => {
        // 年度チェック (文字列・数値どらでも比較できるよう変換)
        const fiscalYear = getFiscalYear(date);
        if (cls.classYear && String(cls.classYear) !== String(fiscalYear)) return false;

        // 学期ごとの設定チェック
        if (semester === 'first' && !cls.firstSemester) return false;
        if (semester === 'second' && !cls.secondSemester) return false;

        const schedule = semester === 'first' ? cls.firstSemester : cls.secondSemester;
        return String(schedule.weekday) === String(weekday);
    });
}


// エクスポート用：全授業データを取得
function getAllMyClasses() {
    return myClasses;
}

// 授業時間帯定義
// PERIOD_TIMES は app.js で定義済み


// 日付と時刻文字列からDateオブジェクトを生成
function createDateTime(date, timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const newDate = new Date(date);
    newDate.setHours(hours, minutes, 0, 0);
    return newDate;
}

// エクスポート用：特定年度の全授業イベントを生成
// エクスポート用：特定年度の全授業イベントを生成
function generateClassEvents(year, options = {}) {
    const events = [];
    const includeExclusions = options.includeExclusions !== undefined ? options.includeExclusions : true;

    // classOverridesの初期化（未定義の場合）
    if (typeof classOverrides === 'undefined') {
        window.classOverrides = [];
    }

    // assignmentExclusionsを取得
    const assignmentExclusions = JSON.parse(localStorage.getItem('assignmentExclusions') || '{}');

    // scheduleDataにアクセス（app.jsから）
    // カレンダー表示と一致させるため、オーバーライド適用済みのデータを取得
    // ※授業データ自体が混ざると再帰的になるため、授業データ（fromMyClass）は除外して解析する
    let sourceData = [];
    if (typeof window.getAppliedScheduleData === 'function') {
        sourceData = window.getAppliedScheduleData('both').filter(item => !item.fromMyClass);
    } else if (typeof scheduleData !== 'undefined' && scheduleData) {
        sourceData = scheduleData.filter(item => !item.fromMyClass);
    }

    console.log(`generateClassEvents: sourceData.length=${sourceData.length}, myClasses.length=${myClasses.length}, classOverrides.length=${classOverrides.length}`);

    // 前期授業開始・後期授業開始の特定
    let firstSemesterStart = null;
    let secondSemesterStart = null;

    // バッチによる推測（マーカーがない場合の救済）
    let firstSemStartByBatch = null;
    let secondSemStartByBatch = null;

    sourceData.forEach(d => {
        const eventText = (d.event || "");
        const nameText = (d.name || "");
        const wcText = (d.weekdayCount || "");
        const text = (eventText + nameText + wcText).trim();
        if (!text) return;

        const date = d.date instanceof Date ? new Date(d.date) : new Date(d.date);
        date.setHours(0, 0, 0, 0);

        // 年度チェックを厳縮に
        if (getFiscalYear(date) !== Number(year)) return;

        // マーカー検索: 「後期」や「第2学期」が含まれ、かつ「開始」または「始め」が含まれる場合
        const isSecondSem = text.includes("後期") || text.includes("第2学期") || text.includes("第二学期");
        const isFirstSem = text.includes("前期") || text.includes("第1学期") || text.includes("第一学期");
        const isStart = text.includes("授業開始") || text.includes("開始") || text.includes("始業") || text.includes("はじめ");

        if (isSecondSem && isStart) {
            if (!secondSemesterStart || date < secondSemesterStart) {
                secondSemesterStart = date;
                console.log(`[Semester] 後期開始マーカー検出: ${formatDateKey(date)} - "${text}"`);
            }
        } else if (isFirstSem && isStart) {
            if (!firstSemesterStart || date < firstSemesterStart) {
                firstSemesterStart = date;
                console.log(`[Semester] 前期開始マーカー検出: ${formatDateKey(date)} - "${text}"`);
            }
        }

        // バッチによる推測 (8/20〜10/15位の期間でバッチが「1」なら後期開始とみなす)
        const wc = wcText.trim();
        const isReset = /^[月火水木金土日]?[1１]$/.test(wc) || wc === "1" || wc === "１";
        if (isReset) {
            const m = date.getMonth() + 1;
            if (m === 8 || m === 9 || m === 10) {
                if (!secondSemStartByBatch || date < secondSemStartByBatch) {
                    secondSemStartByBatch = date;
                    console.log(`[Semester] バッチ[1]による後期開始推測: ${formatDateKey(date)} - "${wc}"`);
                }
            } else if (m === 4 || m === 5 || m === 6) {
                if (!firstSemStartByBatch || date < firstSemStartByBatch) {
                    firstSemStartByBatch = date;
                    console.log(`[Semester] バッチ[1]による前期開始推測: ${formatDateKey(date)} - "${wc}"`);
                }
            }
        }
    });

    // 境界判定：マーカー（授業開始）とバッチリセット（1）のいずれか早い方を採用する
    let finalFirstStart = firstSemesterStart;
    if (firstSemStartByBatch && (!finalFirstStart || firstSemStartByBatch < finalFirstStart)) {
        finalFirstStart = firstSemStartByBatch;
    }
    let finalSecondStart = secondSemesterStart;
    if (secondSemStartByBatch && (!finalSecondStart || secondSemStartByBatch < finalSecondStart)) {
        finalSecondStart = secondSemesterStart;
    }

    const getSemesterLabel = (d) => {
        if (!d) return 'first';
        const target = new Date(d);
        target.setHours(0, 0, 0, 0);

        // 後期開始日（マーカーまたはバッチリセット初日）以降
        if (finalSecondStart && target >= finalSecondStart) return 'second';
        // 前期開始日以降
        if (finalFirstStart && target >= finalFirstStart) return 'first';

        // 境界が見つからない場合の推測
        const m = target.getMonth() + 1;
        // 9月〜10月でバッチが1,2なら後期とみなす（安全策）
        if (m === 9 || m === 10) {
            const tStr = formatDateKey(target);
            const items = sourceData.filter(it => formatDateKey(it.date) === tStr);
            const dayWc = items.find(it => it.weekdayCount)?.weekdayCount || "";
            if (/^[月火水木金土日]?[1１2２]$/.test(dayWc.trim())) return 'second';
        }

        return 'first';
    };

    console.log(`generateClassEvents: 学期境界: 前期=${finalFirstStart ? formatDateKey(finalFirstStart) : '未検出'}, 後期=${finalSecondStart ? formatDateKey(finalSecondStart) : '未検出'}`);

    // 各月のデータ存在確認
    const monthsInFiscalYear = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];
    let uniqueClassDays = [];

    monthsInFiscalYear.forEach(m => {
        const mYear = (m <= 3) ? year + 1 : year;

        // その月のソースデータを取得
        const monthData = sourceData.filter(item => {
            const d = item.date instanceof Date ? item.date : new Date(item.date);
            return d.getFullYear() === mYear && (d.getMonth() + 1) === m;
        });

        // その月に1日でも「曜日カウント（授業日指定）」、「〇曜授業」、または「授業開始」があるか
        const daysWithCountInMonth = monthData.filter(item => {
            const wc = (item.weekdayCount || "").trim();
            const et = (item.event || item.name || "");
            const isBatchWc = wc && (/[月火水木金土日]/.test(wc) || /\d/.test(wc));
            const isUnrelated = et.includes("準備") || et.includes("片付け") || et.includes("会議") || et.includes("設営") || et.includes("案内");
            const isClassEvent = (et.includes("曜授業") || et.includes("授業開始")) && !isUnrelated;
            return isBatchWc || isClassEvent;
        });

        if (daysWithCountInMonth.length > 0) {
            // 指定がある日はその指定に従う（月1、火1など）
            const dateToBestItem = new Map();
            monthData.forEach(item => {
                const dateKey = formatDateKey(item.date);
                const wc = (item.weekdayCount || "").trim();
                const et = (item.event || item.name || "");
                const isUnrelated = et.includes("準備") || et.includes("片付け") || et.includes("会議") || et.includes("設営") || et.includes("案内");

                const isBatchWc = wc && (/[月火水木金土日]/.test(wc) || /\d/.test(wc));
                const isClassEvent = (et.includes("曜授業") || et.includes("授業開始")) && !isUnrelated;

                // 曜日カウント（バッチ）または「授業開始」があるものを最優先
                if (isBatchWc || isClassEvent) {
                    dateToBestItem.set(dateKey, item);
                }
            });
            uniqueClassDays = uniqueClassDays.concat(Array.from(dateToBestItem.values()));
        }
    });

    console.log(`generateClassEvents(${year}): ${uniqueClassDays.length}日の候補日を抽出。`);

    // 各授業日に対して授業をチェック
    uniqueClassDays.forEach(dayData => {
        const date = dayData.date;
        const weekday = date.getDay();
        const month = date.getMonth() + 1;
        const fiscalYear = getFiscalYear(date);
        const dateStrKey = formatDateKey(date);

        // 指定された年度の授業日のみ
        if (getFiscalYear(date) !== Number(year)) return;

        // その日の全イベントを取得 (共通で使用)
        const allItemsForDay = sourceData.filter(d => formatDateKey(d.date) === dateStrKey);

        // 定期試験チェック（ただし「返却」のみの日は授業ありとする）
        const isExamDay = allItemsForDay.some(d => {
            const text = (d.event || d.name || "");
            const examKeywords = ['中間試験', '定期試験', '期末試験', '学年末試験'];
            return examKeywords.some(k => text.includes(k)) && !text.includes('返却');
        });
        if (isExamDay) {
            console.log(`generateClassEvents: ${dateStrKey} は試験期間中のためスキップします (返却日を除く)`);
            return;
        }

        // 曜日カウント（バッチ）を取得
        let countStr = (dayData.weekdayCount || "").trim();

        // 授業開始イベントがあるかチェック
        const textForClassDayCheck = (dayData.event || "") + (dayData.weekdayCount || "");
        const isClassesStartDay = textForClassDayCheck.includes("授業開始");

        // バッチがない場合でも、イベント名に「〇曜授業」や「授業開始」とあればそれをバッチ候補として採用する（救済処置）
        if (!countStr) {
            allItemsForDay.forEach(d => {
                const text = d.event || d.name || "";
                const isUnrelated = text.includes("準備") || text.includes("片付け") || text.includes("会議") || text.includes("設営") || text.includes("案内");
                if (isUnrelated) return;

                const match = text.match(/[月火水木金土日]曜授業/);
                if (match) {
                    countStr = match[0];
                } else if (text.includes("授業開始")) {
                    // 授業開始日の場合は、可能であればその日のイベント全体からバッチを探す
                    const anyWc = allItemsForDay.find(it => it.weekdayCount && it.weekdayCount.trim())?.weekdayCount;
                    if (anyWc) countStr = anyWc;
                }
            });
        }

        // ユーザー要望：曜日カウントのバッチがない日は授業を配置しない（バッチ優先）
        // ただし、「授業開始」イベントがある日は、バッチ自体が空欄でもその曜日の授業として通す
        if (!isClassesStartDay && (!countStr || (!/[月火水木金土日]/.test(countStr) && !/\d/.test(countStr)))) {
            return;
        }

        // 祝日チェック
        if (typeof window.getHolidaysForYear === 'function' && typeof window.getHolidayName === 'function') {
            const holidaysMap = window.getHolidaysForYear(date.getFullYear());
            const holidayName = window.getHolidayName(date, holidaysMap);
            if (holidayName) {
                // 祝日であっても、バッチ（または上記救済）により countStr が存在する場合は
                // 「授業を行う旨の指定がある」とみなして通過させる
                // ただし、念のためイベントテキストのチェックも保持
                const text = (dayData.event || "") + (dayData.weekdayCount || "");
                const hasClassOverride = text.includes("授業") || text.includes("補講") || text.includes("曜授業") || countStr.length > 0;

                if (!hasClassOverride) {
                    return;
                }
            }
        }

        // 前期 or 後期判定（カレンダーの境界設定を最優先とする）
        let semester = getSemesterLabel(date);

        // この日の有効な曜日（カウント文字列から導出）
        const batchWeekday = getWeekdayFromCount(countStr);
        const effectiveWeekday = batchWeekday !== null ? batchWeekday : date.getDay();

        // この日に該当する授業を検索
        myClasses.forEach(cls => {
            // 年度チェック (文字列・数値どらでも比較できるよう変換)
            if (cls.classYear && String(cls.classYear) !== String(fiscalYear)) return;

            // 学期チェック
            if (semester === 'first' && !cls.firstSemester) return;
            if (semester === 'second' && !cls.secondSemester) return;

            const schedule = semester === 'first' ? cls.firstSemester : cls.secondSemester;

            if (!schedule) return;

            // 曜日が一致しない場合スキップ
            if (String(schedule.weekday) !== String(effectiveWeekday)) return;

            // オーバライドチェック：削除されているか、移動済みなのかを確認
            const isDeleted = classOverrides.some(ov =>
                String(ov.id) === String(cls.id) &&
                ov.type === 'myclass' &&
                ov.date === dateStrKey &&
                ov.action === 'delete' &&
                String(ov.period) === String(schedule.period)
            );

            const isMoved = classOverrides.some(ov =>
                String(ov.id) === String(cls.id) &&
                ov.type === 'myclass' &&
                ov.date === dateStrKey &&
                ov.action === 'move' &&
                String(ov.period) === String(schedule.period)
            );

            if (isDeleted || isMoved) return;

            // 担当除外チェック
            if (!includeExclusions) {
                const excludedDates = assignmentExclusions[cls.id] || [];
                if (excludedDates.includes(dateStrKey)) return;
            }
            // この日の全てのイベント（Excel＋カスタム）を取得
            const allItemsForDay = sourceData.filter(d => formatDateKey(d.date) === dateStrKey);

            // 午前・午後の打ち切り判定
            let sessionInfo = {
                hasMorningIndicator: false,
                hasAfternoonIndicator: false,
                hasPriorityMorning: false,
                hasPriorityAfternoon: false
            };

            allItemsForDay.forEach(d => {
                const eventText = (d.event || "");
                const combined = eventText + (d.weekdayCount || "");

                // より正確な判定（「午後打ち切り」に「午後」が含まれることによる誤判定を防ぐ）
                const isMorningMatch = (combined.includes("午前") && !combined.includes("午前打ち切り")) || combined.includes("午後打ち切り") || combined.includes("●");
                const isAfternoonMatch = (combined.includes("午後") && !combined.includes("午後打ち切り")) || combined.includes("午前打ち切り");

                if (!isMorningMatch && !isAfternoonMatch) return;

                // 授業に関係あるか (項目自体に「曜日・数字・曜授業」などの指定があるか)
                const isRelated = d.isSpecificWeekday ||
                    eventText.includes("曜授業") || /\d/.test(eventText) ||
                    (d.weekdayCount && (d.weekdayCount.includes("曜授業") || /\d/.test(d.weekdayCount)));

                // 「準備」「片付け」「会議」などの授業そのものではないキーワードをチェック
                const isUnrelatedKeyword = eventText.includes("準備") || eventText.includes("片付け") || eventText.includes("会議") || eventText.includes("設営") || eventText.includes("案内");

                if (isRelated) {
                    // 授業そのものに午前/午後がついている場合（例：【午前】火曜授業）
                    if (isMorningMatch) sessionInfo.hasPriorityMorning = true;
                    if (isAfternoonMatch) sessionInfo.hasPriorityAfternoon = true;
                } else if (!isUnrelatedKeyword) {
                    // 授業とは別の「行事」として午前/午後の指定がある場合（例：午後打ち切り、など）
                    if (isMorningMatch) sessionInfo.hasMorningIndicator = true;
                    if (isAfternoonMatch) sessionInfo.hasAfternoonIndicator = true;
                }
            });

            let isMorningOnly = false;
            let isAfternoonOnly = false;

            // 優先順位：授業そのものに指定があれば、そちらを優先する
            if (sessionInfo.hasPriorityMorning || sessionInfo.hasPriorityAfternoon) {
                isMorningOnly = sessionInfo.hasPriorityMorning && !sessionInfo.hasPriorityAfternoon;
                isAfternoonOnly = sessionInfo.hasPriorityAfternoon && !sessionInfo.hasPriorityMorning;
            } else {
                isMorningOnly = sessionInfo.hasMorningIndicator && !sessionInfo.hasAfternoonIndicator;
                isAfternoonOnly = sessionInfo.hasAfternoonIndicator && !sessionInfo.hasMorningIndicator;
            }

            const effectiveResult = getEffectivePeriods(schedule.period, isMorningOnly, isAfternoonOnly);
            if (!effectiveResult) return;

            const displayPeriod = effectiveResult.label;
            const activePeriods = effectiveResult.periods;

            // 時間の取得 (PERIOD_TIMESマスタから)
            const PERIOD_TIMES_LOCAL = window.PERIOD_TIMES || (typeof PERIOD_TIMES !== 'undefined' ? PERIOD_TIMES : {});
            let times = PERIOD_TIMES_LOCAL[displayPeriod];

            // 範囲指定（1-2限など）でマスタに直接ラベルがない場合は、最初と最後の時限を合成する
            if (!times && activePeriods && activePeriods.length > 0) {
                const firstTimes = PERIOD_TIMES_LOCAL[activePeriods[0]];
                const lastTimes = PERIOD_TIMES_LOCAL[activePeriods[activePeriods.length - 1]];
                if (firstTimes && lastTimes) {
                    times = { start: firstTimes.start, end: lastTimes.end };
                }
            }

            const startTimeStr = times ? times.start : (cls.startTime || "09:00");
            const endTimeStr = times ? times.end : (cls.endTime || "16:25");

            // 補講日チェック
            const isDayMakeup = allItemsForDay.some(d =>
                (d.event && d.event.includes('補講日')) ||
                (d.weekdayCount && d.weekdayCount.includes('補講日'))
            );
            let finalWeekdayCount = countStr;
            if (isDayMakeup && !finalWeekdayCount.includes('補講日')) {
                finalWeekdayCount = finalWeekdayCount ? `${finalWeekdayCount} (補講日)` : '補講日';
            }

            events.push({
                ...cls,
                id: cls.id,
                type: 'myclass',
                date: new Date(date),
                startTime: startTimeStr,
                endTime: endTimeStr,
                period: displayPeriod,
                displayPeriod: displayPeriod,
                isTruncated: effectiveResult.isTruncated,
                originalPeriod: schedule.period,
                semester: getSemesterLabel(date) === 'first' ? '前期' : '後期',
                weekdayCount: finalWeekdayCount,
                allDay: false,
                isStandard: true
            });
        });
    });

    // 移動先
    window.classOverrides.forEach(ov => {
        if (ov.type === 'myclass' && ov.action === 'move' && ov.data) {
            const date = parseDateKey(ov.date);
            const fiscalYear = getFiscalYear(date);
            if (fiscalYear !== year) return;

            const cls = ov.data;
            const dateStr = ov.date;

            if (!includeExclusions) {
                const excludedDates = assignmentExclusions[cls.id] || [];
                if (excludedDates.includes(dateStr)) return;
            }

            const allItemsForTarget = sourceData.filter(d => formatDateKey(d.date) === dateStr);
            const weekdayCountItem = allItemsForTarget.find(d => d.weekdayCount);
            const countStr = weekdayCountItem ? weekdayCountItem.weekdayCount : "";

            const hasMorningMarkerTarget = allItemsForTarget.some(d => {
                const text = (d.event || "") + (d.name || "") + (d.weekdayCount || "");
                return (text.includes("午前") && !text.includes("午前打ち切り")) || text.includes("午後打ち切り") || text.includes("●");
            });
            const hasAfternoonMarkerTarget = allItemsForTarget.some(d => {
                const text = (d.event || "") + (d.name || "") + (d.weekdayCount || "");
                return (text.includes("午後") && !text.includes("午後打ち切り")) || text.includes("午前打ち切り");
            });

            const isMorningOnly = hasMorningMarkerTarget && !hasAfternoonMarkerTarget;
            const isAfternoonOnly = hasAfternoonMarkerTarget && !hasMorningMarkerTarget;

            const effectiveResult = getEffectivePeriods(ov.period, isMorningOnly, isAfternoonOnly);
            if (!effectiveResult) return;

            const displayPeriod = effectiveResult.label;
            const activePeriods = effectiveResult.periods;
            const PERIOD_TIMES_LOCAL = window.PERIOD_TIMES || (typeof PERIOD_TIMES !== 'undefined' ? PERIOD_TIMES : {});
            let times = PERIOD_TIMES_LOCAL[displayPeriod];

            if (!times && activePeriods && activePeriods.length > 0) {
                const firstTimes = PERIOD_TIMES_LOCAL[activePeriods[0]];
                const lastTimes = PERIOD_TIMES_LOCAL[activePeriods[activePeriods.length - 1]];
                if (firstTimes && lastTimes) {
                    times = { start: firstTimes.start, end: lastTimes.end };
                }
            }

            const startTimeStr = times ? times.start : (cls.startTime || '09:00');
            const endTimeStr = times ? times.end : (cls.endTime || '10:35');

            const isTargetMakeup = allItemsForTarget.some(d =>
                (d.event && d.event.includes('補講日')) ||
                (d.weekdayCount && d.weekdayCount.includes('補講日'))
            );

            let finalTargetCount = countStr;
            if (isTargetMakeup && !finalTargetCount.includes('補講日')) {
                finalTargetCount = finalTargetCount ? `${finalTargetCount} (補講日)` : '補講日';
            }
            if (!finalTargetCount && !isTargetMakeup) {
                finalTargetCount = '[移動]';
            }

            events.push({
                ...cls,
                id: cls.id || ov.id,
                type: 'myclass',
                date: new Date(date),
                startTime: startTimeStr,
                endTime: endTimeStr,
                period: displayPeriod,
                displayPeriod: displayPeriod,
                isTruncated: effectiveResult.isTruncated,
                originalPeriod: ov.period || cls.originalPeriod,
                semester: getSemesterLabel(date) === 'first' ? '前期' : '後期',
                weekdayCount: finalTargetCount,
                allDay: !!cls.allDay,
                isMoved: true,
                isStandard: true
            });
        }
    });

    return events;
}

/**
 * scheduleData に自分の授業イベントを統合して更新する
 */
function updateScheduleDataWithClasses(targetYear = null) {
    if (typeof generateClassEvents !== 'function') return;

    // キャッシュをクリア（月ごとのバッチ判定などをリセット）
    window._monthHasCountCache = new Map();

    try {
        if (window.scheduleData) {
            // 既存の授業イベント（fromMyClassフラグ付き）を除去
            let otherEvents = window.scheduleData.filter(item => !item.fromMyClass);

            // scheduleData に含まれる全年度を特定
            const years = new Set();

            // 引数で指定があれば追加
            if (targetYear !== null && !isNaN(targetYear)) {
                years.add(Number(targetYear));
            }

            otherEvents.forEach(item => {
                const d = item.date instanceof Date ? item.date : new Date(item.date);
                const fy = getFiscalYear(d);
                if (fy) years.add(fy);
            });

            // 現在表示中の年月から年度を特定（1-3月なら前年が年度）
            if (typeof currentYear !== 'undefined' && currentYear && typeof currentMonth !== 'undefined') {
                const cy = parseInt(currentYear);
                const cm = parseInt(currentMonth);
                const viewDate = new Date(cy, cm - 1, 1);
                const fy = getFiscalYear(viewDate);
                if (fy && !isNaN(fy)) years.add(fy);
            }

            // 年度指定が全くない場合（初期状態など）は現在の年度を対象にする
            if (years.size === 0) {
                const cy = getFiscalYear(new Date());
                years.add(cy);
            }

            let allMyClassEvents = [];
            years.forEach(y => {
                allMyClassEvents = allMyClassEvents.concat(generateClassEvents(y));
            });

            // 月ごとの計画キャッシュをクリア
            if (window._monthHasCountCache) window._monthHasCountCache.clear();

            window.scheduleData = otherEvents.concat(allMyClassEvents.map(ev => ({ ...ev, fromMyClass: true })));
            console.log(`scheduleDataを更新しました: 対象年度 [${Array.from(years).join(', ')}] 総数 ${window.scheduleData.length} (うち授業 ${allMyClassEvents.length})`);
        }
    } catch (e) {
        console.error('updateScheduleDataWithClasses failed:', e);
    }
}
window.updateScheduleDataWithClasses = updateScheduleDataWithClasses;


// グローバルスコープに登録
window.getAllMyClasses = getAllMyClasses;
window.generateClassEvents = generateClassEvents;

// =============================
// カレンダーへの統合用関数
// =============================

/**
 * 特定の日付に対して表示可能なマイクラス（授業）のリストを整理して取得する
 */
window.getDisplayableClassesForDate = function (date, dayEvents = null) {
    const dateStr = formatDateKey(date);

    // scheduleData からその日の「自分の授業」を抽出する（既に generateClassEvents で計算済み）
    const classes = (window.scheduleData || []).filter(item =>
        item.fromMyClass && formatDateKey(item.date) === dateStr
    );

    if (classes.length > 0) {
        return classes.map(cls => ({
            ...cls,
            // app.js 等の古い表示ロジックとの互換性のため、必要なフィールドを整理
            period: cls.period || cls.displayPeriod,
            displayPeriod: cls.displayPeriod,
            startTime: cls.startTime,
            endTime: cls.endTime,
            isStandard: true
        }));
    }

    // 万が一、scheduleData に入っていない場合（初期化タイミングなど）のフォールバック
    // ただし、基本的には上記のキャッシュで完結させるのがユーザーの要望
    return [];
}

/**
 * カレンダーのセルに授業を表示
 */
window.addMyClassesToDayCell = function (dayCell, date, dayEvents, laneMap = new Map()) {
    const displayClasses = getDisplayableClassesForDate(date, dayEvents);
    const dateStr = formatDateKey(date);
    const eventsContainer = dayCell.querySelector('.day-events');
    if (!eventsContainer) return;

    displayClasses.forEach(cls => {
        const periodKey = cls.displayPeriod || cls.originalPeriod;
        const PERIOD_TIMES_LOCAL = window.PERIOD_TIMES || (typeof PERIOD_TIMES !== 'undefined' ? PERIOD_TIMES : {});
        let times = PERIOD_TIMES_LOCAL[periodKey];

        if (!times && typeof periodKey === 'string' && periodKey.includes('-')) {
            const parts = periodKey.replace(/\(.*\)/, '').split('-');
            const first = PERIOD_TIMES_LOCAL[parts[0].trim()];
            const last = PERIOD_TIMES_LOCAL[parts[parts.length - 1].trim()];
            if (first && last) times = { start: first.start, end: last.end };
        }
        if (!times) times = { start: '--:--', end: '--:--' };

        const eventItem = document.createElement('div');
        eventItem.className = 'event-item my-class';

        // 参加状況
        let assignmentExclusions = JSON.parse(localStorage.getItem('assignmentExclusions') || '{}');
        let classExclusions = assignmentExclusions[cls.id] || [];
        if (!classExclusions.includes(dateStr)) {
            eventItem.classList.add('is-participating');
        }

        // 表示順（レーン）の固定
        const laneIndex = laneMap.get(`${cls.id}-${cls.originalPeriod}-${dateStr}`);
        if (laneIndex !== undefined) {
            eventItem.style.gridRow = laneIndex + 1;
        }

        const truncatedLabel = cls.isTruncated ? '<span class="truncated-badge" style="color:#ff4d4f; font-weight:bold; font-size:0.8em;">(打ち切り)</span>' : '';
        if (cls.isTruncated) eventItem.classList.add('truncated-event');

        eventItem.innerHTML = `
            <span class="event-text">${times.start}～${times.end} ${cls.name} (${cls.displayPeriod})${truncatedLabel}</span>
            <button class="event-delete-btn" onclick="deleteCalendarEvent(event, 'myclass', '${cls.id}', '${dateStr}', '${cls.originalPeriod}')" title="この日だけ削除">×</button>
        `;

        eventItem.draggable = true;
        eventItem.dataset.classId = cls.id;
        eventItem.dataset.type = 'myclass';
        eventItem.dataset.date = dateStr;
        eventItem.dataset.period = cls.originalPeriod;

        eventItem.addEventListener('dblclick', () => editCalendarEvent('myclass', cls.id, dateStr, cls.originalPeriod));
        eventItem.oncontextmenu = (e) => {
            if (typeof showEventContextMenu === 'function') {
                showEventContextMenu(e, 'myclass', cls.id, dateStr, cls.originalPeriod);
            }
        };
        eventItem.addEventListener('dragstart', handleEventDragStart);

        eventsContainer.appendChild(eventItem);
    });
}

// 初期化を起動（app.jsから呼ばれるが、単体でも動作するように残す）
document.addEventListener('DOMContentLoaded', () => {
    if (typeof initializeMyClasses === 'function') initializeMyClasses();
});

// 日程表を表示 (既存機能を維持)
window.showClassSchedule = function (classId = null, options = {}) {
    console.log('日程表表示処理を開始します...');
    const isIndividualClass = !!classId;
    options = { showAnnual: !isIndividualClass, showMyClass: true, showCustom: !isIndividualClass, ...options };
    currentScheduleClassId = classId;

    const modal = document.getElementById('classScheduleModal');
    const tbody = document.getElementById('classScheduleBody');
    const modalTitle = modal ? modal.querySelector('.modal-header h2') : null;

    if (!modal || !tbody) {
        console.error('モーダルまたはテーブルボディが見つかりません');
        return;
    }
    // フィルタ状態の取得 (引数がない場合はDOMから、ある場合は引数を優先)
    const showAnnual = options.showAnnual;
    const showMyClass = options.showMyClass;
    const showCustom = options.showCustom;

    // 対象年度を決定
    // 1. グローバルの年度選択 (globalYearSelect)
    // 対象年度を決定
    let targetYear;
    const globalYearSelect = document.getElementById('globalYearSelect');

    if (globalYearSelect && globalYearSelect.value) {
        targetYear = parseInt(globalYearSelect.value);
    } else {
        try {
            // currentYear は app.js で定義されている可能性があるため window から取得を試みる
            const cYear = typeof window.currentYear !== 'undefined' ? window.currentYear : null;
            targetYear = (cYear && !isNaN(cYear)) ? cYear : (typeof window.getFiscalYear === 'function' ? window.getFiscalYear(new Date()) : new Date().getFullYear());
        } catch (e) {
            console.warn('年度の取得に失敗しました', e);
            targetYear = new Date().getFullYear();
        }
    }
    if (!targetYear || isNaN(targetYear)) targetYear = new Date().getFullYear();

    // タイトルを更新
    if (modalTitle) {
        if (classId) {
            const cls = myClasses.find(c => c.id === classId);
            const className = cls ? cls.name : '指定授業';
            modalTitle.textContent = `授業日程表: ${className} (${targetYear}年度)`;
            const csvBtn = document.getElementById('csvExportScheduleBtn');
            if (csvBtn) csvBtn.dataset.classId = classId;
        } else {
            modalTitle.textContent = `授業日程表(${targetYear}年度)`;
            const csvBtn = document.getElementById('csvExportScheduleBtn');
            if (csvBtn) delete csvBtn.dataset.classId;
        }
    }
    // フィルターの初期化（全日程表の場合のみ）
    if (!classId && typeof initializeScheduleFilters === 'function') {
        initializeScheduleFilters(targetYear, classId, options);
    }

    // 個別授業の場合はフィルターコンテナを非表示
    const filterContainer = document.getElementById('filterControlsContainer');
    if (filterContainer) {
        filterContainer.style.display = classId ? 'none' : 'flex';
    }

    // 1. 各ソースからデータを収集
    let classEvents = [];
    let annualEvents = [];
    let customEvents = [];

    // --- 授業データ生成 ---
    if (showMyClass) {
        classEvents = typeof window.generateClassEvents === 'function' ? window.generateClassEvents(targetYear, { includeExclusions: true }) : [];
        if (classId) {
            classEvents = classEvents.filter(item => String(item.id) === String(classId));
        }
    }

    // --- 年間行事 & オリジナル予定取得 ---
    if (typeof window.getAppliedScheduleData === 'function') {
        const appliedData = window.getAppliedScheduleData('both');

        // 年度フィルタの作成 (4/1 ～ 3/31)
        const fiscalStart = typeof window.getFiscalYearStart === 'function' ? window.getFiscalYearStart(targetYear) : new Date(targetYear, 3, 1);
        const fiscalEnd = typeof window.getFiscalYearEnd === 'function' ? window.getFiscalYearEnd(targetYear) : new Date(targetYear + 1, 2, 31, 23, 59, 59);

        // 分離 & 年度フィルタ適用
        if (showAnnual) {
            annualEvents = appliedData.filter(item => {
                if (!((item.type === 'teacher' || item.type === 'student' || item.type === 'excel') &&
                    item.date >= fiscalStart && item.date <= fiscalEnd)) return false;

                // 祝日は除外
                if (typeof window.isRedundantHoliday === 'function' && window.isRedundantHoliday(item.event, item.date)) {
                    return false;
                }

                return true;
            });
        }
        if (showCustom) {
            customEvents = appliedData.filter(item =>
                (item.type === 'custom' || item.isCustom) &&
                item.date >= fiscalStart && item.date <= fiscalEnd
            );
        }

        // クラス別フィルタリングの適用
        if (classId) {
            const targetCls = myClasses.find(c => String(c.id) === String(classId));
            if (targetCls) {
                // 年間行事は対象学年・クラスで絞る
                annualEvents = annualEvents.filter(item => {
                    const isSameGrade = item.targetGrade === targetCls.targetGrade;
                    const isSameClass = item.targetClass === targetCls.targetClass;
                    return (item.targetType === 'grade' && isSameGrade) || (isSameGrade && isSameClass);
                });
                // カスタム予定は「共通」扱いの想定だが、科目別日程表では混乱を招くため除外する
                customEvents = [];
            }
        }
    }

    // すべてを統合
    let scheduleData = [...classEvents, ...annualEvents, ...customEvents];

    scheduleData = scheduleData.filter(item => item && (item.name || item.event));

    // 重要：日付順に並び替え
    scheduleData.sort((a, b) => a.date - b.date);
    console.log(`データ構築完了: 合計 ${scheduleData.length} 件`);




    // テーブルヘッダーを更新（チェックボックス列を追加）
    const thead = modal.querySelector('table.schedule-table thead');
    if (thead) {
        thead.innerHTML = `
            <tr>
                <th style="width: 40px;" title="実施/担当設定（\uD83D\uDCCCマークの日付を優先）">\uD83D\uDCCC</th>
                <th style="width: 80px;">日付</th>
                <th style="width: 40px;">曜</th>
                <th style="width: 50px;">時限</th>
                <th style="width: 110px;">時間</th>
                <th>授業名</th>
                <th>クラス</th>
                <th>場所</th>
                <th>備考</th>
            </tr>
        `;
    }

    // テーブルをクリア
    tbody.innerHTML = '';


    if (scheduleData.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" class="center">授業予定が見つかりません。授業を登録するか、Excelファイルを読み込んでください。</td></tr>`;
    } else {
        // 日付順にソート (generateClassEventsですでにソートされているはずだが念のため)
        scheduleData.sort((a, b) => a.date - b.date);

        const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
        let lastMonth = -1;
        let lastWeekKey = null;

        const getWeekKey = (d) => {
            const date = new Date(d);
            date.setHours(0, 0, 0, 0);
            const day = date.getDay();
            const diff = date.getDate() - day + (day === 0 ? -6 : 1);
            const monday = new Date(date.setDate(diff));
            return monday.toDateString();
        };

        scheduleData.forEach(item => {
            const currentMonth = item.date.getMonth();
            const currentWeekKey = getWeekKey(item.date);

            // 月の区切り
            if (currentMonth !== lastMonth) {
                const monthRow = document.createElement('tr');
                monthRow.className = 'month-delim-row';
                monthRow.innerHTML = `<td colspan="9">${currentMonth + 1}月</td>`;
                tbody.appendChild(monthRow);
                lastMonth = currentMonth;
                lastWeekKey = currentWeekKey; // 月替わりの時は週の区切りをスキップ
            }
            // 週の区切り (月曜始まりを想定)
            else if (currentWeekKey !== lastWeekKey) {
                const weekRow = document.createElement('tr');
                weekRow.className = 'week-delim-row';
                weekRow.innerHTML = `<td colspan="9"></td>`;
                tbody.appendChild(weekRow);
                lastWeekKey = currentWeekKey;
            }

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

            let targetLabel = '';
            if (item.targetGrade) {
                targetLabel = item.targetType === 'grade'
                    ? `${item.targetGrade}年全体`
                    : item.targetGrade === 1
                        ? `${item.targetGrade}-${item.targetClass}`
                        : `${item.targetGrade}${item.targetClass}`;
            } else if (item.type === 'teacher' || item.type === 'student' || item.type === 'excel' || item.type === 'custom') {
                targetLabel = item.type === 'student' ? '専攻科共通' : '共通行事';
            }

            let colorStyle = '';
            if (weekday === 0) colorStyle = 'color: red; font-weight: bold;';
            else if (weekday === 6) colorStyle = 'color: blue; font-weight: bold;';

            let remark = item.weekdayCount || '';
            if (item.memo) {
                remark = remark ? `${remark} / ${item.memo}` : item.memo;
            }

            // 日付キーを作成 (YYYY-MM-DD形式)
            const dateKey = typeof window.formatDateKey === 'function' ? window.formatDateKey(item.date) : `${item.date.getFullYear()}-${String(item.date.getMonth() + 1).padStart(2, '0')}-${String(item.date.getDate()).padStart(2, '0')}`;
            const classIdToUse = item.id || classId;

            // チェックボックスの状態を取得 (カレンダーのピン状態と同期)
            let isChecked = false;
            const exclusions = JSON.parse(localStorage.getItem('assignmentExclusions') || '{}');
            const itemExclusions = exclusions[classIdToUse] || [];

            if (item.type === 'myclass') {
                // 授業はデフォルトで「担当（ピンあり）」、除外にあれば「非参加（なし）」
                isChecked = !itemExclusions.includes(dateKey);
            } else {
                // 行事・オリジナル予定：カレンダーのロジックと合わせる
                const ov = (typeof classOverrides !== 'undefined' ? classOverrides : []).find(o =>
                    (o.type === 'excel' || o.type === 'custom') &&
                    String(o.id) === String(classIdToUse) &&
                    (o.date === dateKey || (o.startDate <= dateKey && o.endDate >= dateKey)) &&
                    o.action === 'move' && o.data
                );

                if (ov && ov.data.isParticipating !== undefined) {
                    isChecked = !!ov.data.isParticipating;
                } else {
                    // 除外リストにあるなら強制的にFalse
                    if (itemExclusions.includes(dateKey)) {
                        isChecked = false;
                    } else {
                        // デフォルトでピン付けするキーワード
                        const name = item.name || item.event || "";
                        isChecked = window.containsPinnedKeyword(name);
                    }
                }
            }

            if (item.type === 'custom' || item.isCustom) {
                tr.classList.add('item-custom');
            }
            if (item.type === 'myclass') {
                tr.classList.add('item-myclass');
            }

            tr.innerHTML = `
                <td class="center">
                    <input type="checkbox" class="schedule-checkbox" data-class-id="${classIdToUse}" data-date-key="${dateKey}" ${isChecked ? 'checked' : ''}>
                </td>
                <td>${dateStr}</td>

                <td style="${colorStyle}">${weekdayStr}</td>
                <td class="center">${item.period || ''}</td>
                <td class="center">${timeRange}</td>
                <td>${item.name || item.event || ''}</td>
                <td>${targetLabel}</td>
                <td>${item.location || ''}</td>
                <td>${remark}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    // モーダルを表示
    modal.classList.remove('hidden');

    // チェックボックスのイベントリスナーを設定
    const checkboxes = tbody.querySelectorAll('.schedule-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const classIdToSave = e.target.dataset.classId;
            const dateKeyToSave = e.target.dataset.dateKey;

            // assignmentExclusionsオブジェクトを取得または初期化
            let assignmentExclusions = JSON.parse(localStorage.getItem('assignmentExclusions') || '{}');
            if (!assignmentExclusions[classIdToSave]) {
                assignmentExclusions[classIdToSave] = [];
            }

            // チェックOFF（担当しない）の場合、除外リストに追加
            if (!e.target.checked) {
                if (!assignmentExclusions[classIdToSave].includes(dateKeyToSave)) {
                    assignmentExclusions[classIdToSave].push(dateKeyToSave);
                }
            } else {
                // チェックON（担当する）の場合、除外リストから削除
                assignmentExclusions[classIdToSave] = assignmentExclusions[classIdToSave].filter(d => d !== dateKeyToSave);
            }

            // localStorageに保存
            localStorage.setItem('assignmentExclusions', JSON.stringify(assignmentExclusions));

            if (typeof updateCalendar === 'function') {
                updateCalendar();
            }
        });
    });
}
window.showClassSchedule = showClassSchedule;

function closeClassScheduleModal() {
    const modal = document.getElementById('classScheduleModal');
    if (modal) modal.classList.add('hidden');
}
window.closeClassScheduleModal = closeClassScheduleModal;

/**
 * 年休候補日を表示
 */
function showVacationCandidates() {
    console.log('年休候補日の抽出を開始します...');
    const modal = document.getElementById('vacationCandidateModal');
    const tbody = document.getElementById('vacationCandidateBody');
    if (!modal || !tbody) return;

    let targetYear;
    const globalYearSelect = document.getElementById('globalYearSelect');
    if (globalYearSelect && globalYearSelect.value) {
        targetYear = parseInt(globalYearSelect.value);
    } else {
        targetYear = typeof currentYear !== 'undefined' && currentYear ? currentYear : (new Date().getMonth() + 1 >= 4 ? new Date().getFullYear() : new Date().getFullYear() - 1);
    }

    tbody.innerHTML = '<tr><td colspan="4" class="center">抽出中...</td></tr>';
    modal.classList.remove('hidden');

    setTimeout(() => {
        const fiscalStart = typeof window.getFiscalYearStart === 'function' ? window.getFiscalYearStart(targetYear) : new Date(targetYear, 3, 1);
        const fiscalEnd = typeof window.getFiscalYearEnd === 'function' ? window.getFiscalYearEnd(targetYear) : new Date(targetYear + 1, 2, 31);
        const candidates = [];

        const holidaysMap = typeof window.getHolidaysForYear === 'function' ? window.getHolidaysForYear(targetYear) : new Map();

        const classEvents = typeof window.generateClassEvents === 'function' ? window.generateClassEvents(targetYear, { includeExclusions: true }) : [];
        const appliedData = typeof window.getAppliedScheduleData === 'function' ? window.getAppliedScheduleData('both') : [];
        const assignmentExclusions = JSON.parse(localStorage.getItem('assignmentExclusions') || '{}');

        // 1日ずつチェック
        for (let d = new Date(fiscalStart); d <= fiscalEnd; d.setDate(d.getDate() + 1)) {
            const dateObj = new Date(d);
            const dateKey = typeof window.formatDateKey === 'function' ? window.formatDateKey(dateObj) : `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
            const weekday = dateObj.getDay();
            const isHolidayDay = typeof window.getHolidayName === 'function' && window.getHolidayName(dateObj, holidaysMap);

            // 日曜・祝日は除外
            if (weekday === 0 || isHolidayDay) continue;

            // ピン留め判定のインライン（高速化）
            let isPinned = false;
            let eventsOnThisDay = [];

            // 1. 授業のチェック
            const classOnThisDay = classEvents.filter(item => (typeof window.formatDateKey === 'function' ? window.formatDateKey(item.date) : '') === dateKey);
            if (classOnThisDay.some(cls => {
                const classExclusions = assignmentExclusions[cls.id] || [];
                const isAssigned = !classExclusions.includes(dateKey);
                if (isAssigned) return true;
                return false;
            })) {
                isPinned = true;
            }

            // 2. 行事・カスタム予定のチェック
            if (appliedData.length > 0) {
                eventsOnThisDay = appliedData.filter(item => (typeof window.formatDateKey === 'function' ? window.formatDateKey(item.date) : '') === dateKey);

                if (eventsOnThisDay.some(item => {
                    const ov = (typeof classOverrides !== 'undefined' ? classOverrides : []).find(o =>
                        (o.type === 'excel' || o.type === 'custom') &&
                        String(o.id) === String(item.id) &&
                        (o.date === dateKey || (o.startDate <= dateKey && o.endDate >= dateKey))
                    );
                    if (ov && ov.data && ov.data.isParticipating !== undefined) {
                        return ov.data.isParticipating;
                    }
                    const name = item.event || item.name || "";
                    if (window.containsPinnedKeyword(name)) return true;
                    return false;
                })) {
                    isPinned = true;
                }
            }

            if (!isPinned) {
                // 土曜日の場合、授業日設定がないなら休み
                if (weekday === 6) continue;

                // 行事名を文字列化
                const refEventsRaw = eventsOnThisDay.map(e => e.event || e.name || "").filter(n => n);
                // 授業名も追加したければ（不参加の授業）
                const unpinnedClasses = classOnThisDay.map(c => c.name).filter(n => n);
                const allRefNames = [...new Set([...refEventsRaw, ...unpinnedClasses])].join('、');

                candidates.push({
                    date: new Date(dateObj),
                    refEvents: allRefNames
                });
            }
        }

        tbody.innerHTML = '';
        if (candidates.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="center">年休候補日（フリーな営業日）は見つかりませんでした。</td></tr>';
        } else {
            const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
            let lastMonth = -1;
            let lastWeekKey = null;

            const getWeekKey = (d) => {
                const date = new Date(d);
                date.setHours(0, 0, 0, 0);
                const day = date.getDay();
                const diff = date.getDate() - day + (day === 0 ? -6 : 1);
                const monday = new Date(date.setDate(diff));
                return monday.toDateString();
            };

            candidates.forEach(item => {
                const date = item.date;
                const currentMonth = date.getMonth();
                const currentWeekKey = getWeekKey(date);

                // 月の区切り
                if (currentMonth !== lastMonth) {
                    const monthRow = document.createElement('tr');
                    monthRow.className = 'month-delim-row';
                    monthRow.innerHTML = `<td colspan="4">${currentMonth + 1}月</td>`;
                    tbody.appendChild(monthRow);
                    lastMonth = currentMonth;
                    lastWeekKey = currentWeekKey;
                }
                // 週の区切り
                else if (currentWeekKey !== lastWeekKey) {
                    const weekRow = document.createElement('tr');
                    weekRow.className = 'week-delim-row';
                    weekRow.innerHTML = `<td colspan="4"></td>`;
                    tbody.appendChild(weekRow);
                    lastWeekKey = currentWeekKey;
                }

                const tr = document.createElement('tr');
                const dateStr = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
                const weekdayStr = weekdays[date.getDay()];
                tr.innerHTML = `
                    <td>${dateStr}</td>
                    <td class="center">${weekdayStr}</td>
                    <td style="font-size: 0.85rem; color: #666;">${item.refEvents || '-'}</td>
                    <td>-</td>
                `;
                tbody.appendChild(tr);
            });
        }
    }, 10);
}
window.showVacationCandidates = showVacationCandidates;

function closeVacationCandidateModal() {
    const modal = document.getElementById('vacationCandidateModal');
    if (modal) modal.classList.add('hidden');
}
window.closeVacationCandidateModal = closeVacationCandidateModal;

// 日程表フィルターの初期化とイベント設定
function initializeScheduleFilters(targetYear, classId, options) {
    const annualCheck = document.getElementById('filterAnnualEvents');
    const myClassCheck = document.getElementById('filterMyClasses');
    const customCheck = document.getElementById('filterCustomEvents');

    if (!annualCheck || !myClassCheck || !customCheck) return;

    // 初期状態を同期
    annualCheck.checked = options.showAnnual !== false;
    myClassCheck.checked = options.showMyClass !== false;
    customCheck.checked = options.showCustom !== false;

    // 再描画をトリガーする関数
    const refreshTable = () => {
        showClassSchedule(classId, {
            showAnnual: annualCheck.checked,
            showMyClass: myClassCheck.checked,
            showCustom: customCheck.checked
        });
    };

    // リスナー設定（datasetで重複ガード）
    [annualCheck, myClassCheck, customCheck].forEach(chk => {
        if (!chk.dataset.filterSet) {
            chk.addEventListener('change', refreshTable);
            chk.dataset.filterSet = 'true';
        }
    });
}

/**
 * 年休候補日の判定・抽出
 * \uD83D\uDCCC（ピン）マークがつく要素：
 * 1. 参加チェックを入れたExcel行事/オリジナル予定
 * 2. 📌マークのついた授業
 * 3. デフォルトでピン付けされるキーワード（教職員会議、コース会議）を含む予定
 */
function isDatePinned(date, classId) {
    if (!date) return false;
    const dateKey = typeof window.formatDateKey === 'function' ? window.formatDateKey(date) : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

    // 1. 授業のチェック
    const fy = typeof window.getFiscalYear === 'function' ? window.getFiscalYear(date) : (date.getMonth() + 1 >= 4 ? date.getFullYear() : date.getFullYear() - 1);
    let classEvents = typeof window.generateClassEvents === 'function' ? window.generateClassEvents(fy, { includeExclusions: true }) : [];
    const classOnThisDay = classEvents.filter(item => (typeof window.formatDateKey === 'function' ? window.formatDateKey(item.date) : '') === dateKey);

    // 授業のピン（担当中）
    const isClassPinned = classOnThisDay.some(cls => {
        // classIdが指定されている場合はその授業のみ、指定されていない場合は全授業をチェック
        if (classId && String(cls.id) !== String(classId)) return false;
        const exclusions = JSON.parse(localStorage.getItem('assignmentExclusions') || '{}');
        const classExclusions = exclusions[cls.id] || [];
        return !classExclusions.includes(dateKey);
    });
    if (isClassPinned) return true;

    // 2. 行事・カスタム予定のチェック
    if (typeof window.getAppliedScheduleData === 'function') {
        const appliedData = window.getAppliedScheduleData('both');
        const eventsOnThisDay = appliedData.filter(item => (typeof window.formatDateKey === 'function' ? window.formatDateKey(item.date) : '') === dateKey);

        // 行事そのものがなくても、その日が祝日ならピン留め扱いとする（年休候補から外す）
        const holidaysMap = typeof window.getHolidaysForYear === 'function' ? window.getHolidaysForYear(date.getFullYear()) : null;
        if (holidaysMap && typeof window.getHolidayName === 'function' && window.getHolidayName(date, holidaysMap)) {
            return true;
        }

        const isEventPinned = eventsOnThisDay.some(item => {
            // overrideチェック (Excel or Custom)
            const ov = classOverrides.find(o =>
                (o.type === 'excel' || o.type === 'custom') &&
                String(o.id) === String(item.id) &&
                (o.date === dateKey || (o.startDate <= dateKey && o.endDate >= dateKey)) &&
                o.action === 'move' &&
                o.data
            );

            if (ov && ov.data.isParticipating !== undefined) {
                return ov.data.isParticipating;
            }

            // 除外リストをチェック
            const exclusions = JSON.parse(localStorage.getItem('assignmentExclusions') || '{}');
            const itemExclusions = exclusions[item.id] || [];
            if (itemExclusions.includes(dateKey)) {
                return false;
            }

            // キーワードチェック
            const name = item.event || item.name || "";
            if (window.containsPinnedKeyword(name)) {
                return true;
            }

            // 祝日冗長チェック
            if (typeof window.isRedundantHoliday === 'function' && window.isRedundantHoliday(name, date)) {
                return true;
            }

            return false;
        });

        if (isEventPinned) return true;
    }

    return false;
}

// 日程表をCSV出力
function exportClassScheduleCsv() {
    // ボタンからclassIdを取得
    const csvBtn = document.getElementById('csvExportScheduleBtn');
    const classId = csvBtn && csvBtn.dataset.classId ? parseInt(csvBtn.dataset.classId) : null;

    // 対象年度を決定
    let targetYear;
    const globalYearSelect = document.getElementById('globalYearSelect');
    if (globalYearSelect && globalYearSelect.value) {
        targetYear = parseInt(globalYearSelect.value);
    } else {
        const cYear = typeof window.currentYear !== 'undefined' ? window.currentYear : null;
        targetYear = (cYear && !isNaN(cYear)) ? cYear : (typeof window.getFiscalYear === 'function' ? window.getFiscalYear(new Date()) : (new Date().getMonth() + 1 >= 4 ? new Date().getFullYear() : new Date().getFullYear() - 1));
    }

    // フィルタ状態の取得
    const showAnnual = document.getElementById('filterAnnualEvents')?.checked ?? true;
    const showMyClass = document.getElementById('filterMyClasses')?.checked ?? true;
    const showCustom = document.getElementById('filterCustomEvents')?.checked ?? true;

    // 1. 各ソースからデータを収集
    let classEvents = [];
    let annualEvents = [];
    let customEvents = [];

    if (showMyClass) {
        classEvents = typeof window.generateClassEvents === 'function' ? window.generateClassEvents(targetYear, { includeExclusions: false }) : [];
        if (classId) {
            classEvents = classEvents.filter(item => String(item.id) === String(classId));
        }
    }

    if (typeof window.getAppliedScheduleData === 'function') {
        const appliedData = window.getAppliedScheduleData('both');

        // 年度フィルタの作成 (4/1 ～ 3/31)
        const fiscalStart = new Date(targetYear, 3, 1);
        const fiscalEnd = new Date(targetYear + 1, 2, 31, 23, 59, 59);

        if (showAnnual) {
            annualEvents = appliedData.filter(item => {
                if (!((item.type === 'teacher' || item.type === 'student' || item.type === 'excel') &&
                    item.date >= fiscalStart && item.date <= fiscalEnd)) return false;

                // 祝日は除外
                if (typeof window.isRedundantHoliday === 'function' && window.isRedundantHoliday(item.event, item.date)) {
                    return false;
                }

                return true;
            });
        }
        if (showCustom) {
            customEvents = appliedData.filter(item =>
                (item.type === 'custom' || item.isCustom) &&
                item.date >= fiscalStart && item.date <= fiscalEnd
            );
        }

        if (classId) {
            const targetCls = myClasses.find(c => String(c.id) === String(classId));
            if (targetCls) {
                annualEvents = annualEvents.filter(item => {
                    const isSameGrade = item.targetGrade === targetCls.targetGrade;
                    const isSameClass = item.targetClass === targetCls.targetClass;
                    return (item.targetType === 'grade' && isSameGrade) || (isSameGrade && isSameClass);
                });
            }
        }
    }

    let scheduleData = [...classEvents, ...annualEvents, ...customEvents];
    // 授業名・行事名が空欄の予定を除外
    scheduleData = scheduleData.filter(item => item && (item.name || item.event));


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

        let targetLabel = '';
        if (item.targetGrade) {
            targetLabel = item.targetType === 'grade'
                ? `${item.targetGrade}年全体`
                : item.targetGrade === 1
                    ? `${item.targetGrade}-${item.targetClass}`
                    : `${item.targetGrade}${item.targetClass}`;
        } else if (item.type === 'teacher' || item.type === 'student' || item.type === 'excel' || item.type === 'custom' || item.isCustom) {
            targetLabel = item.type === 'student' ? '専攻科共通' : '共通行事';
        }

        rows.push([
            dateStr,
            weekdayStr,
            item.period,
            formatTime(item.startTime),
            formatTime(item.endTime),
            item.name || item.event || '',
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
        const fileName = classId ? `授業日程表_${scheduleData[0].name}_${targetYear}年度.csv` : `授業日程表_${targetYear}年度.csv`;
        link.setAttribute('href', url);
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
    if (scheduleEventListenersInitialized) {
        console.log('日程表イベントリスナーは既に設定済みです');
        return;
    }

    console.log('日程表イベントリスナーを設定中...');
    const showBtn = document.getElementById('showClassScheduleBtn');
    const modal = document.getElementById('classScheduleModal');

    if (showBtn) {
        showBtn.addEventListener('click', function (e) {
            console.log('「日程表を表示」ボタンがクリックされました');
            showClassSchedule();
        });
        console.log('「日程表を表示」ボタンにイベントを設定しました');
    }

    const vacationBtn = document.getElementById('showVacationCandidatesBtn');
    if (vacationBtn) {
        vacationBtn.addEventListener('click', function (e) {
            console.log('「年休候補日を抽出」ボタンがクリックされました');
            showVacationCandidates();
        });
    }

    if (modal) {
        window.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeClassScheduleModal();
            }
        });
    }

    const vacationModal = document.getElementById('vacationCandidateModal');
    if (vacationModal) {
        window.addEventListener('click', (e) => {
            if (e.target === vacationModal) {
                closeVacationCandidateModal();
            }
        });
    }

    // フィルター用イベントリスナー
    const filters = ['filterAnnualEvents', 'filterMyClasses', 'filterCustomEvents'];
    filters.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => {
                // チェックボックスの状態を取得して options に反映
                const options = {
                    showAnnual: document.getElementById('filterAnnualEvents').checked,
                    showMyClass: document.getElementById('filterMyClasses').checked,
                    showCustom: document.getElementById('filterCustomEvents').checked
                };
                showClassSchedule(currentScheduleClassId, options);
            });
        }
    });

    const printBtn = document.getElementById('printScheduleBtn');
    if (printBtn) {
        printBtn.addEventListener('click', printClassSchedule);
    }
    const csvBtn = document.getElementById('csvExportScheduleBtn');
    if (csvBtn) {
        csvBtn.addEventListener('click', exportClassScheduleCsv);
    }

    // 年休候補モーダル用のイベント
    const printVacationBtn = document.getElementById('printVacationCandidateBtn');
    if (printVacationBtn) {
        printVacationBtn.addEventListener('click', () => window.print());
    }
    const csvVacationBtn = document.getElementById('csvExportVacationBtn');
    if (csvVacationBtn) {
        csvVacationBtn.addEventListener('click', exportVacationCandidatesCsv);
    }

    scheduleEventListenersInitialized = true;
    console.log('日程表イベントリスナーを設定完了');
}

/**
 * 年休候補日をCSV出力
 */
function exportVacationCandidatesCsv() {
    const tbody = document.getElementById('vacationCandidateBody');
    if (!tbody || tbody.rows.length === 0 || tbody.rows[0].cells.length < 2) {
        alert('出力するデータがありません');
        return;
    }

    let csv = '日付,曜日,参考行事,備考\n';
    Array.from(tbody.rows).forEach(row => {
        // 月の区切りなどは飛ばす
        if (row.classList.contains('month-delim-row') || row.classList.contains('week-delim-row')) return;

        if (row.cells.length >= 3) {
            const date = row.cells[0].textContent;
            const week = row.cells[1].textContent;
            const refEvents = row.cells[2] ? row.cells[2].textContent : '';
            const remark = row.cells[3] ? row.cells[3].textContent : '';
            csv += `"${date}","${week}","${refEvents}","${remark}"\n`;
        }
    });

    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    const blob = new Blob([bom, csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `年休候補日一覧.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
window.exportVacationCandidatesCsv = exportVacationCandidatesCsv;
window.showVacationCandidates = showVacationCandidates;
window.closeVacationCandidateModal = closeVacationCandidateModal;


/* ===========================
   時間割表表示機能
   =========================== */


// 時間割の年度選択肢更新 (Global化により廃止 - 互換性のために残す)
function updateTimetableYearOptions() {
    // コンソールログも不要なら削除可能
    // console.log('updateTimetableYearOptions called but ignored (global year used)');
}

function renderTimetable(semester) {
    if (semester) currentTimetableSemester = semester;
    else semester = currentTimetableSemester;

    // 選択された年度を取得 (globalYearSelect)
    const yearSelect = document.getElementById('globalYearSelect');
    const selectedYear = yearSelect ? parseInt(yearSelect.value) : (typeof currentYear !== 'undefined' ? currentYear : new Date().getFullYear());

    // タイトルの年度表記を更新（もし必要なら）
    const titleEl = document.getElementById('timetableTitle');
    if (titleEl) {
        titleEl.textContent = `\uD83D\uDCC6 あなたの時間割（${selectedYear}年度）`;
    }

    const grid = document.getElementById('timetableGrid');
    if (!grid) return;

    grid.innerHTML = '';

    // CSS Gridの設定を適用（行定義を追加）
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = '80px repeat(5, 1fr)';
    grid.style.gridAutoRows = 'minmax(140px, auto)';

    // 1. 曜日ヘッダー (Row 1)
    const weekdays = ['月', '火', '水', '木', '金'];
    const corner = document.createElement('div');
    corner.className = 'timetable-cell header-cell';
    corner.textContent = '/';
    corner.style.gridColumn = '1';
    corner.style.gridRow = '1';
    grid.appendChild(corner);

    weekdays.forEach((day, i) => {
        const header = document.createElement('div');
        header.className = 'timetable-cell header-cell';
        header.textContent = day;
        header.style.gridColumn = `${i + 2}`;
        header.style.gridRow = '1';
        grid.appendChild(header);
    });

    // 2. 空セルと時限ヘッダーの配置
    const periods = [1, 2, 3, 4, "after"];
    const periodMap = { 1: 2, 2: 3, 3: 4, 4: 5, "after": 6 };
    const periodTimes = {
        1: "9:00\n~\n10:35",
        2: "10:45\n~\n12:20",
        3: "13:05\n~\n14:40",
        4: "14:50\n~\n16:25",
        "after": "放課後"
    };

    periods.forEach(p => {
        const rowIndex = periodMap[p];

        // 時限ヘッダー
        const pHeader = document.createElement('div');
        pHeader.className = 'timetable-cell period-header' + (p === "after" ? " after-period" : "");
        const headerText = p === "after" ? "放課後" : `${p}限`;
        const timeText = p === "after" ? "" : `<span style="font-size:0.7em; font-weight:normal; display:block; margin-top:2px;">${periodTimes[p].replace(/\n/g, ' ')}</span>`;
        pHeader.innerHTML = headerText + timeText;
        pHeader.style.gridColumn = '1';
        pHeader.style.gridRow = `${rowIndex}`;
        grid.appendChild(pHeader);

        // 空セル (背景・クリック用)
        for (let w = 1; w <= 5; w++) {
            const cell = document.createElement('div');
            cell.className = 'timetable-cell';
            cell.style.gridColumn = `${w + 1}`;
            cell.style.gridRow = `${rowIndex}`;
            cell.style.zIndex = '1';

            // ドラッグ＆ドロップ対応
            cell.dataset.weekday = w;
            cell.dataset.period = p;
            cell.dataset.semester = semester;
            cell.addEventListener('dragover', handleTimetableDragOver);
            cell.addEventListener('dragleave', handleTimetableDragLeave);
            cell.addEventListener('drop', handleTimetableDrop);

            // クリックで新規登録
            cell.onclick = (e) => {
                if (e.target === cell) {
                    openClassInputModal({ weekday: w, period: p, semester: semester });
                }
            };
            cell.style.cursor = 'pointer';
            cell.title = 'クリックして授業を追加';
            grid.appendChild(cell);
        }

    });

    // 3. 授業カードの配置
    // 対象年度と学期でフィルタ
    const targetClasses = myClasses.filter(cls => {
        const classYear = cls.classYear || (typeof currentYear !== 'undefined' ? currentYear : new Date().getFullYear());
        if (classYear !== selectedYear) return false;

        if (semester === 'first' && !cls.firstSemester) return false;
        if (semester === 'second' && !cls.secondSemester) return false;
        return true;
    });

    targetClasses.forEach(cls => {
        const schedule = semester === 'first' ? cls.firstSemester : cls.secondSemester;
        if (!schedule) return;

        // 時限解析 (結合対応)
        const periodStr = String(schedule.period);
        let startPeriod, endPeriod;

        if (periodStr.includes('-')) {
            const parts = periodStr.split('-');
            startPeriod = parseInt(parts[0]);
            endPeriod = parseInt(parts[parts.length - 1]);
        } else if (periodStr === 'after') {
            startPeriod = 'after';
            endPeriod = 'after';
        } else if (periodStr === 'HR') {
            // HRは4限と同じ枠とする
            startPeriod = 4;
            endPeriod = 4;
        } else {
            startPeriod = parseInt(periodStr);
            endPeriod = parseInt(periodStr);
        }

        // Grid配置座標の計算
        // periodMap: { 1: 2, 2: 3, 3: 4, 4: 5, "after": 6 }
        const gridRowStart = periodMap[startPeriod];
        const gridRowEnd = periodMap[endPeriod] ? periodMap[endPeriod] + 1 : gridRowStart + 1; // endはexclusiveなので+1
        const gridColumn = schedule.weekday + 1;

        if (!gridRowStart) return; // 無効な時限

        // カード生成
        const card = document.createElement('div');
        const deptClass = cls.departmentType === 'student' ? 'dept-student' : 'dept-teacher';
        card.className = `timetable-class-card ${deptClass}`;

        // スタイル配置
        card.style.gridColumn = `${gridColumn}`;
        card.style.gridRow = `${gridRowStart} / ${gridRowEnd}`;
        card.style.zIndex = '2'; // セルの上に表示
        card.style.margin = '4px';
        card.style.height = 'calc(100% - 8px)'; // マージン分引く

        // ドラッグ＆ドロップ対応
        card.draggable = true;
        card.dataset.classId = cls.id;
        card.dataset.type = 'myclass'; // app.jsのhandleEventDragStartを利用
        card.dataset.semester = semester;
        card.addEventListener('dragstart', handleEventDragStart);

        // カードクリックで編集
        card.onclick = (e) => {
            e.stopPropagation();
            editMyClass(cls.id);
        };
        card.style.cursor = 'pointer';


        const deptShort = cls.departmentType === 'student' ? '専' : '本';
        let targetLabel = cls.targetType === 'grade'
            ? `${cls.targetGrade}年`
            : `${cls.targetGrade}${cls.targetType === 'class' && cls.targetGrade === 1 ? '-' : ''}${cls.targetClass}`;

        // この授業・この学期に関連するカレンダーオーバライド（変更）があるかチェック
        const hasOverrides = classOverrides && classOverrides.some(ov =>
            String(ov.id) === String(cls.id) && ov.type === 'myclass'
        );

        card.innerHTML = `
            <div class="timetable-class-name">
                ${cls.name}
                ${hasOverrides ? '<span style="color:#d32f2f; font-size:0.8em; margin-left:4px;" title="カレンダー上で一部日程の変更・移動があります">⚠️</span>' : ''}
            </div>
            <div class="timetable-class-meta">
                <span>\uD83D\uDCDA [${deptShort}]</span>
                <span>\uD83D\uDC65 ${targetLabel}</span>
                ${cls.location ? `<span>\uD83D\uDCCD ${cls.location}</span>` : ''}
            </div>
        `;

        grid.appendChild(card);
    });


    // スイッチャーのスタイル更新
    const container = document.querySelector('.timetable-switcher');
    if (container) {
        const buttons = container.querySelectorAll('button');

        buttons.forEach((btn, idx) => {
            if ((semester === 'first' && idx === 0) || (semester === 'second' && idx === 1)) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }
}


function handleTimetableDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    e.currentTarget.classList.add('drag-over');
}

function handleTimetableDragLeave(e) {
    e.currentTarget.classList.remove('drag-over');
}

function handleTimetableDrop(e) {
    e.preventDefault();
    const cell = e.currentTarget;
    cell.classList.remove('drag-over');

    const targetWeekday = parseInt(cell.dataset.weekday);
    const targetPeriod = cell.dataset.period;
    const targetSemester = cell.dataset.semester;

    const json = e.dataTransfer.getData('text/plain');
    if (!json) return;

    try {
        const data = JSON.parse(json);
        // カレンダーからもドラッグされる可能性があるため、myclassのみ許可
        if (data.type !== 'myclass') return;

        const cls = myClasses.find(c => String(c.id) === String(data.id));
        if (!cls) {
            console.warn('Timetable drop: Class not found', data.id);
            return;
        }

        const isCopy = (e.ctrlKey || e.metaKey);

        // 移動元と移動先が同じなら何もしない
        if (!isCopy) {
            const currentSchedule = targetSemester === 'first' ? cls.firstSemester : cls.secondSemester;
            if (currentSchedule && currentSchedule.weekday === targetWeekday && String(currentSchedule.period) === String(targetPeriod)) {
                return;
            }
        }

        console.log(`Timetable drop: ${isCopy ? 'COPY' : 'MOVE'} class "${cls.name}" (ID: ${cls.id}) to ${targetSemester} ${targetWeekday} ${targetPeriod}`);


        if (isCopy) {
            // コピー: 元の情報を変えず、新しいオブジェクトを作る
            const newCls = JSON.parse(JSON.stringify(cls));
            newCls.id = Date.now(); // 新しい一意なID

            if (targetSemester === 'first') {
                if (!newCls.firstSemester) newCls.firstSemester = {};
                newCls.firstSemester.weekday = targetWeekday;
                newCls.firstSemester.period = targetPeriod;
            } else {
                if (!newCls.secondSemester) newCls.secondSemester = {};
                newCls.secondSemester.weekday = targetWeekday;
                newCls.secondSemester.period = targetPeriod;
            }
            myClasses.push(newCls);
        } else {
            // 移動: 既存オブジェクトを更新
            if (targetSemester === 'first') {
                if (!cls.firstSemester) cls.firstSemester = {};
                cls.firstSemester.weekday = targetWeekday;
                cls.firstSemester.period = targetPeriod;
            } else {
                if (!cls.secondSemester) cls.secondSemester = {};
                cls.secondSemester.weekday = targetWeekday;
                cls.secondSemester.period = targetPeriod;
            }
        }

        saveMyClasses();
        renderMyClassesList(); // これで一覧と時間割が更新される
        if (typeof updateCalendar === 'function') updateCalendar();

    } catch (err) {
        console.error('Timetable drop error:', err);
    }
}


function switchTimetableSemester(semester) {
    currentTimetableSemester = semester;
    renderTimetable(semester);
}

// 初期ロード時の呼び出し、およびリスト更新時の呼び出し
// renderMyClassesList内から呼ぶか、個別に呼ぶか。
// 依存関係を避けるため、グローバル登録してHTMLから呼べるようにする

window.switchTimetableSemester = switchTimetableSemester;
window.renderTimetable = renderTimetable;

// モーダル操作関数
function openClassInputModal(preset = null) {
    const modal = document.getElementById('classInputModal');
    if (modal) {
        modal.classList.remove('hidden');

        // プリセットがあれば反映（新規作成時）
        if (preset) {
            resetForm(); // まずリセット

            // 学期設定
            if (preset.semester) {
                const semSelect = document.getElementById('semesterType');
                if (semSelect) {
                    semSelect.value = preset.semester === 'first' ? 'first' : 'second';
                    updateSemesterVisibility();
                }
            }

            // 後期曜日・時限
            if (preset.weekday && preset.period) {
                if (preset.semester !== 'second') { // 前期または通年
                    document.getElementById('firstWeekday').value = preset.weekday;
                    document.getElementById('firstPeriod').value = preset.period;
                }
                if (preset.semester !== 'first') { // 後期または通年
                    document.getElementById('secondWeekday').value = preset.weekday;
                    document.getElementById('secondPeriod').value = preset.period;
                }
            }
        }
    }
}

function closeClassInputModal() {
    const modal = document.getElementById('classInputModal');
    if (modal) modal.classList.add('hidden');
    resetForm(); // 閉じるときはリセット
}

window.openClassInputModal = openClassInputModal;
window.closeClassInputModal = closeClassInputModal;


// =============================
// 授業科目検索・サジェスト機能
// =============================

// 授業科目（候補）リスト管理
let ALL_COURSES = [];

// デフォルトの授業データ
const DEFAULT_COURSES = [
    { name: "国語1", grade: 1, course: "common" }, { name: "国語2", grade: 2, course: "common" }, { name: "国語3", grade: 3, course: "common" }, { name: "言語と文化", grade: 4, course: "common" },
    { name: "社会1", grade: 1, course: "common" }, { name: "社会2", grade: 2, course: "common" }, { name: "社会3", grade: 3, course: "common" }, { name: "現代社会論", grade: 4, course: "common" },
    { name: "法律", grade: 5, course: "common" }, { name: "経済", grade: 5, course: "common" }, { name: "哲学", grade: 5, course: "common" }, { name: "心理学", grade: 5, course: "common" },
    { name: "基礎数学A", grade: 1, course: "common" }, { name: "基礎数学B", grade: 1, course: "common" }, { name: "基礎数学C", grade: 1, course: "common" },
    { name: "微分積分1", grade: 2, course: "common" }, { name: "微分積分2", grade: 2, course: "common" }, { name: "ベクトル・行列", grade: 2, course: "common" },
    { name: "解析1", grade: 3, course: "common" }, { name: "解析2", grade: 3, course: "common" }, { name: "線形代数・微分方程式", grade: 3, course: "common" },
    { name: "確率統計", grade: 4, course: "common" }, { name: "基礎物理1", grade: 1, course: "common" }, { name: "基礎物理2", grade: 2, course: "common" },
    { name: "基礎物理3", grade: 3, course: "common" }, { name: "現代物理学概論", grade: 5, course: "common" }, { name: "化学1", grade: 1, course: "common" },
    { name: "化学2", grade: 2, course: "common" }, { name: "生物", grade: 2, course: "common" }, { name: "保健・体育1", grade: 1, course: "common" },
    { name: "保健・体育2", grade: 2, course: "common" }, { name: "保健・体育3", grade: 3, course: "common" }, { name: "保健・体育4", grade: 4, course: "common" },
    { name: "英語1", grade: 1, course: "common" }, { name: "英語2", grade: 1, course: "common" }, { name: "英語3", grade: 2, course: "common" }, { name: "英語4", grade: 2, course: "common" },
    { name: "英語5", grade: 3, course: "common" }, { name: "英語6", grade: 4, course: "common" }, { name: "英語表現1", grade: 1, course: "common" },
    { name: "英語表現2", grade: 2, course: "common" }, { name: "英語表現3", grade: 3, course: "common" }, { name: "英語A", grade: 4, course: "common" },
    { name: "英語B", grade: 4, course: "common" }, { name: "中国語", grade: 4, course: "common" }, { name: "ドイツ語", grade: 4, course: "common" },
    { name: "美術", grade: 1, course: "common" }, { name: "書道", grade: 1, course: "common" }, { name: "音楽", grade: 1, course: "common" },
    { name: "総合工学システム概論", grade: 1, course: "common" }, { name: "総合工学システム実験実習", grade: 1, course: "common" },
    { name: "情報1", grade: 1, course: "common" }, { name: "情報2", grade: 2, course: "common" }, { name: "情報3", grade: 3, course: "common" },
    { name: "ダイバーシティと人権", grade: 1, course: "common" }, { name: "多文化共生", grade: 4, course: "common" }, { name: "労働環境と人権", grade: 5, course: "common" },
    { name: "技術倫理", grade: 5, course: "common" }, { name: "システム安全入門", grade: 5, course: "common" }, { name: "環境システム工学", grade: 5, course: "common" },
    { name: "資源と産業", grade: 5, course: "common" }, { name: "環境倫理", grade: 5, course: "common" }, { name: "応用数学A", grade: 4, course: "common" },
    { name: "応用数学B", grade: 4, course: "common" }, { name: "物理学A", grade: 4, course: "common" }, { name: "物理学B", grade: 4, course: "common" },
    { name: "計測工学", grade: 5, course: "common" }, { name: "技術英語", grade: 5, course: "common" }, { name: "機械工学概論", grade: 2, course: "M" },
    { name: "基礎製図", grade: 2, course: "M" }, { name: "電気・電子回路", grade: 2, course: "M" }, { name: "シーケンス制御", grade: 2, course: "M" },
    { name: "機械工作実習1", grade: 2, course: "M" }, { name: "材料力学入門", grade: 3, course: "M" }, { name: "熱力学入門", grade: 3, course: "M" },
    { name: "流体力学入門", grade: 3, course: "M" }, { name: "機械工作法", grade: 3, course: "M" }, { name: "CAD製図", grade: 3, course: "M" },
    { name: "機械設計製図", grade: 3, course: "M" }, { name: "機械工作実習2", grade: 3, course: "M" }, { name: "材料力学", grade: 4, course: "M" },
    { name: "熱力学", grade: 4, course: "M" }, { name: "流れ学", grade: 4, course: "M" }, { name: "機械力学", grade: 4, course: "M" },
    { name: "材料学", grade: 4, course: "M" }, { name: "数値計算", grade: 4, course: "M" }, { name: "エネルギー機械実験1", grade: 4, course: "M" },
    { name: "機械設計", grade: 5, course: "M" }, { name: "伝熱工学", grade: 5, course: "M" }, { name: "流体工学", grade: 5, course: "M" },
    { name: "生産加工工学", grade: 5, course: "M" }, { name: "制御工学", grade: 5, course: "M" }, { name: "エネルギー変換工学", grade: 5, course: "M" },
    { name: "エネルギー機械実験2", grade: 5, course: "M" }, { name: "卒業研究", grade: 5, course: "M" }, { name: "プロダクトデザイン概論", grade: 2, course: "D" },
    { name: "製図基礎", grade: 2, course: "D" }, { name: "プログラミング基礎", grade: 2, course: "D" }, { name: "機械工作法", grade: 2, course: "D" },
    { name: "機械工作実習", grade: 2, course: "D" }, { name: "工業力学", grade: 3, course: "D" }, { name: "CAD設計製図", grade: 3, course: "D" },
    { name: "材料学", grade: 3, course: "D" }, { name: "加工学", grade: 3, course: "D" }, { name: "ユニバーサルデザイン", grade: 3, course: "D" },
    { name: "生産機械実習", grade: 3, course: "D" }, { name: "材料力学", grade: 4, course: "D" }, { name: "熱力学", grade: 4, course: "D" },
    { name: "流体力学", grade: 4, course: "D" }, { name: "機械力学", grade: 4, course: "D" }, { name: "メカトロニクス", grade: 4, course: "D" },
    { name: "ロボット工学", grade: 4, course: "D" }, { name: "プロダクトデザイン実験", grade: 4, course: "D" }, { name: "プロダクトデザイン", grade: 5, course: "D" },
    { name: "CAM/CAE", grade: 5, course: "D" }, { name: "生産システム工学", grade: 5, course: "D" }, { name: "感性工学", grade: 5, course: "D" },
    { name: "プロダクトデザイン実習", grade: 5, course: "D" }, { name: "卒業研究", grade: 5, course: "D" }, { name: "エレクトロニクス概論", grade: 2, course: "E" },
    { name: "電気設備", grade: 2, course: "E" }, { name: "電気回路1", grade: 2, course: "E" }, { name: "電子回路1", grade: 2, course: "E" },
    { name: "電気電子材料1", grade: 2, course: "E" }, { name: "エレクトロニクス実験実習", grade: 2, course: "E" }, { name: "電気回路2", grade: 3, course: "E" },
    { name: "電磁気学1", grade: 3, course: "E" }, { name: "電気電子材料2", grade: 3, course: "E" }, { name: "半導体工学1", grade: 3, course: "E" },
    { name: "工学設計演習", grade: 3, course: "E" }, { name: "エレクトロニクス実験1", grade: 3, course: "E" }, { name: "電子回路2", grade: 4, course: "E" },
    { name: "電気回路3", grade: 4, course: "E" }, { name: "電磁気学2", grade: 4, course: "E" }, { name: "電気電子材料3", grade: 4, course: "E" },
    { name: "半導体工学2", grade: 4, course: "E" }, { name: "コンピュータ工学基礎", grade: 4, course: "E" }, { name: "制御工学1", grade: 4, course: "E" },
    { name: "エレクトロニクス実験2", grade: 4, course: "E" }, { name: "制御工学2", grade: 5, course: "E" }, { name: "電気機器", grade: 5, course: "E" },
    { name: "電力技術", grade: 5, course: "E" }, { name: "パワーエレクトロニクス", grade: 5, course: "E" }, { name: "信号処理", grade: 5, course: "E" },
    { name: "電気化学", grade: 5, course: "E" }, { name: "センサー工学", grade: 5, course: "E" }, { name: "ワイヤレス技術", grade: 5, course: "E" },
    { name: "エレクトロニクス実験3", grade: 5, course: "E" }, { name: "卒業研究", grade: 5, course: "E" }, { name: "メディアデザイン入門", grade: 2, course: "I" },
    { name: "論理回路1", grade: 2, course: "I" }, { name: "マイクロコンピュータ", grade: 2, course: "I" }, { name: "プログラミング1", grade: 2, course: "I" },
    { name: "工学基礎実習", grade: 2, course: "I" }, { name: "プログラミング2", grade: 3, course: "I" }, { name: "プログラミング3", grade: 3, course: "I" },
    { name: "アルゴリズムとデータ構造1", grade: 3, course: "I" }, { name: "論理回路2", grade: 3, course: "I" }, { name: "電気電子回路1", grade: 3, course: "I" },
    { name: "知識科学概論", grade: 3, course: "I" }, { name: "知能情報実験実習1", grade: 3, course: "I" }, { name: "アルゴリズムとデータ構造2", grade: 4, course: "I" },
    { name: "電気電子回路2", grade: 4, course: "I" }, { name: "データベース工学", grade: 4, course: "I" }, { name: "マルチメディア情報処理", grade: 4, course: "I" },
    { name: "情報通信ネットワーク", grade: 4, course: "I" }, { name: "コンピュータシステム", grade: 4, course: "I" }, { name: "知能情報実験実習2", grade: 4, course: "I" },
    { name: "オートマトンと形式言語", grade: 5, course: "I" }, { name: "ソフトウェア工学", grade: 5, course: "I" }, { name: "知能情報実験実習3", grade: 5, course: "I" },
    { name: "オペレーティングシステム", grade: 5, course: "I" }, { name: "人工知能", grade: 5, course: "I" }, { name: "情報理論", grade: 5, course: "I" },
    { name: "コンピュータアーキテクチャ", grade: 5, course: "I" }, { name: "卒業研究", grade: 5, course: "I" }, { name: "応用専門概論", grade: 3, course: "common" },
    { name: "応用専門PBL1", grade: 3, course: "common" }, { name: "応用専門PBL2", grade: 4, course: "common" }, { name: "インターンシップ", grade: 4, course: "common" },
    { name: "生活と物質", grade: 4, course: "common" }, { name: "社会と環境", grade: 4, course: "common" }, { name: "物質プロセス基礎", grade: 4, course: "common" },
    { name: "物質デザイン概論", grade: 4, course: "common" }, { name: "防災工学", grade: 4, course: "common" }, { name: "エルゴノミクス", grade: 4, course: "common" },
    { name: "食品エンジニアリング", grade: 5, course: "common" }, { name: "コスメティックス", grade: 5, course: "common" }, { name: "バイオテクノロジー", grade: 5, course: "common" },
    { name: "高純度化技術", grade: 5, course: "common" }, { name: "環境モニタリング", grade: 5, course: "common" }, { name: "エネルギー変換デバイス", grade: 5, course: "common" },
    { name: "食と健康のセンサ", grade: 5, course: "common" }, { name: "環境対応デバイス", grade: 5, course: "common" }, { name: "社会基盤構造", grade: 5, course: "common" },
    { name: "環境衛生工学", grade: 5, course: "common" }, { name: "維持管理工学", grade: 5, course: "common" }, { name: "水環境工学", grade: 5, course: "common" },
    { name: "環境デザイン論", grade: 5, course: "common" }, { name: "インクルーシブデザイン", grade: 5, course: "common" }, { name: "空間情報学", grade: 5, course: "common" },
    { name: "環境行動", grade: 5, course: "common" }
];

function loadCourses() {
    const saved = localStorage.getItem('course_masters');
    if (saved) {
        ALL_COURSES = JSON.parse(saved);
    } else {
        ALL_COURSES = [...DEFAULT_COURSES];
    }
}

function saveCoursesData() {
    localStorage.setItem('course_masters', JSON.stringify(ALL_COURSES));
    if (document.getElementById('settingsSection').classList.contains('hidden') === false) {
        renderManageCourses(); // 管理用リストを更新
    }
}

function initCourseSearch() {
    const input = document.getElementById('className');
    const suggestions = document.getElementById('courseSuggestions');
    const searchBtn = document.getElementById('searchCourseBtn');
    const filterSelect = document.getElementById('courseFilterSelect');

    if (!input || !suggestions || !searchBtn || !filterSelect) return;

    const performSearch = () => {
        const query = input.value.trim().toLowerCase();
        const filter = filterSelect.value;
        const currentGrade = parseInt(document.getElementById('targetGrade').value);

        let filtered = ALL_COURSES;

        // 検索ワードでフィルタ
        if (query) {
            filtered = filtered.filter(c => c.name.toLowerCase().includes(query));
        }

        // コース（学科）でフィルタ
        if (filter !== 'all') {
            filtered = filtered.filter(c => c.course === filter);
        }

        // 結果が多い場合は絞る。クエリもフィルタもない場合は現在の学年を表示
        if (!query && filter === 'all') {
            filtered = filtered.filter(c => c.grade === currentGrade);
        }

        renderSuggestions(filtered.slice(0, 20));
    };

    // 入力イベントで検索
    input.addEventListener('input', () => {
        if (input.value.trim().length < 1) {
            suggestions.classList.add('hidden');
            return;
        }
        performSearch();
    });

    // フィルタ変更で再検索
    filterSelect.addEventListener('change', performSearch);

    // 検索ボタンクリックで全件表示（または空検索）
    searchBtn.addEventListener('click', (e) => {
        e.preventDefault();
        performSearch();
    });

    // 外側クリックで閉じる
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !suggestions.contains(e.target) && !searchBtn.contains(e.target) && !filterSelect.contains(e.target)) {
            suggestions.classList.add('hidden');
        }
    });
}

function renderSuggestions(courses) {
    const suggestions = document.getElementById('courseSuggestions');
    if (!courses || courses.length === 0) {
        suggestions.classList.add('hidden');
        return;
    }

    suggestions.innerHTML = '';
    courses.forEach(course => {
        const item = document.createElement('div');
        item.className = 'suggestion-item';

        let courseLabel = '';
        switch (course.course) {
            case 'common': courseLabel = '共通'; break;
            case 'M': courseLabel = 'M'; break;
            case 'D': courseLabel = 'D'; break;
            case 'E': courseLabel = 'E'; break;
            case 'I': courseLabel = 'I'; break;
        }

        item.innerHTML = `
            <div>
                <span class="suggestion-name">${course.name}</span>
                <span style="font-size: 0.75rem; color: #666; margin-left: 8px;">(${courseLabel})</span>
            </div>
            <span class="suggestion-grade">${course.grade}年</span>
        `;
        item.onclick = () => selectCourse(course);
        suggestions.appendChild(item);
    });

    suggestions.classList.remove('hidden');
}

function selectCourse(course) {
    const input = document.getElementById('className');
    const gradeSelect = document.getElementById('targetGrade');
    const deptSelect = document.getElementById('departmentType');
    const targetTypeSelect = document.getElementById('targetType');
    const targetClassSelect = document.getElementById('targetClass');
    const suggestions = document.getElementById('courseSuggestions');

    input.value = course.name;

    // 学科データがあれば本科にセット（CSVデータは本科1-5年用）
    if (deptSelect) deptSelect.value = 'teacher';

    // 学年セット
    if (course.grade >= 1 && course.grade <= 5) {
        gradeSelect.value = course.grade;
    }

    // コース・展開方法を推測
    let targetType = 'class';
    let targetClass = '';

    if (course.course === 'common') {
        targetType = 'grade';
    } else {
        targetType = 'class';
        if (course.grade >= 2) {
            targetClass = course.course; // "M", "D", "E", "I"
        }
    }

    // UIを更新して選択肢を生成
    targetTypeSelect.value = targetType;
    if (typeof updateTargetClassVisibility === 'function') updateTargetClassVisibility();
    if (typeof updateClassOptions === 'function') updateClassOptions();

    // 選択肢生成後に値をセット
    if (targetType === 'class' && targetClass) {
        targetClassSelect.value = targetClass;
    }

    suggestions.classList.add('hidden');
}


// =============================
// 教員リスト・ドラッグ＆ドロップ機能
// =============================

// H:\CODE\業務効率化\学生+ 教員\2025(教職員事務局).csv の抜粋
// 教員リスト管理
let ALL_TEACHERS = [];

// 定数としてのデフォルトデータ（初期化用）
const DEFAULT_TEACHERS = [
    { "name": "井上　千鶴子", "dept": "一般（文系）" }, { "name": "小川　清次", "dept": "一般（文系）" }, { "name": "川村　珠巨", "dept": "一般（文系）" }, { "name": "西野　達雄", "dept": "一般（文系）" },
    { "name": "坂井　二三絵", "dept": "一般（文系）" }, { "name": "中山　良子", "dept": "一般（文系）" }, { "name": "川光　大介", "dept": "一般（文系）" }, { "name": "谷野　圭亮", "dept": "一般（文系）" },
    { "name": "松井　悠香", "dept": "一般（文系）" }, { "name": "北野　健一", "dept": "一般（理系）" }, { "name": "佐藤　修", "dept": "一般（理系）" }, { "name": "中田　裕一", "dept": "一般（理系）" },
    { "name": "楢崎　亮", "dept": "一般（理系）" }, { "name": "橋爪　裕", "dept": "一般（理系）" }, { "name": "稗田　吉成", "dept": "一般（理系）" }, { "name": "松野　高典", "dept": "一般（理系）" },
    { "name": "鬼頭　秀行", "dept": "一般（理系）" }, { "name": "室谷　文祥", "dept": "一般（理系）" }, { "name": "梶　真理香", "dept": "一般（理系）" }, { "name": "金井　友希美", "dept": "一般（理系）" },
    { "name": "松永　博昭", "dept": "一般（理系）" }, { "name": "西田　博一", "dept": "一般（理系）" }, { "name": "石川　寿敏 (M)", "dept": "エネルギー機械" }, { "name": "君家　直之 (M)", "dept": "エネルギー機械" },
    { "name": "上村　匡敬 (M)", "dept": "エネルギー機械" }, { "name": "久野　章仁 (A)", "dept": "エネルギー機械" }, { "name": "杉浦　公彦 (M)", "dept": "エネルギー機械" }, { "name": "塚本　晃久 (M)", "dept": "エネルギー機械" },
    { "name": "西岡　求 (A)", "dept": "エネルギー機械" }, { "name": "平林　大介 (A)", "dept": "エネルギー機械" }, { "name": "中津　壮人 (M)", "dept": "エネルギー機械" }, { "name": "白柳　博章 (C)", "dept": "エネルギー機械" },
    { "name": "鯵坂　誠之 (C)", "dept": "プロダクトデザイン" }, { "name": "岩本　いづみ (C)", "dept": "プロダクトデザイン" }, { "name": "里中　直樹 (H)", "dept": "プロダクトデザイン" }, { "name": "中谷　敬子 (H)", "dept": "プロダクトデザイン" },
    { "name": "難波　邦彦 (M)", "dept": "プロダクトデザイン" }, { "name": "藪　厚生 (H)", "dept": "プロダクトデザイン" }, { "name": "倉橋　健介 (A)", "dept": "プロダクトデザイン" }, { "name": "古田　和久 (M)", "dept": "プロダクトデザイン" },
    { "name": "勇　地有理 (M)", "dept": "プロダクトデザイン" }, { "name": "前田　一成 (H)", "dept": "プロダクトデザイン" }, { "name": "梅本　敏孝 (E)", "dept": "エレクトロニクス" }, { "name": "金田　忠裕 (H)", "dept": "エレクトロニクス" },
    { "name": "重井　宣行 (E)", "dept": "エレクトロニクス" }, { "name": "辻元　英孝 (A)", "dept": "エレクトロニクス" }, { "name": "東田　卓 (A)", "dept": "エレクトロニクス" }, { "name": "前田　篤志 (E)", "dept": "エレクトロニクス" },
    { "name": "川上　太知 (E)", "dept": "エレクトロニクス" }, { "name": "田村　生弥 (C)", "dept": "エレクトロニクス" }, { "name": "野田　達夫 (A)", "dept": "エレクトロニクス" }, { "name": "安藤　太一 (H)", "dept": "エレクトロニクス" },
    { "name": "榎倉　浩志 (E)", "dept": "エレクトロニクス" }, { "name": "青木　一弘 (E)", "dept": "知能情報" }, { "name": "窪田　哲也 (E)", "dept": "知能情報" }, { "name": "土井　智晴 (H)", "dept": "知能情報" },
    { "name": "新妻　弘崇 (E)", "dept": "知能情報" }, { "name": "早川　潔 (E)", "dept": "知能情報" }, { "name": "山野　高志 (C)", "dept": "知能情報" }, { "name": "和田　健 (H)", "dept": "知能情報" },
    { "name": "中才　恵太朗 (E)", "dept": "知能情報" }, { "name": "吉田　晃基 (E)", "dept": "知能情報" }, { "name": "木村　祐太 (E)", "dept": "知能情報" }, { "name": "高橋　舞", "dept": "保健室" },
    { "name": "有末　宏明", "dept": "非常勤講師" }, { "name": "上田　純子", "dept": "非常勤講師" }, { "name": "打田　剛生", "dept": "非常勤講師" }, { "name": "内田　晴彦", "dept": "非常勤講師" },
    { "name": "大谷　壮介", "dept": "非常勤講師" }, { "name": "大坪　義一", "dept": "非常勤講師" }, { "name": "小形　美妃", "dept": "非常勤講師" }, { "name": "越智　敏明", "dept": "非常勤講師" },
    { "name": "垣内　喜代三", "dept": "非常勤講師" }, { "name": "片山　登揚", "dept": "非常勤講師" }, { "name": "加藤　のん", "dept": "非常勤講師" }, { "name": "鎌倉　祥太郎", "dept": "非常勤講師" },
    { "name": "川上　幸三", "dept": "非常勤講師" }, { "name": "北村　幸定", "dept": "非常勤講師" }, { "name": "木下　佐和子", "dept": "非常勤講師" }, { "name": "木村　安佐子", "dept": "非常勤講師" },
    { "name": "京　鴻一", "dept": "非常勤講師" }, { "name": "楠本　藍梨", "dept": "非常勤講師" }, { "name": "黒田　良一", "dept": "非常勤講師" }, { "name": "小出　宏樹", "dept": "非常勤講師" },
    { "name": "小森　勇人", "dept": "非常勤講師" }, { "name": "相根　心", "dept": "非常勤講師" }, { "name": "佐藤　亜紀子", "dept": "非常勤講師" }, { "name": "須﨑　昌已", "dept": "非常勤講師" },
    { "name": "武知　薫子", "dept": "非常勤講師" }, { "name": "塚本　大智", "dept": "非常勤講師" }, { "name": "戸塚　譲次郎", "dept": "非常勤講師" }, { "name": "中井　勝博", "dept": "非常勤講師" },
    { "name": "永田　 實", "dept": "非常勤講師" }, { "name": "新納　格", "dept": "非常勤講師" }, { "name": "西村　有理", "dept": "非常勤講師" }, { "name": "濱崎　雅孝", "dept": "非常勤講師" },
    { "name": "早石　典史", "dept": "非常勤講師" }, { "name": "平井　三友", "dept": "非常勤講師" }, { "name": "福山　亮介", "dept": "非常勤講師" }, { "name": "増木　啓二", "dept": "非常勤講師" },
    { "name": "松永　健聖", "dept": "非常勤講師" }, { "name": "真野　純司", "dept": "非常勤講師" }, { "name": "森口　雅弘", "dept": "非常勤講師" }, { "name": "安田　昌弘", "dept": "工学部" },
    { "name": "野村　俊之", "dept": "工学部" }, { "name": "山田　伸武", "dept": "非常勤講師" }, { "name": "吉川　明里", "dept": "非常勤講師" }, { "name": "葭谷　安正", "dept": "非常勤講師" },
    { "name": "吉本　隆光", "dept": "非常勤講師" }, { "name": "楼　　娟", "dept": "非常勤講師" }, { "name": "若竹　昌洋", "dept": "非常勤講師" }, { "name": "若林　悟", "dept": "非常勤講師" }
];

function loadTeachers() {
    const saved = localStorage.getItem('school_teachers');
    if (saved) {
        ALL_TEACHERS = JSON.parse(saved);
    } else {
        ALL_TEACHERS = [...DEFAULT_TEACHERS];
    }
}

function saveTeachersData() {
    localStorage.setItem('school_teachers', JSON.stringify(ALL_TEACHERS));
    renderTeacherList(); // ドラッグ用リストを更新
    if (document.getElementById('settingsSection').classList.contains('hidden') === false) {
        renderManageTeachers(); // 管理用リストを更新
    }
}

function initTeacherDragAndDrop() {
    const teacherInput = document.getElementById('classTeacher');
    const suggestions = document.getElementById('teacherSuggestions');

    if (!teacherInput) return;

    // 入力時のサジェスト表示
    if (suggestions) {
        teacherInput.addEventListener('input', () => {
            const query = teacherInput.value.trim().toLowerCase();
            if (query.length < 1) {
                suggestions.classList.add('hidden');
                return;
            }

            // 最後のカンマ以降のワードを取得（複数入力対応）
            const lastPart = query.split(/[,、\s]+/).pop();
            if (lastPart.length < 1) {
                suggestions.classList.add('hidden');
                return;
            }

            const filtered = ALL_TEACHERS.filter(t =>
                t.name.toLowerCase().includes(lastPart) ||
                (t.dept && t.dept.toLowerCase().includes(lastPart))
            );

            renderTeacherSuggestions(filtered.slice(0, 10));
        });
    }

    // 検索（パネル内）
    const searchInput = document.getElementById('teacherSearchInput');
    if (searchInput) {
        searchInput.oninput = () => {
            const query = searchInput.value.trim().toLowerCase();
            const filtered = ALL_TEACHERS.filter(t =>
                t.name.toLowerCase().includes(query) || (t.dept && t.dept.toLowerCase().includes(query))
            );
            renderTeacherList(filtered);
        };
    }

    // 外側クリックでサジェストを閉じる
    if (teacherInput && suggestions) {
        document.addEventListener('click', (e) => {
            if (!teacherInput.contains(e.target) && !suggestions.contains(e.target)) {
                suggestions.classList.add('hidden');
            }
        });
    }

    // ドラッグ＆ドロップ
    if (teacherInput) {
        teacherInput.ondragover = (e) => {
            e.preventDefault();
            teacherInput.classList.add('drop-over');
        };

        teacherInput.ondragleave = () => {
            teacherInput.classList.remove('drop-over');
        };

        teacherInput.ondrop = (e) => {
            e.preventDefault();
            teacherInput.classList.remove('drop-over');
            const name = e.dataTransfer.getData('text/plain');
            if (name) {
                appendTeacherName(name);
            }
        };

        // ペーストイベント処理
        teacherInput.addEventListener('paste', (e) => {
            e.preventDefault();
            const pastedText = (e.clipboardData || window.clipboardData).getData('text');
            if (pastedText) {
                handleTeacherPaste(pastedText);
            }
        });
    }

    // 追加ボタンのイベントリスナー（重複登録を避けるため削除）
    // 注：このコードはinitializeMyClasses内に移動済み
}

function renderTeacherSuggestions(list) {
    const suggestions = document.getElementById('teacherSuggestions');
    if (!suggestions) return;

    if (list.length === 0) {
        suggestions.classList.add('hidden');
        return;
    }

    suggestions.innerHTML = list.map(t => `
        <div class="suggestion-item" onclick="appendTeacherName('${t.name}'); document.getElementById('teacherSuggestions').classList.add('hidden');">
            <div>
                <span class="suggestion-name">${t.name}</span>
                <span style="font-size: 0.7rem; color: #666; margin-left: 8px;">(${t.dept || '-'})</span>
            </div>
        </div>
    `).join('');

    suggestions.classList.remove('hidden');
}

function appendTeacherName(name) {
    const teacherInput = document.getElementById('classTeacher');
    if (!teacherInput) return;

    // 直接追加を試みる
    if (selectedTeachers.length < 10) {
        if (!selectedTeachers.includes(name)) {
            selectedTeachers.push(name);
            updateTeachersDisplay();
            teacherInput.value = ''; // 入力をクリア

            // サジェストを閉じる
            const suggestions = document.getElementById('teacherSuggestions');
            if (suggestions) suggestions.classList.add('hidden');
        } else {
            alert('既に追加されています');
        }
    } else {
        alert('最大10人まで登録可能です');
    }

    teacherInput.focus();
}

/**
 * Jaro-Winkler距離を計算（氏名のゆらぎ対応）
 */
function jaroWinklerDistance(s1, s2) {
    const s1_lower = s1.toLowerCase();
    const s2_lower = s2.toLowerCase();

    if (s1_lower === s2_lower) return 1.0;
    if (s1_lower.length === 0 || s2_lower.length === 0) return 0.0;

    // Jaro距離を計算
    const maxLen = Math.max(s1_lower.length, s2_lower.length);
    const matchDistance = Math.floor(maxLen / 2) - 1;
    if (matchDistance < 0) return 0.0;

    let s1_matches = new Array(s1_lower.length).fill(false);
    let s2_matches = new Array(s2_lower.length).fill(false);
    let matches = 0;
    let transpositions = 0;

    for (let i = 0; i < s1_lower.length; i++) {
        const start = Math.max(0, i - matchDistance);
        const end = Math.min(i + matchDistance + 1, s2_lower.length);

        for (let j = start; j < end; j++) {
            if (s2_matches[j] || s1_lower[i] !== s2_lower[j]) continue;
            s1_matches[i] = true;
            s2_matches[j] = true;
            matches++;
            break;
        }
    }

    if (matches === 0) return 0.0;

    let k = 0;
    for (let i = 0; i < s1_lower.length; i++) {
        if (!s1_matches[i]) continue;
        while (!s2_matches[k]) k++;
        if (s1_lower[i] !== s2_lower[k]) transpositions++;
        k++;
    }

    const jaro = (matches / s1_lower.length +
        matches / s2_lower.length +
        (matches - transpositions / 2) / matches) / 3.0;

    // Winkler補正
    let prefix = 0;
    for (let i = 0; i < Math.min(4, Math.min(s1_lower.length, s2_lower.length)); i++) {
        if (s1_lower[i] === s2_lower[i]) prefix++;
        else break;
    }

    return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * ペーストされたテキストから氏名を抽出
 */
function extractNamesFromText(text) {
    // スペース、改行、タブ、カンマで分割
    const names = text
        .split(/[\s\n\t,、]/g)
        .map(n => n.trim())
        .filter(n => n.length > 0 && n.length < 30); // 妥当な長さの文字列のみ

    return names;
}

/**
 * 氏名をALL_TEACHERSから検索（ゆらぎ対応）
 */
function findTeacherByName(nameQuery) {
    const query = nameQuery.trim();
    if (query.length === 0) return null;

    // 完全一致チェック
    let found = ALL_TEACHERS.find(t => t.name === query);
    if (found) return { teacher: found, similarity: 1.0 };

    // ゆらぎを考慮した部分一致・類似度チェック
    let bestMatch = null;
    let bestSimilarity = 0;
    const threshold = 0.75; // 75%以上の類似度で採用

    for (const teacher of ALL_TEACHERS) {
        // パターン1：完全に含まれる
        if (teacher.name.includes(query) || query.includes(teacher.name)) {
            const sim = Math.min(query.length, teacher.name.length) /
                Math.max(query.length, teacher.name.length);
            if (sim > bestSimilarity) {
                bestMatch = { teacher, similarity: sim };
                bestSimilarity = sim;
            }
        }

        // パターン2：Jaro-Winkler距離
        if (bestSimilarity < threshold) {
            const sim = jaroWinklerDistance(query, teacher.name);
            if (sim > bestSimilarity && sim >= 0.8) {
                bestMatch = { teacher, similarity: sim };
                bestSimilarity = sim;
            }
        }
    }

    if (bestMatch && bestSimilarity >= threshold) {
        return bestMatch;
    }

    return null;
}

/**
 * ペーストされたテキストを処理（複数氏名の自動検索・登録）
 */
function handleTeacherPaste(pastedText) {
    const names = extractNamesFromText(pastedText);
    if (names.length === 0) return;

    // 処理対象の氏名
    let processedNames = [];
    let unknownNames = [];

    // 各氏名を検索
    names.forEach(name => {
        const result = findTeacherByName(name);
        if (result) {
            processedNames.push(result.teacher.name);
            console.log(`✓ "${name}" → "${result.teacher.name}" (類似度: ${(result.similarity * 100).toFixed(1)}%)`);
        } else {
            unknownNames.push(name);
            console.log(`✗ "${name}" は登録されていません`);
        }
    });

    // 確認ダイアログを表示（複数教員の場合、または未登録がいる場合）
    if (unknownNames.length > 0 || names.length > 1) {
        handleUnknownTeachers(unknownNames, processedNames);
    } else if (processedNames.length === 1) {
        // 1名だけで、かつ既知の教員の場合のみ直接入力
        const teacherInput = document.getElementById('classTeacher');
        teacherInput.value = processedNames[0];
        teacherInput.dispatchEvent(new Event('input', { bubbles: true }));
    }
}


/**
 * 未登録教員の処理（確認ダイアログ）
 */
function handleUnknownTeachers(unknownNames, foundNames) {
    const unknownStr = unknownNames.join('、');

    // 確認ダイアログ
    const options = {
        found: foundNames.join('、'),
        unknown: unknownNames,
        shouldRegister: false
    };


    // HTMLダイアログで確認
    showTeacherPasteDialog(options);
}

/**
 * 教員ペースト確認ダイアログを表示
 */
function showTeacherPasteDialog(options) {
    let html = '<div style="font-size: 0.9rem; line-height: 1.6;">';

    if (options.found) {
        html += `<div style="margin-bottom: 1rem; padding: 0.5rem; background: #e8f5e9; border-radius: 4px; color: #2e7d32;">
            <strong>✓ 見つかった教員:</strong><br>
            ${options.found.replace(/、/g, '<br>')}
        </div>`;
    }

    html += `<div style="margin-bottom: 1rem; padding: 0.5rem; background: #fff3e0; border-radius: 4px; color: #e65100;">
        <strong>? 未登録の教員:</strong><br>
        ${options.unknown.join('<br>')}
    </div>`;

    html += `<div style="margin-top: 1rem;">
        <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
            <input type="checkbox" id="autoRegisterCheckbox" checked>
            <span>未登録教員を自動登録する</span>
        </label>
    </div></div>`;

    // ダイアログを作成
    const dialog = document.createElement('div');
    dialog.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; border: 2px solid #1976d2; border-radius: 8px; padding: 1.5rem; z-index: 10000; max-width: 500px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);';

    dialog.innerHTML = `
        <div style="margin-bottom: 1.5rem;">
            <h3 style="margin: 0 0 1rem 0; color: #1976d2;">ペーストされた教員情報の処理</h3>
            ${html}
        </div>
        <div style="display: flex; gap: 1rem; justify-content: flex-end;">
            <button onclick="document.getElementById('teacherPasteOverlay')?.remove(); document.getElementById('teacherPasteDialog')?.remove();" style="padding: 0.5rem 1rem; background: #e0e0e0; border: 1px solid #999; border-radius: 4px; cursor: pointer;">キャンセル</button>
            <button id="confirmTeacherPasteBtn" onclick='confirmTeacherPaste(${JSON.stringify(options)})' style="padding: 0.5rem 1rem; background: #1976d2; color: white; border: none; border-radius: 4px; cursor: pointer;">確認して登録</button>

        </div>
    `;

    // オーバーレイを追加
    const overlay = document.createElement('div');
    overlay.id = 'teacherPasteOverlay';
    overlay.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.5); z-index: 9999;';
    overlay.onclick = () => {
        overlay.remove();
        dialog.remove();
    };

    dialog.id = 'teacherPasteDialog';

    document.body.appendChild(overlay);
    document.body.appendChild(dialog);

}

/**
 * 教員ペースト確認ダイアログの「確認して登録」ボタン処理
 */
window.confirmTeacherPaste = function (options) {
    if (typeof options === 'string') {
        try {
            options = JSON.parse(decodeURIComponent(options));
        } catch (e) {
            console.error('Failed to parse options:', e);
            return;
        }
    }
    const autoRegister = document.getElementById('autoRegisterCheckbox')?.checked || false;

    // 確認ダイアログを削除
    document.getElementById('teacherPasteOverlay')?.remove();
    document.getElementById('teacherPasteDialog')?.remove();


    // 未登録教員を登録
    if (autoRegister && options.unknown.length > 0) {
        options.unknown.forEach(name => {
            // 既に登録されていないかチェック
            if (!ALL_TEACHERS.find(t => t.name === name)) {
                registerNewTeacher(name, '不明');
            }
        });
    }

    // 教員入力欄に登録
    const allNames = [...options.found.split('、').filter(n => n.trim() !== ''), ...options.unknown];
    const cleanedNames = allNames.filter(n => typeof n === 'string' && n.trim() !== '');
    const uniqueNames = [...new Set(cleanedNames)]; // 重複排除
    const finalNames = uniqueNames.slice(0, 10); // 最大10個まで
    const teacherInput = document.getElementById('classTeacher');
    teacherInput.value = finalNames.join(', ');
    teacherInput.dispatchEvent(new Event('input', { bubbles: true }));

    console.log('教員が登録されました:', allNames);
}

/**
 * 新規教員をマスターリストに登録
 */
function registerNewTeacher(name, dept = '不明') {
    if (!name || typeof name !== 'string') {
        console.warn('無効な教員名です:', name);
        return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
        console.warn('空の教員名は登録できません');
        return;
    }
    const newTeacher = { name: trimmedName, dept: dept.trim() };
    ALL_TEACHERS.push(newTeacher);

    // localStorageに保存
    saveTeachersData();
    console.log(`教員 "${trimmedName}" を登録しました`);
}

function renderTeacherList(list = ALL_TEACHERS) {
    const items = document.getElementById('teacherListItems');
    if (!items) return;

    items.innerHTML = list.map(t => `
        <div class="teacher-item" draggable="true" ondragstart="handleTeacherDragStart(event, '${t.name}')">
            <span>${t.name}</span>
            <span class="teacher-dept">${t.dept}</span>
        </div>
    `).join('');
}

function handleTeacherDragStart(e, name) {
    e.dataTransfer.setData('text/plain', name);
    e.dataTransfer.effectAllowed = 'copy';
}

function closeTeacherList() {
    const container = document.getElementById('teacherListContainer');
    if (container) container.classList.add('hidden');
}

// グローバルスコープに教員処理関数を登録
window.handleTeacherPaste = handleTeacherPaste;
window.confirmTeacherPaste = confirmTeacherPaste;
window.showTeacherPasteDialog = showTeacherPasteDialog;
window.addTeacherToList = addTeacherToList;

// =============================
// 各種設定・管理機能
// =============================

let teacherSortConfig = { key: 'dept', asc: true };
let courseSortConfig = { key: 'grade', asc: true };

function switchSettingsTab(tab) {
    const courseTab = document.getElementById('tabManageCourses');
    const teacherTab = document.getElementById('tabManageTeachers');

    const courseView = document.getElementById('settingsCoursesView');
    const teacherView = document.getElementById('settingsTeachersView');

    // Reset tabs
    [courseTab, teacherTab].forEach(t => t?.classList.remove('active'));
    [courseView, teacherView].forEach(v => v?.classList.add('hidden'));

    if (tab === 'courses') {
        courseTab.classList.add('active');
        courseView.classList.remove('hidden');
        renderManageCourses();
    } else {
        // Default to Teachers
        teacherTab.classList.add('active');
        teacherView.classList.remove('hidden');
        renderManageTeachers();
    }
}

function renderManageCourses() {
    const tbody = document.getElementById('manageCoursesBody');
    const searchInput = document.getElementById('courseMasterSearch');
    if (!tbody) return;

    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

    // フィルター
    let filtered = ALL_COURSES.filter(c =>
        c.name.toLowerCase().includes(searchTerm) ||
        String(c.grade).includes(searchTerm) ||
        c.course.toLowerCase().includes(searchTerm)
    );

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" class="text-center">${ALL_COURSES.length === 0 ? "授業候補が登録されていません" : "該当する授業がありません"}</td></tr>`;
        return;
    }

    // ソート
    filtered.sort((a, b) => {
        let valA = a[courseSortConfig.key];
        let valB = b[courseSortConfig.key];

        let res = 0;
        if (typeof valA === 'string') {
            res = valA.localeCompare(valB, 'ja');
        } else {
            res = valA - valB;
        }
        return courseSortConfig.asc ? res : -res;
    });

    // 並び替えアイコン更新
    updateSortIcons('course', courseSortConfig);

    tbody.innerHTML = filtered.map((c, index) => {
        const originalIndex = ALL_COURSES.findIndex(src => src.name === c.name && src.grade === c.grade && src.course === c.course);
        const courseLabels = { 'common': '一般', 'M': 'M', 'D': 'D', 'E': 'E', 'I': 'I' };

        return `
            <tr>
                <td>${c.grade}年</td>
                <td>${courseLabels[c.course] || c.course}</td>
                <td><strong>${c.name}</strong></td>
                <td>
                    <div style="display: flex; gap: 5px;">
                        <button class="btn btn-outline-primary btn-sm btn-action" onclick="openCourseEditModal(${originalIndex})">✏️</button>
                        <button class="btn btn-outline-danger btn-sm btn-action" onclick="deleteCourseMaster(${originalIndex})">\uD83D\uDDD1️</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function sortCourseMaster(key) {
    if (courseSortConfig.key === key) {
        courseSortConfig.asc = !courseSortConfig.asc;
    } else {
        courseSortConfig.key = key;
        courseSortConfig.asc = true;
    }
    renderManageCourses();
}

// 候補授業（マスター）編集モーダル
function openCourseEditModal(index = -1) {
    const modal = document.getElementById('courseEditModal');
    const title = document.getElementById('courseEditModalTitle');
    const idInput = document.getElementById('editingCourseIndex');
    const nameInput = document.getElementById('editCourseName');
    const gradeInput = document.getElementById('editCourseGrade');
    const deptInput = document.getElementById('editCourseDept');

    if (!modal) return;

    if (index >= 0) {
        const c = ALL_COURSES[index];
        title.innerText = '候補授業の編集';
        idInput.value = index;
        nameInput.value = c.name;
        gradeInput.value = c.grade;
        deptInput.value = c.course;
    } else {
        title.innerText = '新規候補授業の追加';
        idInput.value = -1;
        nameInput.value = '';
        gradeInput.value = 1;
        deptInput.value = 'common';
    }

    modal.classList.remove('hidden');
}

function closeCourseEditModal() {
    const modal = document.getElementById('courseEditModal');
    if (modal) modal.classList.add('hidden');
}

function saveCourseMaster() {
    const index = parseInt(document.getElementById('editingCourseIndex').value);
    const name = document.getElementById('editCourseName').value.trim();
    const grade = parseInt(document.getElementById('editCourseGrade').value);
    const course = document.getElementById('editCourseDept').value;

    if (!name) {
        alert('授業名を入力してください');
        return;
    }

    const courseData = { name, grade, course };

    if (index >= 0) {
        ALL_COURSES[index] = courseData;
    } else {
        ALL_COURSES.push(courseData);
    }

    saveCoursesData();
    closeCourseEditModal();
}

function deleteCourseMaster(index) {
    if (!confirm(`「${ALL_COURSES[index].name}」を候補リストから削除してもよろしいですか？`)) return;
    ALL_COURSES.splice(index, 1);
    saveCoursesData();
}


function renderManageTeachers() {
    const tbody = document.getElementById('manageTeachersBody');
    const searchInput = document.getElementById('teacherMasterSearch');
    if (!tbody) return;

    const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';

    // フィルター
    let filtered = ALL_TEACHERS.filter(t =>
        t.name.toLowerCase().includes(searchTerm) ||
        (t.dept && t.dept.toLowerCase().includes(searchTerm))
    );

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" class="text-center">${ALL_TEACHERS.length === 0 ? "教員が登録されていません" : "該当する教員がいません"}</td></tr>`;
        return;
    }

    // ソート
    filtered.sort((a, b) => {
        let valA = a[teacherSortConfig.key] || '';
        let valB = b[teacherSortConfig.key] || '';
        const res = valA.localeCompare(valB, 'ja');
        return teacherSortConfig.asc ? res : -res;
    });

    // 並び替えアイコン更新
    updateSortIcons('teacher', teacherSortConfig);

    tbody.innerHTML = filtered.map((t, index) => {
        // 元の配列でのインデックスを探す（編集用）
        const originalIndex = ALL_TEACHERS.findIndex(teach => teach.name === t.name && teach.dept === t.dept);

        return `
            <tr>
                <td><strong>${t.name}</strong></td>
                <td>${t.dept || '-'}</td>
                <td>
                    <div style="display: flex; gap: 5px;">
                        <button class="btn btn-outline-primary btn-sm btn-action" onclick="openTeacherEditModal(${originalIndex})">✏️</button>
                        <button class="btn btn-outline-danger btn-sm btn-action" onclick="deleteTeacher(${originalIndex})">\uD83D\uDDD1️</button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function sortTeacherMaster(key) {
    if (teacherSortConfig.key === key) {
        teacherSortConfig.asc = !teacherSortConfig.asc;
    } else {
        teacherSortConfig.key = key;
        teacherSortConfig.asc = true;
    }
    renderManageTeachers();
}

function updateSortIcons(type, config) {
    const icons = {
        'course': { 'grade': 'sortIconGrade', 'course': 'sortIconCourse', 'name': 'sortIconCourseName' },
        'teacher': { 'name': 'sortIconTeacherName', 'dept': 'sortIconTeacherDept' }
    };

    const typeIcons = icons[type];
    for (const key in typeIcons) {
        const el = document.getElementById(typeIcons[key]);
        if (!el) continue;
        if (key === config.key) {
            el.textContent = config.asc ? '▲' : '▼';
            el.style.color = 'var(--primary-blue)';
        } else {
            el.textContent = '⇅';
            el.style.color = 'var(--neutral-400)';
        }
    }
}

// 教員編集モーダル
function openTeacherEditModal(index = -1) {
    const modal = document.getElementById('teacherEditModal');
    const title = document.getElementById('teacherEditModalTitle');
    const idInput = document.getElementById('editingTeacherIndex');
    const nameInput = document.getElementById('editTeacherName');
    const deptInput = document.getElementById('editTeacherDept');

    if (!modal) return;

    if (index >= 0) {
        const t = ALL_TEACHERS[index];
        title.innerText = '教員情報の編集';
        idInput.value = index;
        nameInput.value = t.name;
        deptInput.value = t.dept;
    } else {
        title.innerText = '新規教員の登録';
        idInput.value = -1;
        nameInput.value = '';
        deptInput.value = '';
    }

    modal.classList.remove('hidden');
}

function closeTeacherEditModal() {
    const modal = document.getElementById('teacherEditModal');
    if (modal) modal.classList.add('hidden');
}

function saveTeacher() {
    const index = parseInt(document.getElementById('editingTeacherIndex').value);
    const name = document.getElementById('editTeacherName').value.trim();
    const dept = document.getElementById('editTeacherDept').value.trim();

    if (!name) {
        alert('氏名を入力してください');
        return;
    }

    const teacherData = { name, dept };

    if (index >= 0) {
        ALL_TEACHERS[index] = teacherData;
    } else {
        ALL_TEACHERS.push(teacherData);
    }

    saveTeachersData();
    closeTeacherEditModal();
}

function deleteTeacher(index) {
    if (!confirm(`「${ALL_TEACHERS[index].name}」先生を削除してもよろしいですか？`)) return;
    ALL_TEACHERS.splice(index, 1);
    saveTeachersData();
}

window.switchSettingsTab = switchSettingsTab;
window.renderManageTeachers = renderManageTeachers;
window.renderManageCourses = renderManageCourses;
window.openTeacherEditModal = openTeacherEditModal;
window.closeTeacherEditModal = closeTeacherEditModal;
window.saveTeacher = saveTeacher;
window.deleteTeacher = deleteTeacher;
window.sortTeacherMaster = sortTeacherMaster;

window.openCourseEditModal = openCourseEditModal;
window.closeCourseEditModal = closeCourseEditModal;
window.saveCourseMaster = saveCourseMaster;
window.deleteCourseMaster = deleteCourseMaster;
window.sortCourseMaster = sortCourseMaster;
