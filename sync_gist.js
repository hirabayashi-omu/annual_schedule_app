/**
 * GitHub Gistを利用した同期機能の管理
 */
const GistSync = {
    settings: {
        token: '',
        gistId: ''
    },

    /**
     * 設定の読み込み
     */
    loadSettings() {
        const saved = localStorage.getItem('gist_sync_settings');
        if (saved) {
            try {
                this.settings = JSON.parse(saved);
            } catch (e) {
                console.error('Failed to parse gist sync settings', e);
            }
        }
        this.renderSettings();
    },

    /**
     * 設定の保存
     */
    saveSettings() {
        this.settings.token = document.getElementById('gistToken').value.trim();
        this.settings.gistId = document.getElementById('gistId').value.trim();
        localStorage.setItem('gist_sync_settings', JSON.stringify(this.settings));
        alert('同期設定を保存しました。');
    },

    /**
     * 設定画面への反映
     */
    renderSettings() {
        const tokenEl = document.getElementById('gistToken');
        const gistIdEl = document.getElementById('gistId');
        if (tokenEl) tokenEl.value = this.settings.token || '';
        if (gistIdEl) gistIdEl.value = this.settings.gistId || '';
    },

    /**
     * バックアップデータのまとまりを作成
     */
    prepareBackupData() {
        const type = 'all';
        const backupData = {};

        // グローバル変数から取得（app.js等で定義されている前提）
        if (typeof scheduleCache !== 'undefined') backupData.scheduleCache = scheduleCache;
        if (typeof myClasses !== 'undefined') backupData.myClasses = myClasses;
        if (typeof classOverrides !== 'undefined') backupData.classOverrides = classOverrides;

        try {
            backupData.assignmentExclusions = JSON.parse(localStorage.getItem('assignmentExclusions') || '{}');
            backupData.teacherMaster = JSON.parse(localStorage.getItem('teacherMaster') || '[]');
            backupData.courseMaster = JSON.parse(localStorage.getItem('courseMaster') || '[]');
            backupData.workSettings = JSON.parse(localStorage.getItem('workSettings') || '{}');
            backupData.workOverrides = JSON.parse(localStorage.getItem('workOverrides') || '{}');
            backupData.userProfile = JSON.parse(localStorage.getItem('user_profile') || '{}');
        } catch (e) { }

        backupData.timestamp = new Date().toISOString();
        backupData.backupType = type;
        return backupData;
    },

    /**
     * Gistを作成してプッシュ（初回用）
     */
    async createAndPush() {
        if (!this.settings.token) {
            alert('GitHub Personal Access Tokenを入力してください。');
            return;
        }

        if (!confirm('新しくGitHub上に同期用データを作成しますか？')) return;

        const data = this.prepareBackupData();
        const fileName = 'annual_schedule_sync.json';

        try {
            const response = await fetch('https://api.github.com/gists', {
                method: 'POST',
                headers: {
                    'Authorization': `token ${this.settings.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    description: 'Annual Schedule App Sync Data',
                    public: false,
                    files: {
                        [fileName]: {
                            content: JSON.stringify(data)
                        }
                    }
                })
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const result = await response.json();
            this.settings.gistId = result.id;
            document.getElementById('gistId').value = result.id;
            this.saveSettings();
            alert('GitHub上に新しい同期ポイントを作成しました！Gist IDが自動設定されました。');
        } catch (error) {
            console.error('Failed to create gist:', error);
            alert('Gistの作成に失敗しました。トークンが正しいか確認してください。');
        }
    },

    /**
     * 既存のGistを更新（プッシュ）
     */
    async pushToCloud() {
        if (!this.settings.token || !this.settings.gistId) {
            alert('トークンとGist IDを設定してください。初回の場合は「新規作成」を行ってください。');
            return;
        }

        const data = this.prepareBackupData();
        const fileName = 'annual_schedule_sync.json';

        try {
            const response = await fetch(`https://api.github.com/gists/${this.settings.gistId}`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `token ${this.settings.token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    files: {
                        [fileName]: {
                            content: JSON.stringify(data)
                        }
                    }
                })
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            alert('クラウドへの同期（アップロード）が完了しました。');
        } catch (error) {
            console.error('Failed to push gist:', error);
            alert('クラウドへの送信に失敗しました。IDとトークンを再確認してください。');
        }
    },

    /**
     * クラウドからデータを取得して反映（プル）
     */
    async pullFromCloud() {
        if (!this.settings.token || !this.settings.gistId) {
            alert('トークンとGist IDを設定してください。');
            return;
        }

        if (!confirm('クラウドのデータで現在のスケジュールを上書きしますか？')) return;

        try {
            const response = await fetch(`https://api.github.com/gists/${this.settings.gistId}`, {
                headers: {
                    'Authorization': `token ${this.settings.token}`
                }
            });

            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

            const result = await response.json();
            const fileName = 'annual_schedule_sync.json';

            if (result.files && result.files[fileName]) {
                const data = JSON.parse(result.files[fileName].content);
                this.applyRestoredData(data);
                alert('クラウドから最新データを同期しました！');
            } else {
                alert('同期ファイルが見つかりません。');
            }
        } catch (error) {
            console.error('Failed to pull gist:', error);
            alert('クラウドからの取得に失敗しました。');
        }
    },

    /**
     * 取得したデータをローカルに反映
     */
    applyRestoredData(data) {
        // app.js 等の restoreFromBackup と同等のロジックを実行
        if (data.scheduleCache) {
            window.scheduleCache = data.scheduleCache;
        }
        if (data.myClasses) {
            window.myClasses = data.myClasses;
        }
        if (data.classOverrides) {
            window.classOverrides = data.classOverrides;
        }

        // localStorageへの保存
        if (data.assignmentExclusions) localStorage.setItem('assignmentExclusions', JSON.stringify(data.assignmentExclusions));
        if (data.teacherMaster) localStorage.setItem('teacherMaster', JSON.stringify(data.teacherMaster));
        if (data.courseMaster) localStorage.setItem('courseMaster', JSON.stringify(data.courseMaster));
        if (data.workSettings) localStorage.setItem('workSettings', JSON.stringify(data.workSettings));
        if (data.workOverrides) localStorage.setItem('workOverrides', JSON.stringify(data.workOverrides));
        if (data.userProfile) {
            localStorage.setItem('user_profile', JSON.stringify(data.userProfile));
            if (window.UserProfile) window.UserProfile.load(); // 読み込み
        }

        // 全体保存と更新
        if (typeof saveAllToLocal === 'function') saveAllToLocal();
        if (typeof updateCalendar === 'function') updateCalendar();

        // ページのリロードが必要な場合があるが、まずはそのまま反映
    }
};

// 初期化
document.addEventListener('DOMContentLoaded', () => {
    GistSync.loadSettings();
});
