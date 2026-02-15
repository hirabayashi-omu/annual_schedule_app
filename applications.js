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
 * コースIDを正式名称に変換
 */
function getFullCourseName(id) {
    const map = {
        'M': 'エネルギー機械コース　M',
        'D': 'プロダクトデザインコース　D',
        'E': 'エレクトロニクスコース　E',
        'I': '知能情報コース I'
    };
    return map[id] || id || '';
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

    try {
        if (type === 'shift') {
            await fillShiftApplication(fileName);
        } else if (type === 'wfh_pre') {
            await fillWfhPreApplication(fileName);
        } else if (type === 'wfh_post') {
            await fillWfhPostApplication(fileName);
        } else if (type === 'trip') {
            await fillTripApplication(fileName);
        } else {
            // 他のタイプ（現在は雛形そのままのダウンロード）
            if (window.TEMPLATES_CONTENT && window.TEMPLATES_CONTENT[fileName]) {
                const buffer = base64ToArrayBuffer(window.TEMPLATES_CONTENT[fileName]);
                const blob = new Blob([buffer], { type: 'application/octet-stream' });
                const link = document.createElement('a');
                link.href = URL.createObjectURL(blob);
                link.download = fileName;
                link.click();
            } else {
                const link = document.createElement('a');
                link.href = encodeURI('template/' + fileName);
                link.download = fileName;
                link.click();
            }
        }
    } catch (err) {
        console.error(err);
        alert("書類作成中にエラーが発生しました:\n" + err.message);
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
                user_dept: getFullCourseName(profile.course) || profile.user_dept || '',
                course: getFullCourseName(profile.course) || profile.user_dept || '',
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

                    // 分割データ (Before) - テンプレートから除去されたが、ロジックも整理
                    const bParts = splitShiftInfo(item.before);
                    const isBeforeAtoE = ['A', 'B', 'C', 'D', 'E'].includes(item.before?.id);
                    viewData[`${prefix}b_p`] = bParts.pattern;
                    viewData[`${prefix}b_sh`] = isBeforeAtoE ? '' : bParts.startH;
                    viewData[`${prefix}b_sm`] = isBeforeAtoE ? '' : bParts.startM;
                    viewData[`${prefix}b_eh`] = isBeforeAtoE ? '' : bParts.endH;
                    viewData[`${prefix}b_em`] = isBeforeAtoE ? '' : bParts.endM;
                    // パターン別〇印 (Before)
                    ['A', 'B', 'C', 'D', 'E'].forEach(p => {
                        viewData[`${prefix}b_${p}`] = (bParts.pattern === p) ? '〇' : '';
                    });
                    viewData[`${prefix}b_other`] = (item.before?.id === 'Other') ? '〇' : '';

                    // 分割データ (After) - A-Eの場合は時間を記入せず、その他の場合のみ記入する
                    const aParts = splitShiftInfo(item.after);
                    const isAfterAtoE = ['A', 'B', 'C', 'D', 'E'].includes(item.after.id);
                    viewData[`${prefix}a_p`] = aParts.pattern;
                    viewData[`${prefix}a_sh`] = isAfterAtoE ? '' : aParts.startH;
                    viewData[`${prefix}a_sm`] = isAfterAtoE ? '' : aParts.startM;
                    viewData[`${prefix}a_eh`] = isAfterAtoE ? '' : aParts.endH;
                    viewData[`${prefix}a_em`] = isAfterAtoE ? '' : aParts.endM;
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
                //XTTemplateError の詳細を出力
                console.error("Docxtemplater render error:", error);
                if (error.properties && error.properties.errors instanceof Array) {
                    const errorMessages = error.properties.errors.map(function (error) {
                        return error.properties.explanation;
                    }).join("\n");
                    console.error("Template Error Details:\n", errorMessages);
                    alert("テンプレートのタグにエラーがあります:\n" + errorMessages);
                } else {
                    alert("書類作成中にエラーが発生しました。テンプレートの形式（タグの書き方など）を確認してください。");
                }
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

/**
 * 在宅勤務（事前）申請書の作成 (ExcelJS)
 */
async function fillWfhPreApplication(fileName) {
    const profile = window.activeUserProfile || {};
    if (!profile.name) {
        alert('「あなたについて」タブでプロフィール情報を入力してください。');
        return;
    }

    const wfhEvents = classOverrides.filter(ov => ov.data && ov.data.isWfhCard && !ov.data.isApplied);
    if (wfhEvents.length === 0) {
        alert('申請が必要な未申請の在宅勤務データが見つかりません。');
        return;
    }

    const groups = {};
    wfhEvents.forEach(ov => {
        const date = new Date(ov.date.replace(/-/g, '/'));
        const monthKey = `${date.getFullYear()}-${date.getMonth() + 1}`;
        if (!groups[monthKey]) groups[monthKey] = [];
        groups[monthKey].push(ov);
    });

    const templateBase64 = window.TEMPLATES_CONTENT[fileName];
    if (!templateBase64) throw new Error("テンプレートが見つかりません: " + fileName);
    const templateBuffer = base64ToArrayBuffer(templateBase64);

    for (const monthKey in groups) {
        const events = groups[monthKey].sort((a, b) => a.date.localeCompare(b.date));
        const firstDate = new Date(events[0].date.replace(/-/g, '/'));
        const reiwa = getReiwaDate(firstDate);

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(templateBuffer);
        const targetSheet = workbook.worksheets.find(s => s.name.includes("新様式")) || workbook.worksheets[0];

        // 書き込み
        targetSheet.getCell('H1').value = reiwa.year;
        targetSheet.getCell('J1').value = reiwa.month;
        targetSheet.getCell('K4').value = getFullCourseName(profile.course);
        targetSheet.getCell('K5').value = profile.staffId || '';
        targetSheet.getCell('K6').value = profile.name || '';

        events.forEach((ov, idx) => {
            const row = 9 + idx;
            const d = new Date(ov.date.replace(/-/g, '/'));
            const timeStr = (ov.data.startTime && ov.data.endTime)
                ? `${ov.data.startTime}～${ov.data.endTime}`
                : '08:45～17:15';

            targetSheet.getCell(`C${row}`).value = `${d.getDate()}日`;
            targetSheet.getCell(`D${row}`).value = timeStr;
            targetSheet.getCell(`G${row}`).value = ov.data.location || '自宅';
        });

        const outBuffer = await workbook.xlsx.writeBuffer();
        saveBlob(outBuffer, `在宅勤務事前申請_${reiwa.month}月_${profile.name}.xlsx`);
    }
}

/**
 * 在宅勤務（事後）申請書の作成 (ExcelJS)
 */
async function fillWfhPostApplication(fileName) {
    const profile = window.activeUserProfile || {};
    const wfhEvents = classOverrides.filter(ov => ov.data && ov.data.isWfhCard && !ov.data.isApplied);
    if (wfhEvents.length === 0) {
        alert('申請が必要な未申請の在宅勤務データが見つかりません。');
        return;
    }

    const templateBase64 = window.TEMPLATES_CONTENT[fileName];
    if (!templateBase64) throw new Error("テンプレートが見つかりません: " + fileName);
    const templateBuffer = base64ToArrayBuffer(templateBase64);

    for (const ov of wfhEvents) {
        const date = new Date(ov.date.replace(/-/g, '/'));
        const dateStr = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
        const startTime = ov.data.startTime || '08:45';
        const endTime = ov.data.endTime || '17:15';

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(templateBuffer);

        workbook.worksheets.forEach(sheet => {
            if (!sheet.name.includes("実施申請書") && !sheet.name.includes("実施報告書")) return;

            sheet.getCell('D5').value = `${dateStr} ${startTime}`;
            sheet.getCell('L5').value = `${dateStr} ${endTime}`;
            sheet.getCell('G6').value = getFullCourseName(profile.course);
            sheet.getCell('N6').value = profile.name || '';

            const [sH, sM] = (startTime || "08:45").split(':').map(Number);
            const [eH, eM] = (endTime || "17:15").split(':').map(Number);
            if ((eH * 60 + eM) - (sH * 60 + sM) >= 240) {
                sheet.getCell('B11').value = '12';
                sheet.getCell('D11').value = '20';
                sheet.getCell('F11').value = '13';
                sheet.getCell('H11').value = '05';
                sheet.getCell('I11').value = '昼食';
            }
        });

        const outBuffer = await workbook.xlsx.writeBuffer();
        saveBlob(outBuffer, `在宅勤務実施報告_${date.getMonth() + 1}${date.getDate()}_${profile.name}.xlsx`);
    }
}

/**
 * 出張申請書の作成 (ExcelJS)
 */
async function fillTripApplication(fileName) {
    const profile = window.activeUserProfile || {};
    const tripEvents = classOverrides.filter(ov => ov.data && ov.data.isTripCard && !ov.data.isApplied);
    if (tripEvents.length === 0) {
        alert('申請が必要な未申請の出張データが見つかりません。');
        return;
    }

    const templateBase64 = window.TEMPLATES_CONTENT[fileName];
    if (!templateBase64) throw new Error("テンプレートが見つかりません: " + fileName);
    const templateBuffer = base64ToArrayBuffer(templateBase64);

    for (const ov of tripEvents) {
        const details = ov.data.tripDetails || {};
        const startDate = new Date(ov.startDate.replace(/-/g, '/'));
        const endDate = new Date(ov.endDate.replace(/-/g, '/'));
        const today = getReiwaDate(new Date());

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(templateBuffer);
        const targetSheet = workbook.worksheets.find(s => s.name.includes("旅行命令")) || workbook.worksheets[0];

        targetSheet.getCell('N9').value = profile.rank || '';
        targetSheet.getCell('AN8').value = profile.name || '';
        targetSheet.getCell('BE6').value = `${today.month}月${today.day}日`;

        targetSheet.getCell('G13').value = `${startDate.getFullYear()}/${startDate.getMonth() + 1}/${startDate.getDate()}`;
        targetSheet.getCell('R13').value = `${endDate.getFullYear()}/${endDate.getMonth() + 1}/${endDate.getDate()}`;

        targetSheet.getCell('G15').value = details.depPoint === 'school' ? '工業高等専門学校' : '自宅';
        targetSheet.getCell('G17').value = details.arrPoint === 'school' ? '工業高等専門学校' : '自宅';

        if (details.depPoint === 'school') {
            targetSheet.getCell('V15').value = '京阪本線';
            targetSheet.getCell('V16').value = '寝屋川市駅';
        }
        if (details.arrPoint === 'school') {
            targetSheet.getCell('V17').value = '京阪本線';
            targetSheet.getCell('V18').value = '寝屋川市駅';
        }

        targetSheet.getCell('B22').value = `${startDate.getFullYear()}/${startDate.getMonth() + 1}/${startDate.getDate()}`;
        targetSheet.getCell('G22').value = details.destination || ov.data.location || '';

        const outBuffer = await workbook.xlsx.writeBuffer();
        saveBlob(outBuffer, `出張上申書_${startDate.getMonth() + 1}${startDate.getDate()}_${profile.name}.xlsx`);
    }
}

/**
 * Blobとして保存してダウンロード
 */
function saveBlob(buffer, fileName) {
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
