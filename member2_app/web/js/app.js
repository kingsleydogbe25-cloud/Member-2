const app = {
    // ── State ──────────────────────────────────────────────────────────────
    members: [],
    schema: [],
    categories: [],
    settings: { theme: 'dark', default_category: 'General', date_format: 'YYYY-MM-DD', items_per_page: '10' },
    currentMember: null,
    chartInstance: null,

    // Bulk Selection
    selectionMode: false,
    selectedMembers: new Set(),

    // Pagination
    currentPage: 1,
    itemsPerPage: 10,
    currentSort: 'newest',
    filteredMembers: [],

    // ── Undo Delete ────────────────────────────────────────────────────────
    _undoStack: [],        // { member, timer }
    UNDO_TIMEOUT: 6000,    // ms before permanent delete

    // ── Duplicate detection ────────────────────────────────────────────────
    _pendingDuplicate: null,

    // ── Lock / password ───────────────────────────────────────────────────
    _unlocked: false,

    // ── Splash ────────────────────────────────────────────────────────────
    splash: {
        el: null, bar: null, status: null,
        init() {
            this.el = document.getElementById('splash-screen');
            this.bar = this.el.querySelector('.splash-loader-bar');
            this.status = this.el.querySelector('.splash-status');
        },
        setProgress(pct, msg) {
            if (this.bar) this.bar.style.width = pct + '%';
            if (this.status) this.status.textContent = msg;
        },
        hide() {
            if (this.el) {
                this.setProgress(100, 'Ready!');
                setTimeout(() => {
                    this.el.classList.add('hidden');
                    setTimeout(() => this.el.remove(), 700);
                }, 400);
            }
        }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // INIT
    // ═══════════════════════════════════════════════════════════════════════
    init: async () => {
        app.splash.init();
        app.splash.setProgress(15, 'Starting up...');
        app.debouncedFilter = app.debounce(() => app._performFilter(true), 300);
        app.initSidebar();

        // Lock-screen enter key
        document.getElementById('lock-password-input').addEventListener('keydown', e => {
            if (e.key === 'Enter') app.submitLockScreen();
        });

        window.addEventListener('pywebviewready', async () => {
            app.splash.setProgress(35, 'Connecting to backend...');
            await new Promise(r => setTimeout(r, 3150));
            app.splash.setProgress(60, 'Loading members...');
            await app.loadData();
            app.splash.setProgress(85, 'Rendering dashboard...');
            app.renderDashboard();
            app.splash.setProgress(100, 'Ready!');
            app.splash.hide();

            // Check password protection AFTER splash
            await app.checkLock();
        });
    },

    // ═══════════════════════════════════════════════════════════════════════
    // LOCK SCREEN
    // ═══════════════════════════════════════════════════════════════════════
    checkLock: async () => {
        const pwd = await window.pywebview.api.get_password_settings();
        if (pwd.enabled && pwd.set) {
            app._unlocked = false;
            document.getElementById('lock-screen').style.display = 'flex';
            document.getElementById('lock-password-input').focus();
        } else {
            app._unlocked = true;
        }
    },

    submitLockScreen: async () => {
        const input = document.getElementById('lock-password-input');
        const errEl = document.getElementById('lock-error');
        const btn = document.getElementById('lock-submit-btn');

        const pw = input.value;
        if (!pw) { errEl.textContent = 'Please enter a password.'; return; }

        btn.disabled = true;
        btn.textContent = 'Checking…';
        errEl.textContent = '';

        const res = await window.pywebview.api.verify_password(pw);
        if (res.status === 'success') {
            app._unlocked = true;
            const ls = document.getElementById('lock-screen');
            ls.style.opacity = '0';
            setTimeout(() => ls.style.display = 'none', 400);
            input.value = '';
        } else {
            errEl.textContent = 'Incorrect password. Please try again.';
            input.value = '';
            input.focus();
            // Shake animation
            input.classList.add('shake');
            setTimeout(() => input.classList.remove('shake'), 500);
        }
        btn.disabled = false;
        btn.textContent = 'Unlock';
    },

    // ─── Password Settings ─────────────────────────────────────────────────
    loadPasswordSettings: async () => {
        const pwd = await window.pywebview.api.get_password_settings();
        const toggle = document.getElementById('password-enabled-toggle');
        const badge = document.getElementById('password-status-badge');
        const text = document.getElementById('password-status-text');
        const removeBtn = document.getElementById('remove-pwd-btn');
        const newPwdLabel = document.getElementById('new-pwd-label');

        toggle.checked = pwd.enabled;
        if (pwd.enabled) {
            badge.textContent = 'On'; badge.className = 'pwd-badge pwd-on';
            text.textContent = 'Password protection is active.';
        } else {
            badge.textContent = 'Off'; badge.className = 'pwd-badge pwd-off';
            text.textContent = pwd.set ? 'Password is set but protection is disabled.' : 'Password protection is disabled.';
        }
        removeBtn.style.display = pwd.set ? 'inline-block' : 'none';
        newPwdLabel.textContent = pwd.set ? 'Change Password' : 'New Password';
    },

    onPasswordToggle: async () => {
        const enabled = document.getElementById('password-enabled-toggle').checked;
        const res = await window.pywebview.api.toggle_password_protection(enabled);
        if (res.status === 'success') {
            app.showToast(enabled ? 'Password protection enabled' : 'Password protection disabled');
            await app.loadPasswordSettings();
        } else {
            app.showToast(res.message || 'Error');
            // revert toggle
            document.getElementById('password-enabled-toggle').checked = !enabled;
        }
    },

    savePassword: async () => {
        const np = document.getElementById('new-password-input').value;
        const cp = document.getElementById('confirm-password-input').value;
        if (!np) { app.showToast('Enter a password'); return; }
        if (np !== cp) { app.showToast('Passwords do not match'); return; }
        if (np.length < 4) { app.showToast('Password must be at least 4 characters'); return; }
        const res = await window.pywebview.api.set_password(np);
        if (res.status === 'success') {
            app.showToast('Password saved');
            document.getElementById('new-password-input').value = '';
            document.getElementById('confirm-password-input').value = '';
            // Auto-enable protection after setting
            await window.pywebview.api.toggle_password_protection(true);
            document.getElementById('password-enabled-toggle').checked = true;
            await app.loadPasswordSettings();
        } else {
            app.showToast(res.message || 'Error');
        }
    },

    removePassword: async () => {
        if (!confirm('Remove password? This will also disable protection.')) return;
        const res = await window.pywebview.api.remove_password();
        if (res.status === 'success') {
            app.showToast('Password removed');
            await app.loadPasswordSettings();
        }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // UNDO DELETE
    // ═══════════════════════════════════════════════════════════════════════
    softDeleteMember: (id) => {
        const member = app.members.find(m => m.id === id);
        if (!member) return;

        // Remove from UI immediately
        app.members = app.members.filter(m => m.id !== id);
        app.closeModal();
        app._performFilter(true);
        app.renderDashboard();

        // Clear any existing undo for same member
        app._undoStack = app._undoStack.filter(u => u.member.id !== id);

        const timer = setTimeout(async () => {
            // Permanent delete
            app._undoStack = app._undoStack.filter(u => u.member.id !== id);
            await window.pywebview.api.delete_member(id);
            if (app._undoStack.length === 0) app.hideUndoBar();
        }, app.UNDO_TIMEOUT);

        app._undoStack.push({ member, timer });
        app.showUndoBar(member);
    },

    softDeleteMultiple: (ids) => {
        const toDelete = app.members.filter(m => ids.includes(m.id));
        app.members = app.members.filter(m => !ids.includes(m.id));
        app.toggleSelectionMode();
        app._performFilter(true);
        app.renderDashboard();

        // Batch them as one undo entry
        const batchId = 'batch_' + Date.now();
        const timer = setTimeout(async () => {
            app._undoStack = app._undoStack.filter(u => u.member.id !== batchId);
            await window.pywebview.api.delete_members(ids);
            if (app._undoStack.length === 0) app.hideUndoBar();
        }, app.UNDO_TIMEOUT);

        // Fake single entry representing batch
        const fakeMember = { id: batchId, _batch: toDelete };
        app._undoStack.push({ member: fakeMember, timer });
        app.showUndoBar(null, toDelete.length);
    },

    undoDelete: () => {
        if (app._undoStack.length === 0) return;
        const entry = app._undoStack.pop();
        clearTimeout(entry.timer);

        if (entry.member._batch) {
            app.members.push(...entry.member._batch);
        } else {
            app.members.push(entry.member);
        }

        app._performFilter(true);
        app.renderDashboard();
        app.showToast('Delete undone');

        if (app._undoStack.length === 0) app.hideUndoBar();
        else app.showUndoBar(null); // refresh count
    },

    showUndoBar: (member, count) => {
        const bar = document.getElementById('undo-bar');
        const text = document.getElementById('undo-bar-text');
        const prog = document.getElementById('undo-progress');

        if (count && count > 1) {
            text.textContent = `${count} members deleted`;
        } else if (member) {
            const titleField = app.schema.length > 0 ? app.schema[0].id : 'id';
            const name = member[titleField] || 'Member';
            text.textContent = `"${name}" deleted`;
        } else {
            text.textContent = `${app._undoStack.length} pending deletion(s)`;
        }

        bar.style.display = 'flex';
        // Reset & restart progress bar
        prog.style.transition = 'none';
        prog.style.width = '100%';
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                prog.style.transition = `width ${app.UNDO_TIMEOUT}ms linear`;
                prog.style.width = '0%';
            });
        });
    },

    hideUndoBar: () => {
        document.getElementById('undo-bar').style.display = 'none';
    },

    // ═══════════════════════════════════════════════════════════════════════
    // DUPLICATE DETECTION
    // ═══════════════════════════════════════════════════════════════════════
    checkDuplicates: (member) => {
        // Compare against all primary schema fields (at least first 2)
        const titleField = app.schema.length > 0 ? app.schema[0].id : null;
        const secondField = app.schema.length > 1 ? app.schema[1].id : null;
        const isEditing = !!member.id;

        if (!titleField) return null;

        const newName = (member[titleField] || '').toString().toLowerCase().trim();
        const newSecond = secondField ? (member[secondField] || '').toString().toLowerCase().trim() : '';

        for (const m of app.members) {
            if (isEditing && m.id === member.id) continue;
            const mName = (m[titleField] || '').toString().toLowerCase().trim();
            const mSecond = secondField ? (m[secondField] || '').toString().toLowerCase().trim() : '';

            // Exact name match
            if (newName && mName === newName) {
                // If second field also matches → strong duplicate
                const strong = secondField && newSecond && mSecond === newSecond;
                return { member: m, strong, field: titleField, secondField };
            }
        }
        return null;
    },

    viewDuplicate: (e) => {
        e.preventDefault();
        if (app._pendingDuplicate) app.openMemberModal(app._pendingDuplicate.id);
    },

    hideDuplicateWarning: () => {
        document.getElementById('duplicate-warning').style.display = 'none';
        app._pendingDuplicate = null;
    },

    // ═══════════════════════════════════════════════════════════════════════
    // DATA
    // ═══════════════════════════════════════════════════════════════════════
    onSearch: () => { app.debouncedFilter(); },

    loadData: async () => {
        try {
            const [members, schema, categories, settings] = await Promise.all([
                window.pywebview.api.get_members(),
                window.pywebview.api.get_schema(),
                window.pywebview.api.get_categories(),
                window.pywebview.api.get_settings().catch(() => null)
            ]);
            app.members = members;
            app.schema = schema;
            app.categories = categories;
            if (settings) app.settings = { ...app.settings, ...settings };
            app.itemsPerPage = parseInt(app.settings.items_per_page || app.settings.itemsPerPage || 10);
            app.applySettings();
            app.filterMembers(false);
            app.renderSchemaForm();
            app.renderCategorySelects();
            app.renderSchemaTable();
            app.renderSettingsUI();
        } catch (e) {
            console.error('Error loading data:', e);
            app.showToast('Error loading data');
        }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // SIDEBAR / NAVIGATION
    // ═══════════════════════════════════════════════════════════════════════
    initSidebar: () => {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;
        let toggle = document.createElement('div');
        toggle.id = 'sidebar-toggle';
        toggle.innerHTML = '<i class="fas fa-angle-double-left"></i>';
        toggle.onclick = app.toggleSidebar;
        sidebar.insertBefore(toggle, sidebar.firstChild);
        const collapsed = localStorage.getItem('sidebarCollapsed') === 'true';
        if (collapsed) sidebar.classList.add('collapsed');
        app.updateSidebarIcon();
    },

    toggleSidebar: () => {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;
        const collapsed = sidebar.classList.toggle('collapsed');
        localStorage.setItem('sidebarCollapsed', collapsed);
        app.updateSidebarIcon();
    },

    updateSidebarIcon: () => {
        const icon = document.querySelector('#sidebar-toggle i');
        if (!icon) return;
        icon.className = document.getElementById('sidebar').classList.contains('collapsed')
            ? 'fas fa-angle-double-right' : 'fas fa-angle-double-left';
    },

    navigate: (sectionId) => {
        document.querySelectorAll('section').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));
        document.getElementById(sectionId).classList.add('active');
        document.querySelectorAll('.nav-link').forEach(link => {
            if (link.getAttribute('onclick').includes(sectionId)) link.classList.add('active');
        });
        if (sectionId === 'dashboard') app.renderDashboard();
        if (sectionId === 'members') app.filterMembers();
        if (sectionId === 'settings') {
            app.renderSettingsUI();
            app.renderBackups();
            app.loadPasswordSettings();
        }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // DASHBOARD
    // ═══════════════════════════════════════════════════════════════════════
    renderDashboard: () => {
        document.getElementById('total-members-count').innerText = app.members.length;
        const container = document.getElementById('dashboard-recent-members');
        container.innerHTML = [...app.members].reverse().slice(0, 5).map(m => app.createMemberCard(m)).join('');
        app.renderAdvancedStats();
        app.renderChart();
    },

    renderAdvancedStats: () => {
        const now = new Date();
        const dateFields = app.schema.filter(f => f.type === 'date');
        let newCount = 0;
        if (dateFields.length > 0) {
            const key = dateFields[0].id;
            newCount = app.members.filter(m => {
                if (!m[key]) return false;
                const d = new Date(m[key]);
                return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
            }).length;
        }
        document.getElementById('new-members-count').innerText = newCount;

        const counts = {};
        app.members.forEach(m => { const c = m.category || 'Uncategorized'; counts[c] = (counts[c] || 0) + 1; });
        let topCat = '-', maxCount = -1;
        for (const [cat, count] of Object.entries(counts)) { if (count > maxCount) { maxCount = count; topCat = cat; } }
        document.getElementById('popular-category').innerText = topCat;
    },

    renderChart: () => {
        const ctx = document.getElementById('categoryChart').getContext('2d');
        const counts = {};
        app.categories.forEach(c => counts[c] = 0); counts['Uncategorized'] = 0;
        app.members.forEach(m => { const c = m.category || 'Uncategorized'; counts[c] = (counts[c] || 0) + 1; });
        if (app.chartInstance) app.chartInstance.destroy();
        const colors = ['rgba(255,99,132,0.7)','rgba(54,162,235,0.7)','rgba(255,206,86,0.7)','rgba(75,192,192,0.7)','rgba(153,102,255,0.7)','rgba(255,159,64,0.7)'];
        app.chartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: { labels: Object.keys(counts), datasets: [{ data: Object.values(counts), backgroundColor: colors, borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#e0e0e0' } } } }
        });
    },

    // ═══════════════════════════════════════════════════════════════════════
    // MEMBERS LIST + PAGINATION
    // ═══════════════════════════════════════════════════════════════════════
    renderMembersList: () => {
        const container = document.getElementById('members-list');
        const start = (app.currentPage - 1) * app.itemsPerPage;
        const pageItems = app.filteredMembers.slice(start, start + app.itemsPerPage);
        const totalPages = Math.ceil(app.filteredMembers.length / app.itemsPerPage) || 1;

        // Count label
        const countEl = document.getElementById('members-count-label');
        if (countEl) {
            const from = app.filteredMembers.length === 0 ? 0 : start + 1;
            const to = Math.min(start + app.itemsPerPage, app.filteredMembers.length);
            countEl.textContent = `Showing ${from}–${to} of ${app.filteredMembers.length} member${app.filteredMembers.length !== 1 ? 's' : ''}`;
        }

        // Bulk bar
        const bulkBar = document.getElementById('bulk-actions-bar');
        if (app.selectionMode) {
            if (!bulkBar) {
                const bar = document.createElement('div');
                bar.id = 'bulk-actions-bar';
                bar.style.cssText = 'background:rgba(255,255,255,0.05);padding:10px;margin-bottom:20px;border-radius:8px;display:flex;align-items:center;justify-content:space-between;';
                bar.innerHTML = `<span id="bulk-count">${app.selectedMembers.size} selected</span><div style="display:flex;gap:10px;"><button class="danger" onclick="app.deleteSelectedMembers()">Delete Selected</button><button class="secondary" onclick="app.toggleSelectionMode()">Cancel</button></div>`;
                container.parentElement.insertBefore(bar, container);
            } else {
                document.getElementById('bulk-count').innerText = `${app.selectedMembers.size} selected`;
            }
        } else {
            if (bulkBar) bulkBar.remove();
        }

        container.innerHTML = pageItems.length
            ? pageItems.map(m => app.createMemberCard(m)).join('')
            : '<p style="color:var(--text-secondary);text-align:center;padding:40px;">No members found.</p>';

        // Pagination buttons
        document.getElementById('prev-page-btn').disabled = app.currentPage === 1;
        document.getElementById('next-page-btn').disabled = app.currentPage >= totalPages;
        document.getElementById('first-page-btn').disabled = app.currentPage === 1;
        document.getElementById('last-page-btn').disabled = app.currentPage >= totalPages;

        // Page number pills
        const pageNumsEl = document.getElementById('page-numbers');
        pageNumsEl.innerHTML = '';
        const maxPills = 7;
        let pages = [];
        if (totalPages <= maxPills) {
            for (let i = 1; i <= totalPages; i++) pages.push(i);
        } else {
            pages = [1];
            let lo = Math.max(2, app.currentPage - 2);
            let hi = Math.min(totalPages - 1, app.currentPage + 2);
            if (lo > 2) pages.push('…');
            for (let i = lo; i <= hi; i++) pages.push(i);
            if (hi < totalPages - 1) pages.push('…');
            pages.push(totalPages);
        }
        pages.forEach(p => {
            if (p === '…') {
                const span = document.createElement('span');
                span.textContent = '…';
                span.style.cssText = 'padding:4px 6px;color:var(--text-secondary);';
                pageNumsEl.appendChild(span);
            } else {
                const btn = document.createElement('button');
                btn.textContent = p;
                btn.className = p === app.currentPage ? 'page-pill active' : 'page-pill';
                btn.onclick = () => app.goToPage(p);
                pageNumsEl.appendChild(btn);
            }
        });

        // Items-per-page sync
        const ipp = document.getElementById('items-per-page');
        if (ipp) ipp.value = app.itemsPerPage;

        // Bulk toggle button
        let toggle = document.getElementById('bulk-toggle-btn');
        if (!toggle) {
            toggle = document.createElement('button');
            toggle.id = 'bulk-toggle-btn';
            toggle.className = 'secondary';
            toggle.innerHTML = '<i class="fas fa-check-square"></i> Select';
            toggle.onclick = app.toggleSelectionMode;
            toggle.style.marginLeft = '10px';
            const filterBar = document.querySelector('#members .member-grid').previousElementSibling;
            if (filterBar) filterBar.appendChild(toggle);
        }
        toggle.style.display = app.selectionMode ? 'none' : 'inline-block';
    },

    goToPage: (p) => {
        const total = Math.ceil(app.filteredMembers.length / app.itemsPerPage) || 1;
        app.currentPage = Math.max(1, Math.min(p, total));
        app.renderMembersList();
    },

    goToLastPage: () => {
        app.goToPage(Math.ceil(app.filteredMembers.length / app.itemsPerPage) || 1);
    },

    changePage: (delta) => { app.goToPage(app.currentPage + delta); },

    changeItemsPerPage: () => {
        const val = parseInt(document.getElementById('items-per-page').value);
        app.itemsPerPage = val;
        app.settings.items_per_page = String(val);
        app.currentPage = 1;
        app.renderMembersList();
        window.pywebview.api.save_settings(app.settings);
    },

    toggleSelectionMode: () => {
        app.selectionMode = !app.selectionMode;
        app.selectedMembers.clear();
        app.renderMembersList();
    },

    toggleMemberSelection: (id, event) => {
        if (event) event.stopPropagation();
        app.selectedMembers.has(id) ? app.selectedMembers.delete(id) : app.selectedMembers.add(id);
        app.renderMembersList();
    },

    deleteSelectedMembers: () => {
        if (app.selectedMembers.size === 0) return;
        const ids = Array.from(app.selectedMembers);
        app.softDeleteMultiple(ids);
    },

    // ── Member Card ─────────────────────────────────────────────────────────
    createMemberCard: (member) => {
        const titleField = app.schema.length > 0 ? app.schema[0].id : 'id';
        const title = member[titleField] || 'Unknown';
        const subtitleField = app.schema.length > 1 ? app.schema[1].id : null;
        let subtitle = subtitleField ? member[subtitleField] : '';
        if (typeof subtitle === 'boolean') subtitle = subtitle ? 'Yes' : 'No';
        const shortId = member.short_id || 'MEM-???';
        const photoUrl = member.photo ? member.photo.replace(/\\/g, '/') : null;
        const photoHtml = photoUrl
            ? `<div style="width:50px;height:50px;border-radius:50%;background-image:url('${photoUrl}');background-size:cover;background-position:center;margin-right:15px;border:2px solid rgba(255,255,255,0.1);"></div>`
            : `<div style="width:50px;height:50px;border-radius:50%;background:rgba(255,255,255,0.1);display:flex;align-items:center;justify-content:center;margin-right:15px;"><i class="fas fa-user" style="font-size:1.2rem;color:#fff;"></i></div>`;
        const checkboxHtml = app.selectionMode
            ? `<input type="checkbox" style="margin-right:15px;width:20px;height:20px;cursor:pointer;" ${app.selectedMembers.has(member.id) ? 'checked' : ''} onclick="app.toggleMemberSelection('${member.id}',event)">`
            : '';
        const clickHandler = app.selectionMode
            ? `app.toggleMemberSelection('${member.id}',event)`
            : `app.openMemberModal('${member.id}')`;
        return `<div class="member-card" onclick="${clickHandler}" style="display:flex;align-items:center;text-align:left;padding:15px;cursor:pointer;">${checkboxHtml}${photoHtml}<div style="flex:1;min-width:0;"><div style="font-size:0.75rem;color:var(--primary-color);margin-bottom:2px;font-weight:bold;letter-spacing:0.5px;">${shortId}</div><h3 style="margin:0;font-size:1.1rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${title}</h3><p style="margin:2px 0;font-size:0.9rem;color:#aaa;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${subtitle || ''}</p></div><small style="background:rgba(0,243,255,0.1);padding:4px 8px;border-radius:12px;color:var(--primary-color);font-size:0.75rem;margin-left:10px;">${member.category || 'Uncategorized'}</small></div>`;
    },

    // ═══════════════════════════════════════════════════════════════════════
    // FORMS
    // ═══════════════════════════════════════════════════════════════════════
    renderSchemaForm: () => {
        const container = document.getElementById('dynamic-form-fields');
        container.innerHTML = '';
        app.schema.forEach(field => {
            const div = document.createElement('div');
            div.className = 'form-group';
            const labelText = field.label + (field.required ? ' *' : '');
            const label = document.createElement('label');
            label.innerText = labelText;
            let input;
            if (field.type === 'textarea') {
                input = document.createElement('textarea');
            } else if (field.type === 'select') {
                input = document.createElement('select');
                const def = document.createElement('option');
                def.value = ''; def.innerText = '-- Select --';
                input.appendChild(def);
                if (field.options) {
                    field.options.split(',').forEach(opt => {
                        const val = opt.trim();
                        if (val) { const o = document.createElement('option'); o.value = val; o.innerText = val; input.appendChild(o); }
                    });
                }
            } else {
                input = document.createElement('input');
                input.type = field.type;
            }
            input.name = field.id;
            input.required = field.required || false;

            // Live duplicate check on first field
            if (app.schema.indexOf(field) === 0) {
                input.addEventListener('input', () => app._liveCheckDuplicate(input.value));
            }

            if (field.type === 'checkbox') {
                div.style.cssText = 'flex-direction:row;align-items:center;gap:10px;';
                label.style.cssText = 'width:auto;margin:0;'; input.style.cssText = 'width:auto;margin:0;';
                div.appendChild(input); div.appendChild(label);
            } else {
                div.appendChild(label); div.appendChild(input);
            }
            container.appendChild(div);
        });

        // Photo upload
        const photoDiv = document.createElement('div');
        photoDiv.className = 'form-group';
        photoDiv.style.marginTop = '20px';
        photoDiv.innerHTML = `<label>Member Photo</label><div style="display:flex;gap:15px;align-items:center;background:rgba(255,255,255,0.05);padding:15px;border-radius:8px;"><div id="photo-preview" style="width:60px;height:60px;border-radius:50%;background:#444;background-size:cover;background-position:center;display:none;"></div><div style="flex:1;"><span id="photo-filename" style="font-size:0.9rem;color:#aaa;display:block;margin-bottom:5px;">No file chosen</span><button type="button" class="secondary" onclick="document.getElementById('photo-upload').click()" style="font-size:0.9rem;padding:5px 10px;">Choose Image</button><input type="file" id="photo-upload" accept="image/*" style="display:none;" onchange="app.handleImageUpload(this)"><input type="hidden" name="photo" id="member-photo-hidden"></div><button type="button" class="danger" style="padding:5px 10px;font-size:0.9rem;" onclick="app.clearPhoto()">Remove</button></div>`;
        container.appendChild(photoDiv);
    },

    _liveCheckDuplicate: (value) => {
        const warning = document.getElementById('duplicate-warning');
        const warningText = document.getElementById('duplicate-warning-text');
        if (!value || value.trim() === '') { app.hideDuplicateWarning(); return; }

        const editingId = document.getElementById('member-id-hidden').value;
        const titleField = app.schema[0].id;
        const match = app.members.find(m => {
            if (editingId && m.id === editingId) return false;
            return (m[titleField] || '').toString().toLowerCase().trim() === value.toLowerCase().trim();
        });

        if (match) {
            app._pendingDuplicate = match;
            warningText.textContent = `A member named "${match[titleField]}" already exists (${match.short_id || 'Unknown'}).`;
            warning.style.display = 'block';
        } else {
            app.hideDuplicateWarning();
        }
    },

    handleImageUpload: (input) => {
        const file = input.files[0];
        if (!file) return;
        document.getElementById('photo-filename').innerText = file.name;
        const reader = new FileReader();
        reader.onload = async (e) => {
            const res = await window.pywebview.api.save_image(e.target.result);
            if (res.status === 'success') {
                document.getElementById('member-photo-hidden').value = res.path;
                const preview = document.getElementById('photo-preview');
                preview.style.display = 'block';
                preview.style.backgroundImage = `url('${res.path.replace(/\\/g, '/')}')`;
            } else { app.showToast('Image upload failed'); }
        };
        reader.readAsDataURL(file);
    },

    clearPhoto: () => {
        document.getElementById('member-photo-hidden').value = '';
        document.getElementById('photo-preview').style.display = 'none';
        document.getElementById('photo-filename').innerText = 'No file chosen';
        document.getElementById('photo-upload').value = '';
    },

    renderCategorySelects: () => {
        const selects = [
            document.getElementById('member-category-select'),
            document.getElementById('category-filter'),
            document.getElementById('setting-default-category'),
            document.getElementById('settings-export-category')
        ];
        selects.forEach(select => {
            if (!select) return;
            const currentVal = select.value;
            let html = (select.id === 'category-filter' || select.id === 'settings-export-category') ? '<option value="">All Categories</option>' : '';
            app.categories.forEach(cat => { html += `<option value="${cat}">${cat}</option>`; });
            select.innerHTML = html;
            if (select.id === 'setting-default-category' && app.settings.default_category) select.value = app.settings.default_category;
            else if (select.id === 'member-category-select' && !currentVal && app.settings.default_category) select.value = app.settings.default_category;
            else select.value = currentVal;
        });

        const list = document.getElementById('categories-list');
        if (list) {
            list.innerHTML = app.categories.map(c => `<li style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;background:rgba(255,255,255,0.05);padding:5px 10px;border-radius:4px;">${c}<button class="danger" style="padding:2px 8px;font-size:0.8rem;" onclick="app.deleteCategory('${c}')">Delete</button></li>`).join('');
        }
        app.renderExportFieldSelection();
    },

    renderExportFieldSelection: () => {
        const container = document.getElementById('export-field-selection');
        if (!container) return;
        const baseFields = [{ id: 'short_id', label: 'Short ID' }, { id: 'category', label: 'Category' }, { id: 'id', label: 'Internal ID' }, { id: 'photo', label: 'Photo Path' }];
        let html = '';
        [...baseFields, ...app.schema].forEach(f => {
            html += `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.9rem;"><input type="checkbox" name="export_field" value="${f.id}" checked style="width:16px;height:16px;">${f.label}</label>`;
        });
        container.innerHTML = html;
    },

    deleteCategory: async (category) => {
        if (category === 'General') { app.showToast('Cannot delete General category'); return; }
        if (confirm(`Delete category '${category}'? Members will be set to 'Uncategorized'.`)) {
            const res = await window.pywebview.api.delete_category(category);
            if (res.status === 'success') {
                app.categories = app.categories.filter(c => c !== category);
                app.renderCategorySelects();
                app.showToast('Category deleted');
            }
        }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // SAVE MEMBER
    // ═══════════════════════════════════════════════════════════════════════
    saveMember: async (e) => {
        e.preventDefault();
        const form = document.getElementById('add-member-form');
        const formData = new FormData(form);
        const member = {};
        const id = document.getElementById('member-id-hidden').value;
        if (id) member['id'] = id;

        app.schema.forEach(field => {
            if (field.type === 'checkbox') {
                const el = form.elements[field.id];
                member[field.id] = el ? el.checked : false;
            } else {
                member[field.id] = formData.get(field.id);
            }
        });
        member['category'] = formData.get('category');
        member['photo'] = document.getElementById('member-photo-hidden').value;

        // ── Duplicate check (with warning already shown live, this is confirm gate) ──
        const dup = app.checkDuplicates(member);
        if (dup && !member.id) {
            const titleField = app.schema[0].id;
            const confirmed = confirm(
                `⚠️ Duplicate detected!\n\n"${dup.member[titleField]}" (${dup.member.short_id || 'Unknown'}) already exists with the same ${dup.strong ? 'name and ' + app.schema[1].label : 'name'}.\n\nSave anyway?`
            );
            if (!confirmed) return;
        }

        // Short ID
        if (!member['id']) {
            let maxId = 0;
            app.members.forEach(m => { if (m.short_id && m.short_id.startsWith('MEM-')) { const n = parseInt(m.short_id.split('-')[1]); if (!isNaN(n) && n > maxId) maxId = n; } });
            member['short_id'] = `MEM-${String(maxId + 1).padStart(3, '0')}`;
        } else {
            const existing = app.members.find(m => m.id === member['id']);
            if (existing) member['short_id'] = existing.short_id;
        }

        const res = await window.pywebview.api.save_member(member);
        if (res.status === 'success') {
            app.showToast('Member saved!');
            app.hideDuplicateWarning();
            app.resetForm();
            await app.loadData();
            app.navigate('members');
        } else {
            app.showToast('Error saving member');
        }
    },

    resetForm: () => {
        document.getElementById('add-member-form').reset();
        document.getElementById('member-id-hidden').value = '';
        document.getElementById('add-member-title').innerText = 'Add New Member';
        app.clearPhoto();
        app.hideDuplicateWarning();
    },

    editMember: (id) => {
        const member = app.members.find(m => m.id === id);
        if (!member) return;
        app.closeModal();
        app.navigate('add-member');
        document.getElementById('add-member-title').innerText = 'Edit Member';
        document.getElementById('member-id-hidden').value = member.id;
        app.schema.forEach(field => {
            const input = document.querySelector(`[name="${field.id}"]`);
            if (input) {
                if (field.type === 'checkbox') input.checked = member[field.id] === true || member[field.id] === 'true';
                else input.value = member[field.id] || '';
            }
        });
        const catSelect = document.getElementById('member-category-select');
        if (catSelect) catSelect.value = member.category;
        if (member.photo) {
            document.getElementById('member-photo-hidden').value = member.photo;
            const preview = document.getElementById('photo-preview');
            preview.style.display = 'block';
            preview.style.backgroundImage = `url('${member.photo.replace(/\\/g, '/')}')`;
        } else { app.clearPhoto(); }
        app.hideDuplicateWarning();
    },

    // ═══════════════════════════════════════════════════════════════════════
    // SCHEMA BUILDER
    // ═══════════════════════════════════════════════════════════════════════
    renderSchemaTable: () => {
        const tbody = document.querySelector('#schema-table tbody');
        tbody.innerHTML = app.schema.map((field, i) => `<tr><td><input type="text" value="${field.label}" onchange="app.updateSchemaField(${i},'label',this.value)" placeholder="Label"></td><td><select onchange="app.updateSchemaField(${i},'type',this.value)"><option value="text" ${field.type==='text'?'selected':''}>Text</option><option value="textarea" ${field.type==='textarea'?'selected':''}>Text Area</option><option value="number" ${field.type==='number'?'selected':''}>Number</option><option value="date" ${field.type==='date'?'selected':''}>Date</option><option value="email" ${field.type==='email'?'selected':''}>Email</option><option value="tel" ${field.type==='tel'?'selected':''}>Phone</option><option value="url" ${field.type==='url'?'selected':''}>URL</option><option value="select" ${field.type==='select'?'selected':''}>Dropdown</option><option value="checkbox" ${field.type==='checkbox'?'selected':''}>Checkbox</option></select></td><td><input type="text" value="${field.options||''}" onchange="app.updateSchemaField(${i},'options',this.value)" placeholder="Options (comma separated)" style="display:${field.type==='select'?'block':'none'};width:100%;"></td><td style="text-align:center;"><input type="checkbox" ${field.required?'checked':''} onchange="app.updateSchemaField(${i},'required',this.checked)"></td><td><button class="danger" onclick="app.removeSchemaField(${i})">Remove</button></td></tr>`).join('');
    },

    addSchemaRow: () => { app.schema.push({ id: 'field_' + Date.now(), label: 'New Field', type: 'text', required: true, options: '' }); app.renderSchemaTable(); },
    updateSchemaField: (i, k, v) => { app.schema[i][k] = v; if (k === 'type') app.renderSchemaTable(); },
    removeSchemaField: (i) => { app.schema.splice(i, 1); app.renderSchemaTable(); },
    saveSchema: async () => { const res = await window.pywebview.api.save_schema(app.schema); if (res.status === 'success') { app.showToast('Schema updated!'); await app.loadData(); } },

    // ═══════════════════════════════════════════════════════════════════════
    // CATEGORIES
    // ═══════════════════════════════════════════════════════════════════════
    addCategory: async () => {
        const input = document.getElementById('new-category-input');
        const val = input.value.trim();
        if (val && !app.categories.includes(val)) {
            app.categories.push(val);
            const res = await window.pywebview.api.save_categories(app.categories);
            if (res.status === 'success') { input.value = ''; app.renderCategorySelects(); app.showToast('Category added'); }
        }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // MODAL
    // ═══════════════════════════════════════════════════════════════════════
    openMemberModal: (id) => {
        const member = app.members.find(m => m.id === id);
        if (!member) return;
        const shortId = member.short_id || member.id;
        let html = '';
        if (member.photo) {
            html += `<div style="text-align:center;margin-bottom:20px;"><img src="${member.photo.replace(/\\/g,'/')}" style="height:120px;width:120px;object-fit:cover;border-radius:50%;box-shadow:0 4px 15px rgba(0,0,0,0.5);border:3px solid rgba(255,255,255,0.1);"><div style="margin-top:10px;font-weight:bold;font-size:1.2rem;color:var(--primary-color);">${shortId}</div></div>`;
        } else {
            html += `<div style="text-align:center;margin-bottom:20px;"><div style="height:120px;width:120px;margin:0 auto;background:rgba(255,255,255,0.1);border-radius:50%;display:flex;align-items:center;justify-content:center;"><i class="fas fa-user" style="font-size:3rem;color:#fff;"></i></div><div style="margin-top:10px;font-weight:bold;font-size:1.2rem;color:var(--primary-color);">${shortId}</div></div>`;
        }
        html += `<h2>${member[app.schema[0]?.id] || 'Details'}</h2>`;
        html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;background:rgba(0,0,0,0.2);padding:15px;border-radius:8px;">`;
        app.schema.forEach(field => {
            let val = member[field.id]; if (val === undefined || val === null) val = '-'; if (val === true) val = 'Yes'; if (val === false) val = 'No';
            html += `<div><strong>${field.label}:</strong><p style="margin:5px 0;">${val}</p></div>`;
        });
        html += `<div><strong>Category:</strong><p style="margin:5px 0;">${member.category}</p></div></div>`;
        document.getElementById('modal-body').innerHTML = html;

        const footer = document.getElementById('modal-footer');
        footer.innerHTML = '';
        const editBtn = document.createElement('button'); editBtn.innerText = 'Edit'; editBtn.style.marginRight = '10px'; editBtn.onclick = () => app.editMember(id); footer.appendChild(editBtn);
        const exportBtn = document.createElement('button'); exportBtn.innerText = 'Export PDF'; exportBtn.className = 'secondary'; exportBtn.style.marginRight = '10px'; exportBtn.onclick = () => app.exportSingleMemberPDF(member); footer.appendChild(exportBtn);
        const deleteBtn = document.createElement('button'); deleteBtn.className = 'danger'; deleteBtn.innerHTML = '<i class="fas fa-trash"></i> Delete'; deleteBtn.onclick = () => app.softDeleteMember(id); footer.appendChild(deleteBtn);

        document.getElementById('member-modal').style.display = 'flex';
    },

    closeModal: () => { document.getElementById('member-modal').style.display = 'none'; },

    // Legacy hard-delete kept for bulk (redirected to soft)
    deleteMember: (id) => { app.softDeleteMember(id); },

    exportSingleMemberPDF: async (member) => {
        try {
            if (!window.jspdf) { app.showToast('PDF Library not loaded.'); return; }
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ unit: 'pt', format: 'a4' });
            doc.setFontSize(18); doc.text('Member Report', 40, 48);
            doc.setFontSize(11); doc.text(`Generated: ${new Date().toLocaleString()}`, 40, 68);
            const rows = [['ID', member.id || '']];
            if (member.short_id) rows.push(['Short ID', member.short_id]);
            app.schema.forEach(f => { let v = member[f.id]; if (v === undefined || v === null) v = ''; if (v === true) v = 'Yes'; if (v === false) v = 'No'; rows.push([f.label, String(v)]); });
            rows.push(['Category', member.category || 'Uncategorized']);
            doc.autoTable({ head: [['Field','Value']], body: rows, startY: 100, theme: 'grid', styles: { fontSize: 10 }, headStyles: { fillColor: [0,212,255] } });
            const res = await window.pywebview.api.save_pdf(doc.output('datauristring'));
            app.showToast(res.status === 'success' ? `PDF saved to ${res.path}` : res.message || 'Cancelled');
        } catch (e) { console.error(e); app.showToast('Export failed'); }
    },

    // ═══════════════════════════════════════════════════════════════════════
    // FILTER / SORT
    // ═══════════════════════════════════════════════════════════════════════
    filterMembers: (render = true) => { app._performFilter(render); },

    _performFilter: (render) => {
        const query = (document.getElementById('search-bar')?.value || '').toLowerCase();
        const category = document.getElementById('category-filter')?.value || '';
        const sortOrder = document.getElementById('sort-order')?.value || app.currentSort;

        let filtered = app.members.filter(m => {
            const matchesQuery = app.schema.some(f => (m[f.id] || '').toString().toLowerCase().includes(query))
                || (m.short_id || '').toLowerCase().includes(query);
            const matchesCategory = category ? m.category === category : true;
            return matchesQuery && matchesCategory;
        });

        const titleField = app.schema.length > 0 ? app.schema[0].id : 'id';
        filtered.sort((a, b) => {
            const va = (a[titleField] || '').toString().toLowerCase();
            const vb = (b[titleField] || '').toString().toLowerCase();
            if (sortOrder === 'az') return va.localeCompare(vb);
            if (sortOrder === 'za') return vb.localeCompare(va);
            return 0;
        });
        if (sortOrder === 'newest' || sortOrder === 'oldest') {
            if (sortOrder === 'newest') filtered.reverse();
        }

        app.filteredMembers = filtered;
        app.currentPage = 1;
        if (render) app.renderMembersList();
    },

    // ═══════════════════════════════════════════════════════════════════════
    // EXPORT / IMPORT
    // ═══════════════════════════════════════════════════════════════════════
    exportData: async (members = null, fields = null) => { try { const res = await window.pywebview.api.export_json_file(members, fields); app.showToast(res.status === 'success' ? `JSON saved to ${res.path}` : res.message || 'Cancelled'); } catch (e) { app.showToast('JSON Export failed'); } },
    exportPDF: async (members = null, fields = null) => {
        try {
            if (!window.jspdf) { app.showToast('PDF Library not loaded.'); return; }
            const exportList = members || app.members;
            if (!exportList?.length) { app.showToast('No members to export'); return; }
            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();
            doc.setFontSize(18); doc.text('Members Report', 14, 22);
            doc.setFontSize(11); doc.setTextColor(100);
            doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 30);
            doc.text(`Total Members: ${exportList.length}`, 14, 36);
            let headers, dataKeys;
            if (fields?.length) {
                headers = [fields.map(fid => { const s = app.schema.find(f => f.id === fid); return s ? s.label : (fid === 'short_id' ? 'ID' : fid); })];
                dataKeys = fields;
            } else {
                headers = [['ID', ...app.schema.map(f => f.label), 'Category']];
                dataKeys = ['short_id', ...app.schema.map(f => f.id), 'category'];
            }
            const data = exportList.map(m => dataKeys.map(k => { let v = m[k]; if (v === undefined || v === null) return ''; return v === true ? 'Yes' : v === false ? 'No' : String(v); }));
            doc.autoTable({ head: headers, body: data, startY: 44, theme: 'grid', styles: { fontSize: 8 }, headStyles: { fillColor: [0,212,255] } });
            const res = await window.pywebview.api.save_pdf(doc.output('datauristring'));
            app.showToast(res.status === 'success' ? `PDF saved to ${res.path}` : res.message || 'Cancelled');
        } catch (e) { console.error(e); app.showToast('PDF Export failed'); }
    },
    exportCSV: async (members = null, fields = null) => { try { const res = await window.pywebview.api.export_csv_file(members, fields); app.showToast(res.status === 'success' ? `CSV saved to ${res.path}` : res.message || 'Cancelled'); } catch (e) { app.showToast('Export failed'); } },
    exportSettingsData: async (type) => {
        const category = document.getElementById('settings-export-category').value;
        const selectedFields = Array.from(document.querySelectorAll('input[name="export_field"]:checked')).map(cb => cb.value);
        if (selectedFields.length === 0) { app.showToast('Please select at least one field'); return; }
        let membersToExport = category ? app.members.filter(m => m.category === category) : app.members;
        if (type === 'json') await app.exportData(membersToExport, selectedFields);
        else if (type === 'csv') await app.exportCSV(membersToExport, selectedFields);
        else if (type === 'pdf') await app.exportPDF(membersToExport, selectedFields);
    },

    importData: (input) => {
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                let data;
                if (file.name.endsWith('.csv')) {
                    const lines = e.target.result.split('\n');
                    const headers = lines[0].split(',').map(h => h.trim());
                    data = lines.slice(1).filter(l => l.trim()).map(line => { const vals = line.split(','); const obj = {}; headers.forEach((h, i) => obj[h] = vals[i] ? vals[i].trim() : ''); return obj; });
                } else { data = JSON.parse(e.target.result); }
                const res = await window.pywebview.api.import_members(data);
                app.showToast(res.message);
                await app.loadData(); app.renderMembersList();
            } catch (err) { app.showToast('Invalid file format'); console.error(err); }
            input.value = '';
        };
        reader.readAsText(file);
    },

    // ═══════════════════════════════════════════════════════════════════════
    // BACKUPS
    // ═══════════════════════════════════════════════════════════════════════
    backupData: async () => { const res = await window.pywebview.api.backup_data(); app.showToast(res.message); app.renderBackups(); },
    renderBackups: async () => {
        const backups = await window.pywebview.api.get_backups();
        const container = document.getElementById('backups-list');
        if (!container) return;
        container.innerHTML = backups.length === 0
            ? '<p style="color:#666;">No backups found.</p>'
            : backups.map(b => `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;background:rgba(255,255,255,0.05);padding:10px;border-radius:6px;"><span>${b}</span><div style="display:flex;gap:8px;"><button class="secondary" style="padding:5px 10px;font-size:0.9rem;" onclick="app.restoreBackup('${b}')">Restore</button><button class="danger" style="padding:5px 10px;font-size:0.9rem;" onclick="app.deleteBackup('${b}')">Delete</button></div></div>`).join('');
    },
    restoreBackup: async (id) => { if (confirm(`Restore backup from ${id}? Current data will be overwritten.`)) { const res = await window.pywebview.api.restore_backup(id); if (res.status === 'success') { app.showToast(res.message); setTimeout(() => window.location.reload(), 1000); } else app.showToast('Restore failed'); } },
    deleteBackup: async (id) => { if (confirm(`Permanently delete backup "${id}"?`)) { const res = await window.pywebview.api.delete_backup(id); if (res.status === 'success') { app.showToast('Backup deleted'); app.renderBackups(); } else app.showToast('Delete failed'); } },

    // ═══════════════════════════════════════════════════════════════════════
    // SETTINGS & INTEGRITY
    // ═══════════════════════════════════════════════════════════════════════
    renderSettingsUI: () => {
        const s = app.settings;
        const themeEl = document.getElementById('setting-theme');
        const catEl = document.getElementById('setting-default-category');
        const dateEl = document.getElementById('setting-date-format');
        const ippEl = document.getElementById('setting-items-per-page');
        if (themeEl) themeEl.value = s.theme || 'dark';
        if (catEl) catEl.value = s.default_category || 'General';
        if (dateEl) dateEl.value = s.date_format || 'YYYY-MM-DD';
        if (ippEl) ippEl.value = s.items_per_page || '10';
    },

    saveSettings: async () => {
        app.settings.theme = document.getElementById('setting-theme').value;
        app.settings.default_category = document.getElementById('setting-default-category').value;
        app.settings.date_format = document.getElementById('setting-date-format').value;
        app.settings.items_per_page = document.getElementById('setting-items-per-page').value;
        app.itemsPerPage = parseInt(app.settings.items_per_page);
        app.applySettings();
        const res = await window.pywebview.api.save_settings(app.settings);
        if (res.status === 'success') app.showToast('Settings saved');
    },

    applySettings: () => {
        document.body.classList.toggle('light-theme', app.settings.theme === 'light');
        app.itemsPerPage = parseInt(app.settings.items_per_page || 10);
        const ipp = document.getElementById('items-per-page');
        if (ipp) ipp.value = app.itemsPerPage;
        const sipp = document.getElementById('setting-items-per-page');
        if (sipp) sipp.value = app.settings.items_per_page || '10';
    },

    runIntegrityCheck: () => {
        const container = document.getElementById('integrity-results');
        container.style.display = 'block'; container.innerHTML = '<p>Scanning...</p>';
        const issues = [];
        app.members.forEach(m => {
            const missing = app.schema.filter(f => f.required && (m[f.id] === undefined || m[f.id] === null || m[f.id] === '')).map(f => f.label);
            if (missing.length) issues.push({ member: m, missing });
        });
        container.innerHTML = issues.length === 0
            ? '<p style="color:#4caf50;"><i class="fas fa-check-circle"></i> No issues found.</p>'
            : `<p style="color:#ff5252;">Found ${issues.length} members with missing data:</p>` + issues.map(i => `<div style="background:rgba(255,0,0,0.1);padding:10px;margin-bottom:5px;border-radius:4px;display:flex;justify-content:space-between;align-items:center;"><div><strong>${i.member[app.schema[0].id]||'Unknown'}</strong> (${i.member.short_id||i.member.id})<div style="font-size:0.8rem;color:#ffaaaa;">Missing: ${i.missing.join(', ')}</div></div><button class="secondary" onclick="app.editMember('${i.member.id}')">Fix</button></div>`).join('');
    },

    // ═══════════════════════════════════════════════════════════════════════
    // UTILITIES
    // ═══════════════════════════════════════════════════════════════════════
    debounce: (func, wait) => {
        let timeout;
        return function (...args) { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), wait); };
    },

    showToast: (msg) => {
        const x = document.getElementById('toast');
        x.innerText = msg; x.className = 'show';
        setTimeout(() => { x.className = x.className.replace('show', ''); }, 3000);
    }
};

document.getElementById('add-member-form').onsubmit = app.saveMember;
app.init();
