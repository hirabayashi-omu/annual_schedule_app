/**
 * 申請書類の自動生成・雛形ダウンロード
 */
/**
 * 令和年度への変換
 */
function getReiwaDate(date) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    const dayNames = ['日', '月', '火', '水', '木', '金', '土'];
    const dayName = dayNames[date.getDay()];

    // 2019年5月1日が令和元年
    const reiwaYear = y - 2018;
    return {
        year: reiwaYear,
        month: m,
        day: d,
        weekday: dayName,
        full: `令和${reiwaYear === 1 ? '元' : reiwaYear}年${m}月${d}日`
    };
}

/**
 * 勤務パターンの〇記号付き文字列を生成
 */
function formatShiftChoice(selectedShift) {
    const shifts = ['A', 'B', 'C', 'D', 'E'];
    return shifts.map(s => (s === selectedShift ? `〇 ${s}` : s)).join('　');
}

/**
 * Base64をArrayBufferに変換
 */
function base64ToArrayBuffer(base64) {
    try {
        const binaryString = window.atob(base64);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes.buffer;
    } catch (e) {
        console.error("Base64 decoding failed:", e);
        throw new Error("テンプレートデータの復元に失敗しました。データが壊れている可能性があります。");
    }
}

/**
 * 申請書類の自動生成
 */
