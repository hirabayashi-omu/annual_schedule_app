/**
 * ユーザープロフィール情報の管理
 */
window.UserProfile = {
    data: {
        course: '',
        rank: '',
        staffId: '',
        name: '',
        email: '',
        subjects: []
    },

    load() {
        const saved = localStorage.getItem('user_profile');
        if (saved) {
            try {
                this.data = JSON.parse(saved);
            } catch (e) {
                console.error('Failed to parse user profile', e);
            }
        }
        // マイクラス側でも利用できるようにデータを公開
        window.activeUserProfile = this.data;
        this.render();
    },

    save() {
        this.data.course = document.getElementById('userCourse').value;
        this.data.rank = document.getElementById('userRank').value;
        this.data.staffId = document.getElementById('userStaffId').value;
        this.data.name = document.getElementById('userName').value;
        this.data.email = document.getElementById('userEmail').value;

        localStorage.setItem('user_profile', JSON.stringify(this.data));
        window.activeUserProfile = this.data;
        alert('プロフィール情報を保存しました。');
    },

    render() {
        const courseEl = document.getElementById('userCourse');
        const rankEl = document.getElementById('userRank');
        const staffIdEl = document.getElementById('userStaffId');
        const nameEl = document.getElementById('userName');
        const emailEl = document.getElementById('userEmail');

        if (courseEl) courseEl.value = this.data.course || '';
        if (rankEl) rankEl.value = this.data.rank || '';
        if (staffIdEl) staffIdEl.value = this.data.staffId || '';
        if (nameEl) nameEl.value = this.data.name || '';
        if (emailEl) emailEl.value = this.data.email || '';

        this.renderSubjects();
    },

    renderSubjects() {
        const container = document.getElementById('profileSubjectsDisplay');
        if (!container) return;

        container.innerHTML = '';
        if (!this.data.subjects || this.data.subjects.length === 0) {
            container.innerHTML = '<span style="color:var(--neutral-500); font-size:0.85rem;">科目を追加してください</span>';
            return;
        }

        this.data.subjects.forEach((subject, index) => {
            const badge = document.createElement('div');
            badge.className = 'subject-badge';
            badge.style.cssText = 'background:var(--primary-blue-light); border:1px solid var(--primary-blue); color:var(--primary-blue-dark); padding:4px 10px; border-radius:16px; display:flex; align-items:center; gap:8px; font-size:0.85rem; font-weight:600; animation: fadeIn 0.3s ease;';
            badge.innerHTML = `
                <span>${subject}</span>
                <span style="cursor:pointer; font-size:1.1rem; line-height:1;" onclick="UserProfile.removeSubject(${index})">&times;</span>
            `;
            container.appendChild(badge);
        });
    },

    addSubject(name) {
        if (!name) return;
        if (!this.data.subjects) this.data.subjects = [];
        if (!this.data.subjects.includes(name)) {
            this.data.subjects.push(name);
            this.renderSubjects();
        }
        document.getElementById('profileSubjectInput').value = '';
        document.getElementById('profileSubjectSuggestions').classList.add('hidden');
    },

    removeSubject(index) {
        this.data.subjects.splice(index, 1);
        this.renderSubjects();
    }
};

// 初期化
document.addEventListener('DOMContentLoaded', () => {
    UserProfile.load();

    const saveBtn = document.getElementById('saveProfileBtn');
    if (saveBtn) saveBtn.addEventListener('click', () => UserProfile.save());

    const addBtn = document.getElementById('addProfileSubjectBtn');
    if (addBtn) addBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const input = document.getElementById('profileSubjectInput');
        UserProfile.addSubject(input.value.trim());
    });

    const subjectInput = document.getElementById('profileSubjectInput');
    const suggestions = document.getElementById('profileSubjectSuggestions');

    if (subjectInput && suggestions) {
        subjectInput.addEventListener('input', () => {
            const query = subjectInput.value.trim().toLowerCase();
            if (query.length < 1) {
                suggestions.classList.add('hidden');
                return;
            }

            // ALL_COURSES は my_classes.js で定義されている前提
            const coursesSource = (typeof ALL_COURSES !== 'undefined') ? ALL_COURSES : [];
            const filtered = coursesSource.filter(c => c.name.toLowerCase().includes(query)).slice(0, 10);

            if (filtered.length > 0) {
                suggestions.innerHTML = '';
                filtered.forEach(c => {
                    const item = document.createElement('div');
                    item.className = 'suggestion-item';
                    item.style.padding = '8px 12px';
                    item.style.cursor = 'pointer';
                    item.style.borderBottom = '1px solid var(--neutral-100)';
                    item.innerHTML = `<div style="font-weight:600;">${c.name}</div><div style="font-size:0.75rem; color:var(--neutral-500);">${c.course}コース / ${c.grade}年</div>`;
                    item.onclick = () => UserProfile.addSubject(c.name);
                    suggestions.appendChild(item);
                });
                suggestions.classList.remove('hidden');
            } else {
                suggestions.classList.add('hidden');
            }
        });

        // エンターキーで追加
        subjectInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                UserProfile.addSubject(subjectInput.value.trim());
            }
        });

        // 外側クリックで閉じる
        document.addEventListener('click', (e) => {
            if (!subjectInput.contains(e.target) && !suggestions.contains(e.target)) {
                suggestions.classList.add('hidden');
            }
        });
    }
});
