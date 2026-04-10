    let currentFolder = 'All';

    function escapeHTML(str) {
      if (str == null) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    async function fetchData(url) {
      const res = await fetch(url);
      return res.json();
    }

    function switchTab(event, tabId) {
      document.querySelectorAll('.content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.nav button').forEach(el => el.classList.remove('active'));
      document.getElementById(tabId).classList.add('active');
      if (event && event.target) {
        event.target.classList.add('active');
      }
      loadData();
    }

    function formatTime(ts) {
      return new Date(ts).toLocaleTimeString();
    }

    async function toggleRule(id, isActive) {
      await fetch(`/api/rules/${id}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive })
      });
    }

    async function deleteRule(id) {
      if(confirm('Delete this rule?')) {
        await fetch(`/api/rules/${id}`, { method: 'DELETE' });
        loadData();
      }
    }

    async function clearAllLogs() {
      if(confirm('Are you sure you want to clear all traffic logs permanently?')) {
        await fetch('/api/logs', { method: 'DELETE' });
        loadData();
      }
    }

    async function clearAllRules() {
      if(confirm('Are you sure you want to clear ALL interception rules permanently?')) {
        await fetch('/api/rules', { method: 'DELETE' });
        loadData();
      }
    }

    function renderRules(rules) {
      const container = document.getElementById('rulesContainer');
      container.innerHTML = '';
      
      const filtered = currentFolder === 'All' ? rules : rules.filter(r => r.folder === currentFolder);
      if (filtered.length === 0) {
        container.innerHTML = '<p>No rules found.</p>';
        return;
      }

      filtered.forEach(rule => {
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
          <div class="card-header">
            <div>
              <strong>${escapeHTML(rule.name)}</strong>
              <span class="tag folder">${escapeHTML(rule.folder)}</span>
              <span class="tag action">${escapeHTML((rule.action || 'unknown').toUpperCase())}</span>
            </div>
            <div style="display:flex; gap:10px; align-items:center;">
              <label class="switch">
                <input type="checkbox" ${rule.isActive ? 'checked' : ''} onchange="toggleRule('${escapeHTML(rule.id)}', this.checked)">
                <span class="slider"></span>
              </label>
              <button class="btn-danger" onclick="deleteRule('${escapeHTML(rule.id)}')">Delete</button>
            </div>
          </div>
          <div style="font-size:13px;">
            <p><strong>Match:</strong> ${escapeHTML(rule.method || 'ANY')} ${escapeHTML(rule.urlPattern)}</p>
            ${rule.modifiedBody ? `<p><strong>Override Body:</strong></p><pre>${escapeHTML(rule.modifiedBody)}</pre>` : ''}
            ${rule.modifiedResponseBody ? `<p><strong>Override Response Body:</strong></p><pre>${escapeHTML(rule.modifiedResponseBody)}</pre>` : ''}
          </div>
        `;
        container.appendChild(card);
      });
    }

    function renderLogs(logs) {
      const container = document.getElementById('logsContainer');
      container.innerHTML = '';
      
      const filtered = currentFolder === 'All' ? logs : logs.filter(l => l.folder === currentFolder);
      if (filtered.length === 0) {
        container.innerHTML = '<p>No traffic logs found.</p>';
        return;
      }

      filtered.forEach(log => {
        const card = document.createElement('div');
        card.className = 'card';
        const isErr = log.responseStatusCode >= 400;
        card.innerHTML = `
          <div class="card-header">
            <div style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 80%;">
              <span class="tag method">${escapeHTML(log.method)}</span>
              <span class="tag ${isErr ? 'status-err' : 'status-ok'}">${escapeHTML(log.responseStatusCode || '...')}</span>
              <strong style="font-size: 13px;">${escapeHTML(log.url)}</strong>
            </div>
            <div style="font-size: 12px; color: #858585;">
              ${escapeHTML(formatTime(log.timestamp))}
            </div>
          </div>
          <div style="font-size:13px;">
            <span class="tag folder">${escapeHTML(log.folder)}</span>
            <span class="tag">Mode: ${escapeHTML(log.mode)}</span>
            ${log.requestBody ? `<details><summary style="cursor:pointer; margin-top:5px; color:#4fc1ff;">Show Request Body</summary><pre>${escapeHTML(log.requestBody)}</pre></details>` : ''}
            ${log.responseBody ? `<details><summary style="cursor:pointer; margin-top:5px; color:#4fc1ff;">Show Response Body</summary><pre>${escapeHTML(log.responseBody)}</pre></details>` : ''}
          </div>
        `;
        container.appendChild(card);
      });
    }

    function updateFolders(rules, logs) {
      const folders = new Set(['All']);
      rules.forEach(r => folders.add(r.folder));
      logs.forEach(l => folders.add(l.folder));
      
      const list = document.getElementById('folderList');
      list.innerHTML = '';
      
      folders.forEach(f => {
        const li = document.createElement('li');
        li.textContent = f;
        li.dataset.folder = f;
        if(f === currentFolder) li.classList.add('active');
        
        li.onclick = () => {
          currentFolder = f;
          document.querySelectorAll('.folder-list li').forEach(el => el.classList.remove('active'));
          li.classList.add('active');
          loadData();
        };
        list.appendChild(li);
      });
    }

    async function loadData() {
      const [rules, logs] = await Promise.all([
        fetchData('/api/rules'),
        fetchData('/api/logs')
      ]);
      
      updateFolders(rules, logs);
      renderRules(rules);
      renderLogs(logs);
    }

    // Auto-refresh every 3 seconds
    setInterval(loadData, 3000);
    loadData();
