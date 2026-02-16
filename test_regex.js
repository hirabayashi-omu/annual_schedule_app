
const events = [
    { event: "【午前】火曜授業", name: undefined, weekdayCount: "火" },
    { event: "", name: undefined, weekdayCount: "【午前】火曜授業" },
    { event: "【午後】火曜授業", name: undefined, weekdayCount: "" },
    { event: "午前打切り", name: "", weekdayCount: "" },
    { event: "火曜授業(午前)", name: "", weekdayCount: "" },
];

function test(d) {
    const eventText = (d.event || "");
    const combined = eventText + (d.name || "") + (d.weekdayCount || "");

    const isMorningMatch =
        (combined.includes("午前") && !combined.includes("午前打ち切り")) ||
        combined.includes("午後打ち切り") ||
        combined.includes("●") ||
        /[【（(]午前[)）】]/.test(combined);

    const isAfternoonMatch =
        (combined.includes("午後") && !combined.includes("午後打ち切り")) ||
        combined.includes("午前打ち切り") ||
        /[【（(]午後[)）】]/.test(combined);

    console.log(`Text: "${combined}" | Morning: ${isMorningMatch} | Afternoon: ${isAfternoonMatch}`);
}

events.forEach(test);