window.generateApplicationFile = async function (type) {
    console.log("generateApplicationFile called for:", type);
    const templates = {
        'shift': '勤務パターン変更.docx',
        'wfh_pre': '在宅事前.xlsx',
        'wfh_post': '在宅事後.xlsx',
        'holiday_work': '休日出勤.xlsx',
        'trip': '出張.xlsx'
    };

    const fileName = templates[type];
    if (!fileName) return;

    if (type === 'shift') {
        try {
            await fillShiftApplication(fileName);
        } catch (err) {
            console.error(err);
            alert("エラーが発生しました:\n" + err.message);
        }
        return;
    }

    // 他のタイプ（現在は雛形そのままのダウンロード）も内蔵データから取得
    if (window.TEMPLATES_CONTENT && window.TEMPLATES_CONTENT[fileName]) {
        const buffer = base64ToArrayBuffer(window.TEMPLATES_CONTENT[fileName]);
        const blob = new Blob([buffer], { type: 'application/octet-stream' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        link.click();
    } else {
        // 万が一データがない場合は直接パスへ(従来の挙動)
        const link = document.createElement('a');
        link.href = encodeURI('template/' + fileName);
        link.download = fileName;
        link.click();
    }
};

/**
 * 勤務パターン変更届の作成
 */
async function fillShiftApplication(fileName) {
    console.log("Start fillShiftApplication");

    // ライブラリチェック
    if (typeof PizZip === 'undefined') {
        throw new Error("PizZip ライブラリが読み込まれていません。インターネット接続を確認するか、index.html の設定を確認してください。");
    }
    const DocxTemplater = window.docxtemplater || window.Docxtemplater;
    if (!DocxTemplater) {
        throw new Error("docxtemplater ライブラリが読み込まれていません。");
    }

    const profile = window.activeUserProfile || {};
    if (!profile.name) {
        alert('「あなたについて」メニューで氏名等の基本情報を設定してください。');
        const profileBtn = Array.from(document.querySelectorAll('.drawer-item')).find(i => i.dataset.view === 'profileSection');
        if (profileBtn) profileBtn.click();
        return;
    }

    // 1. 対象データの収集（未申請の勤務変更）
    const targets = [];
    if (typeof workOverrides !== 'undefined') {
        const sortedDates = Object.keys(workOverrides).sort();
        for (const dateStr of sortedDates) {
            const ov = workOverrides[dateStr];
            if (!ov.isApplied) {
                const dateObj = typeof parseDateKey === 'function' ? parseDateKey(dateStr) : new Date(dateStr.replace(/-/g, '/'));
                const beforeShift = typeof getWorkTimeForDate === 'function' ? getWorkTimeForDate(dateObj, true) : null;

                targets.push({
                    date: dateObj,
                    dateStr: dateStr,
                    reiwa: getReiwaDate(dateObj),
                    before: beforeShift ? { id: (beforeShift.id || Object.keys(WORK_SHIFTS).find(k => WORK_SHIFTS[k].name === beforeShift.name)), start: beforeShift.start, end: beforeShift.end } : null,
                    after: { id: ov.shift, start: ov.start, end: ov.end }
                });
            }
        }
    }

    if (targets.length === 0) {
        alert('申請が必要な（未申請の）勤務変更データが見つかりません。');
        return;
    }

    // 2. 5件ずつに分割
    const batches = [];
    for (let i = 0; i < targets.length; i += 5) {
        batches.push(targets.slice(i, i + 5));
    }

    if (!confirm(`${targets.length}件の変更が見つかりました。${batches.length}枚の申請書を作成しますか？`)) {
        return;
    }

    const nowReiwa = getReiwaDate(new Date());

    // 3. テンプレートの取得と処理
    const templateBase64 = window.TEMPLATES_CONTENT[fileName];
    if (!templateBase64) {
        throw new Error("テンプレートデータが見つかりません: " + fileName);
    }
    const templateBuffer = base64ToArrayBuffer(templateBase64);

    // 4. 各バッチについてファイル生成
    for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        try {
            console.log(`Processing batch ${i + 1}`, batch);

            // テンプレートバッファのコピーを使用（念のため）
            const zip = new PizZip(templateBuffer.slice(0));
            const doc = new DocxTemplater();
            doc.loadZip(zip);
            doc.setOptions({
                paragraphLoop: true,
                linebreaks: true,
                delimiters: { start: '{', end: '}' }
            });

            // データの準備 (タグ名の揺れに対応するためエイリアスを追加)
            const viewData = {
                today_year: nowReiwa.year,
                today_year_ad: new Date().getFullYear(),
                today_month: nowReiwa.month,
                today_day: nowReiwa.day,
                staff_id: profile.staffId || profile.staff_id || '',
                staffId: profile.staffId || profile.staff_id || '',
                user_name: profile.name || '',
                name: profile.name || '',
                user_dept: profile.course || profile.user_dept || '',
                course: profile.course || profile.user_dept || '',
                user_rank: profile.rank || profile.user_rank || '',
                rank: profile.rank || profile.user_rank || '',
            };

            // 行データ (1-5)
            for (let j = 0; j < 5; j++) {
                const item = batch[j];
                const prefix = `r${j + 1}_`;
                if (item) {
                    viewData[`${prefix}y`] = item.reiwa.year;
                    viewData[`${prefix}m`] = item.reiwa.month;
                    viewData[`${prefix}d`] = item.reiwa.day;
                    viewData[`${prefix}w`] = item.reiwa.weekday;
                    viewData[`${prefix}before`] = formatShiftChoice(item.before.id);
                    viewData[`${prefix}after`] = formatShiftChoice(item.after.id);

                    // 分割データ (Before)
                    const bParts = splitShiftInfo(item.before);
                    viewData[`${prefix}b_p`] = bParts.pattern;
                    viewData[`${prefix}b_sh`] = bParts.startH;
                    viewData[`${prefix}b_sm`] = bParts.startM;
                    viewData[`${prefix}b_eh`] = bParts.endH;
                    viewData[`${prefix}b_em`] = bParts.endM;
                    // パターン別〇印 (Before)
                    ['A', 'B', 'C', 'D', 'E'].forEach(p => {
                        viewData[`${prefix}b_${p}`] = (bParts.pattern === p) ? '〇' : '';
                    });
                    viewData[`${prefix}b_other`] = (item.before.id === 'Other') ? '〇' : '';

                    // 分割データ (After)
                    const aParts = splitShiftInfo(item.after);
                    viewData[`${prefix}a_p`] = aParts.pattern;
                    viewData[`${prefix}a_sh`] = aParts.startH;
                    viewData[`${prefix}a_sm`] = aParts.startM;
                    viewData[`${prefix}a_eh`] = aParts.endH;
                    viewData[`${prefix}a_em`] = aParts.endM;
                    // パターン別〇印 (After)
                    ['A', 'B', 'C', 'D', 'E'].forEach(p => {
                        viewData[`${prefix}a_${p}`] = (aParts.pattern === p) ? '〇' : '';
                    });
                    viewData[`${prefix}a_other`] = (item.after.id === 'Other') ? '〇' : '';

                } else {
                    const keys = [
                        'y', 'm', 'd', 'w', 'before', 'after',
                        'b_p', 'b_sh', 'b_sm', 'b_eh', 'b_em',
                        'b_A', 'b_B', 'b_C', 'b_D', 'b_E',
                        'b_other', // Added 'b_other'
                        'a_p', 'a_sh', 'a_sm', 'a_eh', 'a_em',
                        'a_A', 'a_B', 'a_C', 'a_D', 'a_E', 'a_other'
                    ];
                    keys.forEach(k => viewData[`${prefix}${k}`] = '');
                }
            }

            console.log("View Data for batch " + (i + 1) + ":", viewData);
            doc.setData(viewData);
            try {
                doc.render();
                console.log("Batch " + (i + 1) + " rendered successfully.");
            } catch (error) {
                console.error("Docxtemplater render error:", error);
                alert("書類作成中にエラーが発生しました。テンプレートの形式（タグの書き方など）を確認してください。");
                throw error;
            }

            const out = doc.getZip().generate({
                type: 'blob',
                mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            });

            const link = document.createElement('a');
            link.href = URL.createObjectURL(out);
            link.download = `勤務パターン変更願_${nowReiwa.month}${nowReiwa.day}_${i + 1}.docx`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            console.log("Download triggered for batch", i + 1);

        } catch (err) {
            console.error("Batch processing error:", err);
            throw new Error(`書類(${i + 1}枚目)の作成中にエラーが発生しました: ` + err.message);
        }
    }

    alert('全ての申請書の作成が完了しました。');
}

/**
 * 勤務パターンの情報を「記号」「時」「分」に分割する
 */
function splitShiftInfo(item) {
    const res = { pattern: '', startH: '', startM: '', endH: '', endM: '' };
    if (!item) return res;

    const shiftId = typeof item === 'object' ? item.id : item;

    // パターン記号 (A, B, C, D, E)
    if (['A', 'B', 'C', 'D', 'E'].includes(shiftId)) {
        res.pattern = shiftId;
    }

    // 時間の抽出
    let startStr = '';
    let endStr = '';

    const preDef = (typeof WORK_SHIFTS !== 'undefined') ? WORK_SHIFTS[shiftId] : null;
    if (preDef && preDef.start && preDef.end) {
        startStr = preDef.start;
        endStr = preDef.end;
    } else if (typeof item === 'object' && item.start && item.end) {
        startStr = item.start;
        endStr = item.end;
    }

    if (startStr && startStr.includes(':')) {
        const parts = startStr.split(':');
        res.startH = parts[0];
        res.startM = parts[1];
    }
    if (endStr && endStr.includes(':')) {
        const parts = endStr.split(':');
        res.endH = parts[0];
        res.endM = parts[1];
    }

    return res;
}
