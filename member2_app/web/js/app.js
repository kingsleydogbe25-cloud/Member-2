const app = {
    // State
    members: [],
    schema: [],
    categories: [],
    settings: { theme: 'dark', default_category: 'General', date_format: 'YYYY-MM-DD' },
    currentMember: null,

    // Bulk Selection
    selectionMode: false,
    selectedMembers: new Set(),

    // Pagination & Sorting
    currentPage: 1,
    itemsPerPage: 10,
    currentSort: 'newest', // newest, oldest, az, za
    filteredMembers: [], // Store filtered list for pagination

    // Chart
    chartInstance: null,

    // Splash Screen
    splash: {
        el: null,
        bar: null,
        status: null,
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
                    // Remove from DOM after transition
                    setTimeout(() => this.el.remove(), 700);
                }, 400);
            }
        }
    },

    // Initialization
    init: async () => {
        console.log("App Initializing...");

        app.splash.init();
        app.splash.setProgress(15, 'Starting up...');

        // Initialize Debounced Filter
        app.debouncedFilter = app.debounce(() => app._performFilter(true), 300);

        // prepare sidebar toggle
        app.initSidebar();

        // Wait for pywebview
        window.addEventListener('pywebviewready', async () => {
            console.log("Pywebview ready");
            app.splash.setProgress(35, 'Connecting to backend...');

            await new Promise(r => setTimeout(r, 3150)); // brief pause for visual feedback
            app.splash.setProgress(60, 'Loading members...');

            await app.loadData();
            app.splash.setProgress(85, 'Rendering dashboard...');

            app.renderDashboard();
            app.splash.setProgress(100, 'Ready!');

            app.splash.hide();
        });
    },

    onSearch: () => {
        app.debouncedFilter();
    },

    // Data Loading
    loadData: async () => {
        try {
            // Parallel Loading
            const [members, schema, categories, settings] = await Promise.all([
                window.pywebview.api.get_members(),
                window.pywebview.api.get_schema(),
                window.pywebview.api.get_categories(),
                window.pywebview.api.get_settings().catch(() => null) // Handle settings error/missing
            ]);

            app.members = members;
            app.schema = schema;
            app.categories = categories;

            // Apply Settings
            if (settings) {
                app.settings = { ...app.settings, ...settings };
            }
            app.applySettings();

            // Initial filter to populate filteredMembers
            app.filterMembers(false);

            app.renderSchemaForm(); // For Add Member page
            app.renderCategorySelects();
            app.renderSchemaTable(); // For Settings page
            app.renderSettingsUI(); // Populate settings inputs
        } catch (e) {
            console.error("Error loading data:", e);
            app.showToast("Error loading data");
        }
    },

    // Sidebar handling
    initSidebar: () => {
        const sidebar = document.getElementById('sidebar');
        if (!sidebar) return;

        // create toggle button
        let toggle = document.createElement('div');
        toggle.id = 'sidebar-toggle';
        toggle.innerHTML = '<i class="fas fa-angle-double-left"></i>';
        toggle.onclick = app.toggleSidebar;
        // insert at top so it stays above the brand/logo
        sidebar.insertBefore(toggle, sidebar.firstChild);

        // apply saved state from localStorage
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
        if (document.getElementById('sidebar').classList.contains('collapsed')) {
            icon.className = 'fas fa-angle-double-right';
        } else {
            icon.className = 'fas fa-angle-double-left';
        }
    },

    // Navigation
    navigate: (sectionId) => {
        document.querySelectorAll('section').forEach(el => el.classList.remove('active'));
        document.querySelectorAll('.nav-link').forEach(el => el.classList.remove('active'));

        document.getElementById(sectionId).classList.add('active');

        // Find link that calls this function (approximate)
        const links = document.querySelectorAll('.nav-link');
        links.forEach(link => {
            if (link.getAttribute('onclick').includes(sectionId)) {
                link.classList.add('active');
            }
        });

        if (sectionId === 'dashboard') app.renderDashboard();
        if (sectionId === 'members') {
            app.filterMembers(); // Re-apply filter/sort/display
        }
        if (sectionId === 'settings') {
            app.renderSettingsUI();
            app.renderBackups();
        }
    },

    // Rendering
    renderDashboard: () => {
        // Total Members
        document.getElementById('total-members-count').innerText = app.members.length;

        // Recent Members
        const container = document.getElementById('dashboard-recent-members');
        const recent = [...app.members].reverse().slice(0, 5); // Copy before reverse
        container.innerHTML = recent.map(m => app.createMemberCard(m)).join('');

        // Advanced Stats
        app.renderAdvancedStats();

        // Chart
        app.renderChart();
    },

    renderAdvancedStats: () => {
        // New Members This Month
        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        // Let's look for a field of type 'date'.
        const dateFields = app.schema.filter(f => f.type === 'date');
        let newCount = 0;

        if (dateFields.length > 0) {
            // Use the first date field found
            const dateKey = dateFields[0].id;
            newCount = app.members.filter(m => {
                if (!m[dateKey]) return false;
                const d = new Date(m[dateKey]);
                return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
            }).length;
        }
        document.getElementById('new-members-count').innerText = newCount;

        // Top Category
        if (app.categories.length > 0) {
            const counts = {};
            app.members.forEach(m => {
                const cat = m.category || 'Uncategorized';
                counts[cat] = (counts[cat] || 0) + 1;
            });

            let topCat = '-';
            let maxCount = -1;
            for (const [cat, count] of Object.entries(counts)) {
                if (count > maxCount) {
                    maxCount = count;
                    topCat = cat;
                }
            }
            document.getElementById('popular-category').innerText = topCat;
        }
    },

    renderChart: () => {
        const ctx = document.getElementById('categoryChart').getContext('2d');

        // Aggregate data
        const counts = {};
        app.categories.forEach(c => counts[c] = 0);
        counts['Uncategorized'] = 0;

        app.members.forEach(m => {
            const cat = m.category || 'Uncategorized';
            counts[cat] = (counts[cat] || 0) + 1;
        });

        const labels = Object.keys(counts);
        const data = Object.values(counts);

        // Destroy previous instance
        if (app.chartInstance) {
            app.chartInstance.destroy();
        }

        // Colors
        const colors = [
            'rgba(255, 99, 132, 0.7)',
            'rgba(54, 162, 235, 0.7)',
            'rgba(255, 206, 86, 0.7)',
            'rgba(75, 192, 192, 0.7)',
            'rgba(153, 102, 255, 0.7)',
            'rgba(255, 159, 64, 0.7)'
        ];

        app.chartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    label: '# of Members',
                    data: data,
                    backgroundColor: colors,
                    borderColor: 'rgba(255,255,255,0.1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                        labels: { color: '#e0e0e0' }
                    }
                }
            }
        });
    },

    renderMembersList: () => {
        const container = document.getElementById('members-list');

        // Pagination logic
        const start = (app.currentPage - 1) * app.itemsPerPage;
        const end = start + app.itemsPerPage;
        const pageItems = app.filteredMembers.slice(start, end);

        // Bulk Actions Bar
        const bulkBar = document.getElementById('bulk-actions-bar');
        if (app.selectionMode) {
            if (!bulkBar) {
                const bar = document.createElement('div');
                bar.id = 'bulk-actions-bar';
                bar.style.cssText = "background: rgba(255,255,255,0.05); padding: 10px; margin-bottom: 20px; border-radius: 8px; display: flex; align-items: center; justify-content: space-between;";
                bar.innerHTML = `
                    <span>${app.selectedMembers.size} selected</span>
                    <div style="display: flex; gap: 10px;">
                        <button class="danger" onclick="app.deleteSelectedMembers()">Delete Selected</button>
                        <button class="secondary" onclick="app.toggleSelectionMode()">Cancel</button>
                    </div>
                 `;
                container.parentElement.insertBefore(bar, container);
            } else {
                if (bulkBar) bulkBar.querySelector('span').innerText = `${app.selectedMembers.size} selected`;
            }
        } else {
            if (bulkBar) bulkBar.remove();
        }

        container.innerHTML = pageItems.map(m => app.createMemberCard(m)).join('');

        // Update controls
        const totalPages = Math.ceil(app.filteredMembers.length / app.itemsPerPage) || 1;
        document.getElementById('page-indicator').innerText = `Page ${app.currentPage} of ${totalPages}`;
        document.getElementById('prev-page-btn').disabled = app.currentPage === 1;
        document.getElementById('next-page-btn').disabled = app.currentPage >= totalPages;

        // Add Bulk Select Toggle if not present and not in mode
        let toggle = document.getElementById('bulk-toggle-btn');
        if (!toggle) {
            toggle = document.createElement('button');
            toggle.id = 'bulk-toggle-btn';
            toggle.className = 'secondary';
            toggle.innerHTML = '<i class="fas fa-check-square"></i> Select';
            toggle.onclick = app.toggleSelectionMode;
            toggle.style.marginLeft = '10px';
            // Insert in the filter bar
            const filterBar = document.querySelector('#members .member-grid').previousElementSibling;
            if (filterBar) filterBar.appendChild(toggle);
        }
        toggle.style.display = app.selectionMode ? 'none' : 'inline-block';
    },

    toggleSelectionMode: () => {
        app.selectionMode = !app.selectionMode;
        app.selectedMembers.clear();
        app.renderMembersList();
    },

    toggleMemberSelection: (id, event) => {
        if (event) event.stopPropagation();
        if (app.selectedMembers.has(id)) {
            app.selectedMembers.delete(id);
        } else {
            app.selectedMembers.add(id);
        }
        app.renderMembersList();
    },

    deleteSelectedMembers: async () => {
        if (confirm(`Delete ${app.selectedMembers.size} members?`)) {
            const ids = Array.from(app.selectedMembers);
            const res = await window.pywebview.api.delete_members(ids);
            if (res.status === 'success') {
                app.showToast(res.message);
                app.toggleSelectionMode(); // Exit mode
                await app.loadData();
                app.renderMembersList();
            } else {
                app.showToast("Bulk delete failed");
            }
        }
    },

    changePage: (delta) => {
        const totalPages = Math.ceil(app.filteredMembers.length / app.itemsPerPage) || 1;
        if (app.currentPage + delta >= 1 && app.currentPage + delta <= totalPages) {
            app.currentPage += delta;
            app.renderMembersList();
        }
    },

    createMemberCard: (member) => {
        // Use the first schema field as the title, usually Name
        const titleField = app.schema.length > 0 ? app.schema[0].id : 'id';
        const title = member[titleField] || 'Unknown';
        const subtitleField = app.schema.length > 1 ? app.schema[1].id : null;
        let subtitle = '';

        if (subtitleField) {
            subtitle = member[subtitleField];
            // Format check for booleans (checkboxes)
            if (typeof subtitle === 'boolean') {
                subtitle = subtitle ? 'Yes' : 'No';
            }
        }

        // Human Readable ID
        const shortId = member.short_id || 'MEM-???';

        // Photo: handle absolute paths from backend
        // If path has backslashes, replace with forward slashes for CSS url()
        const photoUrl = member.photo ? member.photo.replace(/\\/g, '/') : null;

        const photoHtml = photoUrl
            ? `<div style="width: 50px; height: 50px; border-radius: 50%; background-image: url('${photoUrl}'); background-size: cover; background-position: center; margin-right: 15px; border: 2px solid rgba(255,255,255,0.1);"></div>`
            : `<div style="width: 50px; height: 50px; border-radius: 50%; background: rgba(255,255,255,0.1); display: flex; align-items: center; justify-content: center; margin-right: 15px;"><i class="fas fa-user" style="font-size: 1.2rem; color: #fff;"></i></div>`;

        // Checkbox for selection
        const checkboxHtml = app.selectionMode
            ? `<input type="checkbox" style="margin-right: 15px; width: 20px; height: 20px; cursor: pointer;" ${app.selectedMembers.has(member.id) ? 'checked' : ''} onclick="app.toggleMemberSelection('${member.id}', event)">`
            : '';

        // Click handler: if selection mode, toggle. Else open modal.
        const clickHandler = app.selectionMode
            ? `app.toggleMemberSelection('${member.id}', event)`
            : `app.openMemberModal('${member.id}')`;

        return `
            <div class="member-card" onclick="${clickHandler}" style="display: flex; align-items: center; text-align: left; padding: 15px; cursor: pointer;">
                ${checkboxHtml}
                ${photoHtml}
                <div style="flex: 1; min-width: 0;">
                    <div style="font-size: 0.75rem; color: var(--primary-color); margin-bottom: 2px; font-weight: bold; letter-spacing: 0.5px;">${shortId}</div>
                    <h3 style="margin: 0; font-size: 1.1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${title}</h3>
                    <p style="margin: 2px 0; font-size: 0.9rem; color: #aaa; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${subtitle || ''}</p>
                </div>
                <small style="background: rgba(0, 243, 255, 0.1); padding: 4px 8px; border-radius: 12px; color: var(--primary-color); font-size: 0.75rem; margin-left: 10px;">${member.category || 'Uncategorized'}</small>
            </div>
        `;
    },

    // Forms
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
                const defaultOpt = document.createElement('option');
                defaultOpt.value = "";
                defaultOpt.innerText = "-- Select --";
                input.appendChild(defaultOpt);

                if (field.options) {
                    field.options.split(',').forEach(opt => {
                        const val = opt.trim();
                        if (val) {
                            const option = document.createElement('option');
                            option.value = val;
                            option.innerText = val;
                            input.appendChild(option);
                        }
                    });
                }
            } else {
                input = document.createElement('input');
                input.type = field.type;
            }

            input.name = field.id;
            input.required = field.required || false;

            if (field.type === 'checkbox') {
                div.style.flexDirection = 'row';
                div.style.alignItems = 'center';
                div.style.gap = '10px';

                label.innerText = labelText;
                label.style.width = 'auto';
                label.style.margin = '0';

                input.style.width = 'auto';
                input.style.margin = '0';

                div.appendChild(input);
                div.appendChild(label);
            } else {
                div.appendChild(label);
                div.appendChild(input);
            }

            container.appendChild(div);
        });

        // Add Photo Upload Field (Custom)
        const photoDiv = document.createElement('div');
        photoDiv.className = 'form-group';
        photoDiv.style.marginTop = '20px';
        photoDiv.innerHTML = `
            <label>Member Photo</label>
            <div style="display: flex; gap: 15px; align-items: center; background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px;">
                <div id="photo-preview" style="width: 60px; height: 60px; border-radius: 50%; background: #444; background-size: cover; background-position: center; display: none;"></div>
                <div style="flex: 1;">
                    <span id="photo-filename" style="font-size: 0.9rem; color: #aaa; display: block; margin-bottom: 5px;">No file chosen</span>
                    <button type="button" class="secondary" onclick="document.getElementById('photo-upload').click()" style="font-size: 0.9rem; padding: 5px 10px;">Choose Image</button>
                    <input type="file" id="photo-upload" accept="image/*" style="display: none;" onchange="app.handleImageUpload(this)">
                    <input type="hidden" name="photo" id="member-photo-hidden">
                </div>
                <button type="button" class="danger" style="padding: 5px 10px; font-size: 0.9rem;" onclick="app.clearPhoto()">Remove</button>
            </div>
        `;
        container.appendChild(photoDiv);
    },

    handleImageUpload: (input) => {
        const file = input.files[0];
        if (!file) return;

        document.getElementById('photo-filename').innerText = file.name;

        const reader = new FileReader();
        reader.onload = async (e) => {
            const base64 = e.target.result;
            // Send to backend to save
            const res = await window.pywebview.api.save_image(base64);
            if (res.status === 'success') {
                document.getElementById('member-photo-hidden').value = res.path;
                const preview = document.getElementById('photo-preview');
                preview.style.display = 'block';
                preview.style.backgroundImage = `url('${res.path.replace(/\\/g, '/')}')`;
            } else {
                app.showToast("Image upload failed");
            }
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
        const selects = [document.getElementById('member-category-select'), document.getElementById('category-filter'), document.getElementById('setting-default-category')];
        selects.forEach(select => {
            if (!select) return;
            const currentVal = select.value;
            // keep first option if it's the filter
            let html = select.id === 'category-filter' ? '<option value="">All Categories</option>' : '';

            app.categories.forEach(cat => {
                html += `<option value="${cat}">${cat}</option>`;
            });
            select.innerHTML = html;

            // Special handling for default category setting
            if (select.id === 'setting-default-category' && app.settings.default_category) {
                select.value = app.settings.default_category;
            } else if (select.id === 'member-category-select' && !currentVal && app.settings.default_category) {
                select.value = app.settings.default_category;
            } else {
                select.value = currentVal;
            }
        });

        // Settings page list
        const list = document.getElementById('categories-list');
        if (list) {
            list.innerHTML = app.categories.map(c => `
                <li style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; background: rgba(255,255,255,0.05); padding: 5px 10px; border-radius: 4px;">
                    ${c}
                    <button class="danger" style="padding: 2px 8px; font-size: 0.8rem;" onclick="app.deleteCategory('${c}')">Delete</button>
                </li>
            `).join('');
        }
    },

    deleteCategory: async (category) => {
        if (category === 'General') {
            app.showToast("Cannot delete General category");
            return;
        }
        if (confirm(`Delete category '${category}'? Members will be set to 'Uncategorized'.`)) {
            const res = await window.pywebview.api.delete_category(category);
            if (res.status === 'success') {
                app.categories = app.categories.filter(c => c !== category);
                app.renderCategorySelects();
                app.showToast('Category deleted');
            }
        }
    },

    // Actions
    saveMember: async (e) => {
        e.preventDefault();
        const form = document.getElementById('add-member-form');
        const formData = new FormData(form);
        const member = {};

        // ID (if editing)
        const id = document.getElementById('member-id-hidden').value;
        if (id) member['id'] = id;

        // Collect dynamic fields
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

        // Duplicate Check (Name)
        if (!member['id']) { // Only check on create
            const titleField = app.schema.length > 0 ? app.schema[0].id : 'id';
            const newName = member[titleField];
            if (newName) {
                // Check exact match (or case insensitive? let's do case insensitive for name)
                const duplicate = app.members.find(m => {
                    const mName = m[titleField] || '';
                    return mName.toString().toLowerCase() === newName.toString().toLowerCase();
                });
                if (duplicate && !confirm(`A member named "${newName}" already exists (ID: ${duplicate.short_id || 'Unknown'}). Continue?`)) {
                    return;
                }
            }

            // Generate Short ID
            // Format: MEM-001
            let maxId = 0;
            app.members.forEach(m => {
                if (m.short_id && m.short_id.startsWith('MEM-')) {
                    const num = parseInt(m.short_id.split('-')[1]);
                    if (!isNaN(num) && num > maxId) maxId = num;
                }
            });
            member['short_id'] = `MEM-${String(maxId + 1).padStart(3, '0')}`;
        } else {
            // Keep existing short_id if editing
            const existing = app.members.find(m => m.id === member['id']);
            if (existing) member['short_id'] = existing.short_id;
            else if (!member.short_id) {
                // If editing but lost ID somehow, regen? No, just keep as is or gen new if critical.
                // Let's safe gen just in case
                let maxId = 0;
                app.members.forEach(m => {
                    if (m.short_id && m.short_id.startsWith('MEM-')) {
                        const num = parseInt(m.short_id.split('-')[1]);
                        if (!isNaN(num) && num > maxId) maxId = num;
                    }
                });
                member['short_id'] = `MEM-${String(maxId + 1).padStart(3, '0')}`;
            }
        }

        const res = await window.pywebview.api.save_member(member);
        if (res.status === 'success') {
            app.showToast('Member saved!');
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
    },

    editMember: (id) => {
        const member = app.members.find(m => m.id === id);
        if (!member) return;

        app.closeModal();
        app.navigate('add-member');
        document.getElementById('add-member-title').innerText = 'Edit Member';
        document.getElementById('member-id-hidden').value = member.id;

        // Fill fields
        app.schema.forEach(field => {
            const input = document.querySelector(`[name="${field.id}"]`);
            if (input) {
                if (field.type === 'checkbox') {
                    input.checked = member[field.id] === true || member[field.id] === 'true';
                } else {
                    input.value = member[field.id] || '';
                }
            }
        });

        const catSelect = document.getElementById('member-category-select');
        if (catSelect) catSelect.value = member.category;

        // Photo
        if (member.photo) {
            document.getElementById('member-photo-hidden').value = member.photo;
            const preview = document.getElementById('photo-preview');
            preview.style.display = 'block';
            preview.style.backgroundImage = `url('${member.photo.replace(/\\/g, '/')}')`;
        } else {
            app.clearPhoto();
        }
    },

    // Schema Builder
    renderSchemaTable: () => {
        const tbody = document.querySelector('#schema-table tbody');
        tbody.innerHTML = app.schema.map((field, index) => `
            <tr>
                <td><input type="text" value="${field.label}" onchange="app.updateSchemaField(${index}, 'label', this.value)" placeholder="Label"></td>
                <td>
                    <select onchange="app.updateSchemaField(${index}, 'type', this.value)">
                        <option value="text" ${field.type === 'text' ? 'selected' : ''}>Text</option>
                        <option value="textarea" ${field.type === 'textarea' ? 'selected' : ''}>Text Area</option>
                        <option value="number" ${field.type === 'number' ? 'selected' : ''}>Number</option>
                        <option value="date" ${field.type === 'date' ? 'selected' : ''}>Date</option>
                        <option value="email" ${field.type === 'email' ? 'selected' : ''}>Email</option>
                        <option value="tel" ${field.type === 'tel' ? 'selected' : ''}>Phone</option>
                        <option value="url" ${field.type === 'url' ? 'selected' : ''}>URL</option>
                        <option value="select" ${field.type === 'select' ? 'selected' : ''}>Dropdown (Select)</option>
                        <option value="checkbox" ${field.type === 'checkbox' ? 'selected' : ''}>Checkbox</option>
                    </select>
                </td>
                <td>
                    <input type="text" 
                        value="${field.options || ''}" 
                        onchange="app.updateSchemaField(${index}, 'options', this.value)" 
                        placeholder="Options (comma separated)"
                        style="display: ${field.type === 'select' ? 'block' : 'none'}; width: 100%;">
                </td>
                <td style="text-align: center;">
                    <input type="checkbox" ${field.required ? 'checked' : ''} onchange="app.updateSchemaField(${index}, 'required', this.checked)">
                </td>
                <td><button class="danger" onclick="app.removeSchemaField(${index})">Remove</button></td>
            </tr>
        `).join('');
    },

    addSchemaRow: () => {
        const id = 'field_' + Date.now();
        app.schema.push({ id: id, label: 'New Field', type: 'text', required: true, options: '' });
        app.renderSchemaTable();
    },

    updateSchemaField: (index, key, value) => {
        app.schema[index][key] = value;
        if (key === 'type') app.renderSchemaTable();
    },

    removeSchemaField: (index) => {
        app.schema.splice(index, 1);
        app.renderSchemaTable();
    },

    saveSchema: async () => {
        const res = await window.pywebview.api.save_schema(app.schema);
        if (res.status === 'success') {
            app.showToast('Schema updated!');
            await app.loadData(); // Re-render forms
        }
    },

    // Categories
    addCategory: async () => {
        const input = document.getElementById('new-category-input');
        const val = input.value.trim();
        if (val && !app.categories.includes(val)) {
            app.categories.push(val);
            const res = await window.pywebview.api.save_categories(app.categories);
            if (res.status === 'success') {
                input.value = '';
                app.renderCategorySelects();
                app.showToast('Category added');
            }
        }
    },

    // Modal
    openMemberModal: (id) => {
        const member = app.members.find(m => m.id === id);
        if (!member) return;

        const shortId = member.short_id || member.id;

        let html = ``;

        // Header with photo and ID
        if (member.photo) {
            html += `<div style="text-align: center; margin-bottom: 20px;">
                        <img src="${member.photo.replace(/\\/g, '/')}" style="height: 120px; width: 120px; object-fit: cover; border-radius: 50%; box-shadow: 0 4px 15px rgba(0,0,0,0.5); border: 3px solid rgba(255,255,255,0.1);">
                        <div style="margin-top: 10px; font-weight: bold; font-size: 1.2rem; color: var(--primary-color);">${shortId}</div>
                      </div>`;
        } else {
            html += `<div style="text-align: center; margin-bottom: 20px;">
                        <div style="height: 120px; width: 120px; margin: 0 auto; background: rgba(255,255,255,0.1); border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                            <i class="fas fa-user" style="font-size: 3rem; color: #fff;"></i>
                        </div>
                        <div style="margin-top: 10px; font-weight: bold; font-size: 1.2rem; color: var(--primary-color);">${shortId}</div>
                      </div>`;
        }

        html += `<h2>${member[app.schema[0].id] || 'Details'}</h2>`;
        html += `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; background: rgba(0,0,0,0.2); padding: 15px; border-radius: 8px;">`;

        app.schema.forEach(field => {
            let val = member[field.id];
            if (val === undefined || val === null) val = '-';
            if (val === true) val = 'Yes';
            if (val === false) val = 'No';
            // If it's the title field (name) we already showed it as H2, but okay to show again in grid
            html += `<div><strong>${field.label}:</strong> <p style="margin: 5px 0;">${val}</p></div>`;
        });

        html += `<div><strong>Category:</strong> <p style="margin: 5px 0;">${member.category}</p></div>`;
        html += `</div>`;

        document.getElementById('modal-body').innerHTML = html;

        // Modal Actions
        const footer = document.querySelector('#member-modal .modal-content div[style*="text-align: right"]');
        footer.innerHTML = '';

        const editBtn = document.createElement('button');
        editBtn.innerText = 'Edit';
        editBtn.style.marginRight = '10px';
        editBtn.onclick = () => app.editMember(id);
        footer.appendChild(editBtn);

        const exportBtn = document.createElement('button');
        exportBtn.innerText = 'Export PDF';
        exportBtn.className = 'secondary';
        exportBtn.style.marginRight = '10px';
        exportBtn.onclick = () => app.exportSingleMemberPDF(member);
        footer.appendChild(exportBtn);

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'danger';
        deleteBtn.innerText = 'Delete Member';
        deleteBtn.onclick = () => app.deleteMember(id);
        footer.appendChild(deleteBtn);

        document.getElementById('member-modal').style.display = 'flex';
    },

    closeModal: () => {
        document.getElementById('member-modal').style.display = 'none';
    },

    deleteMember: async (id) => {
        if (confirm('Are you sure you want to delete this member?')) {
            const res = await window.pywebview.api.delete_member(id);
            if (res.status === 'success') {
                app.closeModal();
                app.showToast('Member deleted');
                await app.loadData();
                app.renderDashboard();
                app.filterMembers();
            }
        }
    },

    exportSingleMemberPDF: async (member) => {
        try {
            if (!window.jspdf) {
                app.showToast('PDF Library not loaded. Please wait.');
                return;
            }

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF({ unit: 'pt', format: 'a4' });

            doc.setFontSize(18);
            doc.text('Member Report', 40, 48);

            doc.setFontSize(11);
            const dateStr = new Date().toLocaleString();
            doc.text(`Generated: ${dateStr}`, 40, 68);

            // Build rows [label, value]
            const rows = [];
            // include basic id and short_id first
            rows.push(['ID', member.id || '']);
            if (member.short_id) rows.push(['Short ID', member.short_id]);

            // schema fields
            app.schema.forEach(field => {
                let val = member[field.id];
                if (val === undefined || val === null) val = '';
                if (val === true) val = 'Yes';
                if (val === false) val = 'No';
                rows.push([field.label, String(val)]);
            });

            // category
            rows.push(['Category', member.category || 'Uncategorized']);

            // Add photo path if present
            if (member.photo) rows.push(['Photo', member.photo]);

            // Render table using autoTable
            doc.autoTable({
                head: [['Field', 'Value']],
                body: rows,
                startY: 100,
                theme: 'grid',
                styles: { fontSize: 10 },
                headStyles: { fillColor: [0, 212, 255] }
            });

            const pdfData = doc.output('datauristring');
            const res = await window.pywebview.api.save_pdf(pdfData);
            if (res.status === 'success') {
                app.showToast(`PDF saved to ${res.path}`);
            } else {
                app.showToast(res.message || 'Export cancelled');
            }
        } catch (e) {
            console.error('Single member PDF export failed', e);
            app.showToast('Export failed');
        }
    },

    // Utils
    debounce: (func, wait) => {
        let timeout;
        return function (...args) {
            const context = this;
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(context, args), wait);
        };
    },

    filterMembers: (render = true) => {
        // If it's an event (from oninput), we might want to debounce, but the architecture calls this directly.
        // Let's wrap the heavy lifting.
        app._performFilter(render);
    },

    _performFilter: (render) => {
        const searchInput = document.getElementById('search-bar');
        const categoryInput = document.getElementById('category-filter');
        const sortInput = document.getElementById('sort-order');

        const query = searchInput ? searchInput.value.toLowerCase() : '';
        const category = categoryInput ? categoryInput.value : '';
        const sortOrder = sortInput ? sortInput.value : app.currentSort;

        let filtered = app.members.filter(m => {
            const matchesQuery = app.schema.some(field => {
                const val = (m[field.id] || '').toString().toLowerCase();
                return val.includes(query);
            });
            // Also search short_id
            const matchesId = (m.short_id || '').toLowerCase().includes(query);

            const matchesCategory = category ? m.category === category : true;
            return (matchesQuery || matchesId) && matchesCategory;
        });

        filtered.sort((a, b) => {
            if (sortOrder === 'newest') return 0;

            const titleField = app.schema.length > 0 ? app.schema[0].id : 'id';
            const valA = (a[titleField] || '').toString().toLowerCase();
            const valB = (b[titleField] || '').toString().toLowerCase();

            if (sortOrder === 'az') return valA.localeCompare(valB);
            if (sortOrder === 'za') return valB.localeCompare(valA);

            return 0;
        });

        if (sortOrder === 'newest') {
            filtered.reverse();
        }

        app.filteredMembers = filtered;
        app.currentPage = 1;

        if (render) app.renderMembersList();
    },

    exportData: async () => {
        console.log("exportData called");
        try {
            const res = await window.pywebview.api.export_json_file();
            if (res.status === 'success') {
                app.showToast(`JSON saved to ${res.path}`);
            } else {
                app.showToast(res.message || 'Export cancelled');
            }
        } catch (e) {
            console.error("JSON Export Error:", e);
            app.showToast("JSON Export failed: " + e.message);
        }
    },

    exportPDF: async () => {
        console.log("exportPDF called");
        try {
            if (!window.jspdf) {
                app.showToast("PDF Library not loaded. Please wait or check connection.");
                return;
            }
            if (!app.members || app.members.length === 0) {
                app.showToast("No members to export");
                return;
            }

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            doc.setFontSize(18);
            doc.text("Members Report", 14, 22);

            doc.setFontSize(11);
            doc.setTextColor(100);
            const dateStr = new Date().toLocaleDateString();
            doc.text(`Generated on: ${dateStr}`, 14, 30);
            doc.text(`Total Members: ${app.members.length}`, 14, 36);

            // include all schema fields in the report, preserving order
            const headers = [['ID', 'Category']];
            const dataKeys = ['short_id', 'category'];

            // insert each schema column before the final 'Category' column
            app.schema.forEach(field => {
                headers[0].splice(headers[0].length - 1, 0, field.label);
                dataKeys.splice(dataKeys.length - 1, 0, field.id);
            });

            const data = app.members.map(m => {
                return dataKeys.map(key => {
                    let val = m[key];
                    if (val === undefined || val === null) return '';
                    if (val === true) return 'Yes';
                    if (val === false) return 'No';
                    return String(val);
                });
            });

            doc.autoTable({
                head: headers,
                body: data,
                startY: 44,
                theme: 'grid',
                styles: { fontSize: 8 },
                headStyles: { fillColor: [0, 212, 255] }
            });

            // export blob to backend for saving rather than using anchor
            const pdfData = doc.output('datauristring');
            const res = await window.pywebview.api.save_pdf(pdfData);
            if (res.status === 'success') {
                app.showToast(`PDF saved to ${res.path}`);
            } else {
                app.showToast(res.message || 'Export cancelled');
            }
        } catch (e) {
            console.error("PDF Export Error:", e);
            app.showToast("PDF Export failed: " + e.message);
        }
    },

    exportCSV: async () => {
        console.log("exportCSV called");
        try {
            const res = await window.pywebview.api.export_csv_file();
            if (res.status === 'success') {
                app.showToast(`CSV saved to ${res.path}`);
            } else {
                app.showToast(res.message || 'Export cancelled');
            }
        } catch (e) {
            console.error(e);
            app.showToast("Export failed");
        }
    },

    importData: (input) => {
        const file = input.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async (e) => {
            const text = e.target.result;
            try {
                let data;
                if (file.name.endsWith('.csv')) {
                    const lines = text.split('\n');
                    const headers = lines[0].split(',').map(h => h.trim());
                    data = lines.slice(1).filter(l => l.trim()).map(line => {
                        const values = line.split(',');
                        const obj = {};
                        headers.forEach((h, i) => obj[h] = values[i] ? values[i].trim() : '');
                        return obj;
                    });
                } else {
                    data = JSON.parse(text);
                }

                const res = await window.pywebview.api.import_members(data);
                app.showToast(res.message);
                await app.loadData();
                app.renderMembersList();

            } catch (err) {
                app.showToast("Invalid file format");
                console.error(err);
            }
            input.value = ''; // Reset
        };
        reader.readAsText(file);
    },

    backupData: async () => {
        const res = await window.pywebview.api.backup_data();
        app.showToast(res.message);
        app.renderBackups();
    },

    renderBackups: async () => {
        const backups = await window.pywebview.api.get_backups();
        const container = document.getElementById('backups-list');
        if (!container) return;

        if (backups.length === 0) {
            container.innerHTML = '<p style="color: #666;">No backups found.</p>';
            return;
        }

        container.innerHTML = backups.map(b => `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; background: rgba(255,255,255,0.05); padding: 10px; border-radius: 6px;">
                <span>${b}</span>
                <div style="display: flex; gap: 8px;">
                    <button class="secondary" style="padding: 5px 10px; font-size: 0.9rem;" onclick="app.restoreBackup('${b}')">Restore</button>
                    <button class="danger" style="padding: 5px 10px; font-size: 0.9rem;" onclick="app.deleteBackup('${b}')">Delete</button>
                </div>
            </div>
        `).join('');
    },

    restoreBackup: async (id) => {
        if (confirm(`Restore backup from ${id}? Current data will be overwritten.`)) {
            const res = await window.pywebview.api.restore_backup(id);
            if (res.status === 'success') {
                app.showToast(res.message);
                setTimeout(() => window.location.reload(), 1000); // Reload app to accept new data
            } else {
                app.showToast("Restore failed");
            }
        }
    },

    deleteBackup: async (id) => {
        if (confirm(`Permanently delete backup "${id}"? This cannot be undone.`)) {
            const res = await window.pywebview.api.delete_backup(id);
            if (res.status === 'success') {
                app.showToast('Backup deleted');
                app.renderBackups();
            } else {
                app.showToast('Delete failed');
            }
        }
    },

    // Settings & Integrity
    renderSettingsUI: () => {
        const themeSelect = document.getElementById('setting-theme');
        const catSelect = document.getElementById('setting-default-category');
        const dateSelect = document.getElementById('setting-date-format');

        if (themeSelect) themeSelect.value = app.settings.theme || 'dark';
        if (catSelect) catSelect.value = app.settings.default_category || 'General';
        if (dateSelect) dateSelect.value = app.settings.date_format || 'YYYY-MM-DD';
    },

    saveSettings: async () => {
        const themeSelect = document.getElementById('setting-theme');
        const catSelect = document.getElementById('setting-default-category');
        const dateSelect = document.getElementById('setting-date-format');

        app.settings.theme = themeSelect.value;
        app.settings.default_category = catSelect.value;
        app.settings.date_format = dateSelect.value;

        app.applySettings();

        const res = await window.pywebview.api.save_settings(app.settings);
        if (res.status === 'success') {
            app.showToast("Settings saved");
        }
    },

    applySettings: () => {
        // Theme
        if (app.settings.theme === 'light') {
            document.body.classList.add('light-theme');
        } else {
            document.body.classList.remove('light-theme');
        }
    },

    runIntegrityCheck: () => {
        const container = document.getElementById('integrity-results');
        container.style.display = 'block';
        container.innerHTML = '<p>Scanning...</p>';

        const issues = [];

        app.members.forEach(m => {
            const missing = [];
            app.schema.forEach(field => {
                if (field.required) {
                    const val = m[field.id];
                    if (val === undefined || val === null || val === '') {
                        missing.push(field.label);
                    }
                }
            });

            if (missing.length > 0) {
                issues.push({ member: m, missing: missing });
            }
        });

        if (issues.length === 0) {
            container.innerHTML = '<p style="color: #4caf50;"><i class="fas fa-check-circle"></i> No issues found. All members meet schema requirements.</p>';
        } else {
            container.innerHTML = `<p style="color: #ff5252;">Found ${issues.length} members with missing data:</p>` +
                issues.map(i => `
                    <div style="background: rgba(255,0,0,0.1); padding: 10px; margin-bottom: 5px; border-radius: 4px; display: flex; justify-content: space-between; align-items: center;">
                        <div>
                            <strong>${i.member[app.schema[0].id] || 'Unknown'}</strong> (${i.member.short_id || i.member.id})
                            <div style="font-size: 0.8rem; color: #ffaaaa;">Missing: ${i.missing.join(', ')}</div>
                        </div>
                        <button class="secondary" onclick="app.editMember('${i.member.id}')">Fix</button>
                    </div>
                `).join('');
        }
    },

    showToast: (msg) => {
        const x = document.getElementById("toast");
        x.innerText = msg;
        x.className = "show";
        setTimeout(function () { x.className = x.className.replace("show", ""); }, 3000);
    }
};

// Event Listeners
document.getElementById('add-member-form').onsubmit = app.saveMember;

// Init
app.init();
